import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { In, Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import {
	WhatsAppContact,
	WhatsAppConversation,
	WhatsAppStatus,
	WhatsAppStatusHistory,
} from '../entities/whatsapp.entity';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import {
	NormalizedWhatsAppParticipantReceipt,
	WhatsAppProvider,
	WhatsAppStatusQuote,
} from '../providers/whatsapp-provider';
import { statusActorKey, statusMessageKey } from '../utils/whatsapp-status-interactions';
import { WhatsAppAccessService } from './whatsapp-access.service';
import { WhatsAppAuditService } from './whatsapp-audit.service';
import { WhatsAppProviderManagerService } from './whatsapp-provider-manager.service';
import { whatsAppTimestampToDate } from '../utils/whatsapp-time';
import { getWhatsAppPrivacySettings } from '../utils/whatsapp-privacy';
import {
	decodeProviderMedia,
	isIncompleteStatusMedia,
} from '../utils/whatsapp-media-decode';
import {
	isWeakWhatsAppContactName,
	preferWhatsAppContactName,
} from '../utils/whatsapp-contact-name';
import { statusAudienceJids } from '../utils/whatsapp-contact';

function statusId(item: any) {
	return String(
		item?.id?._serialized ||
			(typeof item?.id === 'string' || typeof item?.id === 'number' ? item.id : '') ||
			item?.messageId ||
			'',
	);
}

function normalizeStatusType(value: unknown) {
	const type = String(value || 'text').toLowerCase();
	if (type === 'chat') return 'text';
	return type || 'text';
}

/** Phone digits for a story sender — LID senders only resolve through a saved contact. */
function statusSenderPhone(senderWaId: string | null | undefined, contactPhones: Map<string, string>) {
	const raw = String(senderWaId || '').trim();
	if (!raw) return null;
	const known = contactPhones.get(raw);
	if (known) return known;
	if (/@(hosted\.)?lid$/i.test(raw)) return null;
	const digits = raw.replace(/@.*$/, '').split(':')[0].replace(/\D/g, '');
	return digits.length >= 8 ? digits : null;
}

function isUuid(value: unknown) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
		String(value || '').trim(),
	);
}

/**
 * Ceiling on how many recipients one publish is encrypted for.
 *
 * Not a WhatsApp limit — a guard on our side, since the cost of publishing grows with
 * the audience and an account that blasts thousands of copies at once is one that gets
 * throttled.
 */
const STATUS_AUDIENCE_LIMIT = 800;
const STATUS_PRUNE_INTERVAL_MS = 5 * 60_000;

type StatusRow = WhatsAppStatus | WhatsAppStatusHistory;
type StatusRowSource = 'active' | 'history';

export interface StatusReactionRow {
	statusMessageId: string;
	actorKey: string;
	emoji: string;
	messageId: string | null;
	reactedAt: Date | null;
}

/** Upper bound on viewers returned for one story; WhatsApp audiences are capped well below. */
const STATUS_VIEWERS_LIMIT = 2000;

/** TypeORM/pg returns `[rows, rowCount]` for UPDATE … RETURNING and plain rows otherwise. */
function affectedRowCount(result: unknown): number {
	if (Array.isArray(result) && result.length === 2 && typeof result[1] === 'number') {
		return result[1];
	}
	return Array.isArray(result) ? result.length : 0;
}

@Injectable()

export class WhatsAppStatusService {
	private readonly logger = new Logger(WhatsAppStatusService.name);
	private readonly lastPruneAt = new Map<string, number>();
	/** LID→phone folds already applied in this process (skip repeat UPDATEs per receipt). */
	private readonly foldedStatusActors = new Set<string>();

	constructor(
		@InjectRepository(WhatsAppStatus)
		private readonly repo: Repository<WhatsAppStatus>,
		@InjectRepository(WhatsAppStatusHistory)
		private readonly historyRepo: Repository<WhatsAppStatusHistory>,
		@InjectRepository(WhatsAppContact)
		private readonly contactRepo: Repository<WhatsAppContact>,
		@InjectRepository(WhatsAppConversation)
		private readonly conversationRepo: Repository<WhatsAppConversation>,
		private readonly access: WhatsAppAccessService,
		private readonly providers: WhatsAppProviderManagerService,
		private readonly audit: WhatsAppAuditService,
		private readonly gateway: WhatsAppGateway,
	) {}
	private provider(accountId: string) {
		const provider = this.providers.getProvider(accountId);
		if (!provider || provider.getState() !== 'connected') {
			throw new BadRequestException('WhatsApp account is not connected');
		}
		return provider;
	}

	private async ensureStatusProvider(accountId: string, timeoutMs = 60000) {
		let provider = this.providers.getProvider(accountId);
		let state = provider?.getState() || 'disconnected';
		if (state === 'connected') {
			return { provider, state, ready: true as const };
		}
		try {
			provider = await this.providers.connect(accountId);
			state = provider.getState();
		} catch {
			return { provider: provider || null, state, ready: false as const };
		}
		if (state !== 'connected') {
			const ready = await this.providers.waitUntilConnected(accountId, timeoutMs);
			provider = this.providers.getProvider(accountId);
			state = provider?.getState() || state;
			if (!ready || state !== 'connected') {
				return { provider: provider || null, state, ready: false as const };
			}
		}
		return { provider: provider!, state: 'connected' as const, ready: true as const };
	}

	private statusRefreshHint(state: string) {
		if (state === 'connected') return null;
		if (['connecting', 'qr_pending'].includes(state)) {
			return 'whatsapp_session_not_ready';
		}
		return 'whatsapp_not_connected';
	}

	/** Internal: pull statuses from the linked provider and upsert into Postgres. */
	async syncFromProvider(accountId: string) {
		const readiness = await this.ensureStatusProvider(accountId, 45_000);
		const provider = readiness.provider;
		if (!readiness.ready || !provider?.capabilities.statusFetch) {
			return { providerCount: 0, upserted: 0, hint: this.statusRefreshHint(readiness.state) };
		}
		try {
			const statuses = await Promise.race([
				provider.getStatuses(),
				new Promise<any[]>((_, reject) => {
					setTimeout(() => reject(new Error('Story sync timed out')), 45_000);
				}),
			]);
			const list = Array.isArray(statuses) ? statuses : [];
			const contactNames = new Map<string, string>();
			const upserted = list.length
				? await this.upsertProviderStatuses(accountId, list, contactNames)
				: 0;
			this.logger.log(
				`Status sync ${accountId}: provider=${list.length} upserted=${upserted}`,
			);
			// Persist media while Baileys still has the raw message in RAM.
			// Metadata-only rows are unplayable after process restart / cache eviction.
			if (list.length) {
				await this.prefetchLiveStatusMedia(accountId, list);
			}
			return {
				providerCount: list.length,
				upserted,
				hint: list.length ? null : 'whatsapp_stories_empty',
			};
		} catch (error) {
			this.logger.warn(
				`Status sync failed for ${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return { providerCount: 0, upserted: 0, hint: 'whatsapp_stories_sync_failed' };
		}
	}

	/**
	 * Download + disk-cache media for statuses currently in the provider session.
	 * Without this, CRM only stores metadata and playback dies with "session cache".
	 */
	private async prefetchLiveStatusMedia(accountId: string, statuses: any[]) {
		for (const item of statuses || []) {
			const providerStatusId = statusId(item);
			if (!providerStatusId) continue;
			const type = normalizeStatusType(item?.type);
			if (type === 'text') continue;
			const row = await this.repo.findOne({
				where: { accountId, providerStatusId },
			});
			if (!row || row.mediaPath) continue;
			try {
				await this.resolveStatusMedia(row, 'active', accountId, {
					allowSyncRetry: false,
					allowPhoneRequest: false,
				});
			} catch (error) {
				this.logger.debug(
					`Prefetch skipped for ${providerStatusId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}
	}

	/** Live providerStatusIds currently held in the Baileys/WPP RAM cache. */
	private async liveProviderStatusIds(accountId: string): Promise<{
		ids: Set<string>;
		fetched: boolean;
		count: number;
	}> {
		const provider = this.providers.getProvider(accountId);
		if (!provider || provider.getState() !== 'connected' || !provider.capabilities.statusFetch) {
			return { ids: new Set(), fetched: false, count: 0 };
		}
		try {
			const statuses = await provider.getStatuses();
			const list = Array.isArray(statuses) ? statuses : [];
			const ids = new Set<string>();
			for (const item of list) {
				const id = statusId(item);
				if (id) ids.add(id);
			}
			return { ids, fetched: true, count: list.length };
		} catch {
			return { ids: new Set(), fetched: false, count: 0 };
		}
	}

	private async archiveStatusRow(row: StatusRow) {
		await this.archiveStatusRows([row]);
	}

	private async archiveStatusRows(rows: StatusRow[]) {
		if (!rows.length) return;
		const archivedAt = new Date();
		// One INSERT … ON CONFLICT cannot touch the same key twice.
		const unique = [
			...new Map(rows.map(row => [`${row.accountId}:${row.providerStatusId}`, row])).values(),
		];
		await this.historyRepo.upsert(
			unique.map(row => ({
				accountId: row.accountId,
				providerStatusId: row.providerStatusId,
				senderWaId: row.senderWaId,
				type: row.type,
				caption: row.caption,
				isOwn: row.isOwn,
				publishedAt: row.publishedAt,
				expiresAt: row.expiresAt,
				mediaPath: row.mediaPath,
				archivedAt,
			})),
			['accountId', 'providerStatusId'],
		);
	}

	private async pruneExpiredStatuses(accountId: string) {
		const expired = await this.repo
			.createQueryBuilder('status')
			.where('status.accountId = :accountId', { accountId })
			.andWhere('status.expiresAt IS NOT NULL')
			.andWhere('status.expiresAt <= :now', { now: new Date() })
			.getMany();
		if (!expired.length) return;
		await this.archiveStatusRows(expired);
		await this.repo.delete(expired.map(row => row.id));
	}

	/**
	 * Reads already exclude expired rows, so archiving is housekeeping:
	 * run it off the request path, at most once per interval per account.
	 */
	private schedulePrune(accountId: string) {
		const last = this.lastPruneAt.get(accountId) || 0;
		if (Date.now() - last < STATUS_PRUNE_INTERVAL_MS) return;
		this.lastPruneAt.set(accountId, Date.now());
		void this.pruneExpiredStatuses(accountId).catch(error => {
			this.lastPruneAt.delete(accountId);
			this.logger.warn(
				`Status prune failed for ${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		});
	}

	private async upsertProviderStatuses(
		accountId: string,
		statuses: any[],
		contactNames: Map<string, string>,
	) {
		const existingRows = await this.repo.find({ where: { accountId } });
		const existingActiveCount = existingRows.filter(
			row => !row.expiresAt || row.expiresAt > new Date(),
		).length;
		const byProviderId = new Map(
			existingRows.map(row => [row.providerStatusId, row] as const),
		);

		const refreshedProviderIds = new Set<string>();
		for (const item of statuses || []) {
			const id = statusId(item);
			if (!id) continue;
			refreshedProviderIds.add(id);
			const senderWaId =
				item?.author?._serialized ||
				item?.from?._serialized ||
				String(item?.sender || item?.author || item?.from || '') ||
				null;
			const contactName = String(
				item?.contactName || item?.notifyName || item?.sender?.pushname || '',
			).trim();
			if (senderWaId && contactName && !isWeakWhatsAppContactName(contactName, senderWaId)) {
				const previous = contactNames.get(senderWaId);
				contactNames.set(
					senderWaId,
					preferWhatsAppContactName(previous, contactName, senderWaId) || contactName,
				);
				const existing = await this.contactRepo.findOne({
					where: { accountId, waId: senderWaId },
				});
				const nextName = preferWhatsAppContactName(
					existing?.name,
					contactName,
					senderWaId,
					existing?.phoneNumber || String(senderWaId).replace(/@.*/, '') || null,
				);
				await this.contactRepo.upsert(
					{
						accountId,
						waId: senderWaId,
						name: nextName,
						phoneNumber:
							existing?.phoneNumber || String(senderWaId).replace(/@.*/, '') || null,
					},
					['accountId', 'waId'],
				);
			}
			const publishedAt =
				whatsAppTimestampToDate(item?.timestamp ?? item?.t) || new Date();
			const providerType = normalizeStatusType(item?.type);
			const payload = {
				senderWaId,
				type: providerType,
				caption: item?.caption || item?.body || null,
				isOwn: Boolean(item?.fromMe || item?.isOwn),
				publishedAt,
				expiresAt: new Date(publishedAt.getTime() + 24 * 60 * 60 * 1000),
			};

			const existing = byProviderId.get(id);
			if (existing) {
				Object.assign(existing, payload);
				await this.repo.save(existing);
				await this.archiveStatusRow(existing);
			} else {
				const created = await this.repo.save(
					this.repo.create({
						accountId,
						providerStatusId: id,
						...payload,
						mediaPath: null,
					}),
				);
				byProviderId.set(id, created);
				existingRows.push(created);
				await this.archiveStatusRow(created);
			}
		}

		const allowStalePrune =
			refreshedProviderIds.size > 0 &&
			(existingActiveCount === 0 ||
				refreshedProviderIds.size >= Math.max(3, Math.ceil(existingActiveCount * 0.65)));
		if (allowStalePrune) {
			const stale = existingRows.filter(
				row =>
					(!row.expiresAt || row.expiresAt > new Date()) &&
					!refreshedProviderIds.has(row.providerStatusId),
			);
			for (const row of stale) {
				await this.archiveStatusRow(row);
			}
			if (stale.length) {
				await this.repo.delete(stale.map(row => row.id));
			}
		} else if (refreshedProviderIds.size > 0 && existingActiveCount > refreshedProviderIds.size) {
			this.logger.debug(
				`Status sync ${accountId}: skipped stale prune (provider=${refreshedProviderIds.size} dbActive=${existingActiveCount})`,
			);
		}
		return refreshedProviderIds.size;
	}

	async list(user: User, accountId: string, refresh = false, debug = false) {
		await this.access.assertAccountPermission(user, accountId, 'canView');
		this.schedulePrune(accountId);
		const contactNames = new Map<string, string>();
		let provider = this.providers.getProvider(accountId);
		let providerState = provider?.getState() || this.providers.getProviderState(accountId);
		let sessionReady = providerState === 'connected';
		let refreshHint: string | null = null;
		let providerCount = 0;
		const excluded: Array<{ id: string; reason: string }> = [];

		if (refresh) {
			const synced = await this.syncFromProvider(accountId);
			providerCount = synced.providerCount;
			refreshHint = synced.hint;
			provider = this.providers.getProvider(accountId);
			providerState = provider?.getState() || providerState;
			sessionReady = providerState === 'connected';
		}

		const live = await this.liveProviderStatusIds(accountId);
		if (live.fetched) {
			providerCount = Math.max(providerCount, live.count);
		}

		const items = await this.repo
			.createQueryBuilder('status')
			.where('status.accountId = :accountId', { accountId })
			.andWhere('(status.expiresAt IS NULL OR status.expiresAt > :now)', { now: new Date() })
			.orderBy('status.publishedAt', 'DESC')
			.take(500)
			.getMany();
		const dedupedItems: typeof items = [];
		const seenProviderIds = new Set<string>();
		const seenRowIds = new Set<string>();
		for (const item of items) {
			const providerKey = String(item.providerStatusId || '').trim().toLowerCase();
			if (providerKey && seenProviderIds.has(providerKey)) {
				if (debug) excluded.push({ id: item.id, reason: 'duplicate_provider_id' });
				continue;
			}
			if (seenRowIds.has(item.id)) {
				if (debug) excluded.push({ id: item.id, reason: 'duplicate_row_id' });
				continue;
			}
			if (providerKey) seenProviderIds.add(providerKey);
			seenRowIds.add(item.id);
			dedupedItems.push(item);
		}
		const senderIds = [
			...new Set(dedupedItems.map(item => item.senderWaId).filter(Boolean) as string[]),
		];
		const contactAvatars = new Map<string, string>();
		const contactPhones = new Map<string, string>();
		if (senderIds.length) {
			const contacts = await this.contactRepo.find({
				where: { accountId, waId: In(senderIds) },
			});
			// Address-book / DB labels win over ephemeral status pushNames.
			for (const contact of contacts) {
				const phone = contact.phoneNumber;
				const phoneDigits = String(phone || '').replace(/\D/g, '');
				if (phoneDigits) contactPhones.set(contact.waId, phoneDigits);
				if (contact.avatarUrl) {
					contactAvatars.set(contact.waId, contact.avatarUrl);
				}
				if (
					contact.name &&
					!isWeakWhatsAppContactName(contact.name, contact.waId, phone)
				) {
					contactNames.set(contact.waId, contact.name);
					continue;
				}
				if (!contactNames.has(contact.waId) && contact.name) {
					contactNames.set(contact.waId, contact.name);
				}
			}
		}
		await this.resolveLidSenderPhones(accountId, provider, senderIds, contactPhones, contactNames);
		const mapped = dedupedItems
			.map(item => {
				const fromMap = item.senderWaId ? contactNames.get(item.senderWaId) : null;
				const phoneHint = item.senderWaId
					? String(item.senderWaId).replace(/@.*$/, '').replace(/\D/g, '')
					: '';
				const contactName = item.isOwn
					? fromMap || 'You'
					: fromMap ||
						(phoneHint.length >= 8 ? `+${phoneHint}` : null);
				const inSession = live.ids.has(String(item.providerStatusId || '').trim());
				const isText = normalizeStatusType(item.type) === 'text';
				const hasDiskMedia = Boolean(String(item.mediaPath || '').trim());
				const mediaReady = isText || hasDiskMedia || inSession;
				return {
					...item,
					contactName,
					contactAvatarUrl: item.senderWaId
						? contactAvatars.get(item.senderWaId) || null
						: null,
					senderPhone: statusSenderPhone(item.senderWaId, contactPhones),
					mediaReady,
					inSession,
				};
			})
			.filter(item => {
				if (item.isOwn && normalizeStatusType(item.type) === 'text') return true;
				if (!item.senderWaId && !item.isOwn) {
					if (debug) excluded.push({ id: item.id, reason: 'missing_sender' });
					return false;
				}
				// Hide metadata-only media stories that are no longer in the live
				// Baileys cache and were never downloaded to disk. Refresh cannot
				// resurrect those — they only produce "session cache" errors.
				if (!item.mediaReady) {
					if (debug) {
						excluded.push({ id: item.id, reason: 'no_media_and_not_in_session' });
					}
					return false;
				}
				return true;
			});
		if (debug || process.env.WHATSAPP_STATUS_DEBUG === '1') {
			this.logger.log(
				`Status list ${accountId}: provider=${providerCount} db=${items.length} deduped=${dedupedItems.length} api=${mapped.length} excluded=${excluded.length}`,
			);
			if (excluded.length) {
				this.logger.debug(
					`Status exclusions ${accountId}: ${JSON.stringify(excluded.slice(0, 20))}`,
				);
			}
		}
		return {
			supported: provider?.capabilities.statusFetch ?? true,
			sessionReady,
			providerState,
			hint: refreshHint,
			items: await this.withStatusInteractions(accountId, mapped),
			...(debug || process.env.WHATSAPP_STATUS_DEBUG === '1'
				? {
						debug: {
							providerCount,
							dbCount: items.length,
							dedupedCount: dedupedItems.length,
							apiCount: mapped.length,
							liveCount: live.count,
							excluded,
						},
					}
				: {}),
		};
	}

	/**
	 * Stories from LID senders need the real phone so the inbox can ring the
	 * matching phone-based chat. Saved LID contacts often carry the LID digits as
	 * their "phone", so those are discarded and re-resolved via the live LID map,
	 * then by an exact same-name contact that has a real number.
	 */
	private async resolveLidSenderPhones(
		accountId: string,
		provider: WhatsAppProvider | null | undefined,
		senderIds: string[],
		contactPhones: Map<string, string>,
		contactNames: Map<string, string>,
	) {
		const isLid = (id: string) => /@(hosted\.)?lid$/i.test(id);
		const lidDigits = (id: string) => id.replace(/@.*$/, '').split(':')[0].replace(/\D/g, '');
		const validPhone = (id: string, digits: string) =>
			/^\d{8,15}$/.test(digits) && digits !== lidDigits(id);
		const missing: string[] = [];
		for (const id of senderIds) {
			if (!isLid(id)) continue;
			const known = contactPhones.get(id);
			if (known && validPhone(id, known)) continue;
			contactPhones.delete(id);
			missing.push(id);
		}
		if (!missing.length) return;

		const canResolve =
			typeof provider?.resolveContactIdentity === 'function' && provider.getState() === 'connected';
		if (canResolve) {
			const healed: Array<{ waId: string; phone: string }> = [];
			await Promise.all(
				missing.slice(0, 80).map(async id => {
					const identity = await Promise.race([
						provider!.resolveContactIdentity!(id).catch(() => null),
						new Promise<null>(resolve => setTimeout(() => resolve(null), 1500)),
					]);
					const digits = String(identity?.phoneNumber || '').replace(/\D/g, '');
					if (!validPhone(id, digits)) return;
					contactPhones.set(id, digits);
					healed.push({ waId: id, phone: digits });
				}),
			);
			for (const { waId, phone } of healed) {
				void this.contactRepo
					.update({ accountId, waId }, { phoneNumber: phone })
					.catch(() => undefined);
			}
		}

		const byName = new Map<string, string[]>();
		for (const id of missing) {
			if (contactPhones.has(id)) continue;
			const name = String(contactNames.get(id) || '').trim();
			if (!name || isWeakWhatsAppContactName(name, id, null)) continue;
			byName.set(name, [...(byName.get(name) || []), id]);
		}
		if (!byName.size) return;
		const namesakes = await this.contactRepo.find({
			where: { accountId, name: In([...byName.keys()]) },
			select: ['waId', 'name', 'phoneNumber'],
		});
		const phonesByName = new Map<string, Set<string>>();
		for (const contact of namesakes) {
			if (isLid(contact.waId)) continue;
			const digits = String(contact.phoneNumber || '').replace(/\D/g, '');
			if (!/^\d{8,15}$/.test(digits)) continue;
			const name = String(contact.name || '').trim();
			if (!phonesByName.has(name)) phonesByName.set(name, new Set());
			phonesByName.get(name)!.add(digits);
		}
		for (const [name, ids] of byName) {
			const phones = phonesByName.get(name);
			if (!phones || phones.size !== 1) continue;
			const [phone] = [...phones];
			for (const id of ids) contactPhones.set(id, phone);
		}
	}

	async listHistory(user: User, accountId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canView');
		const historyCount = await this.historyRepo.count({ where: { accountId } });
		if (!historyCount) {
			const activeRows = await this.repo.find({ where: { accountId }, take: 500 });
			await this.archiveStatusRows(activeRows);
		}
		const items = await this.historyRepo
			.createQueryBuilder('status')
			.where('status.accountId = :accountId', { accountId })
			.orderBy('status.publishedAt', 'DESC')
			.take(5000)
			.getMany();
		const contactNames = new Map<string, string>();
		const senderIds = [
			...new Set(items.map(item => item.senderWaId).filter(Boolean) as string[]),
		];
		const contactAvatars = new Map<string, string>();
		const contactPhones = new Map<string, string>();
		if (senderIds.length) {
			const contacts = await this.contactRepo.find({
				where: { accountId, waId: In(senderIds) },
			});
			for (const contact of contacts) {
				const phone = contact.phoneNumber;
				const phoneDigits = String(phone || '').replace(/\D/g, '');
				if (phoneDigits) contactPhones.set(contact.waId, phoneDigits);
				if (contact.avatarUrl) {
					contactAvatars.set(contact.waId, contact.avatarUrl);
				}
				if (
					contact.name &&
					!isWeakWhatsAppContactName(contact.name, contact.waId, phone)
				) {
					contactNames.set(contact.waId, contact.name);
					continue;
				}
				if (!contactNames.has(contact.waId) && contact.name) {
					contactNames.set(contact.waId, contact.name);
				}
			}
		}
		await this.resolveLidSenderPhones(
			accountId,
			this.providers.getProvider(accountId),
			senderIds,
			contactPhones,
			contactNames,
		);
		const mapped = items
			.map(item => {
				const fromMap = item.senderWaId ? contactNames.get(item.senderWaId) : null;
				const phoneHint = item.senderWaId
					? String(item.senderWaId).replace(/@.*$/, '').replace(/\D/g, '')
					: '';
				const contactName = item.isOwn
					? fromMap || 'You'
					: fromMap || (phoneHint.length >= 8 ? `+${phoneHint}` : null);
				const isText = normalizeStatusType(item.type) === 'text';
				const hasDiskMedia = Boolean(String(item.mediaPath || '').trim());
				return {
					...item,
					contactName,
					contactAvatarUrl: item.senderWaId
						? contactAvatars.get(item.senderWaId) || null
						: null,
					senderPhone: statusSenderPhone(item.senderWaId, contactPhones),
					isHistory: true,
					mediaReady: isText || hasDiskMedia,
				};
			})
			.filter(item => {
				if (!(item.isOwn || item.senderWaId)) return false;
				// History without saved media cannot be recovered after WhatsApp expiry.
				return Boolean(item.mediaReady);
			});
		return { items: await this.withStatusInteractions(accountId, mapped) };
	}

	/**
	 * Throws unless this user may publish a status on this account.
	 *
	 * Split out so a caller that is about to do expensive preparation — cutting a
	 * video into story clips, for one — can fail before spending the CPU.
	 */
	async assertCanPublish(user: User, accountId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canUse');
		const provider = this.provider(accountId);
		if (!provider.capabilities.statusPublish) {
			throw new BadRequestException('Status publishing is not supported by this provider');
		}
		return provider;
	}

	/**
	 * Everyone this account could publish a status to, taken from what has been synced
	 * into the database rather than from the provider's memory.
	 *
	 * A status reaches only the recipients named in the send. The provider's own contact
	 * list is populated by an app-state sync that WhatsApp does not repeat on every
	 * reconnect, so after a restart it is empty and a publish would silently go to
	 * nobody. Persisted contacts and the people we already have chats with survive that.
	 */
	private async publishAudience(accountId: string): Promise<string[]> {
		const [conversations, contacts] = await Promise.all([
			this.conversationRepo.find({
				where: { accountId },
				select: ['providerChatId'],
				// Publishing encrypts a copy per recipient, so the most recently active
				// chats — the people actually likely to open it — come first.
				order: { lastMessageAt: 'DESC' },
				take: STATUS_AUDIENCE_LIMIT,
			}),
			this.contactRepo.find({
				where: { accountId },
				select: ['waId', 'phoneNumber'],
				take: STATUS_AUDIENCE_LIMIT,
			}),
		]);
		// Group and broadcast chat ids come through here too; the filter drops them,
		// since neither can view a status.
		const audience = statusAudienceJids([
			...conversations.map(conversation => conversation.providerChatId),
			...contacts.flatMap(contact => [contact.phoneNumber, contact.waId]),
		]);
		return audience.slice(0, STATUS_AUDIENCE_LIMIT);
	}

	async publish(
		user: User,
		accountId: string,
		input: { type: string; content: string; caption?: string },
	) {
		const provider = await this.assertCanPublish(user, accountId);
		const result = await provider.publishStatus(input.content, {
			type: input.type,
			caption: input.caption,
			audienceWaIds: await this.publishAudience(accountId),
		});
		const publishedId = statusId(result);
		if (publishedId) {
			const contactNames = new Map<string, string>();
			await this.upsertProviderStatuses(
				accountId,
				[
					{
						...result,
						id: publishedId,
						type: input.type,
						caption: input.caption || (input.type === 'text' ? input.content : null),
						body: input.type === 'text' ? input.content : null,
						fromMe: true,
						isOwn: true,
						timestamp: Date.now() / 1000,
					},
				],
				contactNames,
			);
		}
		// WhatsApp may take a moment to surface the new status in StatusV3Store.
		try {
			await new Promise(resolve => setTimeout(resolve, 1200));
			await this.list(user, accountId, true);
		} catch {
			/* publish already succeeded; list refresh is best-effort */
		}
		this.gateway.emitAccountEvent(accountId, 'statuses_updated', {
			reason: 'published',
			providerStatusId: publishedId || null,
			type: input.type,
		});
		await this.audit.write({
			actorUserId: user.id,
			accountId,
			action: 'whatsapp.status.published',
			targetType: 'WhatsAppStatus',
			targetId: publishedId || null,
			metadata: { type: input.type },
		});
		const listed = await this.list(user, accountId, false);
		return { ok: true, providerStatusId: publishedId || null, providerResult: result, ...listed };
	}
	async view(user: User, accountId: string, statusProviderId: string, senderWaId?: string) {
		const permission = await this.access.getAccountAccess(user, accountId);
		if (!permission.canView) throw new ForbiddenException('WhatsApp account access denied');
		const privacy = getWhatsAppPrivacySettings(permission.account);
		if (privacy.hideStatusViewReceipts) {
			return { ok: true, receiptSuppressed: true };
		}
		const provider = this.provider(accountId);
		if (!provider.capabilities.statusView) {
			throw new BadRequestException('Status viewing is not supported by this provider');
		}
		await provider.viewStatus(statusProviderId, senderWaId);
		return { ok: true };
	}

	/**
	 * One person, one key: LID receipts are folded onto the phone JID when the live
	 * session (or a saved contact) knows it, so a viewer who also reacts is counted once.
	 */
	private async canonicalStatusActor(
		accountId: string,
		jid: string,
		folds?: Map<string, string>,
	): Promise<string> {
		const key = statusActorKey(jid);
		if (!/@(hosted\.)?lid$/.test(key)) return key;
		const canonical = await this.lidStatusActorToPhone(accountId, jid, key);
		if (canonical !== key) folds?.set(key, canonical);
		return canonical;
	}

	private async lidStatusActorToPhone(accountId: string, jid: string, key: string) {
		const phones = new Map<string, string>();
		const contact = await this.contactRepo
			.findOne({ where: { accountId, waId: jid }, select: ['waId', 'phoneNumber'] })
			.catch(() => null);
		const saved = String(contact?.phoneNumber || '').replace(/\D/g, '');
		if (saved) phones.set(jid, saved);
		await this.resolveLidSenderPhones(
			accountId,
			this.providers.getProvider(accountId),
			[jid],
			phones,
			new Map(),
		).catch(() => undefined);
		const phone = phones.get(jid);
		return phone ? `${phone}@s.whatsapp.net` : key;
	}

	/**
	 * Rows stored under a LID before its phone was known would otherwise be counted as
	 * a second person by the totals query while the viewers list shows one. Moves them
	 * onto the phone key (earliest view, newest reaction win). Idempotent.
	 */
	private async foldStatusActorKeys(accountId: string, folds: Map<string, string>) {
		let changed = false;
		for (const [fromKey, toKey] of folds) {
			if (!fromKey || !toKey || fromKey === toKey) continue;
			const memo = `${accountId}|${fromKey}|${toKey}`;
			if (this.foldedStatusActors.has(memo)) continue;
			await this.repo.manager.query(
				`INSERT INTO whatsapp_status_viewers (account_id, status_message_id, viewer_key, viewed_at)
				SELECT account_id, status_message_id, $3, viewed_at FROM whatsapp_status_viewers
				WHERE account_id = $1 AND viewer_key = $2 AND deleted_at IS NULL
				ON CONFLICT (account_id, status_message_id, viewer_key) DO UPDATE SET
					viewed_at = LEAST(whatsapp_status_viewers.viewed_at, EXCLUDED.viewed_at),
					deleted_at = NULL,
					updated_at = now()`,
				[accountId, fromKey, toKey],
			);
			await this.repo.manager.query(
				`INSERT INTO whatsapp_status_reactions (account_id, status_message_id, actor_key, emoji, message_id, reacted_at)
				SELECT account_id, status_message_id, $3, emoji, message_id, reacted_at FROM whatsapp_status_reactions
				WHERE account_id = $1 AND actor_key = $2 AND deleted_at IS NULL
				ON CONFLICT (account_id, status_message_id, actor_key) DO UPDATE SET
					emoji = EXCLUDED.emoji,
					message_id = COALESCE(EXCLUDED.message_id, whatsapp_status_reactions.message_id),
					reacted_at = EXCLUDED.reacted_at,
					deleted_at = NULL,
					updated_at = now()
				WHERE whatsapp_status_reactions.deleted_at IS NOT NULL
					OR whatsapp_status_reactions.reacted_at IS NULL
					OR EXCLUDED.reacted_at >= whatsapp_status_reactions.reacted_at`,
				[accountId, fromKey, toKey],
			);
			const removed = await Promise.all([
				this.repo.manager.query(
					`UPDATE whatsapp_status_viewers SET deleted_at = now(), updated_at = now()
					WHERE account_id = $1 AND viewer_key = $2 AND deleted_at IS NULL
					RETURNING status_message_id`,
					[accountId, fromKey],
				),
				this.repo.manager.query(
					`UPDATE whatsapp_status_reactions SET deleted_at = now(), updated_at = now()
					WHERE account_id = $1 AND actor_key = $2 AND deleted_at IS NULL
					RETURNING status_message_id`,
					[accountId, fromKey],
				),
			]);
			if (this.foldedStatusActors.size > 5_000) this.foldedStatusActors.clear();
			this.foldedStatusActors.add(memo);
			if (removed.some(rows => affectedRowCount(rows) > 0)) changed = true;
		}
		return changed;
	}

	/** Persist contacts who opened one of our own stories (WhatsApp status read receipts). */
	async recordStatusViewers(
		accountId: string,
		statusMessageIdValue: string,
		receipts: NormalizedWhatsAppParticipantReceipt[],
	) {
		const statusMessageId = statusMessageKey(statusMessageIdValue);
		if (!statusMessageId || !isUuid(accountId)) return;
		const byViewer = new Map<string, Date>();
		const folds = new Map<string, string>();
		for (const receipt of receipts || []) {
			const viewedAt = receipt?.readAt || receipt?.playedAt || null;
			if (!(viewedAt instanceof Date) || Number.isNaN(viewedAt.getTime())) continue;
			const jid = String(receipt?.participantJid || '').trim();
			if (!statusActorKey(jid)) continue;
			const key = await this.canonicalStatusActor(accountId, jid, folds);
			const previous = byViewer.get(key);
			if (!previous || viewedAt < previous) byViewer.set(key, viewedAt);
		}
		if (!byViewer.size) return;
		const params: unknown[] = [];
		const values = [...byViewer.entries()].map(([key, viewedAt], index) => {
			params.push(accountId, statusMessageId, key, viewedAt);
			const base = index * 4;
			return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
		});
		await this.repo.manager.query(
			`INSERT INTO whatsapp_status_viewers (account_id, status_message_id, viewer_key, viewed_at)
			VALUES ${values.join(', ')}
			ON CONFLICT (account_id, status_message_id, viewer_key) DO UPDATE SET
				viewed_at = LEAST(whatsapp_status_viewers.viewed_at, EXCLUDED.viewed_at),
				deleted_at = NULL,
				updated_at = now()`,
			params,
		);
		await this.foldStatusActorKeys(accountId, folds).catch(error =>
			this.logger.warn(
				`Story viewer LID fold failed for ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
		await this.emitStatusInteractionsUpdated(accountId, statusMessageId);
	}

	/**
	 * Upsert one person's reaction to a story. `actorKey = 'me'` is this account
	 * reacting to someone else's story; an older event never overwrites a newer one.
	 */
	async saveStatusReaction(
		accountId: string,
		statusMessageIdValue: string,
		actorKeyValue: string,
		emoji: string,
		messageId: string | null,
		reactedAt: Date | null,
	): Promise<StatusReactionRow | null> {
		const statusMessageId = statusMessageKey(statusMessageIdValue);
		const folds = new Map<string, string>();
		const actorKey =
			actorKeyValue === 'me'
				? 'me'
				: await this.canonicalStatusActor(accountId, actorKeyValue, folds);
		const value = String(emoji || '').trim().slice(0, 32);
		if (!statusMessageId || !actorKey || !value || !isUuid(accountId)) return null;
		const at = reactedAt instanceof Date && !Number.isNaN(reactedAt.getTime()) ? reactedAt : new Date();
		await this.repo.manager.query(
			`INSERT INTO whatsapp_status_reactions (account_id, status_message_id, actor_key, emoji, message_id, reacted_at)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (account_id, status_message_id, actor_key) DO UPDATE SET
				emoji = EXCLUDED.emoji,
				message_id = COALESCE(EXCLUDED.message_id, whatsapp_status_reactions.message_id),
				reacted_at = EXCLUDED.reacted_at,
				deleted_at = NULL,
				updated_at = now()
			WHERE whatsapp_status_reactions.reacted_at IS NULL
				OR whatsapp_status_reactions.emoji = EXCLUDED.emoji
				OR EXCLUDED.reacted_at >= whatsapp_status_reactions.reacted_at`,
			[accountId, statusMessageId, actorKey, value, messageId, at],
		);
		await this.foldStatusActorKeys(accountId, folds).catch(() => undefined);
		const row = await this.findStatusReaction(accountId, statusMessageId, actorKey);
		await this.emitStatusInteractionsUpdated(
			accountId,
			statusMessageId,
			actorKey === 'me' ? { myReaction: row?.emoji || null } : {},
		);
		return row;
	}

	async getOwnStatusReaction(accountId: string, statusMessageIdValue: string) {
		return this.findStatusReaction(accountId, statusMessageKey(statusMessageIdValue), 'me');
	}

	private async findStatusReaction(
		accountId: string,
		statusMessageId: string,
		actorKey: string,
	): Promise<StatusReactionRow | null> {
		if (!statusMessageId || !isUuid(accountId)) return null;
		const rows = await this.repo.manager.query(
			`SELECT status_message_id, actor_key, emoji, message_id, reacted_at
			FROM whatsapp_status_reactions
			WHERE account_id = $1 AND status_message_id = $2 AND actor_key = $3 AND deleted_at IS NULL
			LIMIT 1`,
			[accountId, statusMessageId, actorKey],
		);
		const row = rows?.[0];
		if (!row) return null;
		return {
			statusMessageId: row.status_message_id,
			actorKey: row.actor_key,
			emoji: row.emoji,
			messageId: row.message_id || null,
			reactedAt: row.reacted_at ? new Date(row.reacted_at) : null,
		};
	}

	/** Viewer and reaction totals per story; a reaction implies a view. */
	private async statusInteractionCounts(accountId: string, keys: string[]) {
		const counts = new Map<string, { viewerCount: number; reactionCount: number }>();
		if (!keys.length || !isUuid(accountId)) return counts;
		const rows = await this.repo.manager.query(
			`SELECT status_message_id,
				COUNT(DISTINCT actor)::int AS viewer_count,
				COUNT(DISTINCT actor) FILTER (WHERE is_reaction)::int AS reaction_count
			FROM (
				SELECT status_message_id, viewer_key AS actor, false AS is_reaction
				FROM whatsapp_status_viewers
				WHERE account_id = $1 AND status_message_id = ANY($2::varchar[]) AND deleted_at IS NULL
				UNION ALL
				SELECT status_message_id, actor_key AS actor, true AS is_reaction
				FROM whatsapp_status_reactions
				WHERE account_id = $1 AND status_message_id = ANY($2::varchar[])
					AND actor_key <> 'me' AND deleted_at IS NULL
			) interactions
			GROUP BY status_message_id`,
			[accountId, keys],
		);
		for (const row of rows || []) {
			counts.set(row.status_message_id, {
				viewerCount: Number(row.viewer_count) || 0,
				reactionCount: Number(row.reaction_count) || 0,
			});
		}
		return counts;
	}

	/**
	 * Account rooms reach every staff member with view access, so the live event
	 * carries totals only — never who viewed or reacted.
	 */
	private async emitStatusInteractionsUpdated(
		accountId: string,
		statusMessageId: string,
		extra: Record<string, unknown> = {},
	) {
		const counts = await this.statusInteractionCounts(accountId, [statusMessageId]).catch(
			() => new Map<string, { viewerCount: number; reactionCount: number }>(),
		);
		const total = counts.get(statusMessageId);
		this.gateway.emitAccountEvent(accountId, 'status_interactions_updated', {
			statusMessageId,
			viewerCount: total?.viewerCount || 0,
			reactionCount: total?.reactionCount || 0,
			...extra,
		});
	}

	/** Adds view totals to our own stories and our reaction to everyone else's. */
	private async withStatusInteractions<T extends { providerStatusId: string; isOwn: boolean }>(
		accountId: string,
		items: T[],
	): Promise<T[]> {
		const keys = [
			...new Set(items.map(item => statusMessageKey(item.providerStatusId)).filter(Boolean)),
		];
		if (!keys.length) return items;
		try {
			const [counts, mine] = await Promise.all([
				this.statusInteractionCounts(accountId, keys),
				this.repo.manager.query(
					`SELECT status_message_id, emoji FROM whatsapp_status_reactions
					WHERE account_id = $1 AND status_message_id = ANY($2::varchar[])
						AND actor_key = 'me' AND deleted_at IS NULL`,
					[accountId, keys],
				),
			]);
			const myReactions = new Map<string, string>(
				(mine || []).map((row: any) => [row.status_message_id, row.emoji]),
			);
			return items.map(item => {
				const key = statusMessageKey(item.providerStatusId);
				if (item.isOwn) {
					const total = counts.get(key);
					return {
						...item,
						viewerCount: total?.viewerCount || 0,
						reactionCount: total?.reactionCount || 0,
					};
				}
				return { ...item, myReaction: myReactions.get(key) || null };
			});
		} catch (error) {
			this.logger.warn(
				`Story interaction totals unavailable for ${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return items;
		}
	}

	/** Who opened one of our own stories, with any reaction they sent. Owner-only. */
	async listStatusViewers(user: User, accountId: string, statusIdValue: string) {
		await this.access.assertAccountPermission(user, accountId, 'canView');
		const found = await this.findStatusRow(accountId, statusIdValue);
		if (!found) throw new NotFoundException('WhatsApp status not found');
		if (!found.row.isOwn) {
			throw new ForbiddenException('Only the story owner can see who viewed it');
		}
		const statusMessageId = statusMessageKey(found.row.providerStatusId);
		const [viewerRows, reactionRows] = await Promise.all([
			this.repo.manager.query(
				`SELECT viewer_key, viewed_at FROM whatsapp_status_viewers
				WHERE account_id = $1 AND status_message_id = $2 AND deleted_at IS NULL
				ORDER BY viewed_at DESC NULLS LAST
				LIMIT ${STATUS_VIEWERS_LIMIT}`,
				[accountId, statusMessageId],
			),
			this.repo.manager.query(
				`SELECT actor_key, emoji, reacted_at FROM whatsapp_status_reactions
				WHERE account_id = $1 AND status_message_id = $2
					AND actor_key <> 'me' AND deleted_at IS NULL
				LIMIT ${STATUS_VIEWERS_LIMIT}`,
				[accountId, statusMessageId],
			),
		]);
		const people = new Map<
			string,
			{ viewedAt: Date | null; reaction: string | null; reactedAt: Date | null }
		>();
		for (const row of viewerRows || []) {
			people.set(row.viewer_key, {
				viewedAt: row.viewed_at ? new Date(row.viewed_at) : null,
				reaction: null,
				reactedAt: null,
			});
		}
		for (const row of reactionRows || []) {
			const entry = people.get(row.actor_key) || { viewedAt: null, reaction: null, reactedAt: null };
			entry.reaction = row.emoji || null;
			entry.reactedAt = row.reacted_at ? new Date(row.reacted_at) : null;
			people.set(row.actor_key, entry);
		}

		const keys = [...people.keys()];
		const contactIds = [
			...new Set(keys.flatMap(key => [key, key.replace(/@s\.whatsapp\.net$/, '@c.us')])),
		];
		const contacts = contactIds.length
			? await this.contactRepo.find({
					where: { accountId, waId: In(contactIds) },
					select: ['waId', 'name', 'phoneNumber', 'avatarUrl'],
				})
			: [];
		const contactByKey = new Map<string, WhatsAppContact>();
		for (const contact of contacts) {
			const key = statusActorKey(contact.waId);
			const current = contactByKey.get(key);
			if (!current || (!current.name && contact.name)) contactByKey.set(key, contact);
		}
		const names = new Map<string, string>();
		const phones = new Map<string, string>();
		for (const key of keys) {
			const contact = contactByKey.get(key);
			if (contact?.name) names.set(key, contact.name);
			const digits = String(contact?.phoneNumber || '').replace(/\D/g, '');
			if (digits) phones.set(key, digits);
		}
		await this.resolveLidSenderPhones(
			accountId,
			this.providers.getProvider(accountId),
			keys.filter(key => /@(hosted\.)?lid$/.test(key)),
			phones,
			names,
		).catch(() => undefined);

		const merged = new Map<
			string,
			{
				id: string;
				name: string | null;
				phone: string | null;
				avatarUrl: string | null;
				viewedAt: Date | null;
				reaction: string | null;
				reactedAt: Date | null;
			}
		>();
		const earliest = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a <= b ? a : b);
		const folds = new Map<string, string>();
		for (const [key, entry] of people) {
			const phone = statusSenderPhone(key, phones);
			if (phone && /@(hosted\.)?lid$/.test(key)) folds.set(key, `${phone}@s.whatsapp.net`);
			const contact = contactByKey.get(key);
			const rawName = names.get(key) || null;
			const name =
				rawName && !isWeakWhatsAppContactName(rawName, key, phone) ? rawName : null;
			const identity = phone ? `phone:${phone}` : key;
			const current = merged.get(identity);
			if (!current) {
				merged.set(identity, {
					id: key,
					name,
					phone,
					avatarUrl: contact?.avatarUrl || null,
					viewedAt: entry.viewedAt,
					reaction: entry.reaction,
					reactedAt: entry.reactedAt,
				});
				continue;
			}
			current.name = current.name || name;
			current.avatarUrl = current.avatarUrl || contact?.avatarUrl || null;
			current.viewedAt = earliest(current.viewedAt, entry.viewedAt);
			if (
				entry.reaction &&
				(!current.reactedAt || (entry.reactedAt && entry.reactedAt > current.reactedAt))
			) {
				current.reaction = entry.reaction;
				current.reactedAt = entry.reactedAt;
			}
		}
		const activity = (item: { viewedAt: Date | null; reactedAt: Date | null }) =>
			Math.max(item.viewedAt?.getTime() || 0, item.reactedAt?.getTime() || 0);
		const viewers = [...merged.values()].sort((a, b) => activity(b) - activity(a));
		// Self-heal legacy LID rows so the story ring total matches this list.
		if (folds.size) {
			const changed = await this.foldStatusActorKeys(accountId, folds).catch(() => false);
			if (changed) await this.emitStatusInteractionsUpdated(accountId, statusMessageId);
		}
		return {
			statusId: found.row.id,
			providerStatusId: found.row.providerStatusId,
			viewerCount: viewers.length,
			reactionCount: viewers.filter(item => item.reaction).length,
			viewers,
		};
	}

	/**
	 * Validates a reply/reaction to someone else's live story and returns where it
	 * goes. LID posters are answered in their phone chat when the number is known.
	 */
	async resolveStatusInteractionTarget(user: User, accountId: string, statusIdValue: string) {
		await this.access.assertAccountPermission(user, accountId, 'canUse');
		const found = await this.findStatusRow(accountId, statusIdValue);
		if (!found) throw new NotFoundException('WhatsApp status not found');
		const row = found.row;
		if (row.isOwn) {
			throw new BadRequestException('You cannot reply or react to your own story');
		}
		const expiresAt = row.expiresAt ? new Date(row.expiresAt).getTime() : null;
		if (found.source === 'history' || (expiresAt !== null && expiresAt <= Date.now())) {
			throw new BadRequestException('This story has expired');
		}
		const senderWaId = String(row.senderWaId || '').trim();
		if (!senderWaId) throw new BadRequestException('The story sender is unknown');
		const statusMessageId = statusMessageKey(row.providerStatusId);
		if (!statusMessageId) throw new BadRequestException('The story id is unknown');

		const contact = await this.contactRepo.findOne({
			where: { accountId, waId: senderWaId },
			select: ['waId', 'name', 'phoneNumber'],
		});
		const phones = new Map<string, string>();
		const names = new Map<string, string>();
		const savedDigits = String(contact?.phoneNumber || '').replace(/\D/g, '');
		if (savedDigits) phones.set(senderWaId, savedDigits);
		if (contact?.name) names.set(senderWaId, contact.name);
		let chatJid = senderWaId;
		if (/@(hosted\.)?lid$/i.test(senderWaId)) {
			await this.resolveLidSenderPhones(
				accountId,
				this.providers.getProvider(accountId),
				[senderWaId],
				phones,
				names,
			).catch(() => undefined);
			const phone = phones.get(senderWaId);
			if (phone) chatJid = `${phone}@c.us`;
		}
		const name = names.get(senderWaId) || null;
		const statusQuote: WhatsAppStatusQuote = {
			statusMessageId,
			providerStatusId: row.providerStatusId,
			ownerJid: senderWaId,
			type: normalizeStatusType(row.type),
			caption: row.caption,
		};
		return {
			statusId: row.id,
			ownerJid: chatJid,
			title: name && !isWeakWhatsAppContactName(name, senderWaId, null) ? name : null,
			statusQuote,
		};
	}
	private async findStatusRow(
		accountId: string,
		statusIdValue: string,
		options?: { historyOnly?: boolean },
	): Promise<{ row: StatusRow; source: StatusRowSource } | null> {
		const id = String(statusIdValue || '').trim();
		if (!id) return null;
		if (!isUuid(accountId)) return null;

		const lookupHistory = async () => {
			if (isUuid(id)) {
				const byPk = await this.historyRepo.findOne({ where: { id, accountId } });
				if (byPk) return { row: byPk, source: 'history' as const };
			}
			const byProvider = await this.historyRepo.findOne({
				where: { providerStatusId: id, accountId },
			});
			if (byProvider) return { row: byProvider, source: 'history' as const };
			return null;
		};

		const lookupActive = async () => {
			if (isUuid(id)) {
				const byPk = await this.repo.findOne({ where: { id, accountId } });
				if (byPk) return { row: byPk, source: 'active' as const };
			}
			const byProvider = await this.repo.findOne({
				where: { providerStatusId: id, accountId },
			});
			if (byProvider) return { row: byProvider, source: 'active' as const };
			return null;
		};

		if (options?.historyOnly) return lookupHistory();
		const active = await lookupActive();
		if (active) return active;
		return lookupHistory();
	}

	async resolveContent(
		user: User,
		accountId: string,
		statusIdValue: string,
		options?: { history?: boolean },
	) {
		await this.access.assertAccountPermission(user, accountId, 'canView');
		const found = await this.findStatusRow(accountId, statusIdValue, {
			historyOnly: options?.history,
		});
		if (!found) throw new NotFoundException('WhatsApp status not found');
		return this.resolveStatusMedia(found.row, found.source, accountId);
	}

	private async resolveStatusMedia(
		status: StatusRow,
		source: StatusRowSource,
		accountId: string,
		options?: { allowSyncRetry?: boolean; allowPhoneRequest?: boolean },
	) {
		if (normalizeStatusType(status.type) === 'text') {
			throw new BadRequestException('Text status does not have media content');
		}
		const allowSyncRetry = options?.allowSyncRetry !== false;
		const allowPhoneRequest = options?.allowPhoneRequest !== false;
		const root = path.resolve(
			process.env.WHATSAPP_MEDIA_ROOT ||
				path.join(process.cwd(), 'storage', 'whatsapp-media'),
		);
		const folder = path.join(root, 'statuses', accountId);
		await fs.mkdir(folder, { recursive: true });
		if (status.mediaPath) {
			const cached = path.resolve(process.cwd(), status.mediaPath);
			const allowedRoots = [
				folder,
				path.join(process.cwd(), 'uploads', 'whatsapp-media', 'statuses', accountId),
				path.join(process.cwd(), 'storage', 'whatsapp-media', 'statuses', accountId),
			].map(value => path.resolve(value));
			const underAllowedRoot = allowedRoots.some(
				rootPath =>
					cached === rootPath || cached.startsWith(`${rootPath}${path.sep}`),
			);
			if (underAllowedRoot) {
				try {
					const cachedBuffer = await fs.readFile(cached);
					const detectedMime =
						this.detectMediaMime(cachedBuffer) || this.statusMimeType(status.type);
					if (!isIncompleteStatusMedia(cachedBuffer, detectedMime, status.type)) {
						return {
							absolutePath: cached,
							mimeType: detectedMime,
							fileName: path.basename(cached),
						};
					}
					await fs.unlink(cached).catch(() => undefined);
					status.mediaPath = null;
					if (source === 'history') {
						await this.historyRepo.save(status as WhatsAppStatusHistory);
					} else {
						await this.repo.save(status as WhatsAppStatus);
					}
				} catch {
					// Download again when a stale DB path points to a removed file.
				}
			}
		}
		let data: any = null;
		if (source === 'history') {
			// Last chance: still in the live Baileys cache (rare for archived rows).
			try {
				const liveProvider = this.provider(accountId);
				if (
					!liveProvider.capabilities.mediaDownload ||
					typeof liveProvider.downloadStatus !== 'function'
				) {
					throw new Error('unsupported');
				}
				data = await liveProvider.downloadStatus(
					status.providerStatusId,
					status.senderWaId,
					{ allowPhoneRequest },
				);
				const liveBuffer = decodeProviderMedia(data);
				const liveMime =
					this.detectMediaMime(liveBuffer) || this.statusMimeType(status.type);
				if (
					!liveBuffer.length ||
					isIncompleteStatusMedia(liveBuffer, liveMime, status.type)
				) {
					throw new Error('empty');
				}
			} catch (error) {
				if (error instanceof BadRequestException) throw error;
				throw new BadRequestException(
					'Archived story media is no longer available. It was not saved before expiry.',
				);
			}
		} else {
			let provider;
			try {
				provider = this.provider(accountId);
			} catch (error) {
				if (error instanceof BadRequestException) throw error;
				throw new BadRequestException(
					'WhatsApp account is not connected. Link the account, then open this story again.',
				);
			}
			if (!provider.capabilities.mediaDownload) {
				throw new BadRequestException('Status media download is not supported');
			}
			let lastDownloadError: any = null;
			try {
				data =
					typeof provider.downloadStatus === 'function'
						? await provider.downloadStatus(status.providerStatusId, status.senderWaId, {
								allowPhoneRequest,
							})
						: await provider.downloadMedia(status.providerStatusId);
			} catch (error: any) {
				lastDownloadError = error;
				const detail = String(error?.message || error || '');
				const recoverable =
					allowSyncRetry &&
					(/session cache/i.test(detail) ||
						/not found in whatsapp store/i.test(detail) ||
						/unavailable from whatsapp/i.test(detail));
				if (recoverable) {
					try {
						await this.syncFromProvider(accountId);
						data =
							typeof provider.downloadStatus === 'function'
								? await provider.downloadStatus(
										status.providerStatusId,
										status.senderWaId,
										{ allowPhoneRequest },
									)
								: await provider.downloadMedia(status.providerStatusId);
						lastDownloadError = null;
					} catch (retryError: any) {
						lastDownloadError = retryError;
					}
				}
				if (lastDownloadError) {
					const retryDetail = String(lastDownloadError?.message || lastDownloadError || '');
					if (/session cache/i.test(retryDetail)) {
						throw new BadRequestException(
							'This story is no longer in the live WhatsApp session and was not saved to disk when it arrived. Open a newly posted story, or wait for the next status from this contact.',
						);
					}
					throw new BadRequestException(
						retryDetail && retryDetail !== 'Object'
							? retryDetail
							: 'Status media is unavailable from WhatsApp. Refresh stories and try again.',
					);
				}
			}
		}
		let buffer: Buffer;
		try {
			buffer = decodeProviderMedia(data);
		} catch {
			throw new BadRequestException(
				'Status media is unavailable from WhatsApp. Refresh stories and try again.',
			);
		}
		if (!buffer.length) {
			throw new BadRequestException(
				'Status media is unavailable from WhatsApp. Refresh stories and try again.',
			);
		}
		const mimeFromData =
			typeof data?.data === 'string'
				? data.data.match(/^data:([^;]+);base64,/)?.[1]
				: typeof data === 'string'
					? data.match(/^data:([^;]+);base64,/)?.[1]
					: undefined;
		const detectedMime =
			this.detectMediaMime(buffer) || mimeFromData || this.statusMimeType(status.type);
		if (isIncompleteStatusMedia(buffer, detectedMime, status.type)) {
			throw new BadRequestException(
				'Full status media is unavailable from WhatsApp (got thumbnail only). Refresh stories and try again.',
			);
		}
		if (detectedMime.startsWith('video/') && !String(status.type).toLowerCase().includes('video')) {
			status.type = 'video';
		} else if (
			detectedMime.startsWith('image/') &&
			!['image', 'sticker', 'gif'].some(value =>
				String(status.type).toLowerCase().includes(value),
			)
		) {
			status.type = detectedMime.includes('gif') ? 'gif' : 'image';
		}
		const mimeType = detectedMime;
		const extension = mimeType.includes('video')
			? '.mp4'
			: mimeType.includes('webp')
				? '.webp'
				: mimeType.includes('png')
					? '.png'
					: mimeType.includes('gif')
						? '.gif'
						: '.jpg';
		const absolutePath = path.join(folder, `${status.id}${extension}`);
		await fs.writeFile(absolutePath, buffer);
		status.mediaPath = path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
		if (source === 'history') {
			await this.historyRepo.save(status as WhatsAppStatusHistory);
		} else {
			const active = status as WhatsAppStatus;
			await this.repo.save(active);
			await this.archiveStatusRow(active);
		}
		return { absolutePath, mimeType, fileName: path.basename(absolutePath) };
	}
	private detectMediaMime(buffer: Buffer): string | null {
		if (!buffer?.length || buffer.length < 12) return null;
		if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
		if (
			buffer[0] === 0x89 &&
			buffer[1] === 0x50 &&
			buffer[2] === 0x4e &&
			buffer[3] === 0x47
		) {
			return 'image/png';
		}
		if (
			buffer[0] === 0x47 &&
			buffer[1] === 0x49 &&
			buffer[2] === 0x46 &&
			buffer[3] === 0x38
		) {
			return 'image/gif';
		}
		if (
			buffer.toString('ascii', 0, 4) === 'RIFF' &&
			buffer.toString('ascii', 8, 12) === 'WEBP'
		) {
			return 'image/webp';
		}
		if (buffer.toString('ascii', 4, 8) === 'ftyp') {
			return 'video/mp4';
		}
		return null;
	}
	private statusMimeType(type: string) {
		const value = String(type || '').toLowerCase();
		if (value.includes('video')) return 'video/mp4';
		if (value.includes('gif')) return 'image/gif';
		if (value.includes('webp') || value.includes('sticker')) return 'image/webp';
		return 'image/jpeg';
	}
}
