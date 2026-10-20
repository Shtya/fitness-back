import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
	OnModuleDestroy,
	OnModuleInit,
	ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import {
	CreateWhatsAppContactDto,
	LookupWhatsAppNumberDto,
	StartWhatsAppContactChatDto,
	UpdateWhatsAppContactDto,
} from '../dto/whatsapp-contacts.dto';
import {
	WhatsAppContact,
	WhatsAppContactSyncOp,
	WhatsAppContactSyncStatus,
	WhatsAppConversation,
	WhatsAppConversationType,
} from '../entities/whatsapp.entity';
import {
	WhatsAppNumberProfile,
	WhatsAppProvider,
	WhatsAppProviderUnavailableError,
} from '../providers/whatsapp-provider';
import {
	ContactPhone,
	ContactPhoneError,
	describeStoredPhone,
	normalizeContactPhone,
} from '../utils/whatsapp-contact-phone';
import { resolveWhatsAppContactLabel } from '../utils/whatsapp-contact-name';
import { assertNumberLookupRateLimit } from '../utils/whatsapp-send-rate-limit';
import { WhatsAppAccessService } from './whatsapp-access.service';
import { WhatsAppAuditService } from './whatsapp-audit.service';
import { WhatsAppProviderManagerService } from './whatsapp-provider-manager.service';
import { WhatsAppSyncService } from './whatsapp-sync.service';

export type NumberRegistration = 'registered' | 'not_registered' | 'unknown';
export type UnknownReason = 'not_connected' | 'unsupported' | 'error';

interface RegistrationCheck {
	status: NumberRegistration;
	chatId: string | null;
	reason: UnknownReason | null;
	checkedAt: Date;
}

const REGISTRATION_TTL_MS = 10 * 60_000;
const PROFILE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 2_000;
const MAX_SYNC_ATTEMPTS = 5;
const SYNC_SWEEP_MS = 60_000;
const SYNC_STALE_MS = 5 * 60_000;
const SYNC_SWEEP_BATCH = 20;
const NOT_CONNECTED_RETRY_MS = 2 * 60_000;

const UNKNOWN_MESSAGES: Record<UnknownReason, string> = {
	not_connected: 'WhatsApp account is not connected, so the number could not be checked',
	unsupported: 'The connected WhatsApp integration cannot check numbers',
	error: 'WhatsApp did not answer the number check',
};

function trimMap<K, V>(map: Map<K, V>) {
	while (map.size > CACHE_MAX) {
		const first = map.keys().next().value as K;
		map.delete(first);
	}
}

function chatIdForDigits(digits: string) {
	return `${digits}@c.us`;
}

function isPhoneChatId(waId?: string | null) {
	const id = String(waId || '');
	return id.endsWith('@c.us') || id.endsWith('@s.whatsapp.net');
}

/** Stored sync errors; the code is derived back from the text so clients can localize it. */
const SYNC_ERRORS = {
	NOT_CONNECTED: 'WhatsApp account is not connected. It will be retried when it reconnects.',
	INTEGRATION_UNSUPPORTED: 'The connected WhatsApp integration cannot change WhatsApp contacts',
	NO_PHONE: 'This contact has no phone number',
	NOT_ON_WHATSAPP: 'This number is not on WhatsApp, so WhatsApp cannot store it',
	NAME_REQUIRED: 'Add a name before saving to WhatsApp',
	APP_STATE_KEYS: 'WhatsApp has not shared contact-sync keys with this linked device yet. Retry after the phone finishes syncing.',
	TIMEOUT: 'WhatsApp did not confirm the change in time',
	CONNECTION_DROPPED: 'WhatsApp connection dropped before the change was confirmed',
	REJECTED: 'WhatsApp rejected the contact change',
	UNVERIFIED: 'WhatsApp could not verify this number yet',
} as const;
type SyncErrorCode = keyof typeof SYNC_ERRORS;

function syncErrorCode(message?: string | null): SyncErrorCode | null {
	if (!message) return null;
	const hit = (Object.keys(SYNC_ERRORS) as SyncErrorCode[]).find((code) => SYNC_ERRORS[code] === message);
	return hit || null;
}

/** Keeps errors useful without echoing names, numbers or provider internals. */
function syncErrorMessage(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error || '');
	if (/app state key not present/i.test(text)) return SYNC_ERRORS.APP_STATE_KEYS;
	if (/timed out/i.test(text)) return SYNC_ERRORS.TIMEOUT;
	if (/not connected|connection closed|socket/i.test(text)) return SYNC_ERRORS.CONNECTION_DROPPED;
	return SYNC_ERRORS.REJECTED;
}

@Injectable()
export class WhatsAppContactsService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(WhatsAppContactsService.name);
	private readonly registrationCache = new Map<string, RegistrationCheck>();
	private readonly registrationInFlight = new Map<string, Promise<RegistrationCheck>>();
	private readonly profileCache = new Map<string, { at: number; profile: WhatsAppNumberProfile }>();
	private sweepTimer: NodeJS.Timeout | null = null;
	private sweeping = false;

	constructor(
		@InjectRepository(WhatsAppContact)
		private readonly contactRepo: Repository<WhatsAppContact>,
		@InjectRepository(WhatsAppConversation)
		private readonly conversationRepo: Repository<WhatsAppConversation>,
		private readonly access: WhatsAppAccessService,
		private readonly providers: WhatsAppProviderManagerService,
		private readonly sync: WhatsAppSyncService,
		private readonly audit: WhatsAppAuditService,
	) {}

	onModuleInit() {
		if (process.env.NODE_ENV === 'test') return;
		this.sweepTimer = setInterval(() => void this.sweepPendingSyncs(), SYNC_SWEEP_MS);
		this.sweepTimer.unref?.();
	}

	onModuleDestroy() {
		if (this.sweepTimer) clearInterval(this.sweepTimer);
		this.sweepTimer = null;
	}

	// ── Access ──────────────────────────────────────────────────────────────

	private async accessFor(user: User, accountId: string, need: 'view' | 'use') {
		const accountAccess = await this.access.getAccountAccess(user, accountId);
		if (need === 'use' && !accountAccess.canUse) {
			throw new ForbiddenException('WhatsApp send access denied');
		}
		if (!accountAccess.canView) throw new ForbiddenException('WhatsApp access denied');
		return accountAccess;
	}

	/** Contact ids are only honoured inside the account named in the URL. */
	private async requireContact(accountId: string, contactId: string) {
		const contact = await this.contactRepo.findOne({ where: { id: contactId, accountId } });
		if (!contact) throw new NotFoundException('Contact not found');
		return contact;
	}

	private normalize(raw: string, defaultCountry: string | undefined, accountPhone: string | null) {
		try {
			return normalizeContactPhone(raw, { defaultCountry, accountPhone });
		} catch (error) {
			if (error instanceof ContactPhoneError) {
				throw new BadRequestException({ code: error.code, message: error.message });
			}
			throw error;
		}
	}

	// ── Serialization ───────────────────────────────────────────────────────

	private serialize(
		contact: WhatsAppContact,
		extras: { conversationId?: string | null; pushName?: string | null } = {},
	) {
		const phone = describeStoredPhone(contact.phoneNumber) ||
			(isPhoneChatId(contact.waId) ? describeStoredPhone(contact.waId.split('@')[0]) : null);
		const displayName = resolveWhatsAppContactLabel({
			savedName: contact.localName || contact.name,
			pushName: extras.pushName,
			chatId: contact.waId,
			phone: contact.phoneNumber,
		});
		return {
			id: contact.id,
			phone,
			displayName,
			localName: contact.localName || null,
			whatsappName: resolveWhatsAppContactLabel({
				savedName: contact.name,
				pushName: extras.pushName,
				chatId: contact.waId,
				phone: contact.phoneNumber,
			}),
			notes: contact.notes || null,
			avatarUrl: contact.avatarUrl || null,
			isBusiness: Boolean(contact.isBusiness),
			isSaved: Boolean(contact.isSaved),
			source: contact.source || 'whatsapp',
			registration: {
				status: (contact.waRegistration || 'unknown') as NumberRegistration,
				checkedAt: contact.waCheckedAt || null,
			},
			sync: {
				status: contact.waSyncStatus || 'not_requested',
				operation: contact.waSyncOp || null,
				error: contact.waSyncError || null,
				errorCode: syncErrorCode(contact.waSyncError),
				attempts: contact.waSyncAttempts || 0,
				syncedAt: contact.waSyncedAt || null,
				nextRetryAt: contact.waSyncNextAt || null,
			},
			conversationId: extras.conversationId ?? null,
			createdAt: contact.created_at || null,
			updatedAt: contact.updated_at || null,
		};
	}

	private async conversationIdsFor(accountId: string, contactIds: string[]) {
		const map = new Map<string, string>();
		if (!contactIds.length) return map;
		const rows = await this.conversationRepo.find({
			where: { accountId, contactId: In(contactIds), type: WhatsAppConversationType.DIRECT },
			select: ['id', 'contactId', 'lastMessageAt'],
			order: { lastMessageAt: 'DESC' },
		});
		for (const row of rows) {
			if (row.contactId && !map.has(row.contactId)) map.set(row.contactId, row.id);
		}
		return map;
	}

	private async serializeOne(contact: WhatsAppContact) {
		const ids = await this.conversationIdsFor(contact.accountId, [contact.id]);
		const liveNames = await this.liveContactNames(contact.accountId);
		return this.serialize(contact, {
			conversationId: ids.get(contact.id) || null,
			pushName: this.liveNameFor(contact, liveNames),
		});
	}

	/** Every row for these digits: phone-JID rows, LID rows that carry the number, saved first. */
	private async findByDigits(accountId: string, digits: string) {
		return this.contactRepo
			.createQueryBuilder('c')
			.where('c.account_id = :accountId', { accountId })
			.andWhere(
				`(c.wa_id IN (:...ids) OR regexp_replace(coalesce(c.phone_number, ''), '\\D', '', 'g') = :digits)`,
				{ ids: [`${digits}@c.us`, `${digits}@s.whatsapp.net`], digits },
			)
			.orderBy('c.is_saved', 'DESC')
			.addOrderBy('c.updated_at', 'DESC')
			.getMany();
	}

	// ── List / capabilities ─────────────────────────────────────────────────

	async capabilities(user: User, accountId: string) {
		await this.accessFor(user, accountId, 'view');
		const provider = this.liveProvider(accountId);
		return {
			connected: Boolean(provider),
			lookup: Boolean(provider?.checkWhatsAppNumbers),
			profile: Boolean(provider?.getNumberProfile),
			writeContacts: Boolean(provider?.saveContactToWhatsApp),
			removeContacts: Boolean(provider?.removeContactFromWhatsApp),
			/** The phone's own address book is asked, never confirmed, by the protocol. */
			phoneAddressBookConfirmed: false,
		};
	}

	async list(
		user: User,
		accountId: string,
		query: { search?: string; page?: number; limit?: number; scope?: string },
	) {
		const accountAccess = await this.accessFor(user, accountId, 'view');
		const canSeeAll = this.access.canSeeAllConversations(user, accountAccess);
		const scope = query.scope === 'all' && canSeeAll ? 'all' : 'saved';
		const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
		const page = Math.max(Number(query.page) || 1, 1);
		const qb = this.contactRepo.createQueryBuilder('c').where('c.account_id = :accountId', { accountId });
		if (scope === 'saved') {
			qb.andWhere('c.is_saved = true');
		} else {
			qb.andWhere(
				`(c.is_saved = true OR (coalesce(c.phone_number, '') <> '' AND c.wa_id NOT LIKE '%@g.us'
					AND c.wa_id NOT LIKE '%@newsletter' AND c.wa_id NOT LIKE '%@broadcast'))`,
			);
		}
		const search = String(query.search || '').trim().slice(0, 80);
		if (search) {
			const digits = search.replace(/\D/g, '');
			const text = `%${search.toLowerCase().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
			qb.andWhere(
				digits.length >= 3
					? `(lower(coalesce(c.local_name, '')) LIKE :text OR lower(coalesce(c.name, '')) LIKE :text
						OR regexp_replace(coalesce(c.phone_number, ''), '\\D', '', 'g') LIKE :digits)`
					: `(lower(coalesce(c.local_name, '')) LIKE :text OR lower(coalesce(c.name, '')) LIKE :text)`,
				{ text, digits: `%${digits}%` },
			);
		}
		qb.orderBy('c.is_saved', 'DESC')
			.addOrderBy(`lower(coalesce(c.local_name, c.name, c.phone_number))`, 'ASC', 'NULLS LAST')
			.addOrderBy('c.id', 'ASC')
			.skip((page - 1) * limit)
			.take(limit);
		const [rows, total] = await qb.getManyAndCount();
		const conversations = await this.conversationIdsFor(
			accountId,
			rows.map((row) => row.id),
		);
		const liveNames = await this.liveContactNames(accountId);
		return {
			scope,
			canListAll: canSeeAll,
			page,
			limit,
			total,
			items: rows.map((row) =>
				this.serialize(row, {
					conversationId: conversations.get(row.id) || null,
					pushName: this.liveNameFor(row, liveNames),
				}),
			),
		};
	}

	/** In-memory WhatsApp names (address book + profile pushName) keyed by JID and digits. */
	private async liveContactNames(accountId: string) {
		const names = new Map<string, string>();
		const provider = this.liveProvider(accountId);
		if (!provider?.getContacts) return names;
		let contacts: any[] = [];
		try {
			contacts = (await provider.getContacts()) || [];
		} catch {
			return names;
		}
		const remember = (key: string | null | undefined, label: string) => {
			const id = String(key || '').trim();
			if (!id || names.has(id)) return;
			names.set(id, label);
		};
		for (const item of contacts) {
			const waId = String(item?.id?._serialized || item?.id || '').trim();
			const phone = String(item?.number || '').replace(/\D/g, '') ||
				(isPhoneChatId(waId) ? waId.split('@')[0].replace(/\D/g, '') : '');
			const label = resolveWhatsAppContactLabel({
				savedName: String(item?.name || item?.formattedName || '').trim() || null,
				pushName:
					String(item?.pushname || item?.notify || item?.pushName || '').trim() || null,
				chatId: waId,
				phone,
			});
			if (!label) continue;
			remember(waId, label);
			if (phone) {
				remember(phone, label);
				remember(`${phone}@c.us`, label);
				remember(`${phone}@s.whatsapp.net`, label);
			}
		}
		return names;
	}

	private liveNameFor(contact: WhatsAppContact, names: Map<string, string>) {
		const digits = String(contact.phoneNumber || '').replace(/\D/g, '');
		return (
			names.get(contact.waId) ||
			(digits ? names.get(digits) : null) ||
			(digits ? names.get(`${digits}@c.us`) : null) ||
			(digits ? names.get(`${digits}@s.whatsapp.net`) : null) ||
			null
		);
	}

	// ── Lookup ──────────────────────────────────────────────────────────────

	private liveProvider(accountId: string): WhatsAppProvider | null {
		const provider = this.providers.getProvider(accountId);
		// Never connect from here: a lookup must not start or restart the session.
		return provider && provider.getState() === 'connected' ? provider : null;
	}

	private async checkRegistration(
		user: User | null,
		accountId: string,
		digits: string,
	): Promise<RegistrationCheck & { cached: boolean }> {
		const key = `${accountId}:${digits}`;
		const cached = this.registrationCache.get(key);
		if (cached && Date.now() - cached.checkedAt.getTime() < REGISTRATION_TTL_MS) {
			return { ...cached, cached: true };
		}
		const running = this.registrationInFlight.get(key);
		if (running) return { ...(await running), cached: true };

		const provider = this.liveProvider(accountId);
		const unknown = (reason: UnknownReason): RegistrationCheck => ({
			status: 'unknown',
			chatId: null,
			reason,
			checkedAt: new Date(),
		});
		if (!provider) return { ...unknown('not_connected'), cached: false };
		if (!provider.checkWhatsAppNumbers) return { ...unknown('unsupported'), cached: false };
		assertNumberLookupRateLimit(user ? `${accountId}:${user.id}` : `${accountId}:system`, accountId);

		const work = (async (): Promise<RegistrationCheck> => {
			const started = Date.now();
			try {
				const [answer] = await provider.checkWhatsAppNumbers!([digits]);
				const result: RegistrationCheck = {
					status: answer?.exists ? 'registered' : 'not_registered',
					chatId: answer?.exists ? answer.chatId : null,
					reason: null,
					checkedAt: new Date(),
				};
				this.registrationCache.set(key, result);
				trimMap(this.registrationCache);
				this.logger.log(
					`[WA] number_lookup account=${accountId} outcome=${result.status} ms=${Date.now() - started}`,
				);
				await this.contactRepo
					.createQueryBuilder()
					.update(WhatsAppContact)
					.set({ waRegistration: result.status as any, waCheckedAt: result.checkedAt })
					.where('account_id = :accountId', { accountId })
					.andWhere(
						`(wa_id IN (:...ids) OR regexp_replace(coalesce(phone_number, ''), '\\D', '', 'g') = :digits)`,
						{ ids: [`${digits}@c.us`, `${digits}@s.whatsapp.net`], digits },
					)
					.execute()
					.catch(() => undefined);
				return result;
			} catch (error) {
				const reason: UnknownReason =
					error instanceof WhatsAppProviderUnavailableError ? error.reason : 'error';
				this.logger.warn(
					`[WA] number_lookup account=${accountId} outcome=unknown reason=${reason} ms=${Date.now() - started}`,
				);
				return unknown(reason);
			}
		})();
		this.registrationInFlight.set(key, work);
		try {
			return { ...(await work), cached: false };
		} finally {
			this.registrationInFlight.delete(key);
		}
	}

	private async profileFor(accountId: string, chatId: string) {
		const provider = this.liveProvider(accountId);
		if (!provider?.getNumberProfile) return null;
		const key = `${accountId}:${chatId}`;
		const cached = this.profileCache.get(key);
		if (cached && Date.now() - cached.at < PROFILE_TTL_MS) return cached.profile;
		try {
			const profile = await provider.getNumberProfile(chatId);
			this.profileCache.set(key, { at: Date.now(), profile });
			trimMap(this.profileCache);
			return profile;
		} catch {
			return null;
		}
	}

	async lookup(user: User, accountId: string, dto: LookupWhatsAppNumberDto) {
		const { account } = await this.accessFor(user, accountId, 'use');
		const phone = this.normalize(dto.phone, dto.defaultCountry, account.phoneNumber);
		const check = await this.checkRegistration(user, accountId, phone.digits);
		const [existing] = await this.findByDigits(accountId, phone.digits);

		let profile: WhatsAppNumberProfile | null = null;
		if (check.status === 'registered' && check.chatId) {
			profile = await this.profileFor(accountId, check.chatId);
			if (existing && profile?.picture.status === 'available' && profile.picture.url) {
				if (existing.avatarUrl !== profile.picture.url) {
					await this.contactRepo.update(existing.id, { avatarUrl: profile.picture.url });
					existing.avatarUrl = profile.picture.url;
				}
			}
			if (existing && profile?.business.status === 'available' && !existing.isBusiness) {
				await this.contactRepo.update(existing.id, { isBusiness: true });
				existing.isBusiness = true;
			}
		}
		if (existing && check.status !== 'unknown') {
			existing.waRegistration = check.status;
			existing.waCheckedAt = check.checkedAt;
		}

		return {
			phone,
			registration: {
				status: check.status,
				reason: check.reason,
				message: check.reason ? UNKNOWN_MESSAGES[check.reason] : null,
				checkedAt: check.checkedAt,
				cached: check.cached,
			},
			profile: profile
				? {
						pushName: profile.pushName,
						savedName: profile.savedName,
						picture: profile.picture,
						about: profile.about,
						business: profile.business,
					}
				: null,
			contact: existing ? await this.serializeOne(existing) : null,
			canStartChat: check.status === 'registered',
		};
	}

	// ── Create / update / remove ────────────────────────────────────────────

	async create(user: User, accountId: string, dto: CreateWhatsAppContactDto) {
		const { account } = await this.accessFor(user, accountId, 'use');
		const phone = this.normalize(dto.phone, dto.defaultCountry, account.phoneNumber);
		const name = String(dto.name || '').trim();
		if (!name) throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'Enter a name' });
		const notes = String(dto.notes || '').trim() || null;

		const matches = await this.findByDigits(accountId, phone.digits);
		const saved = matches.find((row) => row.isSaved);
		if (saved) {
			throw new ConflictException({
				code: 'DUPLICATE_CONTACT',
				message: 'This number is already saved',
				contact: await this.serializeOne(saved),
			});
		}
		const cachedCheck = this.registrationCache.get(`${accountId}:${phone.digits}`);
		const target = matches.find((row) => isPhoneChatId(row.waId)) || matches[0] || null;
		const patch: Partial<WhatsAppContact> = {
			localName: name,
			name,
			notes,
			isSaved: true,
			savedByUserId: user.id,
			phoneNumber: phone.digits,
			...(cachedCheck && cachedCheck.status !== 'unknown'
				? { waRegistration: cachedCheck.status, waCheckedAt: cachedCheck.checkedAt }
				: {}),
		};

		let contact: WhatsAppContact;
		if (target) {
			await this.contactRepo.update(target.id, patch);
			contact = { ...target, ...patch } as WhatsAppContact;
		} else {
			try {
				contact = await this.contactRepo.save(
					this.contactRepo.create({
						accountId,
						waId: chatIdForDigits(phone.digits),
						avatarUrl: null,
						isBusiness: false,
						source: dto.source === 'lookup' ? 'lookup' : 'manual',
						...patch,
					}),
				);
			} catch (error: any) {
				if (error?.code !== '23505') throw error;
				const raced = await this.contactRepo.findOneOrFail({
					where: { accountId, waId: chatIdForDigits(phone.digits) },
					withDeleted: true,
				});
				if (raced.deleted_at) {
					await this.contactRepo.restore(raced.id);
					raced.deleted_at = null;
				} else if (raced.isSaved) {
					throw new ConflictException({
						code: 'DUPLICATE_CONTACT',
						message: 'This number is already saved',
						contact: await this.serializeOne(raced),
					});
				}
				await this.contactRepo.update(raced.id, patch);
				contact = { ...raced, ...patch } as WhatsAppContact;
			}
		}

		void this.audit.write({
			actorUserId: user.id,
			accountId,
			action: 'contact_saved',
			targetType: 'whatsapp_contact',
			targetId: contact.id,
			metadata: { source: dto.source || 'manual', syncRequested: Boolean(dto.syncToWhatsApp) },
		});

		if (dto.syncToWhatsApp) {
			contact = await this.queueAndRunSync(accountId, contact.id, 'upsert');
		}
		return this.serializeOne(contact);
	}

	async update(user: User, accountId: string, contactId: string, dto: UpdateWhatsAppContactDto) {
		await this.accessFor(user, accountId, 'use');
		const contact = await this.requireContact(accountId, contactId);
		const patch: Partial<WhatsAppContact> = {};
		const nextName = dto.name !== undefined ? String(dto.name).trim() : undefined;
		if (nextName !== undefined && !nextName) {
			throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'Enter a name' });
		}
		const nameChanged = nextName !== undefined && nextName !== (contact.localName || '');
		if (nextName !== undefined) {
			patch.localName = nextName;
			patch.name = nextName;
			if (!contact.isSaved) {
				patch.isSaved = true;
				patch.savedByUserId = user.id;
			}
		}
		if (dto.notes !== undefined) patch.notes = String(dto.notes || '').trim() || null;
		if (Object.keys(patch).length) {
			await this.contactRepo.update(contact.id, patch);
			Object.assign(contact, patch);
		}
		void this.audit.write({
			actorUserId: user.id,
			accountId,
			action: 'contact_updated',
			targetType: 'whatsapp_contact',
			targetId: contact.id,
			metadata: { nameChanged, notesChanged: dto.notes !== undefined },
		});

		// A rename follows the contact into WhatsApp once it was synced or requested there.
		const wasRequested = !['not_requested', 'unsupported'].includes(contact.waSyncStatus);
		const shouldSync = dto.syncToWhatsApp ?? (nameChanged && wasRequested);
		if (shouldSync) {
			return this.serializeOne(await this.queueAndRunSync(accountId, contact.id, 'upsert'));
		}
		return this.serializeOne(contact);
	}

	async remove(
		user: User,
		accountId: string,
		contactId: string,
		options: { removeFromWhatsApp?: boolean },
	) {
		await this.accessFor(user, accountId, 'use');
		let contact = await this.requireContact(accountId, contactId);
		if (options.removeFromWhatsApp) {
			contact = await this.queueAndRunSync(accountId, contact.id, 'remove');
			if (contact.waSyncStatus !== 'synced') {
				// Still saved here so the user can see the failure and retry it.
				return { removed: false, contact: await this.serializeOne(contact) };
			}
		}
		const conversations = await this.conversationIdsFor(accountId, [contact.id]);
		const createdHere = contact.source === 'manual' || contact.source === 'lookup';
		if (createdHere && !conversations.size) {
			await this.contactRepo.delete({ id: contact.id, accountId });
		} else {
			await this.contactRepo.update(contact.id, {
				isSaved: false,
				localName: null,
				notes: null,
				savedByUserId: null,
				waSyncStatus: 'not_requested',
				waSyncOp: null,
				waSyncError: null,
				waSyncAttempts: 0,
				waSyncNextAt: null,
			});
		}
		void this.audit.write({
			actorUserId: user.id,
			accountId,
			action: 'contact_removed',
			targetType: 'whatsapp_contact',
			targetId: contact.id,
			metadata: { removedFromWhatsApp: Boolean(options.removeFromWhatsApp) },
		});
		return { removed: true, contact: null };
	}

	async retrySync(user: User, accountId: string, contactId: string) {
		await this.accessFor(user, accountId, 'use');
		const contact = await this.requireContact(accountId, contactId);
		const op: WhatsAppContactSyncOp = contact.waSyncOp || (contact.isSaved ? 'upsert' : 'remove');
		return this.serializeOne(await this.queueAndRunSync(accountId, contact.id, op));
	}

	// ── Duplicates ──────────────────────────────────────────────────────────

	async duplicates(user: User, accountId: string) {
		await this.accessFor(user, accountId, 'view');
		const groups: Array<{ digits: string; ids: string[] }> = await this.contactRepo.query(
			`SELECT regexp_replace(phone_number, '\\D', '', 'g') AS digits, array_agg(id::text) AS ids
			   FROM whatsapp_contacts
			  WHERE account_id = $1 AND is_saved = true AND deleted_at IS NULL
			    AND coalesce(phone_number, '') <> ''
			  GROUP BY 1
			 HAVING count(*) > 1
			  LIMIT 100`,
			[accountId],
		);
		const ids = groups.flatMap((group) => group.ids);
		if (!ids.length) return { groups: [] };
		const rows = await this.contactRepo.find({ where: { accountId, id: In(ids) } });
		const conversations = await this.conversationIdsFor(accountId, ids);
		const byId = new Map(rows.map((row) => [row.id, row]));
		return {
			groups: groups.map((group) => ({
				phone: describeStoredPhone(group.digits),
				contacts: group.ids
					.map((id) => byId.get(id))
					.filter(Boolean)
					.map((row) => this.serialize(row!, { conversationId: conversations.get(row!.id) || null })),
			})),
		};
	}

	async merge(user: User, accountId: string, keepId: string, duplicateIds: string[]) {
		await this.accessFor(user, accountId, 'use');
		const keeper = await this.requireContact(accountId, keepId);
		const others = (
			await this.contactRepo.find({ where: { accountId, id: In(duplicateIds.filter((id) => id !== keepId)) } })
		).filter(Boolean);
		if (!others.length) throw new BadRequestException('No duplicates to merge');
		const keeperDigits = String(keeper.phoneNumber || '').replace(/\D/g, '');
		if (others.some((row) => String(row.phoneNumber || '').replace(/\D/g, '') !== keeperDigits)) {
			throw new BadRequestException('Only contacts with the same number can be merged');
		}
		const notes = [keeper.notes, ...others.map((row) => row.notes)]
			.map((value) => String(value || '').trim())
			.filter((value, index, list) => value && list.indexOf(value) === index)
			.join('\n\n');
		const patch: Partial<WhatsAppContact> = {
			isSaved: true,
			localName: keeper.localName || others.find((row) => row.localName)?.localName || keeper.name,
			notes: notes || null,
		};
		await this.contactRepo.update(keeper.id, patch);
		await this.contactRepo.update(
			{ accountId, id: In(others.map((row) => row.id)) },
			{ isSaved: false, localName: null, notes: null, savedByUserId: null },
		);
		void this.audit.write({
			actorUserId: user.id,
			accountId,
			action: 'contacts_merged',
			targetType: 'whatsapp_contact',
			targetId: keeper.id,
			metadata: { merged: others.length },
		});
		return this.serializeOne({ ...keeper, ...patch } as WhatsAppContact);
	}

	// ── Start chat ──────────────────────────────────────────────────────────

	async startChat(user: User, accountId: string, dto: StartWhatsAppContactChatDto) {
		const { account } = await this.accessFor(user, accountId, 'use');
		let contact: WhatsAppContact | null = null;
		let phone: ContactPhone | null = null;
		if (dto.contactId) {
			contact = await this.requireContact(accountId, dto.contactId);
			phone =
				describeStoredPhone(contact.phoneNumber) ||
				(isPhoneChatId(contact.waId) ? describeStoredPhone(contact.waId.split('@')[0]) : null);
			if (!phone) {
				throw new BadRequestException({
					code: 'NO_PHONE',
					message: 'This contact has no phone number to message',
				});
			}
		} else if (dto.phone) {
			phone = this.normalize(dto.phone, dto.defaultCountry, account.phoneNumber);
			[contact] = await this.findByDigits(accountId, phone.digits);
		} else {
			throw new BadRequestException({ code: 'PHONE_REQUIRED', message: 'Enter a phone number' });
		}

		const title = contact?.localName || contact?.name || null;
		const check = await this.checkRegistration(user, accountId, phone.digits);
		if (check.status === 'not_registered') {
			throw new BadRequestException({
				code: 'NOT_ON_WHATSAPP',
				message: 'This number is not on WhatsApp, so a chat cannot be started',
			});
		}
		if (check.status === 'unknown') {
			// An existing thread proves the chat exists; only creating a new one needs a check.
			const existing = await this.existingDirectConversation(accountId, phone.digits);
			if (existing) {
				const conversation = await this.sync.openConversationByChatId(
					user,
					accountId,
					existing.providerChatId,
					{ title },
				);
				return { conversation, verified: false, created: false };
			}
			throw new ServiceUnavailableException({
				code: 'UNABLE_TO_VERIFY',
				message: `${UNKNOWN_MESSAGES[check.reason || 'error']}. Try again when WhatsApp is connected.`,
			});
		}
		const existedBefore = Boolean(await this.existingDirectConversation(accountId, phone.digits));
		const conversation = await this.sync.openConversationByChatId(
			user,
			accountId,
			check.chatId || chatIdForDigits(phone.digits),
			{ title },
		);
		return { conversation, verified: true, created: !existedBefore };
	}

	private async existingDirectConversation(accountId: string, digits: string) {
		return this.conversationRepo
			.createQueryBuilder('conversation')
			.leftJoin('conversation.contact', 'contact')
			.where('conversation.account_id = :accountId', { accountId })
			.andWhere('conversation.type = :type', { type: WhatsAppConversationType.DIRECT })
			.andWhere(
				`(conversation.provider_chat_id IN (:...ids)
					OR regexp_replace(coalesce(contact.phone_number, ''), '\\D', '', 'g') = :digits)`,
				{ ids: [`${digits}@c.us`, `${digits}@s.whatsapp.net`], digits },
			)
			.orderBy('conversation.last_message_at', 'DESC', 'NULLS LAST')
			.getOne();
	}

	// ── WhatsApp contact-list sync ──────────────────────────────────────────

	private async queueAndRunSync(accountId: string, contactId: string, op: WhatsAppContactSyncOp) {
		await this.contactRepo.update(
			{ id: contactId, accountId },
			{ waSyncOp: op, waSyncStatus: 'pending', waSyncError: null, waSyncNextAt: new Date() },
		);
		return this.runSync(accountId, contactId);
	}

	private async setSyncState(contactId: string, patch: Partial<WhatsAppContact>) {
		await this.contactRepo.update(contactId, patch);
		return this.contactRepo.findOneOrFail({ where: { id: contactId } });
	}

	/** Claim → write to WhatsApp → record what WhatsApp actually confirmed. */
	async runSync(accountId: string, contactId: string): Promise<WhatsAppContact> {
		const staleBefore = new Date(Date.now() - SYNC_STALE_MS);
		const claim = await this.contactRepo
			.createQueryBuilder()
			.update(WhatsAppContact)
			.set({ waSyncStatus: 'syncing' })
			.where('id = :id AND account_id = :accountId', { id: contactId, accountId })
			.andWhere('wa_sync_op IS NOT NULL')
			.andWhere(`(wa_sync_status <> 'syncing' OR updated_at < :staleBefore)`, { staleBefore })
			.execute();
		const contact = await this.contactRepo.findOneOrFail({ where: { id: contactId, accountId } });
		if (!Number(claim.affected)) return contact;

		const op = contact.waSyncOp || 'upsert';
		const started = Date.now();
		const finish = async (
			status: WhatsAppContactSyncStatus,
			extra: Partial<WhatsAppContact> = {},
		) => {
			this.logger.log(
				`[WA] contact_sync account=${accountId} contact=${contactId} op=${op} outcome=${status} attempt=${
					(extra.waSyncAttempts ?? contact.waSyncAttempts) || 0
				} ms=${Date.now() - started}`,
			);
			return this.setSyncState(contactId, { waSyncStatus: status, ...extra });
		};

		const provider = this.liveProvider(accountId);
		if (!provider) {
			return finish('pending', {
				waSyncError: SYNC_ERRORS.NOT_CONNECTED,
				waSyncNextAt: new Date(Date.now() + NOT_CONNECTED_RETRY_MS),
			});
		}
		const write = op === 'upsert' ? provider.saveContactToWhatsApp : provider.removeContactFromWhatsApp;
		if (!write) {
			return finish('unsupported', { waSyncError: SYNC_ERRORS.INTEGRATION_UNSUPPORTED, waSyncNextAt: null });
		}
		const digits =
			String(contact.phoneNumber || '').replace(/\D/g, '') ||
			(isPhoneChatId(contact.waId) ? contact.waId.split('@')[0] : '');
		if (!digits) {
			return finish('unsupported', { waSyncError: SYNC_ERRORS.NO_PHONE, waSyncNextAt: null });
		}

		try {
			let chatId = isPhoneChatId(contact.waId) ? contact.waId : chatIdForDigits(digits);
			if (op === 'upsert') {
				const check = await this.checkRegistration(null, accountId, digits);
				if (check.status === 'not_registered') {
					return finish('unsupported', { waSyncError: SYNC_ERRORS.NOT_ON_WHATSAPP, waSyncNextAt: null });
				}
				if (check.status === 'unknown') {
					throw new WhatsAppProviderUnavailableError('not_connected', SYNC_ERRORS.UNVERIFIED);
				}
				chatId = check.chatId || chatId;
				const fullName = String(contact.localName || contact.name || '').trim();
				if (!fullName) {
					return finish('failed', { waSyncError: SYNC_ERRORS.NAME_REQUIRED, waSyncNextAt: null });
				}
				await provider.saveContactToWhatsApp!(chatId, { fullName });
			} else {
				await provider.removeContactFromWhatsApp!(chatId);
			}
			return finish('synced', {
				waSyncOp: null,
				waSyncError: null,
				waSyncAttempts: 0,
				waSyncNextAt: null,
				waSyncedAt: new Date(),
			});
		} catch (error) {
			if (error instanceof WhatsAppProviderUnavailableError && error.reason === 'unsupported') {
				return finish('unsupported', { waSyncError: SYNC_ERRORS.INTEGRATION_UNSUPPORTED, waSyncNextAt: null });
			}
			const attempts = (contact.waSyncAttempts || 0) + 1;
			const retryable = attempts < MAX_SYNC_ATTEMPTS;
			return finish('failed', {
				waSyncAttempts: attempts,
				waSyncError:
					error instanceof WhatsAppProviderUnavailableError
						? error.message === SYNC_ERRORS.UNVERIFIED
							? SYNC_ERRORS.UNVERIFIED
							: SYNC_ERRORS.CONNECTION_DROPPED
						: syncErrorMessage(error),
				waSyncNextAt: retryable
					? new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000)
					: null,
			});
		}
	}

	/** Retries due writes for accounts whose socket lives in this process. */
	async sweepPendingSyncs() {
		if (this.sweeping) return;
		this.sweeping = true;
		try {
			const due = await this.contactRepo
				.createQueryBuilder('c')
				.where(`c.wa_sync_op IS NOT NULL`)
				.andWhere(
					`((c.wa_sync_status IN ('pending', 'failed') AND c.wa_sync_next_at <= now())
						OR (c.wa_sync_status = 'syncing' AND c.updated_at < :staleBefore))`,
					{ staleBefore: new Date(Date.now() - SYNC_STALE_MS) },
				)
				.andWhere('c.wa_sync_attempts < :max', { max: MAX_SYNC_ATTEMPTS })
				.orderBy('c.wa_sync_next_at', 'ASC')
				.take(SYNC_SWEEP_BATCH)
				.getMany();
			for (const contact of due) {
				if (!this.liveProvider(contact.accountId)) continue;
				await this.runSync(contact.accountId, contact.id).catch((error) =>
					this.logger.warn(
						`[WA] contact_sync account=${contact.accountId} contact=${contact.id} sweep_error=${
							error instanceof Error ? error.name : 'unknown'
						}`,
					),
				);
			}
		} catch (error) {
			this.logger.warn(
				`[WA] contact_sync sweep failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			this.sweeping = false;
		}
	}
}
