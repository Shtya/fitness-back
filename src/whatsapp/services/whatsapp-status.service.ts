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
import { WhatsAppContact, WhatsAppStatus, WhatsAppStatusHistory } from '../entities/whatsapp.entity';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
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

function isUuid(value: unknown) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
		String(value || '').trim(),
	);
}

type StatusRow = WhatsAppStatus | WhatsAppStatusHistory;
type StatusRowSource = 'active' | 'history';

@Injectable()

export class WhatsAppStatusService {
	private readonly logger = new Logger(WhatsAppStatusService.name);

	constructor(
		@InjectRepository(WhatsAppStatus)
		private readonly repo: Repository<WhatsAppStatus>,
		@InjectRepository(WhatsAppStatusHistory)
		private readonly historyRepo: Repository<WhatsAppStatusHistory>,
		@InjectRepository(WhatsAppContact)
		private readonly contactRepo: Repository<WhatsAppContact>,
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

	private async archiveStatusRow(row: StatusRow) {
		await this.historyRepo.upsert(
			{
				accountId: row.accountId,
				providerStatusId: row.providerStatusId,
				senderWaId: row.senderWaId,
				type: row.type,
				caption: row.caption,
				isOwn: row.isOwn,
				publishedAt: row.publishedAt,
				expiresAt: row.expiresAt,
				mediaPath: row.mediaPath,
				archivedAt: new Date(),
			},
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
		for (const row of expired) {
			await this.archiveStatusRow(row);
		}
		if (expired.length) {
			await this.repo.delete(expired.map(row => row.id));
		}
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
		await this.pruneExpiredStatuses(accountId);
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
		if (senderIds.length) {
			const contacts = await this.contactRepo.find({
				where: { accountId, waId: In(senderIds) },
			});
			// Address-book / DB labels win over ephemeral status pushNames.
			for (const contact of contacts) {
				const phone = contact.phoneNumber;
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
				return {
					...item,
					contactName,
					contactAvatarUrl: item.senderWaId
						? contactAvatars.get(item.senderWaId) || null
						: null,
				};
			})
			.filter(item => {
				if (item.isOwn) return true;
				if (!item.senderWaId) {
					if (debug) excluded.push({ id: item.id, reason: 'missing_sender' });
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
			items: mapped,
			...(debug || process.env.WHATSAPP_STATUS_DEBUG === '1'
				? {
						debug: {
							providerCount,
							dbCount: items.length,
							dedupedCount: dedupedItems.length,
							apiCount: mapped.length,
							excluded,
						},
					}
				: {}),
		};
	}

	async listHistory(user: User, accountId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canView');
		const historyCount = await this.historyRepo.count({ where: { accountId } });
		if (!historyCount) {
			const activeRows = await this.repo.find({ where: { accountId }, take: 500 });
			for (const row of activeRows) {
				await this.archiveStatusRow(row);
			}
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
		if (senderIds.length) {
			const contacts = await this.contactRepo.find({
				where: { accountId, waId: In(senderIds) },
			});
			for (const contact of contacts) {
				const phone = contact.phoneNumber;
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
		const mapped = items
			.map(item => {
				const fromMap = item.senderWaId ? contactNames.get(item.senderWaId) : null;
				const phoneHint = item.senderWaId
					? String(item.senderWaId).replace(/@.*$/, '').replace(/\D/g, '')
					: '';
				const contactName = item.isOwn
					? fromMap || 'You'
					: fromMap || (phoneHint.length >= 8 ? `+${phoneHint}` : null);
				return {
					...item,
					contactName,
					contactAvatarUrl: item.senderWaId
						? contactAvatars.get(item.senderWaId) || null
						: null,
					isHistory: true,
				};
			})
			.filter(item => item.isOwn || item.senderWaId);
		return { items: mapped };
	}

	async publish(
		user: User,
		accountId: string,
		input: { type: string; content: string; caption?: string },
	) {
		await this.access.assertAccountPermission(user, accountId, 'canUse');
		const provider = this.provider(accountId);
		if (!provider.capabilities.statusPublish) {
			throw new BadRequestException('Status publishing is not supported by this provider');
		}
		const result = await provider.publishStatus(input.content, {
			type: input.type,
			caption: input.caption,
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
		return { ok: true, providerResult: result, ...listed };
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
	) {
		if (normalizeStatusType(status.type) === 'text') {
			throw new BadRequestException('Text status does not have media content');
		}
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
		if (source === 'history') {
			throw new BadRequestException(
				'Archived story media is no longer available. It was not saved before expiry.',
			);
		}
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
		let data: any;
		let lastDownloadError: any = null;
		try {
			data =
				typeof provider.downloadStatus === 'function'
					? await provider.downloadStatus(status.providerStatusId, status.senderWaId)
					: await provider.downloadMedia(status.providerStatusId);
		} catch (error: any) {
			lastDownloadError = error;
			const detail = String(error?.message || error || '');
			const recoverable =
				/session cache/i.test(detail) ||
				/not found in whatsapp store/i.test(detail) ||
				/unavailable from whatsapp/i.test(detail);
			if (recoverable) {
				try {
					await this.syncFromProvider(accountId);
					data =
						typeof provider.downloadStatus === 'function'
							? await provider.downloadStatus(
									status.providerStatusId,
									status.senderWaId,
								)
							: await provider.downloadMedia(status.providerStatusId);
					lastDownloadError = null;
				} catch (retryError: any) {
					lastDownloadError = retryError;
				}
			}
			if (lastDownloadError) {
				const retryDetail = String(lastDownloadError?.message || lastDownloadError || '');
				throw new BadRequestException(
					retryDetail && retryDetail !== 'Object'
						? retryDetail
						: 'Status media is unavailable from WhatsApp. Refresh stories and try again.',
				);
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
		const active = status as WhatsAppStatus;
		await this.repo.save(active);
		await this.archiveStatusRow(active);
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
