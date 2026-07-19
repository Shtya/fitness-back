import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { In, Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import { WhatsAppContact, WhatsAppStatus } from '../entities/whatsapp.entity';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import { WhatsAppAccessService } from './whatsapp-access.service';
import { WhatsAppAuditService } from './whatsapp-audit.service';
import { WhatsAppProviderManagerService } from './whatsapp-provider-manager.service';
import { whatsAppTimestampToDate } from '../utils/whatsapp-time';
import { getWhatsAppPrivacySettings } from '../utils/whatsapp-privacy';

function statusId(item: any) {
	return String(
		item?.id?._serialized ||
			(typeof item?.id === 'string' || typeof item?.id === 'number' ? item.id : '') ||
			item?.messageId ||
			'',
	);
}

function statusIdentityKeys(value: unknown): string[] {
	const text = String(value || '').trim();
	if (!text) return [];
	const keys = new Set<string>([text.toLowerCase()]);
	const broadcastMatch = text.match(/status@broadcast_([^_]+)/i);
	if (broadcastMatch?.[1]) keys.add(broadcastMatch[1].toLowerCase());
	const hexMatch = text.match(/_([0-9A-Fa-f]{10,}|3A[0-9A-Fa-f]+)(?:_|$)/);
	if (hexMatch?.[1]) keys.add(hexMatch[1].toLowerCase());
	const parts = text.split('_').filter(Boolean);
	const bare = parts.length ? parts[parts.length - 1] : text;
	// Prefer the WhatsApp status message id segment when present.
	const statusPart = parts.find(part => /^3A[0-9A-Fa-f]+$/i.test(part) || /^[0-9A-Fa-f]{16,}$/i.test(part));
	if (statusPart) keys.add(statusPart.toLowerCase());
	if (/^[0-9A-Fa-f]{10,}$/i.test(bare) || /^3A[0-9A-Fa-f]+$/i.test(bare)) {
		keys.add(bare.toLowerCase());
	}
	if (/^\d+$/.test(text)) keys.add(text);
	return [...keys];
}

function preferStatusId(current: string, candidate: string) {
	const currentScore =
		(current.includes('status@broadcast') ? 2 : 0) + (current.includes('@') ? 1 : 0) + current.length;
	const candidateScore =
		(candidate.includes('status@broadcast') ? 2 : 0) +
		(candidate.includes('@') ? 1 : 0) +
		candidate.length;
	return candidateScore >= currentScore ? candidate : current;
}

function normalizeStatusType(value: unknown) {
	const type = String(value || 'text').toLowerCase();
	if (type === 'chat') return 'text';
	return type || 'text';
}

@Injectable()

export class WhatsAppStatusService {
	constructor(
		@InjectRepository(WhatsAppStatus)
		private readonly repo: Repository<WhatsAppStatus>,
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

	private async upsertProviderStatuses(
		accountId: string,
		statuses: any[],
		contactNames: Map<string, string>,
	) {
		const existingRows = await this.repo.find({ where: { accountId } });
		const byIdentity = new Map<string, (typeof existingRows)[number]>();
		for (const row of existingRows) {
			for (const key of statusIdentityKeys(row.providerStatusId)) {
				if (!byIdentity.has(key)) byIdentity.set(key, row);
			}
		}

		const refreshedIds: string[] = [];
		const touchedIds = new Set<string>();
		for (const item of statuses || []) {
			const id = statusId(item);
			if (!id) continue;
			refreshedIds.push(id);
			const senderWaId =
				item?.author?._serialized ||
				item?.from?._serialized ||
				String(item?.sender || item?.author || item?.from || '') ||
				null;
			const contactName = String(
				item?.contactName || item?.notifyName || item?.sender?.pushname || '',
			).trim();
			if (senderWaId && contactName) {
				contactNames.set(senderWaId, contactName);
				await this.contactRepo.upsert(
					{
						accountId,
						waId: senderWaId,
						name: contactName,
						phoneNumber: String(senderWaId).replace(/@.*/, '') || null,
					},
					['accountId', 'waId'],
				);
			}
			const publishedAt =
				whatsAppTimestampToDate(item?.timestamp ?? item?.t) || new Date();
			const providerType = normalizeStatusType(item?.type);
			const identity = statusIdentityKeys(id);
			let existing =
				existingRows.find(row => row.providerStatusId === id) ||
				identity.map(key => byIdentity.get(key)).find(Boolean) ||
				null;

			if (existing) {
				if (touchedIds.has(existing.id)) {
					// Same status already updated via another id shape in this batch.
					continue;
				}
				touchedIds.add(existing.id);
				const nextProviderId = preferStatusId(existing.providerStatusId, id);
				existing.providerStatusId = nextProviderId;
				existing.senderWaId = senderWaId;
				existing.type = providerType;
				existing.caption = item?.caption || item?.body || existing.caption;
				existing.isOwn = Boolean(item?.fromMe || item?.isOwn);
				existing.publishedAt = publishedAt;
				existing.expiresAt = new Date(publishedAt.getTime() + 24 * 60 * 60 * 1000);
				await this.repo.save(existing);
				for (const key of statusIdentityKeys(nextProviderId)) {
					byIdentity.set(key, existing);
				}
			} else {
				const created = await this.repo.save(
					this.repo.create({
						accountId,
						providerStatusId: id,
						senderWaId,
						type: providerType,
						caption: item?.caption || item?.body || null,
						isOwn: Boolean(item?.fromMe || item?.isOwn),
						publishedAt,
						expiresAt: new Date(publishedAt.getTime() + 24 * 60 * 60 * 1000),
						mediaPath: null,
					}),
				);
				touchedIds.add(created.id);
				existingRows.push(created);
				for (const key of statusIdentityKeys(id)) {
					byIdentity.set(key, created);
				}
			}
		}
		// Drop statuses that WhatsApp no longer returns (deleted / expired),
		// and collapse any leftover duplicate identity rows.
		if (Array.isArray(statuses)) {
			const refreshedKeys = new Set<string>();
			for (const id of refreshedIds) {
				for (const key of statusIdentityKeys(id)) refreshedKeys.add(key);
			}
			const keepByIdentity = new Map<string, string>();
			const staleIds: string[] = [];
			const latestRows = await this.repo.find({ where: { accountId } });
			for (const row of latestRows) {
				const rowKeys = statusIdentityKeys(row.providerStatusId);
				const stillPresent = rowKeys.some(key => refreshedKeys.has(key));
				if (!stillPresent) {
					staleIds.push(row.id);
					continue;
				}
				const primaryKey = rowKeys.find(key => refreshedKeys.has(key)) || rowKeys[0];
				const keptId = keepByIdentity.get(primaryKey);
				if (!keptId) {
					keepByIdentity.set(primaryKey, row.id);
					continue;
				}
				// Duplicate identity: keep the preferred provider id row.
				const kept = latestRows.find(item => item.id === keptId);
				if (!kept) {
					keepByIdentity.set(primaryKey, row.id);
					continue;
				}
				const preferRow =
					preferStatusId(kept.providerStatusId, row.providerStatusId) ===
					row.providerStatusId
						? row
						: kept;
				const dropId = preferRow.id === row.id ? kept.id : row.id;
				staleIds.push(dropId);
				keepByIdentity.set(primaryKey, preferRow.id);
			}
			if (staleIds.length) {
				await this.repo.delete([...new Set(staleIds)]);
			}
		}
		return refreshedIds.length;
	}

	async list(user: User, accountId: string, refresh = false) {
		await this.access.assertAccountPermission(user, accountId, 'canView');
		const provider = this.providers.getProvider(accountId);
		const contactNames = new Map<string, string>();
		if (refresh && provider?.capabilities.statusFetch) {
			try {
				const statuses = await provider.getStatuses();
				if (Array.isArray(statuses)) {
					await this.upsertProviderStatuses(accountId, statuses, contactNames);
				}
			} catch {
				// Keep the local snapshot when WhatsApp sync fails mid-refresh.
			}
		}
		const items = await this.repo
			.createQueryBuilder('status')
			.where('status.accountId = :accountId', { accountId })
			.andWhere('(status.expiresAt IS NULL OR status.expiresAt > :now)', { now: new Date() })
			.orderBy('status.publishedAt', 'DESC')
			.take(200)
			.getMany();
		const dedupedItems: typeof items = [];
		const seenIdentity = new Set<string>();
		for (const item of items) {
			const keys = statusIdentityKeys(item.providerStatusId);
			const primary = keys[0] || item.id;
			if (keys.some(key => seenIdentity.has(key))) continue;
			for (const key of keys) seenIdentity.add(key);
			seenIdentity.add(primary);
			dedupedItems.push(item);
		}
		const senderIds = [
			...new Set(dedupedItems.map(item => item.senderWaId).filter(Boolean) as string[]),
		];
		if (senderIds.length) {
			const contacts = await this.contactRepo.find({
				where: { accountId, waId: In(senderIds) },
			});
			for (const contact of contacts) {
				if (contact.name && !contactNames.has(contact.waId)) {
					contactNames.set(contact.waId, contact.name);
				}
			}
		}
		return {
			supported: provider?.capabilities.statusFetch ?? false,
			items: dedupedItems.map(item => ({
				...item,
				contactName: item.senderWaId
					? contactNames.get(item.senderWaId) || (item.isOwn ? 'You' : null)
					: item.isOwn
						? 'You'
						: null,
			})),
		};
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
	async resolveContent(user: User, accountId: string, statusIdValue: string) {
		await this.access.assertAccountPermission(user, accountId, 'canView');
		const status = await this.repo.findOne({
			where: { id: statusIdValue, accountId },
		});
		if (!status) throw new NotFoundException('WhatsApp status not found');
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
			if (cached.startsWith(`${folder}${path.sep}`)) {
				try {
					const stats = await fs.stat(cached);
					const cachedBuffer = await fs.readFile(cached);
					const detectedMime =
						this.detectMediaMime(cachedBuffer) || this.statusMimeType(status.type);
					const minBytes = detectedMime.startsWith('video/') ? 20_000 : 3_000;
					// Tiny files are almost always WhatsApp thumbnails saved by an older bug.
					if (stats.size >= minBytes || this.detectMediaMime(cachedBuffer)) {
						return {
							absolutePath: cached,
							mimeType: detectedMime,
							fileName: path.basename(cached),
						};
					}
					await fs.unlink(cached).catch(() => undefined);
					status.mediaPath = null;
					await this.repo.save(status);
				} catch {
					// Download again when a stale DB path points to a removed file.
				}
			}
		}
		const provider = this.provider(accountId);
		if (!provider.capabilities.mediaDownload) {
			throw new BadRequestException('Status media download is not supported');
		}
		let data: any;
		try {
			data =
				typeof provider.downloadStatus === 'function'
					? await provider.downloadStatus(status.providerStatusId, status.senderWaId)
					: await provider.downloadMedia(status.providerStatusId);
		} catch (error: any) {
			const detail = String(error?.message || error || '');
			const missing =
				/not found|could not be downloaded|unavailable|thumbnail only/i.test(detail);
			if (missing) {
				// Deleted/expired stories still linger in DB until refresh; drop them here.
				if (status.mediaPath) {
					const cached = path.resolve(process.cwd(), status.mediaPath);
					await fs.unlink(cached).catch(() => undefined);
				}
				await this.repo.delete(status.id);
			}
			throw new BadRequestException(
				detail && detail !== 'Object'
					? detail
					: 'Status media is unavailable from WhatsApp. Refresh stories and try again.',
			);
		}
		const dataUri = String(data?.data || data || '');
		const mimeFromData = dataUri.match(/^data:([^;]+);base64,/)?.[1];
		const raw = dataUri.replace(/^data:[^;]+;base64,/, '');
		const buffer = Buffer.from(raw, 'base64');
		if (!buffer.length) {
			throw new BadRequestException(
				'Status media is unavailable from WhatsApp. Refresh stories and try again.',
			);
		}
		const detectedMime =
			this.detectMediaMime(buffer) || mimeFromData || this.statusMimeType(status.type);
		const isVideo = detectedMime.startsWith('video/');
		const minBytes = isVideo ? 20_000 : 3_000;
		if (buffer.length < minBytes && !this.detectMediaMime(buffer)) {
			throw new BadRequestException(
				'Full status media is unavailable from WhatsApp (got thumbnail only). Refresh stories and try again.',
			);
		}
		// Persist the real media type so the viewer and thumbnails use the correct decoder.
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
		await this.repo.save(status);
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
