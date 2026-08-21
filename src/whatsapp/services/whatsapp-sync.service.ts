import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
	OnModuleDestroy,
	OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { In, Repository } from 'typeorm';
import { NotificationAudience, NotificationType, User } from '../../../entities/global.entity';
import { NotificationService } from '../../notification/notification.service';
import {
	WhatsAppAccount,
	WhatsAppContact,
	WhatsAppConversation,
	WhatsAppConversationNote,
	WhatsAppConversationPreference,
	WhatsAppConversationType,
	WhatsAppGroup,
	WhatsAppGroupParticipant,
	WhatsAppMessage,
	WhatsAppMessageAttachment,
	WhatsAppMessageDirection,
	WhatsAppMessageReaction,
	WhatsAppMessageStatus,
} from '../entities/whatsapp.entity';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import {
	NormalizedWhatsAppMessage,
	WhatsAppProvider,
	WhatsAppProviderEvent,
} from '../providers/whatsapp-provider';
import { sanitizeBaileysWaMessage } from '../utils/baileys-media-raw';
import { extractWhatsAppLocation, mergeLocationIntoRaw } from '../utils/whatsapp-location';
import { decodeProviderMedia } from '../utils/whatsapp-media-decode';
import { WhatsAppAccessService } from './whatsapp-access.service';
import { WhatsAppAuditService } from './whatsapp-audit.service';
import { WhatsAppProviderManagerService } from './whatsapp-provider-manager.service';
import {
	providerChatActivityMs as providerChatActivityMsFromChat,
	providerChatMessageActivityMs,
	whatsAppTimestampToDate,
	whatsAppTimestampToMs,
} from '../utils/whatsapp-time';
import { getWhatsAppPrivacySettings } from '../utils/whatsapp-privacy';
import { shouldSkipFreshProviderSync } from '../utils/whatsapp-sync-policy';

function hasChatVisibleContent(normalized: Partial<NormalizedWhatsAppMessage> | null | undefined) {
	const text = String(normalized?.text || '')
		.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\u00AD]/g, '')
		.trim();
	if (text) return true;
	if (normalized?.attachments?.length) return true;
	const type = String(normalized?.type || '').toLowerCase();
	return [
		'image',
		'video',
		'audio',
		'ptt',
		'voice',
		'document',
		'sticker',
		'location',
		'live_location',
		'contact',
		'poll',
	].includes(type);
}

function sniffAudioMime(buffer: Buffer): string | null {
	if (!buffer || buffer.length < 4) return null;
	if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
	if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
		return 'audio/webm';
	}
	if (
		buffer.subarray(0, 3).toString('ascii') === 'ID3' ||
		(buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
	) {
		return 'audio/mpeg';
	}
	if (buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
		return 'audio/mp4';
	}
	return null;
}

function isValidAudioBuffer(buffer: Buffer, mimeType?: string | null) {
	if (buffer.length < 64) return false;
	// Prefer magic-byte sniffing — WhatsApp often stores ogg/opus under a mismatched mime.
	if (sniffAudioMime(buffer)) return true;
	const mime = String(mimeType || '').toLowerCase();
	if (!mime || mime.includes('octet-stream') || mime === 'application/ogg') {
		return buffer.length >= 64;
	}
	if (mime.includes('ogg')) return buffer.subarray(0, 4).toString('ascii') === 'OggS';
	if (mime.includes('webm')) {
		return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
	}
	if (mime.includes('mpeg') || mime.includes('mp3')) {
		return (
			buffer.subarray(0, 3).toString('ascii') === 'ID3' ||
			(buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
		);
	}
	if (mime.includes('mp4') || mime.includes('m4a')) {
		return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
	}
	return buffer.length >= 256;
}

/** Guess MIME from filename/extension so CRM outbound media is not sent as generic documents. */
function guessMimeFromPath(filePath: string, fallbackType?: string | null): string | null {
	const lower = String(filePath || '').toLowerCase();
	if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return 'audio/ogg; codecs=opus';
	if (lower.endsWith('.webm')) return 'audio/webm; codecs=opus';
	if (lower.endsWith('.mp3')) return 'audio/mpeg';
	if (lower.endsWith('.m4a')) return 'audio/mp4';
	if (lower.endsWith('.wav')) return 'audio/wav';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.webp')) return 'image/webp';
	if (lower.endsWith('.gif')) return 'image/gif';
	if (lower.endsWith('.mp4')) return 'video/mp4';
	if (lower.endsWith('.mov')) return 'video/quicktime';
	if (lower.endsWith('.pdf')) return 'application/pdf';
	const kind = String(fallbackType || '').toLowerCase();
	if (kind === 'image') return 'image/jpeg';
	if (kind === 'sticker') return 'image/webp';
	if (kind === 'video') return 'video/mp4';
	if (kind === 'voice' || kind === 'audio' || kind === 'ptt') return 'audio/ogg; codecs=opus';
	return null;
}

function sniffImageMime(buffer: Buffer): string | null {
	if (!buffer || buffer.length < 12) return null;
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
	return null;
}

function baileysRawMediaContent(raw: any): any {
	const message = raw?.message || null;
	if (!message) return null;
	return (
		message.ephemeralMessage?.message ||
		message.viewOnceMessage?.message ||
		message.viewOnceMessageV2?.message ||
		message.viewOnceMessageV2Extension?.message ||
		message
	);
}

function baileysRawMediaNode(raw: any): any {
	const content = baileysRawMediaContent(raw);
	if (!content) return null;
	return (
		content.imageMessage ||
		content.videoMessage ||
		content.audioMessage ||
		content.documentMessage ||
		content.stickerMessage ||
		null
	);
}

function baileysRawMediaScore(raw: any): number {
	if (!raw || typeof raw !== 'object') return 0;
	if (!raw.message) return 0;
	const node = baileysRawMediaNode(raw);
	let score = node ? 2 : 1;
	if (node) {
		if (node.mediaKey) score += 3;
		if (node.directPath || node.url) score += 2;
		if (node.fileSha256 || node.fileEncSha256) score += 1;
	}
	const content = baileysRawMediaContent(raw);
	const location = content?.locationMessage || content?.liveLocationMessage;
	if (
		location &&
		(location.degreesLatitude != null ||
			location.degreesLongitude != null ||
			location.latitude != null)
	) {
		score += 4;
	}
	return score;
}

function jpegThumbnailToDataUrl(thumb: any): string | null {
	if (thumb == null) return null;
	if (typeof thumb === 'string' && thumb.length) {
		if (thumb.startsWith('data:')) return thumb;
		return `data:image/jpeg;base64,${thumb}`;
	}
	if (Buffer.isBuffer(thumb) && thumb.length) {
		return `data:image/jpeg;base64,${thumb.toString('base64')}`;
	}
	if (thumb?.type === 'Buffer' && Array.isArray(thumb.data) && thumb.data.length) {
		return `data:image/jpeg;base64,${Buffer.from(thumb.data).toString('base64')}`;
	}
	return null;
}

function mediaPreviewDataUrlFromRaw(raw: any): string | null {
	const mediaThumb = jpegThumbnailToDataUrl(baileysRawMediaNode(raw)?.jpegThumbnail);
	if (mediaThumb) return mediaThumb;
	const content = baileysRawMediaContent(raw);
	return jpegThumbnailToDataUrl(
		(content?.locationMessage || content?.liveLocationMessage)?.jpegThumbnail,
	);
}

function baileysContextInfo(raw: any): any {
	const content = baileysRawMediaContent(raw);
	if (!content || typeof content !== 'object') return null;
	return (
		content.extendedTextMessage?.contextInfo ||
		content.imageMessage?.contextInfo ||
		content.videoMessage?.contextInfo ||
		content.audioMessage?.contextInfo ||
		content.documentMessage?.contextInfo ||
		content.stickerMessage?.contextInfo ||
		content.locationMessage?.contextInfo ||
		content.liveLocationMessage?.contextInfo ||
		null
	);
}

function quotedPreviewFromRaw(raw: any): string | null {
	const quoted = baileysContextInfo(raw)?.quotedMessage;
	if (!quoted) return null;
	return mediaPreviewDataUrlFromRaw({ message: quoted, protocol: 'baileys' });
}

function quotedTypeFromRaw(raw: any): string | null {
	const quoted = baileysContextInfo(raw)?.quotedMessage;
	if (!quoted || typeof quoted !== 'object') return null;
	if (quoted.imageMessage) return 'image';
	if (quoted.videoMessage) return 'video';
	if (quoted.stickerMessage) return 'sticker';
	if (quoted.documentMessage) return 'document';
	if (quoted.audioMessage) return quoted.audioMessage.ptt ? 'ptt' : 'audio';
	if (quoted.liveLocationMessage) return 'live_location';
	if (quoted.locationMessage) return 'location';
	return 'text';
}

function quotedTextFromRaw(raw: any): string | null {
	const quoted = baileysContextInfo(raw)?.quotedMessage;
	if (!quoted || typeof quoted !== 'object') return null;
	const text =
		quoted.conversation ||
		quoted.extendedTextMessage?.text ||
		quoted.imageMessage?.caption ||
		quoted.videoMessage?.caption ||
		quoted.documentMessage?.caption ||
		quoted.locationMessage?.name ||
		quoted.locationMessage?.address ||
		quoted.liveLocationMessage?.caption ||
		'';
	return String(text || '').trim() || null;
}

function needsLocationHydration(message: WhatsAppMessage | null | undefined) {
	const type = String(message?.type || '').toLowerCase();
	if (type !== 'location' && type !== 'live_location' && type !== 'livelocation') {
		return false;
	}
	return !extractWhatsAppLocation(message);
}

function persistableMessageRaw(normalized: NormalizedWhatsAppMessage, currentRaw?: any) {
	const location = normalized.location || extractWhatsAppLocation(normalized);
	const base = safeProviderMetadata(normalized.raw) || currentRaw || null;
	return mergeLocationIntoRaw(base, location);
}

function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
	const da = String(a || '').replace(/\D/g, '');
	const db = String(b || '').replace(/\D/g, '');
	if (!da || !db) return false;
	if (da === db) return true;
	// Egypt local 01xxxxxxxxx ↔ 201xxxxxxxxx
	if (da.startsWith('0') && db === `20${da.slice(1)}`) return true;
	if (db.startsWith('0') && da === `20${db.slice(1)}`) return true;
	if (da.length >= 9 && db.length >= 9) {
		const aTail = da.slice(-9);
		const bTail = db.slice(-9);
		if (aTail === bTail) return true;
	}
	return false;
}

function phoneAliasChatIds(digits: string): string[] {
	const clean = String(digits || '').replace(/\D/g, '');
	if (!clean) return [];
	return [`${clean}@c.us`, `${clean}@s.whatsapp.net`];
}

function waId(value: any): string {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value;
	const serialized =
		value?._serialized ||
		value?.id?._serialized ||
		(typeof value?.id === 'string' ? value.id : null) ||
		value?.chatId?._serialized ||
		(typeof value?.chatId === 'string' ? value.chatId : null) ||
		value?.contact?.id?._serialized ||
		(typeof value?.contact?.id === 'string' ? value.contact.id : null);
	return serialized ? String(serialized) : '';
}

export function isSupportedInboxChatId(id: string): boolean {
	const normalized = String(id || '')
		.trim()
		.toLowerCase();
	if (!normalized) return false;
	// Allow @newsletter channels. Exclude status + classic broadcast lists.
	return !normalized.includes('status@') && !normalized.includes('@broadcast');
}

function phoneFromWaId(id: string): string | null {
	if (!id) return null;
	const lower = id.toLowerCase();
	if (
		lower.includes('@lid') ||
		lower.includes('@broadcast') ||
		lower.includes('status@') ||
		lower.includes('@newsletter')
	) {
		return null;
	}
	const user = id.split('@')[0] || '';
	return /^\d{8,15}$/.test(user) ? user : null;
}

/** Contact/group labels that are just raw WhatsApp ids (LID / phone digits). */
function isWeakContactDisplayName(
	name: string | null | undefined,
	chatId?: string | null,
	phone?: string | null,
): boolean {
	const n = String(name || '').trim();
	if (!n) return true;
	const phoneDigits = String(phone || '').replace(/\D/g, '');
	if (phoneDigits && n.replace(/\D/g, '') === phoneDigits && /^\+?\d[\d\s-]*$/.test(n)) {
		return true;
	}
	const user = String(chatId || '')
		.split('@')[0]
		.split(':')[0]
		.trim();
	if (user && n === user) return true;
	if (/^\d{8,32}$/.test(n)) return true;
	return false;
}

export function providerUnreadCount(chat: any): number | null {
	const candidates = [chat?.unreadCount, chat?.unreadMessages, chat?.countUnreadMessages];
	for (const candidate of candidates) {
		if (candidate === null || candidate === undefined || candidate === '') continue;
		const value = Number(candidate);
		if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
	}
	return null;
}

/** Provider unread can seed a brand-new CRM thread. It must never wipe a
 *  live CRM badge: Baileys/linked-device ChatStore almost always reports 0
 *  after a companion receives the message, even if the operator never opened it. */
export function shouldCopyProviderUnread(
	currentUnread: number,
	lastMessageAt: Date | string | null | undefined,
	providerUnread: number | null,
): boolean {
	if (providerUnread == null) return false;
	const current = Math.max(0, Number(currentUnread) || 0);
	if (providerUnread <= 0) return false;
	if (current > 0) return false;
	return !lastMessageAt;
}

const WHATSAPP_ACK_RANK: Record<string, number> = {
	pending: 0,
	sent: 1,
	delivered: 2,
	read: 3,
	played: 4,
};

export function preferWhatsAppAckStatus(
	current?: string | null,
	incoming?: string | null,
): string {
	const next = String(incoming || '').toLowerCase();
	const prev = String(current || '').toLowerCase();
	if (next === 'failed') return 'failed';
	if (!next) return prev || 'sent';
	if (prev === 'failed') return next;
	const prevRank = WHATSAPP_ACK_RANK[prev] ?? -1;
	const nextRank = WHATSAPP_ACK_RANK[next] ?? -1;
	if (nextRank < 0) return prev || next;
	return nextRank >= prevRank ? next : prev;
}

export function providerChatActivityMs(chat: any): number {
	return providerChatActivityMsFromChat(chat);
}

function providerMessageId(value: any): string {
	return (
		waId(value?.id) ||
		waId(value?.message?.id) ||
		waId(value?.key) ||
		String(
			value?.id?._serialized ||
				value?.messageId ||
				value?.key?.id ||
				value?.sendMsgResult?.messageId ||
				'',
		)
	);
}

function safeProviderMetadata(raw: any) {
	if (!raw || typeof raw !== 'object') return null;
	// Baileys WAMessage (live) or already sanitized envelope.
	if (raw.protocol === 'baileys') {
		return (
			sanitizeBaileysWaMessage(raw) || {
				protocol: 'baileys',
				id: providerMessageId(raw) || undefined,
			}
		);
	}
	if (raw.key && raw.message) {
		return (
			sanitizeBaileysWaMessage(raw) || {
				protocol: 'baileys',
				id: providerMessageId(raw) || undefined,
			}
		);
	}
	return {
		id: providerMessageId(raw) || undefined,
		from: waId(raw.from) || undefined,
		to: waId(raw.to) || undefined,
		author: waId(raw.author) || undefined,
		type: raw.type || undefined,
		timestamp: raw.timestamp || raw.t || undefined,
		ack: raw.ack ?? undefined,
		mimetype: raw.mimetype || undefined,
		filename: raw.filename || undefined,
		size: raw.size || undefined,
		pushName: raw.pushName || raw.notifyName || raw.contactName || undefined,
		duration: Number.isFinite(Number(raw.duration ?? raw.mediaData?.duration))
			? Number(raw.duration ?? raw.mediaData?.duration)
			: undefined,
		lat: raw.lat ?? raw.latitude ?? undefined,
		lng: raw.lng ?? raw.longitude ?? undefined,
		loc: raw.loc || undefined,
		comment: raw.comment || undefined,
	};
}

@Injectable()
export class WhatsAppSyncService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(WhatsAppSyncService.name);
	private unsubscribe?: () => void;
	private bootstrapping = new Set<string>();
	private bootstrapUnlockTimers = new Map<string, NodeJS.Timeout>();
	private persistQueue: Promise<void> = Promise.resolve();
	private activePersists = 0;
	private readonly maxConcurrentPersists = 1;
	private conversationUpdateTimers = new Map<string, NodeJS.Timeout>();
	private conversationUpdatePayloads = new Map<string, Record<string, unknown>>();
	private attachmentDownloads = new Map<string, Promise<any>>();
	private activeMediaDownloads = 0;
	private readonly maxConcurrentMediaDownloads = 2;
	private sendOperations = new Map<string, Promise<unknown>>();
	private inboxReconcileTimers = new Map<string, NodeJS.Timeout>();
	private inboxReconcileInFlight = new Set<string>();
	private inboxSyncTail = new Map<string, Promise<unknown>>();
	private conversationHotCache = new Map<string, { conversation: WhatsAppConversation; at: number }>();
	private lastInboxSyncAt = new Map<string, number>();
	private historyPersistQueue: Promise<void> = Promise.resolve();
	private historyPersistPending = 0;
	private historyInboxDebounceTimers = new Map<string, NodeJS.Timeout>();
	private historyInboxTotals = new Map<string, { chats: number; messages: number }>();
	private readonly historyInboxDebounceMs = 8_000;

	constructor(
		@InjectRepository(WhatsAppAccount)
		private readonly accountRepo: Repository<WhatsAppAccount>,
		@InjectRepository(WhatsAppContact)
		private readonly contactRepo: Repository<WhatsAppContact>,
		@InjectRepository(WhatsAppConversation)
		private readonly conversationRepo: Repository<WhatsAppConversation>,
		@InjectRepository(WhatsAppConversationNote)
		private readonly noteRepo: Repository<WhatsAppConversationNote>,
		@InjectRepository(WhatsAppGroup)
		private readonly groupRepo: Repository<WhatsAppGroup>,
		@InjectRepository(WhatsAppGroupParticipant)
		private readonly participantRepo: Repository<WhatsAppGroupParticipant>,
		@InjectRepository(WhatsAppMessage)
		private readonly messageRepo: Repository<WhatsAppMessage>,
		@InjectRepository(WhatsAppMessageAttachment)
		private readonly attachmentRepo: Repository<WhatsAppMessageAttachment>,
		@InjectRepository(WhatsAppMessageReaction)
		private readonly reactionRepo: Repository<WhatsAppMessageReaction>,
		private readonly access: WhatsAppAccessService,
		private readonly providers: WhatsAppProviderManagerService,
		private readonly gateway: WhatsAppGateway,
		private readonly audit: WhatsAppAuditService,
		private readonly notifications: NotificationService,
		@InjectRepository(WhatsAppConversationPreference)
		private readonly preferenceRepo: Repository<WhatsAppConversationPreference>,
	) {}

	onModuleInit() {
		this.unsubscribe = this.providers.onProviderEvent((accountId, event) =>
			this.handleProviderEvent(accountId, event),
		);
	}

	onModuleDestroy() {
		this.unsubscribe?.();
		for (const timer of this.inboxReconcileTimers.values()) clearInterval(timer);
		this.inboxReconcileTimers.clear();
		for (const timer of this.historyInboxDebounceTimers.values()) clearTimeout(timer);
		this.historyInboxDebounceTimers.clear();
		this.historyInboxTotals.clear();
		this.conversationHotCache.clear();
		this.lastInboxSyncAt.clear();
	}

	private stopInboxReconciliation(accountId: string) {
		const timer = this.inboxReconcileTimers.get(accountId);
		if (timer) clearInterval(timer);
		this.inboxReconcileTimers.delete(accountId);
		this.inboxReconcileInFlight.delete(accountId);
	}

	private startInboxReconciliation(accountId: string) {
		if (this.inboxReconcileTimers.has(accountId)) return;
		const timer = setInterval(() => {
			if (
				this.inboxReconcileInFlight.has(accountId) ||
				this.bootstrapping.has(accountId) ||
				this.inboxSyncTail.has(accountId)
			) {
				this.logger.debug(
					`Inbox reconcile skipped for ${accountId}: skipped-because-locked`,
				);
				return;
			}
			const lastSync = this.lastInboxSyncAt.get(accountId) || 0;
			if (lastSync && Date.now() - lastSync < 90_000) {
				this.logger.debug(
					`Inbox reconcile skipped for ${accountId}: recent sync ${Date.now() - lastSync}ms ago`,
				);
				return;
			}
			const provider = this.providers.getProvider(accountId);
			if (!provider || provider.getState() !== 'connected') {
				this.stopInboxReconciliation(accountId);
				return;
			}
			const cooldown = provider.getChatStoreCooldownMs?.() || 0;
			if (cooldown > 0) return;
			this.inboxReconcileInFlight.add(accountId);
			void (async () => {
				if (typeof provider.isChatStoreHydrated === 'function') {
					const ready = await provider.isChatStoreHydrated().catch(() => false);
					if (!ready) {
						this.logger.debug(
							`Inbox reconcile skipped for ${accountId}: ChatStore not hydrated`,
						);
						return;
					}
				}
				await this.syncChatsInternal(accountId, provider, 500, {
					syncGroupParticipants: false,
					emitProgress: false,
				});
			})()
				.catch((error) =>
					this.logger.warn(
						`Automatic WhatsApp inbox reconciliation failed for ${accountId}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					),
				)
				.finally(() => this.inboxReconcileInFlight.delete(accountId));
		}, 120_000);
		timer.unref?.();
		this.inboxReconcileTimers.set(accountId, timer);
	}

	private requireProvider(accountId: string) {
		const provider = this.providers.getProvider(accountId);
		if (!provider || provider.getState() !== 'connected') {
			throw new BadRequestException('WhatsApp account is not connected');
		}
		return provider;
	}

	private runIdempotentSend<T>(
		userId: string,
		conversationId: string,
		clientMessageId: string | undefined,
		operation: () => Promise<T>,
	): Promise<T> {
		const id = String(clientMessageId || '').trim();
		if (!id) return operation();
		const key = `${userId}:${conversationId}:${id}`;
		const existing = this.sendOperations.get(key);
		if (existing) return existing as Promise<T>;
		const pending = operation().catch((error) => {
			this.sendOperations.delete(key);
			throw error;
		});
		this.sendOperations.set(key, pending);
		const cleanup = setTimeout(
			() => {
				if (this.sendOperations.get(key) === pending) this.sendOperations.delete(key);
			},
			15 * 60 * 1000,
		);
		cleanup.unref?.();
		return pending;
	}

	private async handleProviderEvent(accountId: string, event: WhatsAppProviderEvent) {
		if (event.type === 'message') {
			if (!isSupportedInboxChatId(event.message?.chatId)) return;
			const fromHistory = Boolean(
				(event.message as any)?.__fromHistory || (event.message as any)?.raw?.__fromHistory,
			);
			if (fromHistory) {
				this.enqueueHistoryPersist(
					() =>
						this.persistMessage(accountId, event.message, null, false, {
							emitEvents: false,
						}),
					`history-message:${accountId}:${event.message?.providerMessageId || 'unknown'}`,
				);
				return;
			}
			this.enqueuePersist(
				() =>
					this.persistMessage(accountId, event.message, null, true, {
						emitEvents: true,
					}),
				`message:${accountId}:${event.message?.providerMessageId || 'unknown'}`,
			);
			return;
		}
		if (event.type === 'chat_unread') {
			// ChatStore dumps often report 0. Trust only a live phone-read (explicit 0)
			// after bootstrap — opening/replying in the WhatsApp app.
			if (event.unreadCount !== 0 || this.bootstrapping.has(accountId)) return;
			if (!isSupportedInboxChatId(event.chatId)) return;
			this.enqueuePersist(async () => {
				const conversation = await this.findInboxConversation(accountId, event.chatId);
				if (!conversation) return;
				await this.clearUnreadFromPhone(accountId, conversation.id);
			}, `chat_read:${accountId}:${event.chatId}`);
			return;
		}
		if (event.type === 'history_sync') {
			this.logger.log(
				`Baileys history sync for ${accountId}: ${event.chats} chats, ${event.messages} messages`,
			);
			const historyMessages = Array.isArray(event.payload) ? event.payload : [];
			if (historyMessages.length) {
				this.enqueueHistoryPersist(
					() => this.persistHistoryBatch(accountId, historyMessages),
					`history-batch:${accountId}:${historyMessages.length}`,
				);
			}
			this.scheduleHistoryInboxReconcile(accountId, {
				chats: Number(event.chats) || 0,
				messages: Number(event.messages) || historyMessages.length,
			});
			return;
		}
		if (event.type === 'status_changed') {
			this.gateway.emitAccountEvent(accountId, 'statuses_updated', {
				reason: 'provider_status_changed',
			});
			return;
		}
		if (event.type === 'presence') {
			const chatId = String(event.payload?.chatId || '');
			if (!chatId || !isSupportedInboxChatId(chatId)) return;
			const conversation = await this.conversationRepo.findOne({
				where: { accountId, providerChatId: chatId },
			});
			if (!conversation) return;
			const state = String(event.payload?.state || 'unavailable');
			const typing = state === 'composing' || state === 'recording';
			this.gateway.emitAccountEvent(accountId, 'presence', {
				conversationId: conversation.id,
				chatId,
				state,
				isOnline: Boolean(event.payload?.isOnline),
				typing,
				recording: state === 'recording',
				t: event.payload?.t || Date.now(),
			});
			this.gateway.emitConversationEvent(
				conversation.id,
				'presence',
				{
					conversationId: conversation.id,
					state,
					isOnline: Boolean(event.payload?.isOnline),
					typing,
					recording: state === 'recording',
					t: event.payload?.t || Date.now(),
				},
				accountId,
			);
			return;
		}
		if (event.type === 'connection' && event.status === 'connected') {
			this.startInboxReconciliation(accountId);
			void this.scheduleBootstrap(accountId);
		} else if (event.type === 'connection') {
			this.stopInboxReconciliation(accountId);
			if (!this.bootstrapping.has(accountId)) {
				/* ignore */
			} else if (event.reason === 'session_replaced') {
				this.gateway.emitAccountEvent(accountId, 'sync_progress', {
					accountId,
					progress: 15,
					stage: 'phone_wait',
					message: 'WhatsApp session was replaced — reconnecting…',
				});
			} else if (
				event.reason === 'phone_closed' ||
				event.status === 'error' ||
				String(event.error || '').toLowerCase().includes('phone')
			) {
				this.abortBootstrap(accountId, 'phone_closed');
			} else if (
				['disconnected', 'qr_pending', 'connecting'].includes(String(event.status || ''))
			) {
				this.gateway.emitAccountEvent(accountId, 'sync_progress', {
					accountId,
					progress: 15,
					stage: 'phone_wait',
					message:
						'Keep WhatsApp open on your phone — reconnecting to finish sync…',
				});
			}
		}
		if (event.type === 'message_status') {
			this.enqueuePersist(async () => {
				const message = await this.messageRepo.findOne({
					where: { accountId, providerMessageId: event.providerMessageId },
				});
				if (!message) return;
				const nextStatus = preferWhatsAppAckStatus(message.status, event.status);
				if (nextStatus && nextStatus !== message.status) {
					await this.messageRepo.update(message.id, {
						status: nextStatus as WhatsAppMessageStatus,
						statusUpdatedAt: new Date(),
					});
					message.status = nextStatus as WhatsAppMessageStatus;
				}
				this.gateway.emitConversationEvent(
					message.conversationId,
					'message_status',
					{
						messageId: message.id,
						providerMessageId: event.providerMessageId,
						status: message.status,
					},
					accountId,
				);
				this.scheduleConversationUpdated(accountId, {
					conversationId: message.conversationId,
					preview: {
						id: message.id,
						status: message.status,
						providerMessageId: message.providerMessageId,
						providerTimestamp: message.providerTimestamp,
						type: message.type,
						text: message.text,
						direction: message.direction,
					},
				});
			}, `message_status:${accountId}:${event.providerMessageId}`);
			return;
		}
		if (event.type === 'message_reactions') {
			this.enqueuePersist(
				() => this.persistMessageReactions(accountId, event.providerMessageId, event.reactions),
				`message_reactions:${accountId}:${event.providerMessageId}`,
			);
			return;
		}
		if (event.type === 'message_deleted') {
			this.enqueuePersist(async () => {
				const message = await this.messageRepo.findOne({
					where: { accountId, providerMessageId: event.providerMessageId },
				});
				if (!message) return;
				const providerDeletedAt = new Date();
				await this.messageRepo.update(message.id, {
					deletedMode: event.mode,
					providerDeletedAt,
					text: null,
				});
				this.gateway.emitConversationEvent(
					message.conversationId,
					'message_updated',
					{
						messageId: message.id,
						changes: { deletedMode: event.mode, providerDeletedAt, text: null },
					},
					accountId,
				);
			}, `message_deleted:${accountId}:${event.providerMessageId}`);
		}
	}

	private async persistMessageReactions(
		accountId: string,
		providerMessageIdValue: string,
		reactions: Array<{
			actorKey: string;
			emoji: string;
			timestamp?: Date | null;
		}>,
	) {
		const message = await this.messageRepo.findOne({
			where: { accountId, providerMessageId: providerMessageIdValue },
		});
		if (!message) return [];
		await this.reactionRepo.manager.transaction(async (manager) => {
			await manager.delete(WhatsAppMessageReaction, { messageId: message.id });
			if (reactions.length) {
				await manager.save(
					WhatsAppMessageReaction,
					reactions.map((reaction) =>
						manager.create(WhatsAppMessageReaction, {
							messageId: message.id,
							actorKey: reaction.actorKey,
							emoji: reaction.emoji,
							reactedAt: reaction.timestamp || null,
						}),
					),
				);
			}
		});
		const saved = await this.reactionRepo.find({
			where: { messageId: message.id },
			order: { created_at: 'ASC' },
		});
		this.gateway.emitConversationEvent(
			message.conversationId,
			'message_reactions',
			{
				messageId: message.id,
				providerMessageId: providerMessageIdValue,
				reactions: saved,
			},
			accountId,
		);
		return saved;
	}

	/** WhatsApp Web media downloads all run through one Puppeteer page. Letting a
	 *  chat full of photos and voice notes hit it at once made every request time
	 *  out, so only a couple are in flight at a time. */
	private async withMediaDownloadSlot<T>(task: () => Promise<T>): Promise<T> {
		while (this.activeMediaDownloads >= this.maxConcurrentMediaDownloads) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		this.activeMediaDownloads += 1;
		try {
			return await task();
		} finally {
			this.activeMediaDownloads -= 1;
		}
	}

	private enqueuePersist(task: () => Promise<unknown>, context = 'unknown') {
		this.persistQueue = this.persistQueue
			.then(async () => {
				while (this.activePersists >= this.maxConcurrentPersists) {
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				this.activePersists += 1;
				try {
					let lastError: unknown;
					for (let attempt = 1; attempt <= 3; attempt += 1) {
						try {
							await task();
							lastError = undefined;
							break;
						} catch (error) {
							lastError = error;
							this.logger.warn(
								`WhatsApp persistence failed (${context}), attempt ${attempt}/3: ${
									error instanceof Error ? error.message : String(error)
								}`,
							);
							if (attempt < 3) {
								await new Promise((resolve) => setTimeout(resolve, attempt * 250));
							}
						}
					}
					if (lastError) {
						this.logger.error(
							`WhatsApp persistence dropped after retries (${context})`,
							lastError instanceof Error ? lastError.stack : String(lastError),
						);
					}
				} finally {
					this.activePersists -= 1;
				}
			})
			.catch((error) =>
				this.logger.error(
					`WhatsApp persistence queue failed (${context})`,
					error instanceof Error ? error.stack : String(error),
				),
			);
	}

	private enqueueInboxSync<T>(accountId: string, task: () => Promise<T>): Promise<T> {
		if (this.inboxSyncTail.has(accountId)) {
			this.logger.debug(
				`Inbox sync joined existing job for ${accountId} (skipped-because-locked)`,
			);
		}
		const previous = this.inboxSyncTail.get(accountId) || Promise.resolve();
		const next = previous.catch(() => undefined).then(task);
		this.inboxSyncTail.set(accountId, next);
		void next.finally(() => {
			if (this.inboxSyncTail.get(accountId) === next) {
				this.inboxSyncTail.delete(accountId);
			}
		});
		return next;
	}

	private enqueueHistoryPersist(task: () => Promise<unknown>, context = 'history') {
		this.historyPersistPending += 1;
		this.logger.debug(
			`History persist queued (${context}) depth=${this.historyPersistPending}`,
		);
		this.historyPersistQueue = this.historyPersistQueue
			.then(async () => {
				try {
					await task();
				} catch (error) {
					this.logger.warn(
						`WhatsApp history persist failed (${context}): ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				} finally {
					this.historyPersistPending = Math.max(0, this.historyPersistPending - 1);
				}
			})
			.catch((error) => {
				this.historyPersistPending = Math.max(0, this.historyPersistPending - 1);
				this.logger.error(
					`WhatsApp history persist queue failed (${context})`,
					error instanceof Error ? error.stack : String(error),
				);
			});
	}

	private scheduleHistoryInboxReconcile(
		accountId: string,
		totals: { chats: number; messages: number },
	) {
		const previous = this.historyInboxTotals.get(accountId) || { chats: 0, messages: 0 };
		this.historyInboxTotals.set(accountId, {
			chats: previous.chats + (Number(totals.chats) || 0),
			messages: previous.messages + (Number(totals.messages) || 0),
		});
		const existing = this.historyInboxDebounceTimers.get(accountId);
		if (existing) clearTimeout(existing);
		this.gateway.emitAccountEvent(accountId, 'sync_progress', {
			accountId,
			progress: 55,
			stage: 'hydrating',
			source: 'history_sync',
			background: true,
			chats: this.historyInboxTotals.get(accountId)?.chats || 0,
			messages: this.historyInboxTotals.get(accountId)?.messages || 0,
		});
		const timer = setTimeout(() => {
			this.historyInboxDebounceTimers.delete(accountId);
			const aggregated = this.historyInboxTotals.get(accountId);
			this.historyInboxTotals.delete(accountId);
			void this.finishHistoryInboxReconcile(accountId, aggregated);
		}, this.historyInboxDebounceMs);
		timer.unref?.();
		this.historyInboxDebounceTimers.set(accountId, timer);
	}

	private async finishHistoryInboxReconcile(
		accountId: string,
		totals?: { chats: number; messages: number },
	) {
		const provider = this.providers.getProvider(accountId);
		if (!provider || provider.getState() !== 'connected') return;
		try {
			const result = await this.syncChatsInternal(accountId, provider, 500, {
				syncGroupParticipants: false,
				emitProgress: false,
			});
			await this.markAccountHydrated(accountId, { history: true });
			this.logger.log(
				`History hydrate complete for ${accountId}: chats=${totals?.chats || result?.count || 0} messages=${totals?.messages || 0}`,
			);
			this.gateway.emitAccountEvent(accountId, 'sync_completed', {
				...result,
				progress: 100,
				source: 'history_sync',
				background: true,
				chats: totals?.chats || result?.count || 0,
				messages: totals?.messages || 0,
			});
		} catch (error) {
			this.logger.warn(
				`Post-history inbox sync failed for ${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	private async persistHistoryBatch(
		accountId: string,
		messages: NormalizedWhatsAppMessage[],
	) {
		const incoming = (Array.isArray(messages) ? messages : []).filter(
			(item) =>
				item?.providerMessageId &&
				isSupportedInboxChatId(item.chatId) &&
				hasChatVisibleContent(item),
		);
		if (!incoming.length) return { inserted: 0 };
		const started = Date.now();
		const account = await this.accountRepo.findOneByOrFail({ id: accountId });
		const byChat = new Map<string, NormalizedWhatsAppMessage[]>();
		for (const message of incoming) {
			const list = byChat.get(message.chatId) || [];
			list.push(message);
			byChat.set(message.chatId, list);
		}
		const conversationByChatId = new Map<string, WhatsAppConversation>();
		for (const chatId of byChat.keys()) {
			const sample = byChat.get(chatId)?.[0];
			const conversation = await this.ensureConversation(accountId, chatId, {
				title: sample?.fromMe ? null : sample?.contactName || null,
			});
			conversationByChatId.set(chatId, conversation);
		}

		const providerIds = incoming.map((item) => item.providerMessageId);
		const existingIds = new Set<string>();
		for (let index = 0; index < providerIds.length; index += 200) {
			const slice = providerIds.slice(index, index + 200);
			const rows = await this.messageRepo.find({
				where: { accountId, providerMessageId: In(slice) },
				select: ['providerMessageId'],
			});
			for (const row of rows) existingIds.add(row.providerMessageId);
		}

		const fresh = incoming.filter((item) => !existingIds.has(item.providerMessageId));
		if (!fresh.length) return { inserted: 0 };

		const now = new Date();
		const rows = fresh.map((item) => {
			const conversation = conversationByChatId.get(item.chatId);
			const timestamp =
				item.timestampReliable !== false && item.timestamp?.getTime?.() > 0
					? item.timestamp
					: conversation?.lastMessageAt || item.timestamp || now;
			return {
				id: randomUUID(),
				accountId,
				conversationId: conversation!.id,
				providerMessageId: item.providerMessageId,
				providerName: account.providerName,
				direction: item.fromMe
					? WhatsAppMessageDirection.OUTBOUND
					: WhatsAppMessageDirection.INBOUND,
				senderWaId: item.senderWaId || null,
				senderUserId: null,
				type: item.type || 'text',
				text: item.text || null,
				status: item.fromMe ? WhatsAppMessageStatus.SENT : WhatsAppMessageStatus.DELIVERED,
				statusUpdatedAt: now,
				quotedProviderMessageId: item.quotedProviderMessageId || null,
				isStarred: Boolean(item.isStarred),
				isForwarded: Boolean(item.isForwarded),
				providerTimestamp: timestamp,
				raw: safeProviderMetadata(item.raw),
				created_at: now,
				updated_at: now,
			};
		});

		try {
			await this.messageRepo
				.createQueryBuilder()
				.insert()
				.into(WhatsAppMessage)
				.values(rows as any)
				.orIgnore()
				.execute();
		} catch (error) {
			this.logger.warn(
				`Bulk history insert failed for ${accountId}, falling back per message: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			for (const item of fresh) {
				await this.persistMessage(accountId, item, null, false, {
					emitEvents: false,
				}).catch(() => null);
			}
			return { inserted: fresh.length };
		}

		const inserted = await this.messageRepo.find({
			where: {
				accountId,
				providerMessageId: In(fresh.map((item) => item.providerMessageId)),
			},
			select: ['id', 'providerMessageId'],
		});
		const idByProviderId = new Map(
			inserted.map((row) => [row.providerMessageId, row.id]),
		);
		const attachments = [];
		for (const item of fresh) {
			if (!item.attachments?.length) continue;
			const messageId = idByProviderId.get(item.providerMessageId);
			if (!messageId) continue;
			for (const attachment of item.attachments) {
				attachments.push({
					id: randomUUID(),
					messageId,
					type: attachment.type,
					mimeType: attachment.mimeType || null,
					fileName: attachment.fileName || null,
					fileSizeBytes: attachment.fileSizeBytes
						? String(attachment.fileSizeBytes)
						: null,
					providerMediaId: attachment.providerMediaId || item.providerMessageId,
					storagePath: null,
					downloadStatus: 'pending',
					created_at: now,
					updated_at: now,
				});
			}
		}
		if (attachments.length) {
			await this.attachmentRepo
				.createQueryBuilder()
				.insert()
				.into(WhatsAppMessageAttachment)
				.values(attachments as any)
				.orIgnore()
				.execute()
				.catch(() => undefined);
		}

		for (const [chatId, chatMessages] of byChat) {
			const conversation = conversationByChatId.get(chatId);
			if (!conversation) continue;
			let latest = conversation.lastMessageAt
				? new Date(conversation.lastMessageAt).getTime()
				: 0;
			for (const item of chatMessages) {
				if (item.timestampReliable === false) continue;
				const at = item.timestamp?.getTime?.() || 0;
				if (at > latest) latest = at;
			}
			if (latest && latest !== (conversation.lastMessageAt?.getTime?.() || 0)) {
				await this.conversationRepo.update(conversation.id, {
					lastMessageAt: new Date(latest),
				} as any);
			}
		}
		this.logger.log(
			`History persist account=${accountId} chats=${byChat.size} incoming=${incoming.length} inserted=${fresh.length} durationMs=${Date.now() - started} queueDepth=${this.historyPersistPending}`,
		);
		return { inserted: fresh.length };
	}

	private clearBootstrapUnlock(accountId: string) {
		const timer = this.bootstrapUnlockTimers.get(accountId);
		if (timer) clearTimeout(timer);
		this.bootstrapUnlockTimers.delete(accountId);
	}

	private abortBootstrap(
		accountId: string,
		reason: 'phone_closed' | 'connection_lost' | 'timeout' = 'connection_lost',
	) {
		if (!this.bootstrapping.has(accountId)) return;
		this.clearBootstrapUnlock(accountId);
		this.bootstrapping.delete(accountId);
		const message =
			reason === 'phone_closed'
				? 'Please open WhatsApp on your phone and keep it open — sync paused because the phone connection dropped.'
				: reason === 'timeout'
					? 'Inbox sync is taking longer than expected. Keep WhatsApp open on your phone, then tap Sync.'
					: 'WhatsApp connection dropped during sync. Open WhatsApp on your phone and try Sync again.';
		this.gateway.emitAccountEvent(accountId, 'sync_failed', {
			message,
			reason,
			progress: 0,
		});
	}

	private async markAccountHydrated(
		accountId: string,
		options: { history?: boolean } = {},
	) {
		const account = await this.accountRepo.findOne({
			where: { id: accountId },
			select: ['id', 'initialHydratedAt'],
		});
		if (!account) return;
		const now = new Date();
		const updates: Partial<WhatsAppAccount> = {};
		if (!account.initialHydratedAt) updates.initialHydratedAt = now;
		if (options.history !== false) updates.lastHistorySyncAt = now;
		if (!Object.keys(updates).length) return;
		await this.accountRepo.update(accountId, updates);
	}

	private async runIncrementalReconnect(accountId: string) {
		const provider = this.providers.getProvider(accountId);
		if (!provider || provider.getState() !== 'connected') return;
		try {
			await this.syncChatsInternal(accountId, provider, 500, {
				syncGroupParticipants: false,
				emitProgress: false,
			});
			await this.markAccountHydrated(accountId, { history: true });
		} catch (error) {
			this.logger.debug(
				`Incremental WhatsApp reconnect sync skipped for ${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	private scheduleBootstrap(accountId: string) {
		if (this.bootstrapping.has(accountId)) return;
		void this.startBootstrap(accountId);
	}

	private async startBootstrap(accountId: string) {
		if (this.bootstrapping.has(accountId)) return;
		const account = await this.accountRepo.findOne({
			where: { id: accountId },
			select: ['id', 'initialHydratedAt'],
		});
		const existingCount = account?.initialHydratedAt
			? 1
			: await this.conversationRepo.count({ where: { accountId } });
		if (account?.initialHydratedAt || existingCount > 0) {
			if (!account?.initialHydratedAt && existingCount > 0) {
				await this.markAccountHydrated(accountId, { history: true });
			}
			void this.runIncrementalReconnect(accountId);
			return;
		}

		this.bootstrapping.add(accountId);
		this.clearBootstrapUnlock(accountId);
		// Baileys history can take several minutes on first link; unlock soft.
		const unlockTimer = setTimeout(() => {
			void (async () => {
				if (!this.bootstrapping.has(accountId)) return;
				const count = await this.conversationRepo.count({ where: { accountId } });
				this.clearBootstrapUnlock(accountId);
				this.bootstrapping.delete(accountId);
				if (count > 0) {
					await this.markAccountHydrated(accountId, { history: true });
					this.gateway.emitAccountEvent(accountId, 'sync_completed', {
						progress: 100,
						count,
						softTimeout: true,
					});
					return;
				}
				this.gateway.emitAccountEvent(accountId, 'sync_failed', {
					message:
						'Please keep WhatsApp open on your phone until sync finishes, then tap Sync.',
					reason: 'timeout',
				});
			})();
		}, 300_000);
		this.bootstrapUnlockTimers.set(accountId, unlockTimer);
		unlockTimer.unref?.();

		const run = (attempt: number) => {
			if (!this.bootstrapping.has(accountId)) return;
			void this.waitForInboxReady(accountId, 120_000)
				.then(ready => {
					if (!this.bootstrapping.has(accountId)) return null;
					if (!ready) {
						throw new Error(
							'WhatsApp is not ready yet — keep WhatsApp open on your phone.',
						);
					}
					return this.bootstrapAccount(accountId);
				})
				.then(async (result) => {
					if (!result || !this.bootstrapping.has(accountId)) return;
					this.clearBootstrapUnlock(accountId);
					this.bootstrapping.delete(accountId);
					await this.markAccountHydrated(accountId, { history: true });
					this.gateway.emitAccountEvent(accountId, 'sync_completed', {
						...result,
						progress: 100,
					});
				})
				.catch((error) => {
					if (!this.bootstrapping.has(accountId)) return;
					const message = error instanceof Error ? error.message : String(error);
					const retryable =
						/not ready|not connected|listChats|syncing|keep WhatsApp open/i.test(
							message,
						) || message.includes('timed out');
					if (retryable && attempt < 4) {
						this.gateway.emitAccountEvent(accountId, 'sync_progress', {
							accountId,
							progress: 20,
							stage: 'retry',
							attempt,
						});
						setTimeout(() => run(attempt + 1), 4000 * attempt);
						return;
					}
					this.clearBootstrapUnlock(accountId);
					this.bootstrapping.delete(accountId);
					this.gateway.emitAccountEvent(accountId, 'sync_failed', {
						message,
						reason: 'failed',
					});
				});
		};
		setTimeout(() => run(1), 2000);
	}

	private async waitForInboxReady(accountId: string, timeoutMs = 90000) {
		const started = Date.now();
		while (Date.now() - started < timeoutMs) {
			const provider = this.providers.getProvider(accountId);
			if (!provider || provider.getState() !== 'connected') return false;
			try {
				// Light probe — never run the full getChats retry/getAllChats storm here.
				if (typeof provider.isHistoryReady === 'function') {
					if (await provider.isHistoryReady()) return true;
				} else {
					const chats = await provider.getChats(1);
					if (Array.isArray(chats)) return true;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!/not ready|not connected|listChats|null|cooling down/i.test(message)) {
					throw error;
				}
			}
			await new Promise(resolve => setTimeout(resolve, 2000));
		}
		return false;
	}

	async bootstrapAccount(accountId: string, limit = 500) {
		const provider = this.requireProvider(accountId);
		this.gateway.emitAccountEvent(accountId, 'sync_started', {
			accountId,
			progress: 10,
			stage: 'starting',
		});
		this.gateway.emitAccountEvent(accountId, 'sync_progress', {
			accountId,
			progress: 25,
			stage: 'chats',
		});
		// Inbox order repair only — skip heavy contact sync during bootstrap.
		const chats = provider.capabilities.history
			? await this.syncChatsInternal(accountId, provider, limit, {
					syncGroupParticipants: false,
				})
			: { supported: false, count: 0 };
		this.gateway.emitAccountEvent(accountId, 'sync_progress', {
			accountId,
			progress: 90,
			stage: 'chats_done',
			chats,
		});
		// Do NOT prefetch message history for top N chats here.
		// That stampeded getMessages while ChatStore was still empty, blocked the
		// open-chat path, and felt like "endless sync" — WhatsApp Web loads
		// history on demand when a chat is opened (plus live onMessage).
		return {
			contacts: { supported: false, skipped: true },
			chats,
			progress: 100,
		};
	}

	/**
	 * Optional deep warm — kept for manual/ops use. Not called from bootstrap.
	 * Prefer on-demand sync/latest when the user opens a conversation.
	 */
	private async prefetchTopChatHistories(
		accountId: string,
		chatLimit = 5,
		messageLimit = 30,
	) {
		const provider = this.requireProvider(accountId);
		if (!provider.capabilities?.history) return { warmed: 0 };
		if (typeof provider.isChatStoreHydrated === 'function') {
			const ready = await provider.isChatStoreHydrated().catch(() => false);
			if (!ready) {
				this.logger.warn(
					`prefetchTopChatHistories skipped for ${accountId}: ChatStore not hydrated`,
				);
				return { warmed: 0 };
			}
		}
		const unreadFirst = await this.conversationRepo
			.createQueryBuilder('conversation')
			.leftJoinAndSelect('conversation.contact', 'contact')
			.where('conversation.accountId = :accountId', { accountId })
			.andWhere('conversation.unreadCount > 0')
			.orderBy('conversation.lastMessageAt', 'DESC', 'NULLS LAST')
			.take(Math.min(chatLimit, 5))
			.getMany();
		const seen = new Set<string>();
		const queue = unreadFirst
			.filter(item => {
				if (seen.has(item.id)) return false;
				seen.add(item.id);
				return true;
			})
			.slice(0, chatLimit);

		let warmed = 0;
		for (const conversation of queue) {
			try {
				const localCount = await this.messageRepo.count({
					where: { conversationId: conversation.id },
				});
				if (localCount >= Math.min(20, messageLimit)) continue;
				const aliases = this.conversationMessageAliases(conversation);
				const messages = await provider.getMessages(conversation.providerChatId, {
					limit: messageLimit,
					aliases,
				});
				if (!messages?.length) continue;
				for (const message of messages) {
					await this.persistMessage(accountId, message, null, false, {
						emitEvents: false,
					}).catch(() => null);
				}
				warmed += 1;
				await new Promise(resolve => setTimeout(resolve, 500));
			} catch (error) {
				this.logger.debug(
					`prefetch history skipped for ${conversation.id}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}
		return { warmed };
	}

	private rememberConversation(
		accountId: string,
		chatId: string,
		conversation: WhatsAppConversation,
	) {
		if (!conversation) return conversation;
		const entry = { conversation, at: Date.now() };
		this.conversationHotCache.set(`${accountId}:${chatId}`, entry);
		if (conversation.providerChatId && conversation.providerChatId !== chatId) {
			this.conversationHotCache.set(
				`${accountId}:${conversation.providerChatId}`,
				entry,
			);
		}
		return conversation;
	}

	private forgetConversation(accountId: string, chatId?: string | null) {
		if (!chatId) return;
		this.conversationHotCache.delete(`${accountId}:${chatId}`);
	}

	private conversationRelations() {
		return ['contact', 'group', 'assignedUser'] as const;
	}

	private async hydrateConversation(id: string) {
		const conversation = await this.conversationRepo.findOneOrFail({
			where: { id },
			relations: [...this.conversationRelations()],
		});
		await this.rebindConversationPreferences(conversation);
		return conversation;
	}

	/** Resolve phone digits for a chat id (LID → PN via provider when needed). */
	private async resolveChatPhoneDigits(
		accountId: string,
		chatId: string,
		phoneHint?: string | null,
	): Promise<string | null> {
		const hint = String(phoneHint || '').replace(/\D/g, '');
		if (hint) return hint;
		const fromId = phoneFromWaId(chatId);
		if (fromId) return fromId;
		if (!chatId.endsWith('@lid') && !chatId.endsWith('@hosted.lid')) return null;
		const provider = this.providers.getProvider(accountId);
		if (!provider?.resolveContactIdentity) return null;
		const identity = await provider.resolveContactIdentity(chatId).catch(() => null);
		const digits = String(identity?.phoneNumber || '').replace(/\D/g, '');
		return digits || null;
	}

	private async findInboxConversation(accountId: string, chatId: string) {
		const existing = await this.conversationRepo.findOne({
			where: { accountId, providerChatId: chatId },
		});
		if (existing) return existing;
		return this.findDirectConversationAlias(accountId, chatId, null);
	}

	/**
	 * Find an existing DIRECT conversation for the same person under an alias
	 * (@lid ↔ @c.us / same phone), including the account owner's self-chat.
	 */
	private async findDirectConversationAlias(
		accountId: string,
		chatId: string,
		phoneHint?: string | null,
	): Promise<WhatsAppConversation | null> {
		if (!chatId || chatId.endsWith('@g.us') || chatId.endsWith('@newsletter')) return null;
		const digits = await this.resolveChatPhoneDigits(accountId, chatId, phoneHint);
		const aliasIds = new Set<string>([chatId, ...phoneAliasChatIds(digits || '')]);
		for (const id of [...aliasIds]) {
			if (id.endsWith('@c.us')) {
				aliasIds.add(id.replace(/@c\.us$/i, '@s.whatsapp.net'));
			}
		}

		const byProviderId = await this.conversationRepo.findOne({
			where: {
				accountId,
				providerChatId: In([...aliasIds]),
				type: WhatsAppConversationType.DIRECT,
			},
			relations: [...this.conversationRelations()],
		});
		if (byProviderId && byProviderId.providerChatId !== chatId) {
			return byProviderId;
		}
		if (byProviderId) return byProviderId;

		if (!digits) return null;

		const contacts = await this.contactRepo
			.createQueryBuilder('c')
			.where('c.account_id = :accountId', { accountId })
			.andWhere(
				`(c.wa_id IN (:...ids) OR regexp_replace(coalesce(c.phone_number, ''), '\\D', '', 'g') = :digits)`,
				{ ids: [...aliasIds], digits },
			)
			.getMany();

		for (const contact of contacts) {
			const conversation = await this.conversationRepo.findOne({
				where: {
					accountId,
					contactId: contact.id,
					type: WhatsAppConversationType.DIRECT,
				},
				relations: [...this.conversationRelations()],
			});
			if (conversation) return conversation;
		}

		// Self-chat: match account phone even when contact phone formatting differs.
		const account = await this.accountRepo.findOneBy({ id: accountId });
		const own = String(account?.phoneNumber || '').replace(/\D/g, '');
		if (own && phonesMatch(own, digits)) {
			const selfContacts = await this.contactRepo
				.createQueryBuilder('c')
				.where('c.account_id = :accountId', { accountId })
				.andWhere(
					`(c.wa_id IN (:...ids) OR regexp_replace(coalesce(c.phone_number, ''), '\\D', '', 'g') IN (:...ownVariants))`,
					{
						ids: phoneAliasChatIds(own),
						ownVariants: [own, own.startsWith('20') ? `0${own.slice(2)}` : `20${own.replace(/^0/, '')}`],
					},
				)
				.getMany();
			for (const contact of selfContacts) {
				const conversation = await this.conversationRepo.findOne({
					where: {
						accountId,
						contactId: contact.id,
						type: WhatsAppConversationType.DIRECT,
					},
					relations: [...this.conversationRelations()],
				});
				if (conversation) return conversation;
			}
		}

		return null;
	}

	private async applyConversationIdentityPatch(
		conversation: WhatsAppConversation,
		chatId: string,
		options: { title?: string | null; phone?: string | null },
	) {
		if (conversation.contact && options.title) {
			const weak = isWeakContactDisplayName(
				conversation.contact.name,
				conversation.providerChatId || chatId,
				conversation.contact.phoneNumber || options.phone,
			);
			if (weak && !isWeakContactDisplayName(options.title, chatId, options.phone)) {
				conversation.contact.name = options.title;
				await this.contactRepo.save(conversation.contact);
			}
		}
		if (conversation.group && options.title) {
			const weak = isWeakContactDisplayName(conversation.group.subject, chatId);
			if (weak && !isWeakContactDisplayName(options.title, chatId)) {
				conversation.group.subject = options.title;
				await this.groupRepo.save(conversation.group);
			}
		}
		if (conversation.contact && options.phone && !conversation.contact.phoneNumber) {
			conversation.contact.phoneNumber = options.phone;
			await this.contactRepo.save(conversation.contact);
		}
		return conversation;
	}

	/**
	 * Merge twin direct chats that share the same phone (e.g. @c.us + @lid self-chat).
	 * Keeps the chat with more recent activity / stronger identity.
	 */
	private async mergeDuplicateDirectConversations(accountId: string) {
		const directs = await this.conversationRepo.find({
			where: { accountId, type: WhatsAppConversationType.DIRECT },
			relations: ['contact'],
			order: { lastMessageAt: 'DESC' } as any,
		});
		const groups = new Map<string, WhatsAppConversation[]>();
		for (const conversation of directs) {
			const digits =
				String(conversation.contact?.phoneNumber || '').replace(/\D/g, '') ||
				phoneFromWaId(conversation.providerChatId) ||
				'';
			if (!digits) continue;
			// Normalize Egypt local/international into one bucket key.
			const key =
				digits.startsWith('20') && digits.length >= 11
					? digits
					: digits.startsWith('0') && digits.length >= 10
						? `20${digits.slice(1)}`
						: digits;
			const list = groups.get(key) || [];
			list.push(conversation);
			groups.set(key, list);
		}
		let merged = 0;
		for (const [, list] of groups) {
			if (list.length < 2) continue;
			const ranked = [...list].sort((a, b) => {
				const aPhone = a.providerChatId.endsWith('@c.us') ? 1 : 0;
				const bPhone = b.providerChatId.endsWith('@c.us') ? 1 : 0;
				if (aPhone !== bPhone) return bPhone - aPhone;
				const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
				const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
				return bTime - aTime;
			});
			const keeper = ranked[0];
			for (const duplicate of ranked.slice(1)) {
				await this.mergeConversationInto(keeper, duplicate);
				merged += 1;
			}
		}
		if (merged) {
			this.logger.log(`Merged ${merged} duplicate direct conversation(s) for ${accountId}`);
			this.gateway.emitAccountEvent(accountId, 'conversation_updated', {
				reason: 'duplicate_conversations_merged',
			});
		}
		return merged;
	}

	private async mergeConversationInto(
		keeper: WhatsAppConversation,
		duplicate: WhatsAppConversation,
	) {
		if (!keeper?.id || !duplicate?.id || keeper.id === duplicate.id) return;
		// Move messages (skip duplicates by providerMessageId).
		const dupMessages = await this.messageRepo.find({
			where: { conversationId: duplicate.id },
			select: ['id', 'providerMessageId'],
		});
		for (const message of dupMessages) {
			const clash = await this.messageRepo.findOne({
				where: {
					accountId: keeper.accountId,
					providerMessageId: message.providerMessageId,
				},
				select: ['id'],
			});
			if (clash) {
				await this.messageRepo.delete(message.id);
				continue;
			}
			await this.messageRepo.update(message.id, { conversationId: keeper.id });
		}
		// Prefer stronger contact identity on keeper.
		if (keeper.contact && duplicate.contact) {
			const patch: Partial<WhatsAppContact> = {};
			if (
				isWeakContactDisplayName(
					keeper.contact.name,
					keeper.providerChatId,
					keeper.contact.phoneNumber,
				) &&
				!isWeakContactDisplayName(
					duplicate.contact.name,
					duplicate.providerChatId,
					duplicate.contact.phoneNumber,
				)
			) {
				patch.name = duplicate.contact.name;
			}
			if (!keeper.contact.phoneNumber && duplicate.contact.phoneNumber) {
				patch.phoneNumber = duplicate.contact.phoneNumber;
			}
			if (!keeper.contact.avatarUrl && duplicate.contact.avatarUrl) {
				patch.avatarUrl = duplicate.contact.avatarUrl;
			}
			if (Object.keys(patch).length) {
				await this.contactRepo.update(keeper.contact.id, patch);
			}
		}
		const keeperLast = keeper.lastMessageAt ? new Date(keeper.lastMessageAt).getTime() : 0;
		const dupLast = duplicate.lastMessageAt ? new Date(duplicate.lastMessageAt).getTime() : 0;
		const updates: Partial<WhatsAppConversation> = {
			unreadCount:
				Math.max(0, Number(keeper.unreadCount) || 0) +
				Math.max(0, Number(duplicate.unreadCount) || 0),
		};
		if (dupLast > keeperLast) {
			updates.lastMessageAt = duplicate.lastMessageAt;
		}
		await this.conversationRepo.update(keeper.id, updates);
		await this.mergeConversationPreferences(keeper, duplicate);
		await this.conversationRepo.delete(duplicate.id);
		this.forgetConversation(keeper.accountId, duplicate.providerChatId);
		this.forgetConversation(keeper.accountId, keeper.providerChatId);
		if (duplicate.contactId && duplicate.contactId !== keeper.contactId) {
			const stillUsed = await this.conversationRepo.count({
				where: { contactId: duplicate.contactId },
			});
			if (!stillUsed) {
				await this.contactRepo.delete(duplicate.contactId).catch(() => undefined);
			}
		}
	}

	private async ensureConversation(
		accountId: string,
		chatId: string,
		options: { title?: string | null; phone?: string | null } = {},
	) {
		const cacheKey = `${accountId}:${chatId}`;
		const cached = this.conversationHotCache.get(cacheKey);
		if (cached && Date.now() - cached.at < 60_000) {
			if (!options.title && !options.phone) {
				return cached.conversation;
			}
			const patched = await this.applyConversationIdentityPatch(
				cached.conversation,
				chatId,
				options,
			);
			await this.rebindConversationPreferences(patched);
			return this.rememberConversation(accountId, chatId, patched);
		}
		const existing = await this.conversationRepo.findOne({
			where: { accountId, providerChatId: chatId },
			relations: [...this.conversationRelations()],
		});
		if (existing) {
			const patched = await this.applyConversationIdentityPatch(existing, chatId, options);
			await this.rebindConversationPreferences(patched);
			return this.rememberConversation(accountId, chatId, patched);
		}

		// Reuse twin row for same phone / LID↔PN / self-chat instead of creating a duplicate.
		const aliased = await this.findDirectConversationAlias(
			accountId,
			chatId,
			options.phone,
		);
		if (aliased) {
			const phone =
				options.phone ||
				(await this.resolveChatPhoneDigits(accountId, chatId, options.phone));
			const patched = await this.applyConversationIdentityPatch(aliased, chatId, {
				...options,
				phone: phone || options.phone,
			});
			await this.rebindConversationPreferences(patched);
			return this.rememberConversation(accountId, chatId, patched);
		}

		try {
			if (chatId.endsWith('@g.us')) {
				let group = await this.groupRepo.findOne({
					where: { accountId, waId: chatId },
				});
				if (!group) {
					try {
						group = await this.groupRepo.save(
							this.groupRepo.create({
								accountId,
								waId: chatId,
								subject: options.title || 'Group',
								description: null,
								ownerWaId: null,
								participantCount: 0,
								metadataSyncedAt: null,
							}),
						);
					} catch (error: any) {
						if (error?.code !== '23505') throw error;
						group = await this.groupRepo.findOneByOrFail({
							accountId,
							waId: chatId,
						});
					}
				}
				const conversation = await this.conversationRepo.save(
					this.conversationRepo.create({
						accountId,
						providerChatId: chatId,
						type: WhatsAppConversationType.GROUP,
						groupId: group.id,
						assignedUserId: null,
					}),
				);
				return this.rememberConversation(
					accountId,
					chatId,
					await this.hydrateConversation(conversation.id),
				);
			}

			const phone =
				options.phone ||
				(await this.resolveChatPhoneDigits(accountId, chatId, options.phone));
			let contact = await this.contactRepo.findOne({
				where: { accountId, waId: chatId },
			});
			if (!contact && phone) {
				contact = await this.contactRepo
					.createQueryBuilder('c')
					.where('c.account_id = :accountId', { accountId })
					.andWhere(
						`(c.wa_id IN (:...ids) OR regexp_replace(coalesce(c.phone_number, ''), '\\D', '', 'g') = :digits)`,
						{ ids: phoneAliasChatIds(phone), digits: phone },
					)
					.getOne();
			}
			if (!contact) {
				try {
					contact = await this.contactRepo.save(
						this.contactRepo.create({
							accountId,
							waId: chatId,
							phoneNumber: phone || phoneFromWaId(chatId),
							name: options.title || null,
							avatarUrl: null,
							isBusiness: false,
						}),
					);
				} catch (error: any) {
					if (error?.code !== '23505') throw error;
					contact = await this.contactRepo.findOneByOrFail({
						accountId,
						waId: chatId,
					});
				}
			} else if (phone && !contact.phoneNumber) {
				contact.phoneNumber = phone;
				await this.contactRepo.save(contact);
			}
			const conversation = await this.conversationRepo.save(
				this.conversationRepo.create({
					accountId,
					providerChatId: chatId,
					type: WhatsAppConversationType.DIRECT,
					contactId: contact.id,
					assignedUserId: null,
				}),
			);
			return this.rememberConversation(
				accountId,
				chatId,
				await this.hydrateConversation(conversation.id),
			);
		} catch (error: any) {
			if (error?.code === '23505') {
				const conversation = await this.conversationRepo.findOne({
					where: { accountId, providerChatId: chatId },
				});
				if (conversation) {
					return this.rememberConversation(
						accountId,
						chatId,
						await this.hydrateConversation(conversation.id),
					);
				}
				const aliasedRetry = await this.findDirectConversationAlias(
					accountId,
					chatId,
					options.phone,
				);
				if (aliasedRetry) {
					await this.rebindConversationPreferences(aliasedRetry);
					return this.rememberConversation(accountId, chatId, aliasedRetry);
				}
			}
			throw error;
		}
	}

	/** Open or create a direct chat by WhatsApp id (used for story replies). */
	async openConversationByChatId(
		user: User,
		accountId: string,
		chatId: string,
		options: { title?: string | null } = {},
	) {
		const accountAccess = await this.access.getAccountAccess(user, accountId);
		if (!accountAccess.canUse) {
			throw new ForbiddenException('WhatsApp send access denied');
		}
		const raw = String(chatId || '').trim();
		if (!raw) throw new BadRequestException('Chat id is required');
		const normalized =
			raw.includes('@')
				? raw
				: /^\d+$/.test(raw.replace(/\D/g, ''))
					? `${raw.replace(/\D/g, '')}@c.us`
					: raw;
		if (normalized.endsWith('@g.us') || normalized.includes('status@broadcast')) {
			throw new BadRequestException('Cannot open this chat id for messaging');
		}
		const conversation = await this.ensureConversation(accountId, normalized, {
			title: options.title || null,
			phone: phoneFromWaId(normalized),
		});
		const canSeeAll = this.access.canSeeAllConversations(user, accountAccess);
		if (
			!canSeeAll &&
			conversation.assignedUserId &&
			conversation.assignedUserId !== user.id
		) {
			throw new ForbiddenException('WhatsApp conversation access denied');
		}
		return conversation;
	}

	/** Phone opened or replied in this thread — drop the CRM unread badge. */
	private async clearUnreadFromPhone(accountId: string, conversationId: string) {
		if (!conversationId) return;
		const result = await this.conversationRepo
			.createQueryBuilder()
			.update(WhatsAppConversation)
			.set({ unreadCount: 0 })
			.where('id = :id', { id: conversationId })
			.andWhere('unread_count > 0')
			.execute();
		if (!Number(result.affected)) return;
		this.gateway.emitAccountEvent(accountId, 'conversation_read', {
			conversationId,
			reason: 'phone_read',
		});
	}

	async persistMessage(
		accountId: string,
		normalized: NormalizedWhatsAppMessage,
		senderUserId?: string | null,
		notifyAssignedUser = false,
		options: { emitEvents?: boolean; clientMessageId?: string } = {},
	) {
		const emitEvents = options.emitEvents !== false;
		const clientMessageId = String(
			options.clientMessageId || (normalized as any)?.clientMessageId || '',
		).trim();
		const fromHistory = Boolean(
			(normalized as any)?.__fromHistory || (normalized as any)?.raw?.__fromHistory,
		);
		if (!normalized.providerMessageId || !normalized.chatId) {
			throw new BadRequestException('Provider message does not have stable identifiers');
		}
		const account = await this.accountRepo.findOneByOrFail({ id: accountId });
		const phoneHint = await this.resolveChatPhoneDigits(
			accountId,
			normalized.chatId,
			null,
		);
		const ownDigits = String(account.phoneNumber || '').replace(/\D/g, '');
		const isSelfChat = Boolean(ownDigits && phoneHint && phonesMatch(ownDigits, phoneHint));
		const isChannel = String(normalized.chatId || '').endsWith('@newsletter');
		// fromMe pushName is usually YOUR WhatsApp name — never use it to rename the peer chat.
		let title = normalized.fromMe
			? isSelfChat
				? 'You'
				: null
			: isSelfChat
				? 'You'
				: normalized.contactName || null;
		if (
			isChannel &&
			isWeakContactDisplayName(title, normalized.chatId, phoneHint)
		) {
			const provider = this.providers.getProvider(accountId);
			const identity =
				typeof provider?.resolveContactIdentity === 'function'
					? await provider.resolveContactIdentity(normalized.chatId).catch(() => null)
					: null;
			if (identity?.name && !isWeakContactDisplayName(identity.name, normalized.chatId)) {
				title = identity.name;
			}
		}
		const conversation = await this.ensureConversation(accountId, normalized.chatId, {
			title,
			phone: phoneHint,
		});
		void this.rememberGroupSender(accountId, conversation, normalized).catch(() => undefined);
		const existing = await this.messageRepo.findOne({
			where: { accountId, providerMessageId: normalized.providerMessageId },
			relations: ['attachments', 'senderUser'],
		});
		if (!existing && !hasChatVisibleContent(normalized)) {
			this.logger.debug(
				`Skipping empty WhatsApp envelope ${normalized.providerMessageId} in ${conversation.id}`,
			);
			return this.messageRepo.create({
				accountId,
				conversationId: conversation.id,
				providerMessageId: normalized.providerMessageId,
				providerName: account.providerName,
				direction: normalized.fromMe
					? WhatsAppMessageDirection.OUTBOUND
					: WhatsAppMessageDirection.INBOUND,
				type: normalized.type || 'text',
				text: null,
				status: normalized.fromMe ? WhatsAppMessageStatus.SENT : WhatsAppMessageStatus.DELIVERED,
			});
		}
		if (existing) {
			// Upgrade stripped/partial Baileys media envelope when a richer live copy arrives.
			const nextRaw = persistableMessageRaw(normalized, (existing as any).raw);
			const existingScore = baileysRawMediaScore((existing as any).raw);
			const nextScore = baileysRawMediaScore(nextRaw);
			const shouldWriteLocation =
				Boolean(normalized.location || extractWhatsAppLocation(normalized)) &&
				needsLocationHydration(existing);
			if (nextRaw && (nextScore > existingScore || shouldWriteLocation)) {
				await this.messageRepo.update(existing.id, { raw: nextRaw } as any);
				(existing as any).raw = nextRaw;
				await this.attachmentRepo
					.createQueryBuilder()
					.update()
					.set({ downloadStatus: 'pending', storagePath: null })
					.where('message_id = :messageId', { messageId: existing.id })
					.andWhere(
						'(storage_path IS NULL OR download_status IN (:...statuses))',
						{ statuses: ['failed', 'pending'] },
					)
					.execute()
					.catch(() => undefined);
			}
			// Prefer CRM-declared media type (image/voice) over a generic document upsert.
			if (normalized.attachments?.length && existing.attachments?.length) {
				const next = normalized.attachments[0];
				const current = existing.attachments[0];
				const nextType = String(next?.type || '').toLowerCase();
				const currentType = String(current?.type || '').toLowerCase();
				const shouldUpgradeType =
					nextType &&
					nextType !== 'document' &&
					(currentType === 'document' || currentType !== nextType);
				const shouldUpgradeMime =
					next?.mimeType &&
					(!current?.mimeType ||
						String(current.mimeType).includes('octet-stream'));
				if (shouldUpgradeType || shouldUpgradeMime) {
					await this.attachmentRepo.update(current.id, {
						...(shouldUpgradeType ? { type: next.type } : {}),
						...(shouldUpgradeMime ? { mimeType: next.mimeType } : {}),
					} as any);
					if (shouldUpgradeType) current.type = next.type;
					if (shouldUpgradeMime) current.mimeType = next.mimeType || current.mimeType;
				}
			}
			if (emitEvents && !fromHistory && normalized.fromMe && !this.bootstrapping.has(accountId)) {
				await this.clearUnreadFromPhone(accountId, conversation.id);
			}
			if (clientMessageId) (existing as any).clientMessageId = clientMessageId;
			return existing;
		}

		let saved: WhatsAppMessage;
		try {
			saved = await this.messageRepo.save(
				this.messageRepo.create({
					accountId,
					conversationId: conversation.id,
					providerMessageId: normalized.providerMessageId,
					providerName: account.providerName,
					direction: normalized.fromMe
						? WhatsAppMessageDirection.OUTBOUND
						: WhatsAppMessageDirection.INBOUND,
					senderWaId: normalized.senderWaId || null,
					senderUserId: senderUserId || null,
					type: normalized.type || 'text',
					text: normalized.text || null,
					status: normalized.fromMe ? WhatsAppMessageStatus.SENT : WhatsAppMessageStatus.DELIVERED,
					statusUpdatedAt: new Date(),
					quotedProviderMessageId: normalized.quotedProviderMessageId || null,
					isStarred: Boolean(normalized.isStarred),
					isForwarded: Boolean(normalized.isForwarded),
					providerTimestamp:
						normalized.timestampReliable !== false && normalized.timestamp?.getTime?.() > 0
							? normalized.timestamp
							: conversation.lastMessageAt || normalized.timestamp,
					raw: persistableMessageRaw(normalized),
				}),
			);
		} catch (error: any) {
			if (error?.code === '23505') {
				const existing = await this.messageRepo.findOneOrFail({
					where: { accountId, providerMessageId: normalized.providerMessageId },
					relations: ['attachments', 'senderUser'],
				});
				const nextRaw = persistableMessageRaw(normalized, (existing as any).raw);
				const existingScore = baileysRawMediaScore((existing as any).raw);
				const nextScore = baileysRawMediaScore(nextRaw);
				const shouldWriteLocation =
					Boolean(normalized.location || extractWhatsAppLocation(normalized)) &&
					needsLocationHydration(existing);
				if (nextRaw && (nextScore > existingScore || shouldWriteLocation)) {
					await this.messageRepo.update(existing.id, { raw: nextRaw } as any);
					(existing as any).raw = nextRaw;
					await this.attachmentRepo
						.createQueryBuilder()
						.update()
						.set({ downloadStatus: 'pending', storagePath: null })
						.where('message_id = :messageId', { messageId: existing.id })
						.andWhere(
							'(storage_path IS NULL OR download_status IN (:...statuses))',
							{ statuses: ['failed', 'pending'] },
						)
						.execute()
						.catch(() => undefined);
				}
				const changes: Partial<WhatsAppMessage> = {};
				if (normalized.isStarred !== undefined) {
					changes.isStarred = Boolean(normalized.isStarred);
				}
				if (normalized.isForwarded) changes.isForwarded = true;
				if (Object.keys(changes).length) {
					await this.messageRepo.update(existing.id, changes);
					Object.assign(existing, changes);
				}
				if (emitEvents && !fromHistory && normalized.fromMe && !this.bootstrapping.has(accountId)) {
					await this.clearUnreadFromPhone(accountId, conversation.id);
				}
				return existing;
			}
			throw error;
		}

		if (normalized.attachments?.length) {
			await this.attachmentRepo.save(
				normalized.attachments.map((item) =>
					this.attachmentRepo.create({
						messageId: saved.id,
						type: item.type,
						mimeType: item.mimeType || null,
						fileName: item.fileName || null,
						fileSizeBytes: item.fileSizeBytes ? String(item.fileSizeBytes) : null,
						providerMediaId: item.providerMediaId || normalized.providerMessageId,
						storagePath: null,
						downloadStatus: 'pending',
					}),
				),
			);
		}
		// History hydration does not need unread reconciliation, realtime events,
		// or a second fully-hydrated read for every individual message.
		if (!emitEvents) {
			// Still advance inbox order from Baileys history dumps without WS spam.
			if (fromHistory && normalized.timestampReliable !== false) {
				const historyAt = whatsAppTimestampToDate(normalized.timestamp);
				const previous = conversation.lastMessageAt
					? new Date(conversation.lastMessageAt).getTime()
					: 0;
				if (historyAt && historyAt.getTime() >= previous) {
					await this.conversationRepo.update(conversation.id, {
						lastMessageAt: historyAt,
					} as any);
				}
			}
			return saved;
		}

		const nextLastMessageAt =
			normalized.timestampReliable === false || this.bootstrapping.has(accountId)
				? null
				: whatsAppTimestampToDate(normalized.timestamp);
		const previousLastMessageAt = conversation.lastMessageAt
			? new Date(conversation.lastMessageAt).getTime()
			: 0;
		const shouldBumpLastMessage =
			nextLastMessageAt != null && nextLastMessageAt.getTime() >= previousLastMessageAt;
		// Only live inbound messages raise unread. Outbound + history sync must not.
		const shouldCountUnread =
			emitEvents &&
			!fromHistory &&
			!normalized.fromMe &&
			!this.bootstrapping.has(accountId);
		if (shouldCountUnread) {
			await this.conversationRepo.increment({ id: conversation.id }, 'unreadCount', 1);
		} else if (
			emitEvents &&
			!fromHistory &&
			normalized.fromMe &&
			!this.bootstrapping.has(accountId)
		) {
			await this.clearUnreadFromPhone(accountId, conversation.id);
		}
		if (shouldBumpLastMessage) {
			await this.conversationRepo.update(conversation.id, {
				lastMessageAt: nextLastMessageAt,
			} as any);
		}
		const unreadRow = await this.conversationRepo.findOne({
			where: { id: conversation.id },
			select: ['id', 'unreadCount'],
		});
		const nextUnreadCount = unreadRow?.unreadCount ?? conversation.unreadCount;
		const hydrated = await this.messageRepo.findOneOrFail({
			where: { id: saved.id },
			relations: ['attachments', 'senderUser', 'reactions'],
		});
		if (hydrated.quotedProviderMessageId) {
			const quoted = await this.messageRepo.findOne({
				where: {
					conversationId: conversation.id,
					providerMessageId: hydrated.quotedProviderMessageId,
				},
			});
			if (quoted) {
				(hydrated as any).replyTo = this.buildReplyToPayload(quoted, (hydrated as any).raw);
			}
		}
		this.attachMessageLocations([hydrated]);
		if (emitEvents) {
			if (clientMessageId) (hydrated as any).clientMessageId = clientMessageId;
			await this.decorateGroupMessages(conversation, [hydrated]);
			this.gateway.emitConversationEvent(conversation.id, 'message', hydrated, accountId);
			this.scheduleConversationUpdated(accountId, {
				conversationId: conversation.id,
				assignedUserId: conversation.assignedUserId,
				lastMessageAt: hydrated.providerTimestamp,
				unreadCount: nextUnreadCount,
				preview: {
					id: hydrated.id,
					providerMessageId: hydrated.providerMessageId,
					text: hydrated.text,
					type: hydrated.type,
					direction: hydrated.direction,
					status: hydrated.status,
					providerTimestamp: hydrated.providerTimestamp,
					hasAttachments: Boolean(hydrated.attachments?.length),
					...(clientMessageId ? { clientMessageId } : {}),
				},
			});
		}
		if (
			emitEvents &&
			notifyAssignedUser &&
			!fromHistory &&
			!normalized.fromMe &&
			!this.bootstrapping.has(accountId)
		) {
			const recipientIds = await this.access.notificationRecipientIds(
				accountId,
				conversation.assignedUserId,
			);
			const title =
				conversation.group?.subject ||
				conversation.contact?.name ||
				normalized.contactName ||
				conversation.contact?.phoneNumber ||
				'New WhatsApp message';
			const message =
				normalized.text?.trim().slice(0, 240) ||
				(normalized.type === 'image'
					? 'Photo'
					: normalized.type === 'ptt' || normalized.type === 'audio' || normalized.type === 'voice'
						? 'Voice message'
						: `New ${normalized.type || 'message'}`);
			await Promise.all(
				recipientIds.map((userId) =>
					this.notifications.create({
						type: NotificationType.WHATSAPP_MESSAGE,
						title,
						message,
						data: {
							accountId,
							conversationId: conversation.id,
							messageId: hydrated.id,
							type: 'whatsapp_message',
						},
						audience: NotificationAudience.USER,
						userId,
					}),
				),
			);
		}
		return hydrated;
	}

	/** Coalesces bursts without postponing them: the pending timer is never reset,
	 *  so the inbox row always updates within one window of the first message
	 *  instead of drifting while a contact keeps typing. */
	private scheduleConversationUpdated(accountId: string, payload: Record<string, unknown>) {
		const timerKey = `${accountId}:${String(payload.conversationId || 'unknown')}`;
		this.conversationUpdatePayloads.set(timerKey, payload);
		if (this.conversationUpdateTimers.has(timerKey)) return;
		this.conversationUpdateTimers.set(
			timerKey,
			setTimeout(() => {
				this.conversationUpdateTimers.delete(timerKey);
				const latest = this.conversationUpdatePayloads.get(timerKey);
				this.conversationUpdatePayloads.delete(timerKey);
				if (latest) {
					this.gateway.emitAccountEvent(accountId, 'conversation_updated', latest);
				}
			}, 250),
		);
	}

	async syncContacts(user: User, accountId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canUse');
		const provider = this.requireProvider(accountId);
		return this.syncContactsInternal(accountId, provider);
	}

	private async syncContactsInternal(accountId: string, provider: WhatsAppProvider) {
		if (!provider.capabilities.contacts) return { supported: false, count: 0 };
		let contacts: any[] = [];
		try {
			contacts = (await provider.getContacts()) || [];
		} catch {
			return { supported: true, count: 0, failed: true };
		}
		let count = 0;
		for (const item of contacts) {
			const id = waId(item);
			if (!isSupportedInboxChatId(id) || id.endsWith('@g.us')) continue;
			await this.contactRepo.upsert(
				{
					accountId,
					waId: id,
					phoneNumber: item?.id?.user || phoneFromWaId(id),
					name: item?.name || item?.pushname || item?.formattedName || null,
					avatarUrl: item?.profilePicThumbObj?.eurl || null,
					isBusiness: Boolean(item?.isBusiness),
				},
				['accountId', 'waId'],
			);
			count += 1;
		}
		return { supported: true, count };
	}

	async syncChats(user: User, accountId: string, limit = 500) {
		await this.access.assertAccountPermission(user, accountId, 'canUse');
		const provider = this.requireProvider(accountId);
		this.gateway.emitAccountEvent(accountId, 'sync_started', {
			accountId,
			progress: 10,
			stage: 'manual',
		});
		try {
			const result = await this.syncChatsInternal(accountId, provider, limit, {
				syncGroupParticipants: false,
			});
			await this.markAccountHydrated(accountId, { history: true });
			this.gateway.emitAccountEvent(accountId, 'sync_completed', {
				...result,
				progress: 100,
				stage: 'manual',
			});
			return result;
		} catch (error) {
			this.gateway.emitAccountEvent(accountId, 'sync_failed', {
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	private async syncChatsInternal(
		accountId: string,
		provider: WhatsAppProvider,
		limit = 500,
		options: { syncGroupParticipants?: boolean; emitProgress?: boolean } = {},
	) {
		return this.enqueueInboxSync(accountId, () =>
			this.syncChatsUnlocked(accountId, provider, limit, options),
		);
	}

	private async syncChatsUnlocked(
		accountId: string,
		provider: WhatsAppProvider,
		limit = 500,
		options: { syncGroupParticipants?: boolean; emitProgress?: boolean } = {},
	) {
		if (!provider.capabilities.history) return { supported: false, count: 0 };
		const started = Date.now();
		const emitProgress = options.emitProgress !== false;
		if (emitProgress) {
			this.gateway.emitAccountEvent(accountId, 'sync_progress', {
				accountId,
				progress: 30,
				stage: 'fetching_chats',
			});
		}
		let chats: any[];
		let fetchPulse = 0;
		const fetchHeartbeat =
			emitProgress &&
			setInterval(() => {
				fetchPulse += 1;
				this.gateway.emitAccountEvent(accountId, 'sync_progress', {
					accountId,
					progress: Math.min(45, 30 + fetchPulse * 3),
					stage: 'fetching_chats',
				});
			}, 8000);
		try {
			chats = await provider.getChats(Math.min(limit, 1000));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const stillWarming =
				/not ready|cooling down|still syncing|empty after retries|timed out/i.test(message);
			throw new BadRequestException(
				stillWarming
					? 'WhatsApp chat store is not ready yet — keep the phone online; sync will retry automatically.'
					: message || 'Could not load chats from WhatsApp',
			);
		} finally {
			if (fetchHeartbeat) clearInterval(fetchHeartbeat);
		}
		if (emitProgress) {
			this.gateway.emitAccountEvent(accountId, 'sync_progress', {
				accountId,
				progress: 40,
				stage: 'saving_chats',
				fetched: Array.isArray(chats) ? chats.length : 0,
			});
		}
		const list = (Array.isArray(chats) ? chats : [])
			.map((chat) => {
				const id = waId(chat) || waId(chat?.id) || waId(chat?.chatId);
				const activityMs = providerChatActivityMs(chat);
				return { chat, id, activityMs };
			})
			.filter((item) => isSupportedInboxChatId(item.id))
			.sort((a, b) => b.activityMs - a.activityMs);
		let count = 0;
		let changed = false;
		let avatarFetches = 0;
		const total = list.length || 1;
		for (const { chat, id, activityMs } of list) {
			const isGroup = id.endsWith('@g.us');
			const isChannel = id.endsWith('@newsletter');
			const isLidChat = id.endsWith('@lid') || id.endsWith('@hosted.lid');
			const provisionalTitle =
				chat?.name ||
				chat?.contact?.name ||
				chat?.contact?.pushname ||
				chat?.contact?.formattedName ||
				chat?.formattedTitle ||
				chat?.formattedName ||
				null;
			const needsIdentity =
				!isGroup &&
				typeof provider.resolveContactIdentity === 'function' &&
				(isLidChat ||
					isChannel ||
					isWeakContactDisplayName(provisionalTitle, id, phoneFromWaId(id)));
			const identity = needsIdentity
				? await provider.resolveContactIdentity(id).catch(() => null)
				: null;
			const rawTitle =
				identity?.name ||
				provisionalTitle ||
				null;
			const title = isWeakContactDisplayName(rawTitle, id, identity?.phoneNumber || phoneFromWaId(id))
				? null
				: rawTitle;
			const phone =
				identity?.phoneNumber || phoneFromWaId(id) || phoneFromWaId(waId(chat?.contact)) || null;
			const conversation = await this.ensureConversation(accountId, id, {
				title,
				phone,
			});
			let avatarUrl =
				chat?.imgUrl ||
				chat?.contact?.profilePicThumbObj?.eurl ||
				chat?.profilePicThumbObj?.eurl ||
				null;
			const existingAvatar = conversation.contact?.avatarUrl || conversation.group?.avatarUrl;
			if (
				!avatarUrl &&
				!existingAvatar &&
				typeof provider.getProfilePictureUrl === 'function' &&
				(id.endsWith('@newsletter') || avatarFetches < 20)
			) {
				avatarUrl = await provider.getProfilePictureUrl(id).catch(() => null);
				if (!id.endsWith('@newsletter')) avatarFetches += 1;
			}
			avatarUrl = avatarUrl || existingAvatar || null;
			if (conversation.contact) {
				const existingWeak = isWeakContactDisplayName(
					conversation.contact.name,
					id,
					conversation.contact.phoneNumber,
				);
				const nextName =
					title || (existingWeak ? null : conversation.contact.name);
				const nextPhone = phone || conversation.contact.phoneNumber;
				const nextAvatarUrl = avatarUrl || conversation.contact.avatarUrl;
				if (
					nextName !== conversation.contact.name ||
					nextPhone !== conversation.contact.phoneNumber ||
					nextAvatarUrl !== conversation.contact.avatarUrl
				) {
					await this.contactRepo.update(conversation.contact.id, {
						name: nextName || null,
						phoneNumber: nextPhone || null,
						avatarUrl: nextAvatarUrl || null,
					});
					changed = true;
				}
			}
			if (conversation.group && title) {
				const existingWeak = isWeakContactDisplayName(conversation.group.subject, id);
				if (existingWeak || conversation.group.subject !== title) {
					if (existingWeak || !conversation.group.subject) {
						await this.groupRepo.update(conversation.group.id, { subject: title });
						changed = true;
					}
				}
			}
			if (conversation.group && avatarUrl && avatarUrl !== conversation.group.avatarUrl) {
				await this.groupRepo.update(conversation.group.id, { avatarUrl });
				changed = true;
			}
			const messageActivityMs = providerChatMessageActivityMs(chat);
			// Only promote inbox order from real message activity. Metadata-only
			// ChatModel.t (common on groups before MsgCollection hydrates) used to
			// park silent groups at the top of the CRM inbox.
			const trustedActivityMs = messageActivityMs ?? (conversation.lastMessageAt ? null : activityMs);
			const lastMessageAt = trustedActivityMs ? new Date(trustedActivityMs) : null;
			const unreadCount = providerUnreadCount(chat);
			const updates: Partial<WhatsAppConversation> = {};
			if (
				lastMessageAt &&
				lastMessageAt.getTime() !==
					(conversation.lastMessageAt ? new Date(conversation.lastMessageAt).getTime() : 0)
			) {
				updates.lastMessageAt = lastMessageAt;
			}
			if (
				shouldCopyProviderUnread(
					conversation.unreadCount,
					conversation.lastMessageAt,
					unreadCount,
				)
			) {
				updates.unreadCount = unreadCount as number;
			}
			if (Object.keys(updates).length) {
				await this.conversationRepo.update(conversation.id, updates);
				changed = true;
			}
			if (
				options.syncGroupParticipants &&
				id.endsWith('@g.us') &&
				provider.capabilities.groupParticipants
			) {
				await this.syncGroupMetadata(provider, accountId, id);
			}
			count += 1;
			if (emitProgress && (count % 3 === 0 || count === list.length)) {
				this.gateway.emitAccountEvent(accountId, 'sync_progress', {
					accountId,
					progress: 40 + Math.round((count / total) * 45),
					stage: 'chats',
					synced: count,
					total: list.length,
				});
			}
		}
		if (changed) {
			this.gateway.emitAccountEvent(accountId, 'conversation_updated', {
				reason: 'provider_inbox_reconciled',
			});
		}
		const merged = await this.mergeDuplicateDirectConversations(accountId).catch((error) => {
			this.logger.warn(
				`Duplicate conversation merge failed for ${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return 0;
		});
		this.lastInboxSyncAt.set(accountId, Date.now());
		this.logger.log(
			`Inbox sync finished for ${accountId}: chats=${count} changed=${changed || Boolean(merged)} durationMs=${Date.now() - started}`,
		);
		return { supported: true, count, changed: changed || Boolean(merged) };
	}

	private async syncGroupMetadata(
		provider: WhatsAppProvider,
		accountId: string,
		groupWaId: string,
	) {
		const group = await this.groupRepo.findOne({
			where: { accountId, waId: groupWaId },
		});
		if (!group) return;
		const participants = await provider.getGroupParticipants(groupWaId);
		await this.participantRepo.manager.transaction(async (manager) => {
			await manager.delete(WhatsAppGroupParticipant, { groupId: group.id });
			if (participants?.length) {
				await manager.save(
					WhatsAppGroupParticipant,
					participants.map((item: any) =>
						manager.create(WhatsAppGroupParticipant, {
							groupId: group.id,
							waId: waId(item),
							displayName: item?.name || item?.pushname || null,
							isAdmin: Boolean(item?.isAdmin || item?.isSuperAdmin),
							isSuperAdmin: Boolean(item?.isSuperAdmin),
						}),
					),
				);
			}
			await manager.update(WhatsAppGroup, group.id, {
				participantCount: participants?.length || 0,
				metadataSyncedAt: new Date(),
			});
		});
	}

	async listConversations(
		user: User,
		accountId: string,
		page = 1,
		limit = 50,
		search = '',
		filter = 'all',
		assignedUserId = '',
		kind = '',
	) {
		const accountAccess = await this.access.getAccountAccess(user, accountId);
		if (!accountAccess.canView) throw new ForbiddenException('WhatsApp account access denied');
		const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
		const canSeeAll = this.access.canSeeAllConversations(user, accountAccess);
		const pageNumber = Math.max(Number(page) || 1, 1);
		// Always serve inbox rows from DB — even while the live session is offline —
		// so the CRM stays usable after Chromium/session drops. Live sync remains
		// gated separately behind a connected provider.
		const query = this.conversationRepo
			.createQueryBuilder('conversation')
			.leftJoinAndSelect('conversation.contact', 'contact')
			.leftJoinAndSelect('conversation.group', 'group')
			.leftJoinAndSelect('conversation.assignedUser', 'assignedUser')
			.leftJoin(
				WhatsAppConversationPreference,
				'conversationPreference',
				`
				"conversationPreference"."user_id" = :preferenceUserId
				AND "conversationPreference"."deleted_at" IS NULL
				AND (
					"conversationPreference"."conversation_id" = "conversation"."id"
					OR (
						"conversationPreference"."account_id" = "conversation"."account_id"
						AND "conversationPreference"."provider_chat_id" = "conversation"."provider_chat_id"
					)
				)
				`,
				{ preferenceUserId: user.id },
			)
			.where('conversation.accountId = :accountId', { accountId })
			.andWhere('LOWER(conversation.providerChatId) NOT LIKE :broadcast', {
				broadcast: '%@broadcast%',
			})
			.andWhere('LOWER(conversation.providerChatId) NOT LIKE :status', {
				status: '%status@%',
			});
		const inboxKind = String(kind || '').trim().toLowerCase();
		if (inboxKind === 'channel') {
			query.andWhere('LOWER(conversation.providerChatId) LIKE :newsletter', {
				newsletter: '%@newsletter',
			});
		} else if (inboxKind === 'chat') {
			query.andWhere('LOWER(conversation.providerChatId) NOT LIKE :newsletter', {
				newsletter: '%@newsletter',
			});
		}
		if (!canSeeAll) {
			query.andWhere('conversation.assignedUserId = :userId', {
				userId: user.id,
			});
		}
		if (filter === 'unread') {
			query.andWhere('conversation.unreadCount > 0');
		}
		if (filter === 'favorites') {
			query.andWhere('conversationPreference.isFavorite = :isFavorite', {
				isFavorite: true,
			});
		}
		if (filter === 'important' || filter === 'starred') {
			query.andWhere((qb) => {
				const subQuery = qb
					.subQuery()
					.select('1')
					.from(WhatsAppMessage, 'starredMessage')
					.where('starredMessage.conversationId = conversation.id')
					.andWhere('starredMessage.isStarred = true')
					.getQuery();
				return `EXISTS ${subQuery}`;
			});
		}
		if (filter === 'archived') {
			query.andWhere('conversationPreference.isArchived = :isArchived', {
				isArchived: true,
			});
		} else {
			query.andWhere(
				'(conversationPreference.isArchived IS NULL OR conversationPreference.isArchived = false)',
			);
		}
		if (assignedUserId === 'unassigned') {
			query.andWhere('conversation.assignedUserId IS NULL');
		} else if (/^[0-9a-f-]{36}$/i.test(assignedUserId)) {
			query.andWhere('conversation.assignedUserId = :assignedUserId', {
				assignedUserId,
			});
		}
		const normalizedSearch = String(search || '').trim();
		if (normalizedSearch) {
			query.andWhere(
				`(
					contact.name ILIKE :search
					OR contact.phoneNumber ILIKE :search
					OR group.subject ILIKE :search
					OR conversation.providerChatId ILIKE :search
				)`,
				{ search: `%${normalizedSearch}%` },
			);
		}
		const [items, total] = await query
			.addSelect('conversationPreference.isPinned')
			.orderBy('conversationPreference.isPinned', 'DESC', 'NULLS LAST')
			.addOrderBy('conversation.lastMessageAt', 'DESC', 'NULLS LAST')
			.addOrderBy('conversation.created_at', 'DESC')
			.take(take)
			.skip((pageNumber - 1) * take)
			.getManyAndCount();
		const conversationIds = items.map((item) => item.id);
		const chatIds = items.map((item) => item.providerChatId).filter(Boolean);
		const preferences = items.length
			? await this.preferenceRepo.find({
					where: [
						{
							userId: user.id,
							conversationId: In(conversationIds),
						},
						...(chatIds.length
							? [
									{
										userId: user.id,
										accountId,
										providerChatId: In(chatIds),
									},
								]
							: []),
					],
				})
			: [];
		const preferenceByConversationId = new Map(
			preferences
				.filter((item) => item.conversationId)
				.map((item) => [item.conversationId as string, item]),
		);
		const preferenceByChatId = new Map(
			preferences
				.filter((item) => item.accountId && item.providerChatId)
				.map((item) => [`${item.accountId}:${item.providerChatId}`, item]),
		);
		const lastMessages = items.length
			? await this.messageRepo
					.createQueryBuilder('message')
					.distinctOn(['message.conversationId'])
					.where('message.conversationId IN (:...conversationIds)', {
						conversationIds: items.map((item) => item.id),
					})
					.andWhere(
						`(
							NULLIF(BTRIM(message.text), '') IS NOT NULL
							OR LOWER(message.type) IN (:...previewMediaTypes)
						)`,
						{
							previewMediaTypes: [
								'image',
								'photo',
								'video',
								'audio',
								'ptt',
								'voice',
								'document',
								'sticker',
								'location',
								'live_location',
								'contact',
								'contacts',
								'poll',
							],
						},
					)
					.orderBy('message.conversationId', 'ASC')
					.addOrderBy('message.providerTimestamp', 'DESC')
					.addOrderBy('message.created_at', 'DESC')
					.getMany()
			: [];
		const lastMessageByConversationId = new Map(
			lastMessages.map((message) => [message.conversationId, message]),
		);
		return {
			items: items.map((item) => {
				const preference =
					preferenceByConversationId.get(item.id) ||
					preferenceByChatId.get(`${item.accountId}:${item.providerChatId}`);
				return {
					...item,
					isFavorite: Boolean(preference?.isFavorite),
					isPinned: Boolean(preference?.isPinned),
					isArchived: Boolean(preference?.isArchived),
					lastMessage: (() => {
						const message = lastMessageByConversationId.get(item.id);
						return message
							? {
									id: message.id,
									providerMessageId: message.providerMessageId,
									text: message.text,
									type: message.type,
									direction: message.direction,
									status: message.status,
									providerTimestamp: message.providerTimestamp,
								}
							: null;
					})(),
				};
			}),
			total,
			page: pageNumber,
			limit: take,
			scope: canSeeAll ? 'all' : 'assigned',
			archivedCount: await this.countArchivedConversations(user.id, accountId, inboxKind),
		};
	}

	async setConversationFavorite(user: User, conversationId: string, isFavorite: boolean) {
		await this.assertConversationVisible(user, conversationId);
		await this.saveConversationPreference(user.id, conversationId, {
			isFavorite: Boolean(isFavorite),
		});
		return { ok: true, conversationId, isFavorite: Boolean(isFavorite) };
	}

	async setConversationPinned(user: User, conversationId: string, isPinned: boolean) {
		await this.assertConversationVisible(user, conversationId);
		await this.saveConversationPreference(user.id, conversationId, {
			isPinned: Boolean(isPinned),
		});
		return { ok: true, conversationId, isPinned: Boolean(isPinned) };
	}

	async setConversationArchived(user: User, conversationId: string, isArchived: boolean) {
		await this.assertConversationVisible(user, conversationId);
		await this.saveConversationPreference(user.id, conversationId, {
			isArchived: Boolean(isArchived),
			...(isArchived ? { isPinned: false } : {}),
		});
		return { ok: true, conversationId, isArchived: Boolean(isArchived) };
	}

	private async countArchivedConversations(
		userId: string,
		accountId: string,
		inboxKind: string,
	) {
		const query = this.preferenceRepo
			.createQueryBuilder('pref')
			.innerJoin(
				WhatsAppConversation,
				'conversation',
				`
				conversation.account_id = :accountId
				AND conversation.deleted_at IS NULL
				AND (
					pref.conversation_id = conversation.id
					OR (
						pref.account_id = conversation.account_id
						AND pref.provider_chat_id = conversation.provider_chat_id
					)
				)
				`,
				{ accountId },
			)
			.where('pref.user_id = :userId', { userId })
			.andWhere('pref.deleted_at IS NULL')
			.andWhere('pref.is_archived = true')
			.andWhere('LOWER(conversation.provider_chat_id) NOT LIKE :broadcast', {
				broadcast: '%@broadcast%',
			})
			.andWhere('LOWER(conversation.provider_chat_id) NOT LIKE :status', {
				status: '%status@%',
			});
		if (inboxKind === 'channel') {
			query.andWhere('LOWER(conversation.provider_chat_id) LIKE :newsletter', {
				newsletter: '%@newsletter',
			});
		} else if (inboxKind === 'chat') {
			query.andWhere('LOWER(conversation.provider_chat_id) NOT LIKE :newsletter', {
				newsletter: '%@newsletter',
			});
		}
		const row = await query
			.select('COUNT(DISTINCT conversation.id)', 'count')
			.getRawOne();
		return Number(row?.count || 0);
	}

	private async saveConversationPreference(
		userId: string,
		conversationId: string,
		patch: { isPinned?: boolean; isFavorite?: boolean; isArchived?: boolean },
	) {
		const conversation = await this.conversationRepo.findOneByOrFail({ id: conversationId });
		const row = (await this.findConversationPreference(userId, conversation)) ||
			this.preferenceRepo.create({
				userId,
				isPinned: false,
				isFavorite: false,
				isArchived: false,
			});
		row.deleted_at = null;
		row.userId = userId;
		row.conversationId = conversation.id;
		row.accountId = conversation.accountId;
		row.providerChatId = conversation.providerChatId;
		if (patch.isPinned != null) row.isPinned = patch.isPinned;
		if (patch.isFavorite != null) row.isFavorite = patch.isFavorite;
		if (patch.isArchived != null) row.isArchived = patch.isArchived;
		await this.preferenceRepo.save(row);
	}

	private async findConversationPreference(
		userId: string,
		conversation: WhatsAppConversation,
	) {
		const byConversation = await this.preferenceRepo.findOne({
			where: { userId, conversationId: conversation.id },
			withDeleted: true,
		});
		if (byConversation) return byConversation;
		if (!conversation.accountId || !conversation.providerChatId) return null;
		return this.preferenceRepo.findOne({
			where: {
				userId,
				accountId: conversation.accountId,
				providerChatId: conversation.providerChatId,
			},
			withDeleted: true,
		});
	}

	private async rebindConversationPreferences(conversation: WhatsAppConversation) {
		if (!conversation?.id || !conversation.accountId || !conversation.providerChatId) return;
		await this.preferenceRepo
			.createQueryBuilder()
			.update()
			.set({ conversationId: conversation.id })
			.where('account_id = :accountId', { accountId: conversation.accountId })
			.andWhere('provider_chat_id = :providerChatId', {
				providerChatId: conversation.providerChatId,
			})
			.andWhere('(conversation_id IS NULL OR conversation_id != :conversationId)', {
				conversationId: conversation.id,
			})
			.execute()
			.catch(() => undefined);
	}

	private async mergeConversationPreferences(
		keeper: WhatsAppConversation,
		duplicate: WhatsAppConversation,
	) {
		const rows = await this.preferenceRepo.find({
			where: { conversationId: duplicate.id },
			withDeleted: true,
		});
		for (const row of rows) {
			const existing = await this.findConversationPreference(row.userId, keeper);
			if (existing && existing.id !== row.id) {
				existing.deleted_at = null;
				existing.conversationId = keeper.id;
				existing.accountId = keeper.accountId;
				existing.providerChatId = keeper.providerChatId;
				existing.isPinned = Boolean(existing.isPinned || row.isPinned);
				existing.isFavorite = Boolean(existing.isFavorite || row.isFavorite);
				existing.isArchived = Boolean(existing.isArchived || row.isArchived);
				await this.preferenceRepo.save(existing);
				await this.preferenceRepo.delete(row.id);
				continue;
			}
			row.deleted_at = null;
			row.conversationId = keeper.id;
			row.accountId = keeper.accountId;
			row.providerChatId = keeper.providerChatId;
			await this.preferenceRepo.save(row);
		}
	}

	async assertConversationVisible(user: User, conversationId: string) {
		return this.access.assertConversationVisible(user, conversationId);
	}

	private async subscribeConversationPresence(conversation: WhatsAppConversation) {
		const provider = this.providers.getProvider(conversation.accountId);
		if (!provider?.subscribePresence || !conversation.providerChatId) return;
		await provider.subscribePresence(conversation.providerChatId);
	}

	private async hydrateConversationAvatar(conversation: WhatsAppConversation) {
		const existing = conversation.contact?.avatarUrl || conversation.group?.avatarUrl;
		if (existing) return;
		const provider = this.providers.getProvider(conversation.accountId);
		if (!provider || provider.getState() !== 'connected') return;
		if (typeof provider.getProfilePictureUrl !== 'function') return;
		const url = await provider.getProfilePictureUrl(conversation.providerChatId).catch(() => null);
		if (!url) return;
		if (conversation.contact) {
			await this.contactRepo.update(conversation.contact.id, { avatarUrl: url });
			conversation.contact.avatarUrl = url;
		} else if (conversation.group) {
			await this.groupRepo.update(conversation.group.id, { avatarUrl: url });
			conversation.group.avatarUrl = url;
		}
		this.gateway.emitAccountEvent(conversation.accountId, 'conversation_updated', {
			reason: 'avatar_hydrated',
			conversationId: conversation.id,
		});
	}

	async listMessages(
		user: User,
		conversationId: string,
		before?: string,
		limit = 30,
		options: { allowLivePull?: boolean; starredOnly?: boolean } = {},
	) {
		const starredOnly = Boolean(options.starredOnly);
		const allowLivePull = options.allowLivePull !== false && !starredOnly;
		const { conversation, accountAccess } = await this.assertConversationVisible(
			user,
			conversationId,
		);
		void this.subscribeConversationPresence(conversation).catch(() => undefined);
		void this.hydrateConversationAvatar(conversation).catch(() => undefined);
		const take = Math.min(Math.max(Number(limit) || 100, 1), 200);
		const loadLocal = async (cursorId?: string) => {
			const query = this.messageRepo
				.createQueryBuilder('message')
				.leftJoinAndSelect('message.attachments', 'attachments')
				.leftJoinAndSelect('message.reactions', 'reactions')
				.leftJoinAndSelect('message.senderUser', 'senderUser')
				.where('message.conversationId = :conversationId', { conversationId });
			if (starredOnly) {
				query.andWhere('message.isStarred = true');
			}
			if (cursorId) {
				const cursor = await this.messageRepo.findOne({
					where: { id: cursorId, conversationId },
				});
				if (!cursor) return [];
				if (cursor?.providerTimestamp) {
					query.andWhere(
						'(message.providerTimestamp < :timestamp OR (message.providerTimestamp = :timestamp AND message.id < :cursorId))',
						{
							timestamp: cursor.providerTimestamp,
							cursorId: cursor.id,
						},
					);
				}
			}
			const rows = await query
				.orderBy('message.providerTimestamp', 'DESC')
				.addOrderBy('message.id', 'DESC')
				.take(take)
				.getMany();
			for (const message of rows) {
				const duration = Number(message.raw?.duration ?? message.raw?.mediaData?.duration ?? 0);
				if (!(Number.isFinite(duration) && duration > 0)) continue;
				for (const attachment of message.attachments || []) {
					const type = String(attachment.type || '').toLowerCase();
					if (type !== 'audio' && type !== 'ptt' && type !== 'voice') continue;
					if (/voice-\d/i.test(String(attachment.fileName || ''))) continue;
					const ext = String(attachment.mimeType || '').includes('webm')
						? '.webm'
						: String(attachment.mimeType || '').includes('mpeg')
							? '.mp3'
							: '.ogg';
					attachment.fileName = `voice-${Math.round(duration)}s${ext}`;
				}
			}
			const quotedProviderIds = [
				...new Set(rows.map((item) => item.quotedProviderMessageId).filter(Boolean)),
			] as string[];
			if (quotedProviderIds.length) {
				const quotedMessages = await this.messageRepo.find({
					where: {
						conversationId,
						providerMessageId: In(quotedProviderIds),
					},
				});
				const quotedByProviderId = new Map(
					quotedMessages.map((message) => [message.providerMessageId, message]),
				);
				for (const message of rows) {
					const quoted = message.quotedProviderMessageId
						? quotedByProviderId.get(message.quotedProviderMessageId)
						: null;
					if (!quoted) continue;
					(message as any).replyTo = this.buildReplyToPayload(quoted, (message as any).raw);
				}
			}
			return rows.reverse();
		};

		const local = await loadLocal(before);
		if (
			allowLivePull &&
			local.length &&
			!before &&
			accountAccess.canUse &&
			local.some(
				(message) =>
					(message.attachments || []).some(
						(attachment) =>
							attachment.downloadStatus !== 'downloaded' || !attachment.storagePath,
					) || needsLocationHydration(message),
			)
		) {
			const live = await this.pullLiveMessagesFromLinkedDevice(conversation, take).catch(
				() => [],
			);
			if (live.length) {
				for (const item of live) {
					await this.persistMessage(
						conversation.accountId,
						{ ...item, chatId: conversation.providerChatId },
						null,
						false,
						{ emitEvents: false },
					).catch(() => undefined);
				}
				const refreshed = await loadLocal(before);
				await this.prepareMessagesForApi(conversation, refreshed);
				this.queuePendingAttachmentDownloads(refreshed);
				return refreshed;
			}
		}
		// Pagination cursor stays DB-only. First page with empty DB must come from
		// the linked WhatsApp Web session on the phone.
		if (local.length || before || !accountAccess.canUse || !allowLivePull) {
			await this.prepareMessagesForApi(conversation, local);
			if (local.length && !before && accountAccess.canUse) {
				this.queuePendingAttachmentDownloads(local);
			}
			return local;
		}

		const live = await this.pullLiveMessagesFromLinkedDevice(conversation, take);
		if (!live.length) {
			await this.prepareMessagesForApi(conversation, local);
			return local;
		}

		for (const item of live) {
			await this.persistMessage(
				conversation.accountId,
				{ ...item, chatId: conversation.providerChatId },
				null,
				false,
				{ emitEvents: false },
			).catch((error) => {
				this.logger.warn(
					`Could not persist live message ${item.providerMessageId} for ${conversationId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			});
		}
		await this.conversationRepo.update(conversation.id, {
			lastProviderSyncAt: new Date(),
		});
		const saved = await loadLocal();
		if (saved.length) {
			await this.prepareMessagesForApi(conversation, saved);
			this.queuePendingAttachmentDownloads(saved);
			return saved;
		}
		// Persist may fail (unique/db) — still return linked-device messages to the UI.
		const mapped = this.mapLiveMessagesForApi(conversation.id, live);
		await this.prepareMessagesForApi(conversation, mapped as any);
		return mapped;
	}

	private async hydrateLocationsFromProvider(
		conversation: WhatsAppConversation,
		messages: WhatsAppMessage[],
		options: { fetchLive?: boolean } = {},
	) {
		const missing = (messages || []).filter((message) => needsLocationHydration(message));
		if (!missing.length) return;
		const provider = this.providers.getProvider(conversation.accountId);
		if (!provider) return;
		const conversationChatId = String(conversation.providerChatId || '').trim();
		for (const message of missing) {
			try {
				let live =
					typeof provider.findMessage === 'function'
						? provider.findMessage(message.providerMessageId)
						: null;
				let location = live?.location || extractWhatsAppLocation(live);
				if (!location && options.fetchLive && typeof provider.fetchMessage === 'function') {
					const chatId =
						String((message as any)?.raw?.key?.remoteJid || '').trim() ||
						conversationChatId;
					if (chatId && message.providerMessageId) {
						live = await provider.fetchMessage(chatId, message.providerMessageId);
						location = live?.location || extractWhatsAppLocation(live);
					}
				}
				if (!location) continue;
				const nextRaw = mergeLocationIntoRaw((message as any).raw, location);
				await this.messageRepo.update(message.id, { raw: nextRaw } as any).catch(() => undefined);
				(message as any).raw = nextRaw;
				(message as any).location = location;
			} catch (error) {
				this.logger.warn(
					`Could not hydrate WhatsApp location ${message.providerMessageId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}
	}

	private attachMessageLocations(messages: WhatsAppMessage[]) {
		for (const message of messages || []) {
			const location = extractWhatsAppLocation({
				type: message.type,
				location: (message as any).location,
				raw: (message as any).raw,
			});
			if (location) (message as any).location = location;
		}
	}

	private attachMediaPreviews(messages: WhatsAppMessage[]) {
		for (const message of messages || []) {
			const preview = mediaPreviewDataUrlFromRaw((message as any)?.raw);
			if (!preview) continue;
			for (const attachment of message.attachments || []) {
				const type = String(attachment.type || '').toLowerCase();
				if (!['image', 'sticker', 'video'].includes(type)) continue;
				(attachment as any).previewDataUrl = preview;
			}
		}
	}

	private buildReplyToPayload(quoted: WhatsAppMessage, parentRaw?: any) {
		return {
			id: quoted.id,
			providerMessageId: quoted.providerMessageId,
			text: quoted.text,
			type: quoted.type,
			direction: quoted.direction,
			previewDataUrl:
				mediaPreviewDataUrlFromRaw((quoted as any)?.raw) ||
				quotedPreviewFromRaw(parentRaw) ||
				null,
		};
	}

	private attachReplyPreviews(messages: WhatsAppMessage[]) {
		for (const message of messages || []) {
			const raw = (message as any)?.raw;
			const replyTo = (message as any).replyTo;
			if (replyTo) {
				if (!replyTo.previewDataUrl) {
					replyTo.previewDataUrl = quotedPreviewFromRaw(raw) || null;
				}
				continue;
			}
			const preview = quotedPreviewFromRaw(raw);
			const type = quotedTypeFromRaw(raw);
			const text = quotedTextFromRaw(raw);
			if (!preview && !type && !text) continue;
			(message as any).replyTo = {
				id: null,
				providerMessageId: message.quotedProviderMessageId || null,
				text,
				type: type || 'text',
				direction: null,
				previewDataUrl: preview,
			};
		}
	}

	private async rememberGroupSender(
		accountId: string,
		conversation: WhatsAppConversation,
		normalized: NormalizedWhatsAppMessage,
	) {
		if (conversation.type !== WhatsAppConversationType.GROUP) return;
		const senderWaId = String(normalized.senderWaId || '').trim();
		if (!senderWaId || normalized.fromMe) return;
		if (senderWaId.endsWith('@g.us') || senderWaId.endsWith('@newsletter')) return;
		const name = String(normalized.contactName || '').trim();
		const strongName = isWeakContactDisplayName(name, senderWaId) ? null : name;
		let contact = await this.contactRepo.findOne({
			where: { accountId, waId: senderWaId },
		});
		if (!contact) {
			try {
				contact = await this.contactRepo.save(
					this.contactRepo.create({
						accountId,
						waId: senderWaId,
						phoneNumber: phoneFromWaId(senderWaId),
						name: strongName,
						avatarUrl: null,
						isBusiness: false,
					}),
				);
			} catch (error: any) {
				if (error?.code !== '23505') throw error;
				contact = await this.contactRepo.findOne({
					where: { accountId, waId: senderWaId },
				});
			}
		} else if (
			strongName &&
			isWeakContactDisplayName(contact.name, contact.waId, contact.phoneNumber)
		) {
			await this.contactRepo.update(contact.id, { name: strongName });
			contact.name = strongName;
		}
		if (conversation.groupId) {
			try {
				await this.participantRepo.upsert(
					{
						groupId: conversation.groupId,
						waId: senderWaId,
						displayName: strongName || contact?.name || null,
						isAdmin: false,
						isSuperAdmin: false,
					},
					['groupId', 'waId'],
				);
			} catch {
				// Participant rows are optional identity cache, not required for chat.
			}
		}
	}

	private async decorateGroupMessages(
		conversation: WhatsAppConversation,
		messages: WhatsAppMessage[],
	) {
		this.attachReplyPreviews(messages);
		if (conversation.type !== WhatsAppConversationType.GROUP || !messages?.length) return;
		const senderIds = [
			...new Set(
				messages.map((item) => String(item.senderWaId || '').trim()).filter(Boolean),
			),
		];
		const names = new Map<string, string>();
		const avatars = new Map<string, string>();
		if (senderIds.length) {
			const contacts = await this.contactRepo.find({
				where: { accountId: conversation.accountId, waId: In(senderIds) },
			});
			for (const contact of contacts) {
				if (
					contact.name &&
					!isWeakContactDisplayName(contact.name, contact.waId, contact.phoneNumber)
				) {
					names.set(contact.waId, contact.name);
				}
				if (contact.avatarUrl) avatars.set(contact.waId, contact.avatarUrl);
			}
			if (conversation.groupId) {
				const participants = await this.participantRepo.find({
					where: { groupId: conversation.groupId, waId: In(senderIds) },
				});
				for (const participant of participants) {
					if (
						participant.displayName &&
						!names.has(participant.waId) &&
						!isWeakContactDisplayName(participant.displayName, participant.waId)
					) {
						names.set(participant.waId, participant.displayName);
					}
				}
			}
		}
		for (const message of messages) {
			const senderWaId = String(message.senderWaId || '').trim();
			const pushName = String((message as any)?.raw?.pushName || '').trim();
			if (
				senderWaId &&
				pushName &&
				!names.has(senderWaId) &&
				!isWeakContactDisplayName(pushName, senderWaId)
			) {
				names.set(senderWaId, pushName);
			}
		}
		for (const message of messages) {
			const senderWaId = String(message.senderWaId || '').trim();
			(message as any).senderName = (senderWaId && names.get(senderWaId)) || null;
			(message as any).senderAvatarUrl = (senderWaId && avatars.get(senderWaId)) || null;
		}
	}

	private collectMentionIds(message: WhatsAppMessage): string[] {
		const ids = new Set<string>();
		const text = String(message?.text || '');
		const mentionPattern = /@(\d{8,32})\b/g;
		let match: RegExpExecArray | null;
		while ((match = mentionPattern.exec(text)) !== null) {
			ids.add(match[1]);
		}
		const raw = (message as any)?.raw;
		const mentionedJid =
			raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
			raw?.message?.imageMessage?.contextInfo?.mentionedJid ||
			raw?.message?.videoMessage?.contextInfo?.mentionedJid ||
			raw?.extendedTextMessage?.contextInfo?.mentionedJid ||
			raw?.contextInfo?.mentionedJid ||
			[];
		if (Array.isArray(mentionedJid)) {
			for (const jid of mentionedJid) {
				const id = String(jid || '')
					.split('@')[0]
					.replace(/\D/g, '');
				if (id) ids.add(id);
			}
		}
		return [...ids];
	}

	private mentionLabelForIdentity(
		name: string | null | undefined,
		waId: string | null | undefined,
		phone: string | null | undefined,
	): string | null {
		if (name && !isWeakContactDisplayName(name, waId, phone)) return String(name).trim();
		const phoneDigits = String(phone || '').replace(/\D/g, '');
		const idDigits = String(waId || '')
			.split('@')[0]
			.replace(/\D/g, '');
		if (
			phoneDigits &&
			phoneDigits !== idDigits &&
			phoneDigits.length >= 8 &&
			phoneDigits.length <= 15
		) {
			return `+${phoneDigits}`;
		}
		return null;
	}

	private async decorateMessageMentions(
		conversation: WhatsAppConversation,
		messages: WhatsAppMessage[],
	) {
		const mentionIds = [
			...new Set(messages.flatMap((message) => this.collectMentionIds(message))),
		];
		if (!mentionIds.length) return;
		const labels = new Map<string, string>();
		const remember = (
			waId: string | null | undefined,
			name?: string | null,
			phone?: string | null,
		) => {
			const digits = String(waId || '')
				.split('@')[0]
				.replace(/\D/g, '');
			if (!digits) return;
			const label = this.mentionLabelForIdentity(name, waId, phone);
			if (!label) return;
			const existing = labels.get(digits);
			if (existing && !/^\+?\d[\d\s-]*$/.test(existing)) return;
			labels.set(digits, label);
		};
		const waIds = mentionIds.flatMap((id) => [
			id,
			`${id}@lid`,
			`${id}@hosted.lid`,
			`${id}@c.us`,
			`${id}@s.whatsapp.net`,
		]);
		const contacts = await this.contactRepo.find({
			where: { accountId: conversation.accountId, waId: In(waIds) },
		});
		for (const contact of contacts) {
			remember(contact.waId, contact.name, contact.phoneNumber);
		}
		if (conversation.groupId) {
			const participants = await this.participantRepo.find({
				where: { groupId: conversation.groupId },
			});
			for (const participant of participants) {
				remember(participant.waId, participant.displayName, null);
			}
		}
		for (const message of messages) {
			remember(
				message.senderWaId,
				(message as any).senderName || (message as any)?.raw?.pushName,
				null,
			);
			const map: Record<string, string> = {};
			for (const id of this.collectMentionIds(message)) {
				const label = labels.get(id);
				if (label) map[id] = label;
			}
			if (Object.keys(map).length) (message as any).mentionLabels = map;
		}
	}

	private async prepareMessagesForApi(
		conversation: WhatsAppConversation,
		messages: WhatsAppMessage[],
	) {
		this.attachMediaPreviews(messages);
		await this.hydrateLocationsFromProvider(conversation, messages);
		this.attachMessageLocations(messages);
		await this.decorateGroupMessages(conversation, messages);
		await this.decorateMessageMentions(conversation, messages);
		return messages;
	}

	/** Kick off durable downloads for pending/failed media once the chat is open
	 *  and WhatsApp is connected — same moment the old WPP ChatStore path used to
	 *  hydrate photos after link. */
	private queuePendingAttachmentDownloads(messages: WhatsAppMessage[]) {
		const ids: string[] = [];
		for (const message of messages || []) {
			if (baileysRawMediaScore((message as any)?.raw) < 5) continue;
			for (const attachment of message.attachments || []) {
				if (attachment.downloadStatus === 'downloaded' && attachment.storagePath) continue;
				if (!attachment.id) continue;
				ids.push(attachment.id);
			}
		}
		if (!ids.length) return;
		void (async () => {
			for (const attachmentId of ids.slice(0, 16)) {
				if (this.attachmentDownloads.has(attachmentId)) continue;
				const attachment = await this.attachmentRepo.findOne({
					where: { id: attachmentId },
					relations: ['message'],
				});
				if (!attachment?.message) continue;
				const download = this.downloadAttachmentInternal(attachment)
					.catch(() => undefined)
					.finally(() => {
						this.attachmentDownloads.delete(attachmentId);
					});
				this.attachmentDownloads.set(attachmentId, download);
				await download;
			}
		})();
	}

	private conversationMessageAliases(conversation: WhatsAppConversation) {
		const aliases: string[] = [];
		const providerChatId = String(conversation.providerChatId || '');
		const lidUser = providerChatId.includes('@')
			? providerChatId.split('@')[0]
			: '';
		const phoneDigits = String(conversation.contact?.phoneNumber || '').replace(/\D/g, '');
		// Never treat the LID numeric id as a phone — that produced bogus
		// 15-digit @c.us lookups (Chat not found) and drowned real history sync.
		if (phoneDigits && phoneDigits !== lidUser && phoneDigits.length <= 15) {
			aliases.push(`${phoneDigits}@c.us`, `${phoneDigits}@s.whatsapp.net`);
		}
		return aliases;
	}

	private async pullLiveMessagesFromLinkedDevice(
		conversation: WhatsAppConversation,
		limit: number,
	) {
		const provider = this.providers.getProvider(conversation.accountId);
		if (!provider || provider.getState() !== 'connected') return [];
		if (typeof provider.resetChatStoreCooldown === 'function') {
			const cooldown = provider.getChatStoreCooldownMs?.() || 0;
			if (cooldown > 0) provider.resetChatStoreCooldown();
		}
		const aliases = this.conversationMessageAliases(conversation);
		const providerChatId = String(conversation.providerChatId || '');
		if (
			(providerChatId.endsWith('@lid') || providerChatId.endsWith('@hosted.lid')) &&
			typeof provider.resolveContactIdentity === 'function'
		) {
			const identity = await provider.resolveContactIdentity(providerChatId).catch(() => null);
			const resolvedPhone = String(identity?.phoneNumber || '').replace(/\D/g, '');
			if (resolvedPhone) {
				aliases.push(`${resolvedPhone}@c.us`, `${resolvedPhone}@s.whatsapp.net`);
			}
		}
		try {
			const messages = await provider.getMessages(conversation.providerChatId, {
				limit,
				aliases: [...new Set(aliases)],
			});
			this.logger.log(
				`Linked-device pull for ${conversation.id} returned ${messages.length} message(s)`,
			);
			return messages;
		} catch (error) {
			this.logger.warn(
				`Linked-device pull failed for ${conversation.id}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return [];
		}
	}

	private mapLiveMessagesForApi(
		conversationId: string,
		messages: NormalizedWhatsAppMessage[],
	) {
		return messages
			.filter((item) => hasChatVisibleContent(item))
			.map((item) => ({
			id: `live:${item.providerMessageId}`,
			conversationId,
			providerMessageId: item.providerMessageId,
			direction: item.fromMe
				? WhatsAppMessageDirection.OUTBOUND
				: WhatsAppMessageDirection.INBOUND,
			type: item.type || 'text',
			text: item.text || null,
			status: item.fromMe ? WhatsAppMessageStatus.SENT : WhatsAppMessageStatus.DELIVERED,
			providerTimestamp: item.timestamp,
			quotedProviderMessageId: item.quotedProviderMessageId || null,
			senderWaId: item.senderWaId || null,
			senderName: item.contactName || null,
			isStarred: Boolean(item.isStarred),
			isForwarded: Boolean(item.isForwarded),
			attachments: (item.attachments || [])
				.filter(attachment => attachment?.type)
				.map((attachment, index) => ({
					// No fake DB ids — MediaAttachment treats live-* as unavailable.
					id: null,
					type: attachment.type,
					mimeType: attachment.mimeType || null,
					fileName: attachment.fileName || null,
					fileSizeBytes: attachment.fileSizeBytes || null,
					providerMediaId: attachment.providerMediaId || item.providerMessageId,
					key: `live-att:${item.providerMessageId}:${index}`,
				})),
			reactions: [],
			location: item.location || extractWhatsAppLocation(item),
			raw: item.raw || null,
			source: 'linked_device',
		}));
	}

	async reactToMessage(user: User, conversationId: string, messageId: string, emoji?: string) {
		const { conversation, accountAccess } = await this.assertConversationVisible(
			user,
			conversationId,
		);
		if (!accountAccess.canUse) {
			throw new ForbiddenException('WhatsApp reaction access denied');
		}
		const message = await this.messageRepo.findOne({
			where: { id: messageId, conversationId },
		});
		if (!message) throw new NotFoundException('WhatsApp message not found');
		const provider = this.requireProvider(conversation.accountId);
		if (!provider.capabilities.reactions) {
			throw new BadRequestException('Message reactions are not supported');
		}
		const normalizedEmoji = String(emoji || '').trim();
		if (normalizedEmoji.length > 16) {
			throw new BadRequestException('Invalid reaction');
		}
		await provider.sendReaction(message.providerMessageId, normalizedEmoji || false);
		let reactions = await provider.getReactions(message.providerMessageId).catch(() => []);
		if (normalizedEmoji && !reactions.some((reaction) => reaction.actorKey === 'me')) {
			reactions = [
				...reactions.filter((reaction) => reaction.actorKey !== 'me'),
				{ actorKey: 'me', emoji: normalizedEmoji, timestamp: new Date() },
			];
		}
		if (!normalizedEmoji) {
			reactions = reactions.filter((reaction) => reaction.actorKey !== 'me');
		}
		const saved = await this.persistMessageReactions(
			conversation.accountId,
			message.providerMessageId,
			reactions,
		);
		return { messageId: message.id, reactions: saved };
	}

	private async resolveMessageAction(
		user: User,
		conversationId: string,
		messageId: string,
		requireUse = true,
	) {
		const { conversation, accountAccess } = await this.assertConversationVisible(
			user,
			conversationId,
		);
		if (requireUse && !accountAccess.canUse) {
			throw new ForbiddenException('WhatsApp message action access denied');
		}
		const message = await this.messageRepo.findOne({
			where: { id: messageId, conversationId },
			relations: ['attachments', 'reactions'],
		});
		if (!message) throw new NotFoundException('WhatsApp message not found');
		const provider = this.requireProvider(conversation.accountId);
		if (!provider.capabilities.messageActions) {
			throw new BadRequestException('Message actions are not supported');
		}
		return { conversation, message, provider };
	}

	async forwardMessage(
		user: User,
		conversationId: string,
		messageId: string,
		targetConversationId: string,
	) {
		const source = await this.resolveMessageAction(user, conversationId, messageId);
		const target = await this.assertConversationVisible(user, targetConversationId);
		if (!target.accountAccess.canUse) {
			throw new ForbiddenException('WhatsApp forwarding access denied');
		}
		if (source.conversation.accountId !== target.conversation.accountId) {
			throw new BadRequestException(
				'Messages can only be forwarded within the same WhatsApp account',
			);
		}
		await source.provider.forwardMessage(
			target.conversation.providerChatId,
			source.message.providerMessageId,
			{ rawHint: source.message.raw },
		);
		return { ok: true, messageId, targetConversationId };
	}

	async starMessage(user: User, conversationId: string, messageId: string, isStarred: boolean) {
		const { message, provider } = await this.resolveMessageAction(user, conversationId, messageId);
		try {
			await provider.starMessage?.(message.providerMessageId, isStarred);
		} catch (error) {
			this.logger.warn(
				`Provider starMessage failed for ${messageId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
		await this.messageRepo.update(message.id, { isStarred });
		const result = { messageId, changes: { isStarred } };
		this.gateway.emitConversationEvent(
			conversationId,
			'message_updated',
			result,
			message.accountId,
		);
		return result;
	}

	async pinMessage(user: User, conversationId: string, messageId: string, isPinned: boolean) {
		const { message, provider } = await this.resolveMessageAction(user, conversationId, messageId);
		await provider.pinMessage(message.providerMessageId, isPinned);
		const pinnedUntil = isPinned ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null;
		await this.messageRepo.update(message.id, { isPinned, pinnedUntil });
		const result = { messageId, changes: { isPinned, pinnedUntil } };
		this.gateway.emitConversationEvent(
			conversationId,
			'message_updated',
			result,
			message.accountId,
		);
		return result;
	}

	async deleteMessage(
		user: User,
		conversationId: string,
		messageId: string,
		mode: 'local' | 'everyone',
	) {
		const { conversation, message, provider } = await this.resolveMessageAction(
			user,
			conversationId,
			messageId,
		);
		if (mode === 'everyone' && message.direction !== WhatsAppMessageDirection.OUTBOUND) {
			throw new BadRequestException('Only sent messages can be deleted for everyone');
		}
		await provider.deleteMessage(conversation.providerChatId, message.providerMessageId, mode);
		const providerDeletedAt = new Date();
		await this.messageRepo.update(message.id, {
			deletedMode: mode,
			providerDeletedAt,
			text: null,
		});
		const result = {
			messageId,
			changes: { deletedMode: mode, providerDeletedAt, text: null },
		};
		this.gateway.emitConversationEvent(
			conversationId,
			'message_updated',
			result,
			conversation.accountId,
		);
		return result;
	}

	async getMessageLocation(user: User, conversationId: string, messageId: string) {
		const { conversation } = await this.assertConversationVisible(user, conversationId);
		const message = await this.messageRepo.findOne({
			where: { id: messageId, conversationId },
		});
		if (!message) throw new NotFoundException('WhatsApp message not found');
		await this.hydrateLocationsFromProvider(conversation, [message], { fetchLive: true });
		this.attachMessageLocations([message]);
		const location = (message as any).location || extractWhatsAppLocation(message);
		if (!location) {
			const provider = this.providers.getProvider(conversation.accountId);
			const connected = String(provider?.getState?.() || '').toLowerCase() === 'connected';
			if (!connected) {
				throw new BadRequestException(
					'WhatsApp is not connected. Link the account, then open this location again.',
				);
			}
			throw new NotFoundException('Location coordinates are not available for this message');
		}
		return { location };
	}

	async getMessageInfo(user: User, conversationId: string, messageId: string) {
		const { message, provider } = await this.resolveMessageAction(
			user,
			conversationId,
			messageId,
			false,
		);
		const providerInfo = await provider.getMessageInfo(message.providerMessageId).catch(() => null);
		return {
			id: message.id,
			providerMessageId: message.providerMessageId,
			direction: message.direction,
			type: message.type,
			status: message.status,
			statusUpdatedAt: message.statusUpdatedAt,
			sentAt: message.providerTimestamp,
			isStarred: message.isStarred,
			isPinned: message.isPinned,
			pinnedUntil: message.pinnedUntil,
			deletedMode: message.deletedMode,
			provider: providerInfo,
		};
	}

	async syncConversation(
		user: User,
		conversationId: string,
		mode: 'latest' | 'older',
		limit = 30,
		options: { force?: boolean } = {},
	) {
		const force = Boolean(options.force);
		const { conversation, accountAccess } = await this.assertConversationVisible(
			user,
			conversationId,
		);
		if (!accountAccess.canUse) throw new ForbiddenException('WhatsApp send/sync access denied');
		const provider = this.requireProvider(conversation.accountId);
		if (!provider.capabilities.history) {
			return { supported: false, items: [], hasMore: false, syncReason: 'unsupported' };
		}
		const [oldestBeforeSync, newestLocal, localCount] = await Promise.all([
			this.messageRepo.findOne({
				where: { conversationId },
				order: { providerTimestamp: 'ASC' },
			}),
			this.messageRepo.findOne({
				where: { conversationId },
				order: { providerTimestamp: 'DESC' },
			}),
			this.messageRepo.count({ where: { conversationId } }),
		]);
		const requestedLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
		const returnLocalOnly = async (
			syncError: string,
			message?: string,
			extra: Record<string, unknown> = {},
		) => ({
			supported: true,
			// Never live-pull again here — we just tried the provider.
			items: await this.listMessages(
				user,
				conversationId,
				mode === 'older' ? oldestBeforeSync?.id : undefined,
				requestedLimit,
				{ allowLivePull: false },
			),
			hasMore: Boolean(conversation.hasMoreProviderHistory),
			syncSkipped: true,
			syncError,
			syncReason: syncError,
			cooldownMs: provider.getChatStoreCooldownMs?.() || 0,
			lastProviderSyncAt: conversation.lastProviderSyncAt,
			message,
			...extra,
		});
		const freshSkip = shouldSkipFreshProviderSync({
			mode,
			force,
			localCount,
			lastProviderSyncAt: conversation.lastProviderSyncAt,
		});
		if (freshSkip.skip) {
			return returnLocalOnly('fresh', undefined, {
				syncReason: 'fresh',
			});
		}
		const cooldownMs = provider.getChatStoreCooldownMs?.() || 0;
		if (cooldownMs > 0) {
			// Empty chats must still attempt history once — otherwise GET /messages
			// stays [] forever while inbox metadata looks healthy.
			if (localCount === 0 && typeof provider.resetChatStoreCooldown === 'function') {
				provider.resetChatStoreCooldown();
			} else {
				return returnLocalOnly('provider_unavailable');
			}
		}
		// Do not hard-block on isHistoryReady when the inbox already lists chats.
		// A soft probe used to skip getMessages entirely and leave every
		// conversation at 0 local messages (GET /messages → []).
		const aliases: string[] = [...this.conversationMessageAliases(conversation)];
		const providerChatId = String(conversation.providerChatId || '');
		if (providerChatId.endsWith('@lid') || providerChatId.endsWith('@hosted.lid')) {
			const lidUser = providerChatId.split('@')[0] || '';
			const identity =
				typeof provider.resolveContactIdentity === 'function'
					? await provider.resolveContactIdentity(providerChatId).catch(() => null)
					: null;
			const resolvedPhone = String(identity?.phoneNumber || '').replace(/\D/g, '');
			if (resolvedPhone && resolvedPhone !== lidUser && resolvedPhone.length <= 15) {
				aliases.push(`${resolvedPhone}@c.us`, `${resolvedPhone}@s.whatsapp.net`);
			}
		}
		// Soft catch-up: only ask the provider for messages newer than our newest
		// local row. Full latest page remains available via force=1 (gap repair).
		const afterCursor =
			mode === 'latest' && !force && localCount > 0
				? String(newestLocal?.providerMessageId || '').trim() || undefined
				: undefined;
		let messages: Awaited<ReturnType<WhatsAppProvider['getMessages']>>;
		try {
			messages = await provider.getMessages(conversation.providerChatId, {
				limit: requestedLimit,
				before: mode === 'older' ? conversation.oldestProviderCursor || undefined : undefined,
				after: afterCursor,
				aliases: [...new Set(aliases)],
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// Only log real attempts; cooldown short-circuits above stay quiet.
			if (!/cooling down/i.test(message)) {
				this.logger.warn(
					`syncConversation(${mode}) getMessages failed for ${conversationId}: ${message}`,
				);
			}
			// Opening a chat must still return DB history. A dead/half-ready WA Web
			// page must not surface as an unhandled Nest 500 flood.
			const sessionDead =
				/session died|detached Frame|Target closed|browser page closed|not connected|Execution context was destroyed/i.test(
					message,
				);
			const chatMissing = /chat not found/i.test(message);
			const mainNotReady = /main UI still syncing|main not ready|not ready|cooling down/i.test(
				message,
			);
			return returnLocalOnly(
				sessionDead
					? 'session_dead'
					: chatMissing
						? 'chat_not_found'
						: mainNotReady
							? 'main_not_ready'
							: 'provider_unavailable',
				sessionDead
					? 'WhatsApp Web session died on the server. Reconnect the account from WhatsApp settings, then open the chat again.'
					: mainNotReady
						? 'WhatsApp Web is still syncing with the phone. Messages will appear when ready.'
						: undefined,
			);
		}
		if (!Array.isArray(messages) || messages.length === 0) {
			// Empty provider page with empty DB usually means ChatStore has not hydrated
			// this JID yet (common for @lid / groups right after link). Soft-skip so the
			// UI keeps retrying instead of showing a permanent "no messages" empty state.
			if (localCount === 0) {
				return returnLocalOnly(
					'main_not_ready',
					'WhatsApp Web is still syncing with the phone. Messages will appear when ready.',
				);
			}
			// Catch-up found nothing new — stamp hydration so reopen stays soft.
			await this.conversationRepo.update(conversation.id, {
				lastProviderSyncAt: new Date(),
			});
			const items = await this.listMessages(
				user,
				conversationId,
				mode === 'older' ? oldestBeforeSync?.id : undefined,
				requestedLimit,
				{ allowLivePull: false },
			);
			return {
				supported: true,
				items,
				hasMore: Boolean(conversation.hasMoreProviderHistory),
				syncReason: afterCursor ? 'caught_up' : 'empty_provider_page',
				lastProviderSyncAt: new Date(),
			};
		}
		// Persist provider history with bounded concurrency. Sequential hydration
		// performs several database round trips per message and made 30 messages
		// take tens of seconds on a remote database.
		const historyWriteConcurrency = 4;
		for (let index = 0; index < messages.length; index += historyWriteConcurrency) {
			const batch = messages.slice(index, index + historyWriteConcurrency);
			const results = await Promise.allSettled(
				batch.map((item) =>
					// Always bind history to the opened conversation. Provider message
					// chatIds often flip between @lid and @c.us and would otherwise
					// create a twin conversation while the opened one stays empty.
					this.persistMessage(
						conversation.accountId,
						{
							...item,
							chatId: conversation.providerChatId,
						},
						null,
						false,
						{
							emitEvents: false,
						},
					),
				),
			);
			results.forEach((result, offset) => {
				if (result.status !== 'rejected') return;
				const item = batch[offset];
				this.logger.warn(
					`Failed to persist history message ${item?.providerMessageId || '?'} in conversation ${conversationId}: ${
						result.reason instanceof Error ? result.reason.message : String(result.reason)
					}`,
				);
			});
		}
		const newestReliableTimestamp = messages.reduce<Date | null>((latest, item) => {
			if (item.timestampReliable === false) return latest;
			const timestamp = whatsAppTimestampToDate(item.timestamp);
			if (!timestamp?.getTime?.()) return latest;
			return !latest || timestamp.getTime() > latest.getTime() ? timestamp : latest;
		}, null);
		if (
			newestReliableTimestamp &&
			newestReliableTimestamp.getTime() >
				(conversation.lastMessageAt ? new Date(conversation.lastMessageAt).getTime() : 0)
		) {
			await this.conversationRepo.update(conversation.id, {
				lastMessageAt: newestReliableTimestamp,
			});
		}
		const oldestStored = await this.messageRepo.findOne({
			where: { conversationId },
			order: { providerTimestamp: 'ASC' },
		});
		const sortedProvider = [...(messages || [])].sort((a: any, b: any) => {
			const aTime = whatsAppTimestampToDate(a?.timestamp)?.getTime() || 0;
			const bTime = whatsAppTimestampToDate(b?.timestamp)?.getTime() || 0;
			if (aTime !== bTime) return aTime - bTime;
			return String(a?.providerMessageId || '').localeCompare(String(b?.providerMessageId || ''));
		});
		const oldestFromBatch = sortedProvider[0]?.providerMessageId || null;
		// Latest sync must never move the oldest cursor forward; only older sync
		// (or first hydration) may establish how far back we reached.
		const oldest =
			mode === 'older'
				? oldestFromBatch ||
					conversation.oldestProviderCursor ||
					oldestStored?.providerMessageId ||
					null
				: conversation.oldestProviderCursor ||
					oldestStored?.providerMessageId ||
					oldestFromBatch ||
					null;
		const hasMoreProviderHistory =
			mode === 'older'
				? messages.length >= requestedLimit
				: localCount < requestedLimit
					? messages.length >= requestedLimit
					: conversation.hasMoreProviderHistory;
		const oldestStoredTs = oldestStored?.providerTimestamp
			? new Date(oldestStored.providerTimestamp).getTime()
			: 0;
		const oldestFromProviderTs = (messages || []).reduce((min, item) => {
			const at = item?.timestamp?.getTime?.() || 0;
			return at && (min === 0 || at < min) ? at : min;
		}, 0);
		const olderPageDidExtend =
			!oldestStoredTs ||
			(oldestFromProviderTs > 0 && oldestFromProviderTs < oldestStoredTs - 500);
		const nextHasMore =
			mode === 'older'
				? Boolean(hasMoreProviderHistory && olderPageDidExtend)
				: hasMoreProviderHistory;
		await this.conversationRepo.update(conversation.id, {
			lastProviderSyncAt: new Date(),
			oldestProviderCursor: oldest,
			hasMoreProviderHistory: nextHasMore,
		});
		const items = await this.listMessages(
			user,
			conversationId,
			mode === 'older' ? oldestBeforeSync?.id : undefined,
			requestedLimit,
			{ allowLivePull: false },
		);
		if (items.length) {
			return {
				supported: true,
				items,
				hasMore: nextHasMore,
				syncReason: afterCursor ? 'incremental' : force ? 'forced' : 'full_latest',
				lastProviderSyncAt: new Date(),
			};
		}
		// If DB still empty after persist attempts, serve linked-device payload directly.
		return {
			supported: true,
			items: this.mapLiveMessagesForApi(conversationId, messages),
			hasMore: nextHasMore,
			source: 'linked_device',
			syncReason: 'linked_device',
			lastProviderSyncAt: new Date(),
		};
	}

	private async markReadAfterReply(
		conversation: WhatsAppConversation,
		account: WhatsAppAccount,
		provider: WhatsAppProvider,
		userId: string,
	) {
		const privacy = getWhatsAppPrivacySettings(account);
		if (privacy.readReceiptMode !== 'on_reply') return;

		try {
			await provider.markChatRead(conversation.providerChatId);
			await this.conversationRepo.update(conversation.id, { unreadCount: 0 });
			this.gateway.emitAccountEvent(conversation.accountId, 'conversation_read', {
				conversationId: conversation.id,
				userId,
			});
		} catch (error) {
			// The outgoing message already succeeded. A receipt failure must not make
			// the frontend retry and accidentally send the message twice.
			this.logger.warn(
				`Could not mark conversation ${conversation.id} read after reply: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	async markConversationRead(user: User, conversationId: string, manualReceiptRequested = false) {
		const { conversation, accountAccess } = await this.assertConversationVisible(
			user,
			conversationId,
		);
		const privacy = getWhatsAppPrivacySettings(accountAccess.account);
		const shouldSendReceipt =
			accountAccess.canUse &&
			(privacy.readReceiptMode === 'on_open' ||
				(privacy.readReceiptMode === 'manual' && manualReceiptRequested));
		let providerReceiptSent = false;
		if (shouldSendReceipt) {
			const provider = this.providers.getProvider(conversation.accountId);
			if (provider?.getState() === 'connected') {
				try {
					await provider.markChatRead(conversation.providerChatId);
					providerReceiptSent = true;
				} catch (error) {
					this.logger.warn(
						`Could not send WhatsApp read receipt for ${conversationId}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				}
			}
		}
		await this.conversationRepo.update(conversationId, { unreadCount: 0 });
		this.gateway.emitAccountEvent(conversation.accountId, 'conversation_read', {
			conversationId,
			userId: user.id,
		});
		await this.audit.write({
			actorUserId: user.id,
			accountId: conversation.accountId,
			action: 'whatsapp.conversation.read',
			targetType: 'WhatsAppConversation',
			targetId: conversationId,
			metadata: {
				providerReceiptSent,
				readReceiptMode: privacy.readReceiptMode,
				manualReceiptRequested,
			},
		});
		return {
			ok: true,
			providerReceiptSent,
			readReceiptMode: privacy.readReceiptMode,
		};
	}

	async listConversationNotes(user: User, conversationId: string) {
		await this.assertConversationVisible(user, conversationId);
		return this.noteRepo.find({
			where: { conversationId },
			relations: ['author'],
			order: { created_at: 'ASC' },
			take: 200,
		});
	}

	async createConversationNote(user: User, conversationId: string, text: string) {
		await this.assertConversationVisible(user, conversationId);
		const trimmed = String(text || '').trim();
		if (!trimmed) throw new BadRequestException('Note text is required');
		if (trimmed.length > 2000) {
			throw new BadRequestException('Note text must be at most 2000 characters');
		}
		const note = await this.noteRepo.save(
			this.noteRepo.create({
				conversationId,
				authorUserId: user.id,
				text: trimmed,
			}),
		);
		return this.noteRepo.findOne({
			where: { id: note.id },
			relations: ['author'],
		});
	}

	async sendText(
		user: User,
		conversationId: string,
		text: string,
		quotedProviderMessageId?: string,
		clientMessageId?: string,
		persistClientMessageId?: string,
	) {
		if (clientMessageId) {
			return this.runIdempotentSend(user.id, conversationId, clientMessageId, () =>
				this.sendText(
					user,
					conversationId,
					text,
					quotedProviderMessageId,
					undefined,
					clientMessageId,
				),
			);
		}
		const { conversation, accountAccess } = await this.assertConversationVisible(
			user,
			conversationId,
		);
		if (!accountAccess.canUse) throw new ForbiddenException('WhatsApp send access denied');
		const provider = this.requireProvider(conversation.accountId);
		const result = await provider.sendText(
			conversation.providerChatId,
			text,
			quotedProviderMessageId,
		);
		const id =
			providerMessageId(result) ||
			`local_out_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
		if (!providerMessageId(result)) {
			this.logger.warn(
				`sendText returned without a stable provider id for conversation ${conversationId}; persisting with local fallback id`,
			);
		}
		await this.markReadAfterReply(conversation, accountAccess.account, provider, user.id);
		const saved = await this.persistMessage(
			conversation.accountId,
			{
				providerMessageId: id,
				chatId: conversation.providerChatId,
				fromMe: true,
				type: 'text',
				text,
				timestamp: new Date(),
				timestampReliable: true,
				quotedProviderMessageId: quotedProviderMessageId || null,
				raw: result,
			},
			user.id,
			false,
			{ clientMessageId: persistClientMessageId },
		);
		if (persistClientMessageId) (saved as any).clientMessageId = persistClientMessageId;
		await this.audit.write({
			actorUserId: user.id,
			accountId: conversation.accountId,
			action: 'whatsapp.message.sent',
			targetType: 'WhatsAppMessage',
			targetId: saved.id,
			metadata: { conversationId },
		});
		return { ok: true, message: saved, providerResult: { id } };
	}

	async sendMedia(
		user: User,
		conversationId: string,
		input: {
			type: string;
			fileId: string;
			caption?: string;
			quotedProviderMessageId?: string;
			clientMessageId?: string;
			persistClientMessageId?: string;
		},
	) {
		if (input.clientMessageId) {
			const { clientMessageId, persistClientMessageId: _ignored, ...singleSendInput } = input as any;
			return this.runIdempotentSend(user.id, conversationId, clientMessageId, () =>
				this.sendMedia(user, conversationId, {
					...singleSendInput,
					persistClientMessageId: clientMessageId,
				}),
			);
		}
		const { conversation, accountAccess } = await this.assertConversationVisible(
			user,
			conversationId,
		);
		if (!accountAccess.canUse) throw new ForbiddenException('WhatsApp send access denied');
		const root = path.resolve(
			process.env.WHATSAPP_MEDIA_ROOT || path.join(process.cwd(), 'storage', 'whatsapp-media'),
		);
		const absolutePath = path.resolve(root, input.fileId);
		const allowedUploadRoot = path.join(root, 'outgoing', conversation.accountId, user.id);
		if (!absolutePath.startsWith(`${allowedUploadRoot}${path.sep}`)) {
			throw new BadRequestException('Invalid WhatsApp media identifier');
		}
		await fs.access(absolutePath);
		const provider = this.requireProvider(conversation.accountId);
		const mimeGuess =
			guessMimeFromPath(absolutePath, input.type) ||
			(input.type === 'voice' || input.type === 'audio' ? 'audio/ogg; codecs=opus' : null);
		const result = await provider.sendMedia(conversation.providerChatId, absolutePath, {
			caption: input.caption,
			fileName: path.basename(absolutePath),
			isVoice: input.type === 'voice',
			isSticker: input.type === 'sticker',
			mimeType: mimeGuess,
			quotedProviderMessageId: input.quotedProviderMessageId,
		});
		const id =
			providerMessageId(result) ||
			`local_out_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
		if (!providerMessageId(result)) {
			this.logger.warn(
				`sendMedia returned without a stable provider id for conversation ${conversationId}; persisting with local fallback id`,
			);
		}
		await this.markReadAfterReply(conversation, accountAccess.account, provider, user.id);
		const stat = await fs.stat(absolutePath);
		const attachmentType =
			input.type === 'voice' ? 'ptt' : input.type === 'audio' ? 'audio' : input.type;
		const saved = await this.persistMessage(
			conversation.accountId,
			{
				providerMessageId: id,
				chatId: conversation.providerChatId,
				fromMe: true,
				type: attachmentType,
				text: input.caption || null,
				timestamp: new Date(),
				timestampReliable: true,
				quotedProviderMessageId: input.quotedProviderMessageId || null,
				attachments: [
					{
						type: attachmentType,
						mimeType: mimeGuess,
						fileName: path.basename(absolutePath),
						fileSizeBytes: stat.size,
						providerMediaId: id,
					},
				],
				raw: result,
			},
			user.id,
			false,
			{ clientMessageId: input.persistClientMessageId },
		);
		if (input.persistClientMessageId) {
			(saved as any).clientMessageId = input.persistClientMessageId;
		}
		// Always bind a durable copy — upsert may have created the row first, and the
		// outgoing upload path must not be the only copy (FE / cleanup can remove it).
		await this.bindOutboundLocalAttachment({
			accountId: conversation.accountId,
			providerMessageId: id,
			messageId: saved.id,
			sourcePath: absolutePath,
			mimeType: mimeGuess,
			attachmentType,
			fileName: path.basename(absolutePath),
			fileSizeBytes: stat.size,
		});
		const refreshed = await this.messageRepo.findOne({
			where: { id: saved.id },
			relations: ['attachments', 'senderUser'],
		});
		await this.audit.write({
			actorUserId: user.id,
			accountId: conversation.accountId,
			action: 'whatsapp.message.media_sent',
			targetType: 'WhatsAppMessage',
			targetId: saved.id,
			metadata: { conversationId, type: input.type },
		});
		return { ok: true, message: refreshed || saved, providerResult: { id } };
	}

	private async bindOutboundLocalAttachment(input: {
		accountId: string;
		providerMessageId: string;
		messageId: string;
		sourcePath: string;
		mimeType?: string | null;
		attachmentType: string;
		fileName: string;
		fileSizeBytes: number;
	}) {
		const root = path.resolve(
			process.env.WHATSAPP_MEDIA_ROOT || path.join(process.cwd(), 'storage', 'whatsapp-media'),
		);
		const accountFolder = path.join(root, input.accountId);
		await fs.mkdir(accountFolder, { recursive: true });
		let attachment =
			(await this.attachmentRepo.find({ where: { messageId: input.messageId } }))?.[0] || null;
		if (!attachment) {
			const message = await this.messageRepo.findOne({
				where: {
					accountId: input.accountId,
					providerMessageId: input.providerMessageId,
				},
				relations: ['attachments'],
			});
			attachment = message?.attachments?.[0] || null;
			if (!attachment && message) {
				attachment = await this.attachmentRepo.save(
					this.attachmentRepo.create({
						messageId: message.id,
						type: input.attachmentType,
						mimeType: input.mimeType || null,
						fileName: input.fileName,
						fileSizeBytes: String(input.fileSizeBytes),
						providerMediaId: input.providerMessageId,
						storagePath: null,
						downloadStatus: 'pending',
					}),
				);
			}
		}
		if (!attachment) return;
		const safeName = `${attachment.id}-${path
			.basename(input.fileName || 'attachment')
			.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
		const durablePath = path.resolve(accountFolder, safeName);
		if (!durablePath.startsWith(`${accountFolder}${path.sep}`)) {
			throw new Error('Invalid media storage path');
		}
		await fs.copyFile(input.sourcePath, durablePath);
		let mimeType = input.mimeType || attachment.mimeType || null;
		try {
			const bytes = await fs.readFile(durablePath);
			mimeType =
				sniffImageMime(bytes) ||
				sniffAudioMime(bytes) ||
				mimeType ||
				guessMimeFromPath(durablePath, input.attachmentType);
		} catch {
			/* keep prior mime */
		}
		attachment.storagePath = path.relative(process.cwd(), durablePath).replace(/\\/g, '/');
		attachment.downloadStatus = 'downloaded';
		attachment.mimeType = mimeType;
		attachment.type = input.attachmentType || attachment.type;
		attachment.fileName = input.fileName || attachment.fileName;
		attachment.fileSizeBytes = String(input.fileSizeBytes);
		attachment.providerMediaId = input.providerMessageId;
		await this.attachmentRepo.save(attachment);
	}

	async listGroups(user: User, accountId: string) {
		const accountAccess = await this.access.getAccountAccess(user, accountId);
		if (!accountAccess.canView) throw new ForbiddenException('WhatsApp account access denied');
		const groups = await this.groupRepo.find({
			where: { accountId },
			relations: ['participants'],
			order: { subject: 'ASC' },
		});
		const canSeeAll = this.access.canSeeAllConversations(user, accountAccess);
		const conversations = groups.length
			? await this.conversationRepo
					.createQueryBuilder('conversation')
					.where('conversation.accountId = :accountId', { accountId })
					.andWhere('conversation.groupId IN (:...groupIds)', {
						groupIds: groups.map((group) => group.id),
					})
					.andWhere(
						canSeeAll ? '1 = 1' : 'conversation.assignedUserId = :userId',
						canSeeAll ? {} : { userId: user.id },
					)
					.getMany()
			: [];
		const conversationByGroup = new Map(
			conversations.map((conversation) => [conversation.groupId, conversation.id]),
		);
		return groups.map((group) => ({
			...group,
			conversationId: conversationByGroup.get(group.id) || null,
		}));
	}

	async getGroupDetails(user: User, accountId: string, groupId: string, refresh = false) {
		const accountAccess = await this.access.getAccountAccess(user, accountId);
		if (!accountAccess.canView) throw new ForbiddenException('WhatsApp account access denied');
		let group = await this.groupRepo.findOne({
			where: { id: groupId, accountId },
			relations: ['participants'],
		});
		if (!group) throw new NotFoundException('WhatsApp group not found');

		if (refresh) {
			const provider = this.requireProvider(accountId);
			if (provider.capabilities.groupParticipants) {
				try {
					await this.syncGroupMetadata(provider, accountId, group.waId);
				} catch {
					// Return stored details when WhatsApp cannot refresh participants.
				}
			}
			try {
				const providerGroups = (await (provider as any).getGroups?.()) || [];
				const providerGroup = providerGroups.find(
					(item: any) => waId(item) === group!.waId || waId(item?.id) === group!.waId,
				);
				if (providerGroup) {
					await this.groupRepo.update(group.id, {
						subject:
							providerGroup?.name ||
							providerGroup?.subject ||
							providerGroup?.formattedTitle ||
							group.subject,
						description:
							providerGroup?.groupMetadata?.desc || providerGroup?.description || group.description,
						ownerWaId:
							waId(providerGroup?.groupMetadata?.owner) ||
							waId(providerGroup?.owner) ||
							group.ownerWaId,
					});
				}
			} catch {
				// Participant details are still useful when full group metadata is unavailable.
			}
			group = await this.groupRepo.findOneOrFail({
				where: { id: groupId, accountId },
				relations: ['participants'],
			});
		}

		const canSeeAll = this.access.canSeeAllConversations(user, accountAccess);
		const conversationQuery = this.conversationRepo
			.createQueryBuilder('conversation')
			.where('conversation.accountId = :accountId', { accountId })
			.andWhere('conversation.groupId = :groupId', { groupId });
		if (!canSeeAll) {
			conversationQuery.andWhere('conversation.assignedUserId = :userId', {
				userId: user.id,
			});
		}
		const conversation = await conversationQuery.getOne();
		return { ...group, conversationId: conversation?.id || null };
	}

	async tryDownloadAttachmentQuiet(user: User, attachmentId: string) {
		try {
			return await this.downloadAttachment(user, attachmentId);
		} catch {
			return null;
		}
	}

	/** Media that is not on disk is pulled through the single linked WhatsApp Web
	 *  page. Concurrent requests for the same attachment (chat reopened, retry,
	 *  bulk download) share one download instead of queueing duplicate work. */
	async downloadAttachment(user: User, attachmentId: string) {
		const attachment = await this.attachmentRepo.findOne({
			where: { id: attachmentId },
			relations: ['message'],
		});
		if (!attachment) throw new NotFoundException('WhatsApp attachment not found');
		await this.assertConversationVisible(user, attachment.message.conversationId);
		const inFlight = this.attachmentDownloads.get(attachmentId);
		if (inFlight) return inFlight;
		const download = this.downloadAttachmentInternal(attachment).finally(() => {
			this.attachmentDownloads.delete(attachmentId);
		});
		this.attachmentDownloads.set(attachmentId, download);
		return download;
	}

	private async downloadAttachmentInternal(attachment: WhatsAppMessageAttachment) {
		const fresh = await this.attachmentRepo.findOne({
			where: { id: attachment.id },
			relations: ['message'],
		});
		if (fresh?.message) attachment = fresh;

		if (attachment.storagePath && attachment.downloadStatus === 'downloaded') {
			const cachedPath = path.resolve(process.cwd(), attachment.storagePath);
			try {
				const cachedBuffer = await fs.readFile(cachedPath);
				const audioType = ['audio', 'ptt', 'voice'].includes(
					String(attachment.type || '').toLowerCase(),
				);
				if (audioType && !isValidAudioBuffer(cachedBuffer, attachment.mimeType)) {
					throw new Error('Cached audio is invalid');
				}
				const sniffedMime =
					(audioType ? sniffAudioMime(cachedBuffer) : null) ||
					sniffImageMime(cachedBuffer) ||
					guessMimeFromPath(cachedPath, attachment.type);
				if (sniffedMime && sniffedMime !== attachment.mimeType) {
					attachment.mimeType = sniffedMime;
					await this.attachmentRepo.save(attachment);
				}
				return {
					ok: true,
					path: attachment.storagePath,
					url: `/api/v1/whatsapp/attachments/${attachment.id}/content`,
					cached: true,
					mimeType: attachment.mimeType,
					type: attachment.type,
				};
			} catch {
				await fs.rm(cachedPath, { force: true }).catch(() => {});
				attachment.storagePath = null;
				attachment.downloadStatus = 'pending';
				await this.attachmentRepo.save(attachment);
			}
		}
		const provider = this.providers.getProvider(attachment.message.accountId);
		const providerState =
			provider?.getState?.() || this.providers.getProviderState?.(attachment.message.accountId);
		if (!provider || providerState !== 'connected') {
			attachment.downloadStatus = 'pending';
			await this.attachmentRepo.save(attachment);
			throw new BadRequestException(
				'WhatsApp media is not ready yet. Wait for the account to finish syncing, then retry.',
			);
		}
		if (!provider.capabilities.mediaDownload) {
			return { ok: false, supported: false };
		}
		attachment.downloadStatus = 'downloading';
		await this.attachmentRepo.save(attachment);
		try {
			const mediaId = attachment.providerMediaId || attachment.message.providerMessageId;
			if (!mediaId) throw new Error('Attachment has no provider media id');
			let rawHint = attachment.message?.raw || null;
			const attemptDownload = async (hint: any) =>
				this.withMediaDownloadSlot(() => provider.downloadMedia(mediaId, { rawHint: hint }));

			let data: any;
			try {
				data = await attemptDownload(rawHint);
			} catch (error: any) {
				const refreshed = await this.refreshAttachmentRawFromLive(attachment).catch(
					() => false,
				);
				if (refreshed) {
					const reloaded = await this.attachmentRepo.findOne({
						where: { id: attachment.id },
						relations: ['message'],
					});
					if (reloaded?.message) {
						attachment = reloaded;
						rawHint = attachment.message?.raw || rawHint;
					}
				}
				await new Promise((resolve) => setTimeout(resolve, refreshed ? 400 : 800));
				try {
					data = await attemptDownload(rawHint);
				} catch (retryError: any) {
					const detail = String(retryError?.message || error?.message || error || '');
					throw new Error(
						detail && detail !== 'Object'
							? detail
							: 'Media is unavailable from WhatsApp right now',
					);
				}
			}
			const buffer = decodeProviderMedia(data);
			if (!buffer.length) throw new Error('Provider returned empty media');
			const audioType = ['audio', 'ptt', 'voice'].includes(
				String(attachment.type || '').toLowerCase(),
			);
			if (audioType && !isValidAudioBuffer(buffer, attachment.mimeType)) {
				throw new Error('Provider returned invalid audio media');
			}
			const sniffedMime =
				(audioType ? sniffAudioMime(buffer) : null) ||
				sniffImageMime(buffer) ||
				guessMimeFromPath(attachment.fileName || '', attachment.type);
			if (sniffedMime && sniffedMime !== attachment.mimeType) {
				attachment.mimeType = sniffedMime;
			}
			const root = path.resolve(
				process.env.WHATSAPP_MEDIA_ROOT || path.join(process.cwd(), 'storage', 'whatsapp-media'),
			);
			const accountFolder = path.join(root, attachment.message.accountId);
			await fs.mkdir(accountFolder, { recursive: true });
			const safeName = `${attachment.id}-${path
				.basename(attachment.fileName || 'attachment')
				.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
			const absolutePath = path.resolve(accountFolder, safeName);
			if (!absolutePath.startsWith(`${accountFolder}${path.sep}`)) {
				throw new Error('Invalid media storage path');
			}
			await fs.writeFile(absolutePath, buffer);
			attachment.storagePath = path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
			attachment.fileSizeBytes = String(buffer.length);
			attachment.downloadStatus = 'downloaded';
			await this.attachmentRepo.save(attachment);
			return {
				ok: true,
				path: attachment.storagePath,
				url: `/api/v1/whatsapp/attachments/${attachment.id}/content`,
				cached: false,
				mimeType: attachment.mimeType,
				type: attachment.type,
			};
		} catch (error: any) {
			attachment.downloadStatus = 'failed';
			await this.attachmentRepo.save(attachment);
			const detail = String(error?.message || error || '');
			throw new BadRequestException(
				detail && detail !== 'Object' ? detail : 'WhatsApp media is not available',
			);
		}
	}

	private async refreshAttachmentRawFromLive(
		attachment: WhatsAppMessageAttachment,
	): Promise<boolean> {
		const message = attachment.message;
		if (!message?.conversationId || !message.providerMessageId) return false;
		const conversation = await this.conversationRepo.findOne({
			where: { id: message.conversationId },
			relations: ['contact'],
		});
		if (!conversation) return false;
		const live = await this.pullLiveMessagesFromLinkedDevice(conversation, 80).catch(() => []);
		const hit = live.find(
			(item) => String(item.providerMessageId) === String(message.providerMessageId),
		);
		if (!hit) return false;
		const before = baileysRawMediaScore((message as any).raw);
		await this.persistMessage(
			conversation.accountId,
			{ ...hit, chatId: conversation.providerChatId },
			null,
			false,
			{ emitEvents: false },
		);
		const updated = await this.messageRepo.findOne({ where: { id: message.id } });
		const after = baileysRawMediaScore((updated as any)?.raw);
		if (updated) (attachment as any).message = { ...message, ...updated };
		return after > before;
	}

	async resolveAttachmentFile(user: User, attachmentId: string) {
		const downloaded = await this.downloadAttachment(user, attachmentId);
		if (!downloaded?.ok || !downloaded.path) {
			throw new BadRequestException('WhatsApp media is not available');
		}
		const absolutePath = path.resolve(process.cwd(), downloaded.path.replace(/^\/+/, ''));
		const privateRoot = path.resolve(
			process.env.WHATSAPP_MEDIA_ROOT || path.join(process.cwd(), 'storage', 'whatsapp-media'),
		);
		const legacyRoot = path.resolve(path.join(process.cwd(), 'uploads', 'whatsapp-media'));
		if (
			![privateRoot, legacyRoot].some(
				(root) => absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`),
			)
		) {
			throw new BadRequestException('Invalid WhatsApp media storage path');
		}
		await fs.access(absolutePath);
		const attachment = await this.attachmentRepo.findOne({
			where: { id: attachmentId },
		});
		let mimeType = downloaded.mimeType || attachment?.mimeType || null;
		if (!mimeType || String(mimeType).includes('octet-stream')) {
			try {
				const head = Buffer.alloc(64);
				const handle = await fs.open(absolutePath, 'r');
				try {
					await handle.read(head, 0, 64, 0);
				} finally {
					await handle.close();
				}
				mimeType =
					sniffImageMime(head) ||
					sniffAudioMime(head) ||
					guessMimeFromPath(absolutePath, attachment?.type) ||
					mimeType;
			} catch {
				/* keep prior */
			}
		}
		return {
			absolutePath,
			mimeType: mimeType || 'application/octet-stream',
			fileName: attachment?.fileName || path.basename(absolutePath),
		};
	}
}
