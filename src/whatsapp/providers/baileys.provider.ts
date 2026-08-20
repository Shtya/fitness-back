import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as qrcode from 'qrcode';
import {
	NormalizedWhatsAppMessage,
	NormalizedWhatsAppReaction,
	WhatsAppProvider,
	WhatsAppProviderCapabilities,
	WhatsAppProviderEvent,
} from './whatsapp-provider';
import { loadBaileysModule } from './baileys-loader';
import { reviveBaileysWaMessage } from '../utils/baileys-media-raw';
import { extractWhatsAppLocation } from '../utils/whatsapp-location';
import { ensureWhatsAppVoiceOgg, guessVoiceSeconds } from '../utils/whatsapp-voice-ogg';

type BaileysSocket = any;

const sessionRoot = () =>
	path.resolve(
		process.env.WHATSAPP_BAILEYS_DIR ||
			process.env.WHATSAPP_TOKEN_FOLDER ||
			path.join(process.cwd(), 'tokens', 'baileys'),
	);

function jidOf(value: any): string {
	if (!value) return '';
	if (typeof value === 'string') return normalizeInboxJid(value);
	return normalizeInboxJid(String(value._serialized || value.id || value.user || ''));
}

/** Keep CRM chat ids compatible with older WPP @c.us rows. */
function normalizeInboxJid(jid: string): string {
	const raw = String(jid || '').trim();
	if (!raw) return '';
	if (raw.endsWith('@s.whatsapp.net')) {
		return `${raw.slice(0, -'@s.whatsapp.net'.length)}@c.us`;
	}
	return raw;
}

const LIVE_FROM_ME_WINDOW_MS = 30 * 60 * 1000;

export function shouldSyncFullHistory() {
	const value = String(process.env.WHATSAPP_SYNC_FULL_HISTORY || '')
		.trim()
		.toLowerCase();
	return value === '1' || value === 'true' || value === 'yes';
}

/** Phone opened/read the chat → unreadCount 0. Marked unread is -1. Missing stays prev. */
export function applyLiveChatUnread(
	prev: number,
	incoming: unknown,
): { next: number; phoneRead: boolean } {
	if (incoming === null || incoming === undefined || incoming === '') {
		return { next: prev, phoneRead: false };
	}
	const value = Math.floor(Number(incoming));
	if (!Number.isFinite(value)) return { next: prev, phoneRead: false };
	if (value === 0) return { next: 0, phoneRead: true };
	if (value < 0) return { next: prev, phoneRead: false };
	return { next: value, phoneRead: false };
}

/** Phone-sent echoes often arrive as `append`, not `notify`. Treat recent fromMe as live. */
export function isHistoryMessageUpsert(type: string, raw: any): boolean {
	const kind = String(type || 'notify').toLowerCase();
	if (kind === 'notify') return false;
	if (!raw?.key?.fromMe) return true;
	if (kind !== 'append') return true;
	const ts = Number(raw.messageTimestamp) || 0;
	const tsMs = ts > 1e12 ? ts : ts * 1000;
	if (!Number.isFinite(tsMs) || tsMs <= 0) return true;
	return Date.now() - tsMs > LIVE_FROM_ME_WINDOW_MS;
}

/** proto.WebMessageInfo.Status: 2=SERVER_ACK, 3=DELIVERY_ACK, 4=READ, 5=PLAYED */
export function mapBaileysMessageStatus(status: unknown): string | null {
	if (status === 0 || status === 'ERROR' || status === 'failed') return 'failed';
	if (status === 1 || status === 'PENDING' || status === 'pending') return 'pending';
	if (status === 2 || status === 'SERVER_ACK' || status === 'sent') return 'sent';
	if (status === 3 || status === 'DELIVERY_ACK' || status === 'delivered') return 'delivered';
	if (status === 4 || status === 'READ' || status === 'read') return 'read';
	if (status === 5 || status === 'PLAYED' || status === 'played') return 'played';
	return null;
}

function isStatusBroadcastJid(jid: string | null | undefined): boolean {
	const id = String(jid || '').toLowerCase();
	return Boolean(id) && (id.includes('status@') || id.endsWith('@broadcast'));
}

export function shouldSkipMediaReupload(raw: any): boolean {
	return isStatusBroadcastJid(jidOf(raw?.key?.remoteJid));
}

export function attachFullMediaUrls(
	content: any,
	getUrlFromDirectPath?: ((directPath: string, host?: string) => string) | null,
) {
	if (!content || typeof content !== 'object' || typeof getUrlFromDirectPath !== 'function') {
		return content;
	}
	for (const key of [
		'imageMessage',
		'videoMessage',
		'audioMessage',
		'documentMessage',
		'stickerMessage',
	]) {
		const node = content[key];
		if (node?.directPath && !node.url) {
			try {
				node.url = getUrlFromDirectPath(node.directPath);
			} catch {
				/* keep directPath-only node */
			}
		}
	}
	return content;
}

function toBaileysJid(jid: string): string {
	const raw = String(jid || '').trim();
	if (!raw) return '';
	if (raw.endsWith('@c.us')) {
		return `${raw.slice(0, -'@c.us'.length)}@s.whatsapp.net`;
	}
	return raw;
}

function waitMs(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when a label is just an id/phone — not a real contact/group name. */
function isWeakDisplayName(
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

function extractChatDisplayName(chat: any): string | null {
	const chatId = jidOf(chat?.id) || jidOf(chat);
	const candidates = [
		chat?.name,
		chat?.verifiedName,
		chat?.displayName,
		chat?.notify,
		chat?.notifyName,
		chat?.pushName,
		chat?.pushname,
		chat?.username,
		chat?.formattedTitle,
		chat?.formattedName,
		chat?.contact?.name,
		chat?.contact?.verifiedName,
		chat?.contact?.pushname,
		chat?.contact?.formattedName,
		chat?.threadMetadata?.name,
		chat?.thread_metadata?.name,
	];
	for (const value of candidates) {
		if (!value) continue;
		if (typeof value === 'object') {
			const nested = String(value.text || value.name || '').trim();
			if (nested && !isWeakDisplayName(nested, chatId)) return nested;
			continue;
		}
		const text = String(value).trim();
		if (text && text !== '[object Object]' && !isWeakDisplayName(text, chatId)) return text;
	}
	return null;
}

function newsletterDisplayName(meta: any): string | null {
	const candidates = [
		meta?.name,
		meta?.thread_metadata?.name,
		meta?.threadMetadata?.name,
		meta?.result?.thread_metadata?.name,
		meta?.result?.name,
	];
	for (const value of candidates) {
		if (typeof value === 'string' && value.trim()) return value.trim();
		const text = String(value?.text || '').trim();
		if (text) return text;
	}
	return null;
}

function resolveWhatsAppPictureUrl(value: any): string | null {
	if (!value) return null;
	if (typeof value === 'string') {
		const text = value.trim();
		if (text.startsWith('http')) return text;
		if (text.startsWith('/')) return `https://pps.whatsapp.net${text}`;
		return null;
	}
	const url = String(value.url || value.eurl || '').trim();
	if (url.startsWith('http')) return url;
	const path = String(value.directPath || value.direct_path || '').trim();
	if (path.startsWith('http')) return path;
	if (path.startsWith('/')) return `https://pps.whatsapp.net${path}`;
	return null;
}

function newsletterPictureUrl(meta: any): string | null {
	const candidates = [
		meta?.picture,
		meta?.preview,
		meta?.thread_metadata?.picture,
		meta?.thread_metadata?.preview,
		meta?.threadMetadata?.picture,
		meta?.threadMetadata?.preview,
		meta?.result?.picture,
		meta?.result?.thread_metadata?.picture,
		meta?.result?.thread_metadata?.preview,
	];
	for (const value of candidates) {
		const url = resolveWhatsAppPictureUrl(value);
		if (url) return url;
	}
	return null;
}

function unwrapMessageContent(message: any): any {
	if (!message || typeof message !== 'object') return message;
	return (
		message.ephemeralMessage?.message ||
		message.viewOnceMessage?.message ||
		message.viewOnceMessageV2?.message ||
		message.viewOnceMessageV2Extension?.message ||
		message.documentWithCaptionMessage?.message ||
		message.editedMessage?.message ||
		message
	);
}

function contextInfoOf(content: any) {
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

function messageText(message: any): string {
	if (!message) return '';
	return (
		message.conversation ||
		message.extendedTextMessage?.text ||
		message.imageMessage?.caption ||
		message.videoMessage?.caption ||
		message.documentMessage?.caption ||
		message.buttonsResponseMessage?.selectedDisplayText ||
		message.listResponseMessage?.title ||
		message.templateButtonReplyMessage?.selectedDisplayText ||
		message.contactMessage?.displayName ||
		message.contactsArrayMessage?.displayName ||
		message.pollCreationMessage?.name ||
		message.pollCreationMessageV3?.name ||
		message.eventMessage?.name ||
		''
	);
}

function detectType(message: any): string {
	if (!message) return 'text';
	if (message.imageMessage) return 'image';
	if (message.videoMessage) return 'video';
	if (message.audioMessage) return message.audioMessage.ptt ? 'ptt' : 'audio';
	if (message.documentMessage) return 'document';
	if (message.stickerMessage) return 'sticker';
	if (message.contactMessage || message.contactsArrayMessage) return 'contact';
	if (message.liveLocationMessage) return 'live_location';
	if (message.locationMessage) return 'location';
	if (message.pollCreationMessage || message.pollCreationMessageV3) return 'poll';
	return 'text';
}

const CONTROL_ONLY_KEYS = new Set([
	'protocolMessage',
	'senderKeyDistributionMessage',
	'messageContextInfo',
	'reactionMessage',
	'encReactionMessage',
	'pollUpdateMessage',
	'keepInChatMessage',
	'pinInChatMessage',
	'placeholderMessage',
	'associatedChildMessage',
]);

function isControlOnlyContent(content: any): boolean {
	if (!content || typeof content !== 'object') return true;
	const keys = Object.keys(content).filter((key) => content[key] != null);
	if (!keys.length) return true;
	return keys.every((key) => CONTROL_ONLY_KEYS.has(key));
}

export type BaileysDisconnectKind = 'logged_out' | 'replaced' | 'phone_closed' | 'connection_lost';

/**
 * WhatsApp allows one WebSocket per linked-device identity. When we (or another
 * process) open a second socket with the same creds, the previous one is kicked
 * with conflict/replaced — that is not the phone going to sleep.
 */
export function classifyBaileysDisconnect(
	update: any,
	DisconnectReason?: { loggedOut?: number; connectionReplaced?: number; connectionClosed?: number; connectionLost?: number; timedOut?: number },
	context: { sessionHadOpened?: boolean } = {},
): BaileysDisconnectKind {
	const err = update?.lastDisconnect?.error;
	const statusCode = Number(err?.output?.statusCode || err?.data?.reason || 0);
	const msg = String(err?.message || err?.output?.payload?.message || err?.data || '');
	const node = err?.data?.content?.[0] || err?.data || err?.reasonNode || {};
	const inner = Array.isArray(err?.data?.content) ? err.data.content[0] : null;
	const replaced =
		statusCode === DisconnectReason?.connectionReplaced ||
		statusCode === 440 ||
		/stream errored \(conflict\)|conflict.*replaced|type":"replaced"/i.test(msg) ||
		node?.tag === 'conflict' ||
		node?.attrs?.type === 'replaced' ||
		inner?.tag === 'conflict' ||
		inner?.attrs?.type === 'replaced';
	const handshakeFailure = /connection failure/i.test(msg);
	// CB:failure during login often carries WhatsApp's 401 even when the
	// companion keys are still valid. Treating that as logout wiped nothing on
	// disk (Baileys creds stayed) and immediately logged in with the same
	// identity — an infinite "scan QR" loop without a QR.
	if (
		(statusCode === DisconnectReason?.loggedOut || statusCode === 401) &&
		!(handshakeFailure && !context.sessionHadOpened)
	) {
		return 'logged_out';
	}
	if (replaced) return 'replaced';
	if (handshakeFailure) return 'connection_lost';
	const phoneLikelyClosed =
		statusCode === DisconnectReason?.connectionClosed ||
		statusCode === DisconnectReason?.connectionLost ||
		statusCode === DisconnectReason?.timedOut ||
		statusCode === 408 ||
		statusCode === 428 ||
		statusCode === 500 ||
		statusCode === 503 ||
		!statusCode;
	return phoneLikelyClosed ? 'phone_closed' : 'connection_lost';
}

async function resolveBaileysSocketVersion(baileys: any): Promise<number[]> {
	const configured = process.env.WHATSAPP_BAILEYS_VERSION?.trim();
	if (configured) {
		const parts = configured.split(/[.,]/).map((part) => Number(part.trim()));
		if (parts.length === 3 && parts.every((n) => Number.isFinite(n) && n >= 0)) {
			return parts;
		}
	}
	const web = await baileys.fetchLatestWaWebVersion?.().catch(() => null);
	if (web?.isLatest && Array.isArray(web.version) && web.version.length === 3) {
		return web.version;
	}
	const fallback = await baileys.fetchLatestBaileysVersion();
	return fallback.version;
}

function toDate(ts: any): Date {
	const n =
		typeof ts === 'number'
			? ts
			: typeof ts?.toNumber === 'function'
				? ts.toNumber()
				: Number(ts) || 0;
	if (!n) return new Date();
	return new Date(n > 1e12 ? n : n * 1000);
}

/**
 * Baileys-backed WhatsApp provider (protocol WebSocket — no Chromium).
 * Live inbound path mirrors Dragify: messages.upsert → normalize → emit.
 * Chat/message history is kept in-memory from upserts + history sync events
 * and served to the existing CRM sync layer via getChats / getMessages.
 */
export class BaileysProvider implements WhatsAppProvider {
	readonly name = 'baileys';
	readonly capabilities: WhatsAppProviderCapabilities = {
		qr: true,
		history: true,
		contacts: true,
		groups: true,
		groupParticipants: false,
		mediaDownload: true,
		statusFetch: true,
		statusPublish: false,
		statusView: true,
		reactions: true,
		messageActions: true,
	};

	private readonly logger = new Logger(BaileysProvider.name);
	private socket: BaileysSocket | null = null;
	private socketGeneration = 0;
	private opening: Promise<void> | null = null;
	private state: string = 'disconnected';
	private qr: string | null = null;
	private pairingCode: string | null = null;
	private closing = false;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private reconnectAttempt = 0;
	private socketOpened = false;
	private phoneNumberHint: string | null = null;
	private readonly listeners = new Set<(event: WhatsAppProviderEvent) => void | Promise<void>>();
	private readonly chats = new Map<string, any>();
	private readonly contacts = new Map<
		string,
		{ id: string; name?: string | null; notify?: string | null; phoneNumber?: string | null; lid?: string | null }
	>();
	/** LID chat id → phone digits (no @domain). */
	private readonly lidToPn = new Map<string, string>();
	private readonly groupSubjectCache = new Map<string, string | null>();
	private readonly newsletterNameCache = new Map<string, string | null>();
	private readonly avatarUrlCache = new Map<string, { url: string | null; at: number }>();
	private readonly messagesByChat = new Map<string, Map<string, NormalizedWhatsAppMessage>>();
	/** Original WAMessage by provider id — required for Baileys media download. */
	private readonly rawByMessageId = new Map<string, any>();
	private readonly reactionsByMessageId = new Map<string, NormalizedWhatsAppReaction[]>();
	private readonly statusesById = new Map<string, any>();
	private readonly statusRawById = new Map<string, any>();
	private statusChangeTimer: NodeJS.Timeout | null = null;
	private connectedAtMs = 0;
	private historySyncChunks = 0;
	/** Provider ids already included in a messaging-history.set batch. */
	private readonly recentHistoryMessageIds = new Set<string>();

	constructor(private readonly accountId: string) {}

	onEvent(listener: (event: WhatsAppProviderEvent) => void | Promise<void>) {
		this.listeners.add(listener);
	}

	private emit(event: WhatsAppProviderEvent) {
		for (const listener of this.listeners) {
			try {
				void Promise.resolve(listener(event)).catch((error) => {
					this.logger.warn(
						`Baileys event listener failed: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				});
			} catch (error) {
				this.logger.warn(
					`Baileys event listener threw: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}
	}

	getQr() {
		return this.qr;
	}

	getPairingCode() {
		return this.pairingCode;
	}

	getState() {
		return this.state;
	}

	getChatStoreCooldownMs() {
		return 0;
	}

	resetChatStoreCooldown() {}

	async isChatStoreHydrated() {
		return this.isHistoryReady();
	}

	async isHistoryReady() {
		if (this.state !== 'connected') return false;
		// Do not treat socket-open as "inbox ready". WhatsApp still has to send
		// messaging-history.set; bootstrapping immediately produced a 1–2 chat
		// inbox and left every other thread without messages.
		if (this.historySyncChunks > 0) return true;
		if (!this.connectedAtMs) return false;
		const openForMs = Date.now() - this.connectedAtMs;
		// Some sessions never emit history (phone asleep). Give WhatsApp a window,
		// then proceed with whatever chats.upsert already delivered.
		if (this.chats.size > 0 && openForMs >= 8_000) return true;
		return openForMs >= 12_000;
	}

	private sessionDir() {
		return path.join(sessionRoot(), this.accountId);
	}

	private setState(status: string, extra: Partial<Extract<WhatsAppProviderEvent, { type: 'connection' }>> = {}) {
		this.state = status;
		this.emit({ type: 'connection', status, ...extra });
	}

	private rememberHistoryMessageId(id: string) {
		const key = String(id || '').trim();
		if (!key) return;
		this.recentHistoryMessageIds.add(key);
		if (this.recentHistoryMessageIds.size > 20_000) {
			this.recentHistoryMessageIds.clear();
			this.recentHistoryMessageIds.add(key);
		}
	}

	private rememberChat(chatId: string, patch: Record<string, unknown> = {}) {
		if (!chatId || isStatusBroadcastJid(chatId)) return;
		const prev = this.chats.get(chatId) || {
			id: { _serialized: chatId },
			name: null,
			t: 0,
			unreadCount: 0,
		};
		const patchedName = patch.name != null ? String(patch.name).trim() || null : undefined;
		const next = {
			...prev,
			...patch,
			// Prefer a real display name over raw LID/phone digits.
			name:
				patchedName && !isWeakDisplayName(patchedName, chatId)
					? patchedName
					: prev.name && !isWeakDisplayName(String(prev.name), chatId)
						? prev.name
						: patchedName || prev.name || null,
			id: { _serialized: chatId },
		};
		this.chats.set(chatId, next);
	}

	private rememberLidMapping(lid: string | null | undefined, pn: string | null | undefined) {
		const lidId = lid ? jidOf(lid) || String(lid).trim() : '';
		const pnRaw = pn ? String(pn).trim() : '';
		if (!lidId || !pnRaw) return;
		const digits = pnRaw.includes('@') ? pnRaw.split('@')[0].split(':')[0] : pnRaw.replace(/\D/g, '');
		if (!digits) return;
		this.lidToPn.set(lidId, digits);
		const hosted = lidId.replace(/@lid$/i, '@hosted.lid');
		if (hosted !== lidId) this.lidToPn.set(hosted, digits);
	}

	private rememberContact(contact: any) {
		if (!contact) return;
		const id = jidOf(contact.id) || jidOf(contact);
		if (!id || isStatusBroadcastJid(id)) return;
		const lid = contact.lid ? jidOf(contact.lid) : id.endsWith('@lid') || id.endsWith('@hosted.lid') ? id : null;
		const phoneJid = contact.phoneNumber
			? jidOf(contact.phoneNumber)
			: id.endsWith('@c.us') || id.endsWith('@s.whatsapp.net')
				? id
				: null;
		const phoneDigits = phoneJid
			? phoneJid.split('@')[0].split(':')[0].replace(/\D/g, '')
			: null;
		const name =
			[contact.name, contact.notify, contact.verifiedName, contact.pushname, contact.shortName]
				.map((v) => String(v || '').trim())
				.find((v) => v && !isWeakDisplayName(v, id, phoneDigits)) || null;
		const notify = String(contact.notify || '').trim() || null;
		const entry = {
			id,
			lid,
			phoneNumber: phoneDigits,
			name: name || notify,
			notify,
		};
		const merge = (key: string) => {
			if (!key) return;
			const prev = this.contacts.get(key) || { id: key };
			this.contacts.set(key, {
				...prev,
				...entry,
				id: key,
				name: entry.name || prev.name || null,
				notify: entry.notify || prev.notify || null,
				phoneNumber: entry.phoneNumber || prev.phoneNumber || null,
				lid: entry.lid || prev.lid || null,
			});
		};
		merge(id);
		if (lid) merge(lid);
		if (phoneDigits) {
			merge(`${phoneDigits}@c.us`);
			merge(`${phoneDigits}@s.whatsapp.net`);
		}
		if (lid && phoneDigits) this.rememberLidMapping(lid, phoneDigits);
	}

	private contactDisplayName(chatId: string): string | null {
		const id = jidOf(chatId) || String(chatId || '').trim();
		if (!id) return null;
		const hit = this.contacts.get(id);
		const phone = hit?.phoneNumber || this.lidToPn.get(id) || null;
		const name = hit?.name || hit?.notify || null;
		if (name && !isWeakDisplayName(name, id, phone)) return name;
		if (phone) {
			const byPhone =
				this.contacts.get(`${phone}@c.us`) || this.contacts.get(`${phone}@s.whatsapp.net`);
			const phoneName = byPhone?.name || byPhone?.notify || null;
			if (phoneName && !isWeakDisplayName(phoneName, id, phone)) return phoneName;
		}
		return null;
	}

	private async fetchGroupSubject(groupId: string): Promise<string | null> {
		const id = jidOf(groupId) || String(groupId || '').trim();
		if (!id.endsWith('@g.us')) return null;
		if (this.groupSubjectCache.has(id)) return this.groupSubjectCache.get(id) || null;
		if (!this.socket || this.state !== 'connected') return null;
		try {
			const meta = await this.socket.groupMetadata(id);
			const subject = String(meta?.subject || '').trim() || null;
			this.groupSubjectCache.set(id, subject);
			if (subject) this.rememberChat(id, { name: subject });
			return subject;
		} catch {
			this.groupSubjectCache.set(id, null);
			return null;
		}
	}

	private attachChatPicture(chatId: string, url: string | null) {
		const id = jidOf(chatId) || String(chatId || '').trim();
		if (!id || !url) return;
		if (!this.chats.has(id)) this.rememberChat(id);
		const chat = this.chats.get(id);
		if (!chat) return;
		chat.imgUrl = url;
		chat.profilePicThumbObj = { ...(chat.profilePicThumbObj || {}), eurl: url };
	}

	private async fetchNewsletterName(newsletterId: string): Promise<string | null> {
		const meta = await this.fetchNewsletterMetadata(newsletterId);
		return meta.name;
	}

	private async fetchNewsletterMetadata(
		newsletterId: string,
	): Promise<{ name: string | null; pictureUrl: string | null }> {
		const id = jidOf(newsletterId) || String(newsletterId || '').trim();
		if (!id.endsWith('@newsletter')) return { name: null, pictureUrl: null };
		const cachedName = this.newsletterNameCache.has(id)
			? this.newsletterNameCache.get(id) || null
			: undefined;
		const cachedPicture = this.avatarUrlCache.get(id);
		if (cachedName !== undefined && cachedPicture) {
			return {
				name: cachedName,
				pictureUrl: cachedPicture.url || null,
			};
		}
		if (!this.socket || this.state !== 'connected') {
			return { name: cachedName || null, pictureUrl: cachedPicture?.url || null };
		}
		let name = cachedName || null;
		let pictureUrl = cachedPicture?.url || null;
		if (typeof this.socket.newsletterMetadata === 'function' && cachedName === undefined) {
			try {
				const meta = await this.socket.newsletterMetadata('jid', id);
				name = newsletterDisplayName(meta) || name;
				pictureUrl = newsletterPictureUrl(meta) || pictureUrl;
			} catch {
				/* keep fallbacks below */
			}
			this.newsletterNameCache.set(id, name);
			if (name) {
				this.rememberChat(id, { name });
				this.rememberContact({ id, name, verifiedName: name });
			}
		}
		if (!pictureUrl && typeof this.socket.profilePictureUrl === 'function') {
			try {
				const jid = toBaileysJid(id) || id;
				pictureUrl = String((await this.socket.profilePictureUrl(jid, 'preview')) || '').trim() || null;
			} catch {
				pictureUrl = pictureUrl || null;
			}
		}
		this.avatarUrlCache.set(id, { url: pictureUrl, at: Date.now() });
		this.attachChatPicture(id, pictureUrl);
		return { name, pictureUrl };
	}

	private rememberMessage(normalized: NormalizedWhatsAppMessage, rawMessage?: any) {
		if (!normalized.chatId || !normalized.providerMessageId) return;
		let bucket = this.messagesByChat.get(normalized.chatId);
		if (!bucket) {
			bucket = new Map();
			this.messagesByChat.set(normalized.chatId, bucket);
		}
		bucket.set(normalized.providerMessageId, normalized);
		if (rawMessage?.message) {
			this.rawByMessageId.set(normalized.providerMessageId, rawMessage);
		}
		// Cap per-chat memory so long-lived sessions do not grow forever.
		if (bucket.size > 500) {
			const keys = [...bucket.keys()].slice(0, bucket.size - 500);
			for (const key of keys) {
				bucket.delete(key);
				this.rawByMessageId.delete(key);
				this.reactionsByMessageId.delete(key);
			}
		}
		if (this.rawByMessageId.size > 4000) {
			const keys = [...this.rawByMessageId.keys()].slice(0, this.rawByMessageId.size - 4000);
			for (const key of keys) this.rawByMessageId.delete(key);
		}
		if (this.reactionsByMessageId.size > 4000) {
			const keys = [...this.reactionsByMessageId.keys()].slice(
				0,
				this.reactionsByMessageId.size - 4000,
			);
			for (const key of keys) this.reactionsByMessageId.delete(key);
		}
		if (normalized.contactName && !normalized.fromMe) {
			const contactId = normalized.chatId.endsWith('@g.us')
				? normalized.senderWaId || normalized.chatId
				: normalized.chatId;
			if (contactId) {
				this.rememberContact({
					id: contactId,
					notify: normalized.contactName,
					name: normalized.contactName,
				});
			}
		}
		const ts = normalized.timestamp?.getTime?.() || Date.now();
		const existingName = this.chats.get(normalized.chatId)?.name || null;
		const nextName =
			this.contactDisplayName(normalized.chatId) ||
			(normalized.contactName &&
			!isWeakDisplayName(normalized.contactName, normalized.chatId)
				? normalized.contactName
				: null) ||
			existingName;
		const fromHistory = Boolean((normalized as any).__fromHistory);
		const prevUnread = Number(this.chats.get(normalized.chatId)?.unreadCount) || 0;
		let nextUnread = prevUnread;
		if (!fromHistory && !normalized.fromMe) nextUnread = prevUnread + 1;
		if (!fromHistory && normalized.fromMe) nextUnread = 0;
		this.rememberChat(normalized.chatId, {
			t: Math.floor(ts / 1000),
			name: nextName,
			unreadCount: nextUnread,
			lastMessage: {
				id: { _serialized: normalized.providerMessageId },
				body: normalized.text,
				t: Math.floor(ts / 1000),
				fromMe: normalized.fromMe,
				type: normalized.type,
			},
		});
		if (
			normalized.chatId.endsWith('@newsletter') &&
			isWeakDisplayName(nextName, normalized.chatId) &&
			!this.newsletterNameCache.has(normalized.chatId)
		) {
			void this.fetchNewsletterName(normalized.chatId);
		}
	}

	private ownUserJid(): string {
		const full = String(this.socket?.user?.id || this.socket?.user?.lid || '').trim();
		if (!full) return '';
		const bare = full.includes(':') ? full.split(':')[0] : full.split('@')[0];
		const domain = full.includes('@') ? full.split('@')[1] : 's.whatsapp.net';
		return jidOf(`${bare}@${domain}`) || jidOf(full);
	}

	private statusSerializedId(raw: any): string {
		const id = String(raw?.key?.id || '').trim();
		const fromMe = Boolean(raw?.key?.fromMe);
		const participant =
			jidOf(raw?.key?.participant) ||
			jidOf(raw?.key?.participantAlt) ||
			jidOf(raw?.key?.remoteJidAlt) ||
			(fromMe ? this.ownUserJid() : '');
		if (!id) return '';
		return `${fromMe ? 'true' : 'false'}_status@broadcast_${id}${
			participant ? `_${participant}` : ''
		}`;
	}

	private emitStatusChanged() {
		if (this.statusChangeTimer) clearTimeout(this.statusChangeTimer);
		this.statusChangeTimer = setTimeout(() => {
			this.statusChangeTimer = null;
			this.emit({ type: 'status_changed' });
		}, 750);
	}

	private pruneExpiredStatuses() {
		const cutoff = Date.now() / 1000 - 24 * 60 * 60;
		for (const [id, item] of this.statusesById) {
			if (Number(item?.timestamp) > 0 && Number(item.timestamp) < cutoff) {
				this.statusesById.delete(id);
				this.statusRawById.delete(id);
				const messageId = String(item?.messageId || '').trim();
				if (messageId) this.statusRawById.delete(messageId);
			}
		}
		if (this.statusesById.size > 400) {
			const extra = [...this.statusesById.keys()].slice(0, this.statusesById.size - 400);
			for (const id of extra) {
				const item = this.statusesById.get(id);
				this.statusesById.delete(id);
				this.statusRawById.delete(id);
				const messageId = String(item?.messageId || '').trim();
				if (messageId) this.statusRawById.delete(messageId);
			}
		}
	}

	private rememberStatus(raw: any): boolean {
		const remoteJid = jidOf(raw?.key?.remoteJid) || String(raw?.key?.remoteJid || '');
		if (!isStatusBroadcastJid(remoteJid) || !raw?.message) return false;
		const content = unwrapMessageContent(raw.message);
		if (!content || isControlOnlyContent(content)) return false;
		const serialized = this.statusSerializedId(raw);
		if (!serialized) return false;
		const fromMe = Boolean(raw?.key?.fromMe);
		const senderWaId =
			jidOf(raw?.key?.participant) ||
			jidOf(raw?.key?.participantAlt) ||
			jidOf(raw?.key?.remoteJidAlt) ||
			(fromMe ? this.ownUserJid() : '') ||
			null;
		const type = detectType(content);
		const caption = messageText(content) || null;
		const published = toDate(raw.messageTimestamp);
		const timestamp = Math.floor(published.getTime() / 1000) || Math.floor(Date.now() / 1000);
		const contactName =
			(!fromMe && String(raw.pushName || '').trim()) ||
			(senderWaId ? this.contactDisplayName(senderWaId) : '') ||
			null;
		const item = {
			id: { _serialized: serialized, id: String(raw?.key?.id || ''), remote: 'status@broadcast' },
			messageId: String(raw?.key?.id || ''),
			author: { _serialized: senderWaId },
			from: { _serialized: senderWaId },
			sender: senderWaId,
			notifyName: contactName,
			contactName,
			timestamp,
			type,
			caption,
			body: type === 'text' ? caption : caption,
			fromMe,
			isOwn: fromMe,
		};
		this.statusesById.set(serialized, item);
		this.statusRawById.set(serialized, raw);
		if (item.messageId) this.statusRawById.set(item.messageId, raw);
		if (senderWaId && contactName) {
			this.rememberContact({
				id: senderWaId,
				notify: contactName,
				name: contactName,
			});
		}
		this.pruneExpiredStatuses();
		this.emitStatusChanged();
		return true;
	}

	private resolveStatusRaw(statusId: string, senderWaId?: string | null) {
		const id = String(statusId || '').trim();
		if (!id) return null;
		const direct = this.statusRawById.get(id);
		if (direct?.message) return direct;
		const hex = id.match(/status@broadcast_([^_]+)/i)?.[1] || '';
		const sender = jidOf(senderWaId) || '';
		for (const [key, raw] of this.statusRawById) {
			const messageId = String(raw?.key?.id || '');
			if (messageId === id || (hex && (messageId === hex || key.includes(hex)))) {
				if (sender) {
					const participant = jidOf(raw?.key?.participant);
					if (participant && participant !== sender && !key.includes(sender)) continue;
				}
				if (raw?.message) return raw;
			}
		}
		return null;
	}

	/** Ensure every chat that has messages is visible in getChats. */
	private ensureChatsFromMessages() {
		for (const chatId of this.messagesByChat.keys()) {
			if (!this.chats.has(chatId)) this.rememberChat(chatId);
		}
	}

	findMessage(providerMessageId: string): NormalizedWhatsAppMessage | null {
		const id = String(providerMessageId || '').trim();
		if (!id) return null;
		const remembered = this.findRememberedMessage(id);
		if (extractWhatsAppLocation(remembered)) return remembered;
		const raw = this.rawByMessageId.get(id);
		if (raw) {
			const normalized = this.normalizeWaMessage(raw);
			if (normalized) return normalized;
		}
		return remembered;
	}

	async fetchMessage(
		chatId: string,
		providerMessageId: string,
	): Promise<NormalizedWhatsAppMessage | null> {
		const id = String(providerMessageId || '').trim();
		if (!id) return null;
		const located = this.messageWithLocation(this.findMessage(id));
		if (extractWhatsAppLocation(located)) return located;

		const loaded = await this.loadMessageFromSocket(chatId, id);
		if (extractWhatsAppLocation(loaded)) return loaded;

		try {
			const recent = await this.getMessages(chatId, { limit: 200 });
			const found = recent.find((item) => item.providerMessageId === id) || null;
			if (found) this.rememberMessage(found);
			const fromList = this.messageWithLocation(found);
			if (extractWhatsAppLocation(fromList)) return fromList;
		} catch {
			/* RAM lookup only */
		}

		const fromHistory = await this.pullHistoryThenFind(chatId, id);
		if (extractWhatsAppLocation(fromHistory)) return fromHistory;

		const fromPhone = await this.requestMessageFromPhone(chatId, id);
		if (extractWhatsAppLocation(fromPhone)) return fromPhone;

		return this.messageWithLocation(this.findMessage(id)) || loaded || located;
	}

	private messageWithLocation(
		message: NormalizedWhatsAppMessage | null,
	): NormalizedWhatsAppMessage | null {
		if (!message) return null;
		const location = message.location || extractWhatsAppLocation(message);
		return location ? { ...message, location } : message;
	}

	private loadMessageJids(chatId: string): string[] {
		const raw = String(chatId || '').trim();
		const ids = new Set<string>();
		const add = (value: string | null | undefined) => {
			const v = String(value || '').trim();
			if (v) ids.add(v);
		};
		add(raw);
		add(normalizeInboxJid(raw));
		add(toBaileysJid(raw));
		add(toBaileysJid(normalizeInboxJid(raw)));
		for (const extra of this.collectMessageLookupIds(raw)) add(extra);
		return [...ids];
	}

	private async loadMessageFromSocket(
		chatId: string,
		providerMessageId: string,
	): Promise<NormalizedWhatsAppMessage | null> {
		const sock = this.socket;
		if (!sock || this.state !== 'connected') return null;
		for (const jid of this.loadMessageJids(chatId)) {
			if (typeof sock.loadMessage !== 'function') break;
			try {
				const raw = await sock.loadMessage(jid, providerMessageId);
				const normalized = raw ? this.normalizeWaMessage(raw) : null;
				if (normalized) {
					this.rememberMessage(normalized, raw);
					if (extractWhatsAppLocation(normalized)) {
						return this.messageWithLocation(normalized);
					}
				}
			} catch {
				/* try the next JID shape */
			}
		}
		return null;
	}

	private async requestMessageFromPhone(
		chatId: string,
		providerMessageId: string,
	): Promise<NormalizedWhatsAppMessage | null> {
		const sock = this.socket;
		if (!sock || this.state !== 'connected') return null;
		if (typeof sock.requestPlaceholderResend !== 'function') return null;
		const remembered = this.findRememberedMessage(providerMessageId);
		const raw = this.rawByMessageId.get(providerMessageId);
		const fromMe = Boolean(raw?.key?.fromMe ?? remembered?.fromMe);
		const jids = this.loadMessageJids(chatId || remembered?.chatId || raw?.key?.remoteJid);
		let requested = false;
		for (const jid of jids) {
			try {
				await sock.requestPlaceholderResend({
					remoteJid: toBaileysJid(jid) || jid,
					id: providerMessageId,
					fromMe,
					participant: raw?.key?.participant || undefined,
				});
				requested = true;
				break;
			} catch {
				/* try the next JID shape */
			}
		}
		if (!requested) return null;
		await waitMs(2000);
		return this.messageWithLocation(this.findMessage(providerMessageId));
	}

	private historyAnchorForChat(chatId: string): { key: any; timestamp: number } | null {
		const ids = this.collectMessageLookupIds(chatId);
		let oldest: NormalizedWhatsAppMessage | null = null;
		let newest: NormalizedWhatsAppMessage | null = null;
		for (const id of ids) {
			const bucket = this.messagesByChat.get(id);
			if (!bucket) continue;
			for (const msg of bucket.values()) {
				const ts = msg.timestamp?.getTime?.() || 0;
				if (!oldest || ts < (oldest.timestamp?.getTime?.() || 0)) oldest = msg;
				if (!newest || ts > (newest.timestamp?.getTime?.() || 0)) newest = msg;
			}
		}
		const pick = oldest || newest;
		if (!pick) return null;
		const raw = this.rawByMessageId.get(pick.providerMessageId);
		const key = raw?.key || {
			remoteJid: toBaileysJid(pick.chatId) || pick.chatId,
			id: pick.providerMessageId,
			fromMe: pick.fromMe,
		};
		const timestamp =
			Number(raw?.messageTimestamp) ||
			Math.floor((pick.timestamp?.getTime?.() || Date.now()) / 1000);
		if (!key?.id || !key?.remoteJid) return null;
		return { key, timestamp };
	}

	private async pullHistoryThenFind(
		chatId: string,
		providerMessageId: string,
	): Promise<NormalizedWhatsAppMessage | null> {
		const sock = this.socket;
		if (!sock || this.state !== 'connected') return null;
		if (typeof sock.fetchMessageHistory !== 'function') return null;
		const anchor = this.historyAnchorForChat(chatId);
		if (!anchor) return null;
		try {
			await sock.fetchMessageHistory(30, anchor.key, anchor.timestamp);
		} catch {
			return null;
		}
		await waitMs(1500);
		return this.messageWithLocation(this.findMessage(providerMessageId));
	}

	private findRememberedMessage(providerMessageId: string): NormalizedWhatsAppMessage | null {
		for (const bucket of this.messagesByChat.values()) {
			const found = bucket.get(providerMessageId);
			if (found) return found;
		}
		return null;
	}

	private ingestReaction(raw: any): boolean {
		const content = unwrapMessageContent(raw?.message);
		const reaction = content?.reactionMessage;
		const targetId = String(reaction?.key?.id || '').trim();
		if (!targetId) return false;
		const emoji = String(reaction.text || '').trim();
		const actorKey = raw?.key?.fromMe
			? 'me'
			: String(raw?.key?.participant || raw?.key?.remoteJid || 'unknown');
		const current = this.reactionsByMessageId.get(targetId) || [];
		const withoutActor = current.filter((item) => item.actorKey !== actorKey);
		const next = emoji
			? [...withoutActor, { actorKey, emoji, timestamp: toDate(raw.messageTimestamp) }]
			: withoutActor;
		this.reactionsByMessageId.set(targetId, next);
		this.emit({
			type: 'message_reactions',
			providerMessageId: targetId,
			reactions: next,
		});
		return true;
	}

	private setOwnReaction(providerMessageId: string, emoji: string) {
		const current = this.reactionsByMessageId.get(providerMessageId) || [];
		const withoutMe = current.filter((item) => item.actorKey !== 'me');
		const next = emoji
			? [...withoutMe, { actorKey: 'me', emoji, timestamp: new Date() }]
			: withoutMe;
		this.reactionsByMessageId.set(providerMessageId, next);
		this.emit({
			type: 'message_reactions',
			providerMessageId,
			reactions: next,
		});
		return next;
	}

	private normalizeWaMessage(raw: any): NormalizedWhatsAppMessage | null {
		const remoteJid = jidOf(raw?.key?.remoteJid);
		const remoteJidAlt = jidOf(raw?.key?.remoteJidAlt);
		const id = String(raw?.key?.id || '').trim();
		if (!remoteJid || !id || !raw?.message) return null;
		if (isStatusBroadcastJid(remoteJid)) return null;

		const content = unwrapMessageContent(raw.message);
		if (isControlOnlyContent(content)) return null;
		const type = detectType(content);
		const text = messageText(content) || null;
		const contextInfo = contextInfoOf(content);
		const quoted = contextInfo?.stanzaId || null;
		const attachments = [];
		if (['image', 'video', 'audio', 'ptt', 'document', 'sticker'].includes(type)) {
			const media =
				content.imageMessage ||
				content.videoMessage ||
				content.audioMessage ||
				content.documentMessage ||
				content.stickerMessage;
			attachments.push({
				type,
				mimeType: media?.mimetype || null,
				fileName: media?.fileName || media?.caption || null,
				fileSizeBytes: Number(media?.fileLength) || null,
				providerMediaId: id,
			});
		}
		if (
			type === 'text' &&
			!String(text || '')
				.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\u00AD]/g, '')
				.trim() &&
			!attachments.length
		) {
			return null;
		}

		const fromMe = Boolean(raw?.key?.fromMe);
		// Prefer stable phone JID when Baileys provides remoteJidAlt (LID primary).
		const chatId =
			remoteJid.endsWith('@lid') || remoteJid.endsWith('@hosted.lid')
				? remoteJidAlt &&
					(remoteJidAlt.endsWith('@c.us') || remoteJidAlt.endsWith('@s.whatsapp.net'))
					? remoteJidAlt
					: remoteJid
				: remoteJid;
		if (
			(remoteJid.endsWith('@lid') || remoteJid.endsWith('@hosted.lid')) &&
			remoteJidAlt &&
			(remoteJidAlt.endsWith('@c.us') || remoteJidAlt.endsWith('@s.whatsapp.net'))
		) {
			this.rememberLidMapping(remoteJid, remoteJidAlt);
		}

		return {
			providerMessageId: id,
			chatId,
			senderWaId: raw?.key?.participant || (fromMe ? null : chatId),
			fromMe,
			type,
			text,
			timestamp: toDate(raw.messageTimestamp),
			timestampReliable: Boolean(raw.messageTimestamp),
			quotedProviderMessageId: quoted,
			isForwarded: Boolean(
				contextInfo?.isForwarded || Number(contextInfo?.forwardingScore) > 0,
			),
			// Never use your own pushName to title the peer conversation.
			contactName: fromMe ? null : raw.pushName || null,
			attachments,
			location: extractWhatsAppLocation({ type, raw }),
			raw,
		};
	}

	async connect(phoneNumber?: string) {
		this.closing = false;
		this.phoneNumberHint = phoneNumber ? String(phoneNumber).replace(/\D/g, '') : null;
		if (this.opening) return this.opening;
		if (this.socket && this.state === 'connected') return;
		if (this.socket && ['connecting', 'qr_pending'].includes(this.state)) return;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.qr = null;
		this.pairingCode = null;
		this.setState('connecting');
		await this.openSocket();
	}

	private async openSocket() {
		if (this.opening) return this.opening;
		this.opening = this.openSocketOnce().finally(() => {
			this.opening = null;
		});
		return this.opening;
	}

	private async openSocketOnce() {
		const baileys = await loadBaileysModule();
		const {
			default: makeWASocket,
			useMultiFileAuthState,
			DisconnectReason,
			Browsers,
		} = baileys as any;

		await fs.mkdir(this.sessionDir(), { recursive: true });
		const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir());
		const version = await resolveBaileysSocketVersion(baileys);

		this.socketOpened = false;
		const generation = ++this.socketGeneration;
		const previous = this.socket;
		this.socket = null;
		if (previous) {
			try {
				previous.end?.(undefined);
			} catch {
				/* ignore */
			}
			await new Promise((resolve) => setTimeout(resolve, 400));
		}

		const socket = makeWASocket({
			auth: state,
			version,
			printQRInTerminal: false,
			markOnlineOnConnect: false,
			syncFullHistory: shouldSyncFullHistory(),
			connectTimeoutMs: 60_000,
			browser: Browsers?.ubuntu?.('Chrome') || Browsers?.macOS?.('Chrome') || ['Ubuntu', 'Chrome', '22.04.4'],
		});
		this.socket = socket;

		socket.ev.on('creds.update', saveCreds);

		socket.ev.on('connection.update', async (update: any) => {
			if (this.closing) return;
			if (generation !== this.socketGeneration || this.socket !== socket) return;
			if (update.qr) {
				try {
					this.qr = await qrcode.toDataURL(String(update.qr), { margin: 1, width: 320 });
				} catch {
					this.qr = String(update.qr);
				}
				this.pairingCode = null;
				this.setState('qr_pending');
				this.emit({ type: 'qr', qr: this.qr });
			}

			if (update.connection === 'open') {
				this.reconnectAttempt = 0;
				this.socketOpened = true;
				this.qr = null;
				this.pairingCode = null;
				this.connectedAtMs = Date.now();
				const fullId = String(socket.user?.id || '');
				const phone = fullId.split(':')[0] || this.phoneNumberHint || undefined;
				this.setState('connected', { phoneNumber: phone });
				return;
			}

			if (update.connection === 'close') {
				if (this.socket === socket) this.socket = null;
				if (this.closing) return;
				const err = update?.lastDisconnect?.error;
				const statusCode = Number(err?.output?.statusCode || err?.data?.reason || 0);
				const kind = classifyBaileysDisconnect(update, DisconnectReason, {
					sessionHadOpened: this.socketOpened,
				});
				this.logger.warn(
					`Baileys connection closed for ${this.accountId} (${kind}, code=${statusCode || 'n/a'})`,
				);
				if (kind === 'logged_out') {
					this.setState('error', {
						error: 'WhatsApp logged out this linked device. Scan the QR again.',
					});
					this.emit({
						type: 'session_invalid',
						reason: 'WhatsApp logged out this linked device. Scan the QR again.',
					});
					return;
				}
				if (kind === 'replaced') {
					this.logger.warn(
						`WhatsApp session replaced for ${this.accountId}; waiting before a single reconnect.`,
					);
					this.setState('disconnected', {
						reason: 'session_replaced',
						error: 'This linked device signed in from another connection. Reconnecting once…',
					});
					this.scheduleReconnect(8_000);
					return;
				}
				if (statusCode === 515) {
					this.setState('connecting');
					this.scheduleReconnect(1_500);
					return;
				}
				this.setState('disconnected', {
					reason: kind === 'phone_closed' ? 'phone_closed' : 'connection_lost',
					error:
						kind === 'phone_closed'
							? 'WhatsApp on the phone looks closed or offline. Open WhatsApp and keep it in the foreground.'
							: undefined,
				});
				const handshakeFailure = /connection failure/i.test(String(err?.message || ''));
				this.scheduleReconnect(handshakeFailure ? 5_000 : 0);
			}
		});

		socket.ev.on('messages.upsert', async (upsert: any) => {
			const type = String(upsert?.type || 'notify');
			const list = Array.isArray(upsert?.messages) ? upsert.messages : [];
			// notify = live while online. append / other types are usually store /
			// history dumps, except a recent fromMe echo from the phone app.
			for (const raw of list) {
				if (this.rememberStatus(raw)) continue;
				if (this.ingestReaction(raw)) continue;
				const normalized = this.normalizeWaMessage(raw);
				if (!normalized) continue;
				const fromHistory = isHistoryMessageUpsert(type, raw);
				if (fromHistory) {
					(normalized as any).__fromHistory = true;
					if (normalized.raw && typeof normalized.raw === 'object') {
						normalized.raw = { ...normalized.raw, __fromHistory: true };
					}
				}
				this.rememberMessage(normalized, raw);
				if (
					fromHistory &&
					this.recentHistoryMessageIds.has(normalized.providerMessageId)
				) {
					continue;
				}
				this.emit({ type: 'message', message: normalized });
			}
		});

		socket.ev.on('messages.update', async (updates: any[]) => {
			if (!Array.isArray(updates)) return;
			for (const item of updates) {
				const providerMessageId = String(item?.key?.id || '').trim();
				if (!providerMessageId) continue;
				const status = mapBaileysMessageStatus(item?.update?.status);
				if (status) {
					this.emit({ type: 'message_status', providerMessageId, status });
				}
			}
		});

		socket.ev.on('chats.upsert', (chats: any[]) => {
			for (const chat of chats || []) {
				const id = jidOf(chat?.id);
				if (!id) continue;
				const incoming = Number(chat.unreadCount);
				const prev = Number(this.chats.get(id)?.unreadCount) || 0;
				this.rememberChat(id, {
					name: extractChatDisplayName(chat),
					t: Number(chat.conversationTimestamp) || Number(chat.t) || 0,
					unreadCount: Number.isFinite(incoming) && incoming > 0 ? incoming : prev,
				});
			}
		});

		socket.ev.on('chats.update', (chats: any[]) => {
			for (const chat of chats || []) {
				const id = jidOf(chat?.id);
				if (!id) continue;
				const prev = Number(this.chats.get(id)?.unreadCount) || 0;
				const applied = applyLiveChatUnread(prev, chat.unreadCount);
				this.rememberChat(id, {
					name: extractChatDisplayName(chat) || this.chats.get(id)?.name || null,
					t: Number(chat.conversationTimestamp) || Number(chat.t) || this.chats.get(id)?.t || 0,
					unreadCount: applied.next,
				});
				if (applied.phoneRead) {
					this.emit({
						type: 'chat_unread',
						chatId: id,
						unreadCount: 0,
					});
				}
			}
		});

		socket.ev.on('contacts.upsert', (contacts: any[]) => {
			for (const contact of contacts || []) this.rememberContact(contact);
		});

		socket.ev.on('contacts.update', (contacts: any[]) => {
			for (const contact of contacts || []) this.rememberContact(contact);
		});

		socket.ev.on('lid-mapping.update', (mapping: any) => {
			this.rememberLidMapping(mapping?.lid, mapping?.pn);
		});

		// Optional history dump on link (Baileys versions that emit it).
		socket.ev.on('messaging-history.set', (data: any) => {
			const chats = Array.isArray(data?.chats) ? data.chats : [];
			const messages = Array.isArray(data?.messages) ? data.messages : [];
			const contacts = Array.isArray(data?.contacts) ? data.contacts : [];
			const lidPnMappings = Array.isArray(data?.lidPnMappings) ? data.lidPnMappings : [];
			for (const mapping of lidPnMappings) {
				this.rememberLidMapping(mapping?.lid, mapping?.pn);
			}
			for (const contact of contacts) this.rememberContact(contact);
			for (const chat of chats) {
				const id = jidOf(chat?.id);
				if (!id) continue;
				const contactName = this.contactDisplayName(id);
				this.rememberChat(id, {
					name: extractChatDisplayName(chat) || contactName || null,
					t: Number(chat.conversationTimestamp) || 0,
					unreadCount: Number(chat.unreadCount) || 0,
				});
			}
			const historyMessages: NormalizedWhatsAppMessage[] = [];
			for (const raw of messages) {
				if (this.rememberStatus(raw)) continue;
				if (this.ingestReaction(raw)) continue;
				const normalized = this.normalizeWaMessage(raw);
				if (!normalized) continue;
				// Mark history so sync persists without unread spam / push flood.
				(normalized as any).__fromHistory = true;
				if (normalized.raw && typeof normalized.raw === 'object') {
					normalized.raw = { ...normalized.raw, __fromHistory: true };
				}
				this.rememberMessage(normalized, raw);
				this.rememberHistoryMessageId(normalized.providerMessageId);
				historyMessages.push(normalized);
			}
			this.ensureChatsFromMessages();
			this.historySyncChunks += 1;
			this.logger.log(
				`Baileys history set for ${this.accountId}: chunk=${this.historySyncChunks} chats=${chats.length} messages=${messages.length} contacts=${contacts.length}`,
			);
			this.emit({
				type: 'history_sync',
				chats: chats.length,
				messages: historyMessages.length,
				payload: historyMessages,
			});
		});

		if (this.phoneNumberHint && typeof socket.requestPairingCode === 'function') {
			try {
				const code = await socket.requestPairingCode(this.phoneNumberHint);
				this.pairingCode = String(code || '');
				if (this.pairingCode) {
					this.setState('qr_pending');
					this.emit({ type: 'pairing_code', code: this.pairingCode });
				}
			} catch (error) {
				this.logger.warn(
					`Baileys pairing code failed for ${this.accountId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}
	}

	private scheduleReconnect(minDelayMs = 0) {
		if (this.closing || this.reconnectTimer || this.opening) return;
		this.reconnectAttempt += 1;
		if (this.reconnectAttempt > 12) {
			this.setState('error', {
				error: 'WhatsApp reconnect failed repeatedly. Reconnect from the dashboard.',
			});
			return;
		}
		const delay = Math.max(minDelayMs, Math.min(60_000, 2_000 * this.reconnectAttempt));
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (this.closing || this.opening) return;
			this.setState('connecting');
			void this.openSocket().catch((error) => {
				this.logger.warn(
					`Baileys reconnect failed for ${this.accountId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				this.scheduleReconnect();
			});
		}, delay);
		this.reconnectTimer.unref?.();
	}

	async disconnect() {
		this.closing = true;
		this.socketGeneration += 1;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		try {
			this.socket?.end?.(undefined);
		} catch {
			/* ignore */
		}
		this.socket = null;
		this.qr = null;
		this.pairingCode = null;
		this.connectedAtMs = 0;
		this.socketOpened = false;
		this.setState('disconnected');
	}

	async logout() {
		this.closing = true;
		this.socketGeneration += 1;
		try {
			await this.socket?.logout?.();
		} catch {
			/* ignore */
		}
		try {
			await fs.rm(this.sessionDir(), { recursive: true, force: true });
		} catch {
			/* ignore */
		}
		this.socket = null;
		this.chats.clear();
		this.contacts.clear();
		this.lidToPn.clear();
		this.groupSubjectCache.clear();
		this.newsletterNameCache.clear();
		this.avatarUrlCache.clear();
		this.messagesByChat.clear();
		this.rawByMessageId.clear();
		this.qr = null;
		this.pairingCode = null;
		this.connectedAtMs = 0;
		this.socketOpened = false;
		this.historySyncChunks = 0;
		this.recentHistoryMessageIds.clear();
		this.setState('disconnected');
	}

	async getChats(limit = 50) {
		this.ensureChatsFromMessages();
		const count = Math.min(Math.max(Number(limit) || 50, 1), 1000);
		const list = [...this.chats.values()]
			.sort((a, b) => Number(b.t || 0) - Number(a.t || 0))
			.slice(0, count);
		// Fill missing titles / channel pictures before CRM sync.
		let newsletterFetches = 0;
		for (const chat of list) {
			const id = String(chat?.id?._serialized || '');
			if (!id) continue;
			const current = String(chat.name || '').trim();
			const fromContact = this.contactDisplayName(id);
			if ((!current || isWeakDisplayName(current, id)) && fromContact) {
				chat.name = fromContact;
			}
			if (id.endsWith('@g.us') && (!chat.name || isWeakDisplayName(chat.name, id))) {
				const subject = await this.fetchGroupSubject(id);
				if (subject) chat.name = subject;
			}
			if (id.endsWith('@newsletter')) {
				const missingName = !chat.name || isWeakDisplayName(String(chat.name), id);
				const missingPicture = !String(chat.imgUrl || chat?.profilePicThumbObj?.eurl || '').trim();
				if (!missingName && !missingPicture) continue;
				if (!this.newsletterNameCache.has(id) && newsletterFetches >= 20) continue;
				if (!this.newsletterNameCache.has(id)) newsletterFetches += 1;
				const meta = await this.fetchNewsletterMetadata(id);
				if (meta.name) chat.name = meta.name;
				if (meta.pictureUrl) this.attachChatPicture(id, meta.pictureUrl);
			}
		}
		return list;
	}

	async getMessages(
		chatId: string,
		options: { limit?: number; before?: string; after?: string; aliases?: string[] } = {},
	) {
		const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
		const ids = this.collectMessageLookupIds(chatId, options.aliases);
		const merged = new Map<string, NormalizedWhatsAppMessage>();
		for (const id of ids) {
			const bucket = this.messagesByChat.get(id);
			if (!bucket) continue;
			for (const [key, value] of bucket) merged.set(key, value);
		}
		let list = [...merged.values()].sort(
			(a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
		);
		const beforeId = String(options.before || '').trim();
		if (beforeId) {
			const beforeMsg = list.find((item) => item.providerMessageId === beforeId);
			if (!beforeMsg) return [];
			const beforeTs = beforeMsg.timestamp.getTime();
			list = list.filter(
				(item) =>
					item.timestamp.getTime() < beforeTs ||
					(item.timestamp.getTime() === beforeTs &&
						item.providerMessageId !== beforeId),
			);
		}
		const afterId = String(options.after || '').trim();
		if (afterId) {
			const afterMsg = list.find((item) => item.providerMessageId === afterId);
			if (afterMsg) {
				const afterTs = afterMsg.timestamp.getTime();
				list = list.filter((item) => item.timestamp.getTime() > afterTs);
			}
		}
		return list.slice(-limit);
	}

	/** LID and @c.us are often stored in different memory buckets for the same person. */
	private collectMessageLookupIds(chatId: string, aliases: string[] = []): string[] {
		const seed = [chatId, ...(aliases || [])].map(String).filter(Boolean);
		const ids = new Set<string>();
		const add = (value: string | null | undefined) => {
			const raw = String(value || '').trim();
			if (!raw) return;
			ids.add(raw);
			const normalized = normalizeInboxJid(raw);
			if (normalized) ids.add(normalized);
			if (raw.endsWith('@c.us')) {
				ids.add(`${raw.slice(0, -'@c.us'.length)}@s.whatsapp.net`);
			}
			if (normalized.endsWith('@c.us')) {
				ids.add(`${normalized.slice(0, -'@c.us'.length)}@s.whatsapp.net`);
			}
		};
		for (const id of seed) add(id);
		for (const id of [...ids]) {
			const contact = this.contacts.get(id);
			add(contact?.lid || null);
			const digits =
				this.lidToPn.get(id) ||
				contact?.phoneNumber ||
				null;
			if (digits) {
				add(`${digits}@c.us`);
				add(`${digits}@s.whatsapp.net`);
			}
		}
		for (const id of [...ids]) {
			const user = id.split('@')[0]?.split(':')[0] || '';
			if (!user) continue;
			for (const [lid, phone] of this.lidToPn) {
				if (phone === user) add(lid);
			}
		}
		return [...ids];
	}

	async getContacts() {
		return [...this.contacts.values()].map((contact) => ({
			id: { _serialized: contact.id },
			name: contact.name || contact.notify || null,
			pushname: contact.notify || null,
			number: contact.phoneNumber || null,
		}));
	}

	async getProfilePictureUrl(chatId: string): Promise<string | null> {
		const id = jidOf(chatId) || String(chatId || '').trim();
		if (!id) return null;
		const cached = this.avatarUrlCache.get(id);
		if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) {
			return cached.url;
		}
		if (!this.socket || this.state !== 'connected') {
			return cached?.url || null;
		}
		if (id.endsWith('@newsletter')) {
			const meta = await this.fetchNewsletterMetadata(id);
			return meta.pictureUrl;
		}
		try {
			const jid = toBaileysJid(id) || id;
			const url = await this.socket.profilePictureUrl(jid, 'preview');
			const next = String(url || '').trim() || null;
			this.avatarUrlCache.set(id, { url: next, at: Date.now() });
			return next;
		} catch {
			this.avatarUrlCache.set(id, { url: null, at: Date.now() });
			return cached?.url || null;
		}
	}

	async resolveContactIdentity(chatId: string) {
		const id = jidOf(chatId) || String(chatId || '').trim();
		if (!id) return null;

		if (id.endsWith('@newsletter')) {
			const existing =
				this.contactDisplayName(id) ||
				(() => {
					const chatName = String(this.chats.get(id)?.name || '').trim();
					return chatName && !isWeakDisplayName(chatName, id) ? chatName : null;
				})();
			if (existing) return { phoneNumber: null, name: existing };
			const fetched = await this.fetchNewsletterName(id);
			return fetched ? { phoneNumber: null, name: fetched } : null;
		}

		let phoneNumber: string | null = this.lidToPn.get(id) || this.contacts.get(id)?.phoneNumber || null;

		if (
			!phoneNumber &&
			(id.endsWith('@lid') || id.endsWith('@hosted.lid')) &&
			this.socket?.signalRepository?.lidMapping?.getPNForLID
		) {
			try {
				const pnJid = await this.socket.signalRepository.lidMapping.getPNForLID(
					id.endsWith('@hosted.lid') ? id : toBaileysJid(id) || id,
				);
				const digits = String(pnJid || '')
					.split('@')[0]
					.split(':')[0]
					.replace(/\D/g, '');
				if (digits) {
					phoneNumber = digits;
					this.rememberLidMapping(id, digits);
				}
			} catch {
				/* ignore */
			}
		}

		if (!phoneNumber && (id.endsWith('@c.us') || id.endsWith('@s.whatsapp.net'))) {
			const digits = id.split('@')[0].split(':')[0].replace(/\D/g, '');
			if (/^\d{8,15}$/.test(digits)) phoneNumber = digits;
		}

		const name = this.contactDisplayName(id) || (() => {
			const chatName = String(this.chats.get(id)?.name || '').trim();
			return chatName && !isWeakDisplayName(chatName, id, phoneNumber) ? chatName : null;
		})();

		if (!phoneNumber && !name) return null;
		return { phoneNumber, name };
	}

	async getGroups() {
		return [...this.chats.values()].filter((chat) =>
			String(chat?.id?._serialized || '').endsWith('@g.us'),
		);
	}

	async getGroupParticipants() {
		return [];
	}

	async sendText(chatId: string, text: string, quotedProviderMessageId?: string) {
		if (!this.socket || this.state !== 'connected') {
			throw new Error('WhatsApp account is not connected');
		}
		const jid = toBaileysJid(chatId);
		const payload: any = { text };
		if (quotedProviderMessageId) {
			payload.quoted = {
				key: { remoteJid: jid, id: quotedProviderMessageId },
				message: { conversation: '' },
			};
		}
		const result = await this.socket.sendMessage(jid, payload);
		const normalized = this.normalizeWaMessage(result);
		if (normalized) this.rememberMessage(normalized, result);
		return result;
	}

	async sendMedia(
		chatId: string,
		filePath: string,
		options: {
			caption?: string;
			fileName?: string;
			isVoice?: boolean;
			isSticker?: boolean;
			mimeType?: string | null;
			quotedProviderMessageId?: string;
		} = {},
	) {
		if (!this.socket || this.state !== 'connected') {
			throw new Error('WhatsApp account is not connected');
		}
		const jid = toBaileysJid(chatId);
		const lower = String(filePath || options.fileName || '').toLowerCase();
		let mime =
			String(options.mimeType || '').trim() ||
			(lower.endsWith('.jpg') || lower.endsWith('.jpeg')
				? 'image/jpeg'
				: lower.endsWith('.png')
					? 'image/png'
					: lower.endsWith('.webp')
						? 'image/webp'
						: lower.endsWith('.gif')
							? 'image/gif'
							: lower.endsWith('.mp4')
								? 'video/mp4'
								: lower.endsWith('.ogg') || lower.endsWith('.opus')
									? 'audio/ogg; codecs=opus'
									: lower.endsWith('.webm')
										? 'audio/webm; codecs=opus'
										: lower.endsWith('.mp3')
											? 'audio/mpeg'
											: lower.endsWith('.m4a')
												? 'audio/mp4'
												: '');
		let sendPath = filePath;
		let convertedVoice: Awaited<ReturnType<typeof ensureWhatsAppVoiceOgg>> | null = null;
		try {
			if (options.isVoice) {
				convertedVoice = await ensureWhatsAppVoiceOgg(filePath, {
					mimeType: mime,
					fileName: options.fileName,
				});
				sendPath = convertedVoice.filePath;
				mime = convertedVoice.mimeType;
			}
			const buffer = await fs.readFile(sendPath);
			let content: any;
			if (options.isSticker) {
				content = { sticker: buffer };
			} else if (options.isVoice || mime.startsWith('audio/')) {
				content = {
					audio: buffer,
					mimetype: mime || 'audio/ogg; codecs=opus',
					ptt: Boolean(options.isVoice),
					seconds: options.isVoice
						? guessVoiceSeconds(filePath, options.fileName)
						: undefined,
				};
			} else if (mime.startsWith('image/')) {
				content = { image: buffer, caption: options.caption || undefined, mimetype: mime };
			} else if (mime.startsWith('video/')) {
				content = { video: buffer, caption: options.caption || undefined, mimetype: mime };
			} else {
				content = {
					document: buffer,
					mimetype: mime || 'application/octet-stream',
					fileName: options.fileName || path.basename(filePath),
					caption: options.caption || undefined,
				};
			}
			const result = await this.socket.sendMessage(jid, content);
			const normalized = this.normalizeWaMessage(result);
			if (normalized) this.rememberMessage(normalized, result);
			return result;
		} finally {
			await convertedVoice?.cleanup?.();
		}
	}

	async sendReaction(providerMessageId: string, emoji: string | false) {
		if (!this.socket || this.state !== 'connected') {
			throw new Error('WhatsApp account is not connected');
		}
		const id = String(providerMessageId || '').trim();
		if (!id) throw new Error('Message is unavailable for reactions');
		const raw = this.rawByMessageId.get(id);
		const remembered = this.findRememberedMessage(id);
		const remoteJid = toBaileysJid(
			jidOf(raw?.key?.remoteJid) || remembered?.chatId || '',
		);
		if (!remoteJid) {
			throw new Error('Cannot react: message chat is unknown');
		}
		const text = emoji ? String(emoji) : '';
		await this.socket.sendMessage(remoteJid, {
			react: {
				text,
				key: {
					remoteJid: remoteJid,
					fromMe: Boolean(raw?.key?.fromMe ?? remembered?.fromMe),
					id: raw?.key?.id || id,
					participant: raw?.key?.participant || remembered?.senderWaId || undefined,
				},
			},
		});
		this.setOwnReaction(id, text);
		return { ok: true };
	}

	async getReactions(providerMessageId: string): Promise<NormalizedWhatsAppReaction[]> {
		return this.reactionsByMessageId.get(String(providerMessageId || '').trim()) || [];
	}

	async forwardMessage(chatId: string, providerMessageId: string, options: { rawHint?: any } = {}) {
		if (!this.socket || this.state !== 'connected') {
			throw new Error('WhatsApp account is not connected');
		}
		const id = String(providerMessageId || '').trim();
		if (!id) throw new Error('Message id is required');
		const stored = this.rawByMessageId.get(id);
		const hint = options.rawHint?.key && options.rawHint?.message ? options.rawHint : null;
		const raw =
			(stored?.key && stored?.message ? stored : null) ||
			reviveBaileysWaMessage(hint) ||
			(hint
				? {
						key: hint.key,
						message: hint.message,
						messageTimestamp: hint.messageTimestamp,
					}
				: null);
		if (!raw?.key || !raw?.message) {
			throw new Error('Original message is not available to forward');
		}
		const jid = toBaileysJid(chatId);
		const result = await this.socket.sendMessage(jid, { forward: raw });
		const normalized = this.normalizeWaMessage(result);
		if (normalized) this.rememberMessage(normalized, result);
		return result;
	}

	async deleteMessage(chatId: string, providerMessageId: string, mode: 'local' | 'everyone') {
		if (!this.socket || this.state !== 'connected') {
			throw new Error('WhatsApp account is not connected');
		}
		const id = String(providerMessageId || '').trim();
		const jid = toBaileysJid(chatId);
		const raw = this.rawByMessageId.get(id);
		const key = raw?.key || {
			remoteJid: jid,
			id,
			fromMe: mode === 'everyone',
		};
		if (mode === 'everyone') {
			await this.socket.sendMessage(jid, { delete: key });
		} else if (typeof this.socket.chatModify === 'function' && raw?.key) {
			try {
				await this.socket.chatModify(
					{
						deleteForMe: {
							deleteMedia: true,
							key: raw.key,
							timestamp: Number(raw.messageTimestamp || Date.now() / 1000),
						},
					},
					jid,
				);
			} catch {
				/* Local CRM hide still proceeds below. */
			}
		}
		const bucket = this.messagesByChat.get(chatId) || this.messagesByChat.get(jid);
		bucket?.delete(id);
		this.rawByMessageId.delete(id);
		return { ok: true };
	}

	async starMessage() {
		return { ok: false };
	}

	async pinMessage() {
		return { ok: false };
	}

	async getMessageInfo() {
		return null;
	}

	async markChatRead(chatId: string) {
		if (!this.socket || this.state !== 'connected') return;
		const jid = toBaileysJid(chatId);
		const bucket =
			this.messagesByChat.get(normalizeInboxJid(chatId)) ||
			this.messagesByChat.get(chatId) ||
			this.messagesByChat.get(jid);
		if (!bucket?.size) {
			this.rememberChat(normalizeInboxJid(chatId), { unreadCount: 0 });
			return;
		}
		const keys = [...bucket.values()]
			.filter((msg) => !msg.fromMe)
			.slice(-20)
			.map((msg) => ({
				remoteJid: jid,
				id: msg.providerMessageId,
				fromMe: false,
			}));
		if (keys.length && typeof this.socket.readMessages === 'function') {
			await this.socket.readMessages(keys);
		}
		this.rememberChat(normalizeInboxJid(chatId), { unreadCount: 0 });
	}

	async downloadMedia(providerMessageId: string, options: { rawHint?: any } = {}) {
		if (!this.socket || this.state !== 'connected') {
			throw new Error('WhatsApp account is not connected');
		}
		const id = String(providerMessageId || '').trim();
		if (!id) throw new Error('Media message id is required');

		let raw = this.rawByMessageId.get(id);
		const hint = options.rawHint;
		const hintedRaw =
			hint && (hint.protocol === 'baileys' || (hint.key && hint.message))
				? reviveBaileysWaMessage(hint) ||
					(hint.key && hint.message
						? {
								key: hint.key,
								message: hint.message,
								messageTimestamp: hint.messageTimestamp,
							}
						: null)
				: null;
		if (isStatusBroadcastJid(jidOf(hintedRaw?.key?.remoteJid)) && hintedRaw?.message) {
			raw = hintedRaw;
		}
		if (!raw?.message && hintedRaw?.message) {
			raw = hintedRaw;
		}
		if (!raw?.message) {
			// Last resort: scan in-memory chat buckets for this id.
			for (const bucket of this.messagesByChat.values()) {
				const hit = bucket.get(id);
				if (hit?.raw?.message) {
					raw = hit.raw;
					break;
				}
			}
		}
		if (!raw?.message) {
			throw new Error('Media message is not available in the current session cache');
		}

		const baileys = await loadBaileysModule();
		const { downloadMediaMessage, downloadContentFromMessage, getUrlFromDirectPath } =
			baileys as any;

		// Stories cannot be re-uploaded by the phone for linked devices (NOT_FOUND),
		// and Baileys waitForMsgMediaUpdate can emit TimeoutNegativeWarning (-1).
		if (
			!shouldSkipMediaReupload(raw) &&
			typeof this.socket.updateMediaMessage === 'function' &&
			raw.key
		) {
			try {
				const refreshed = await this.socket.updateMediaMessage(raw);
				if (refreshed?.message) {
					raw = refreshed;
					this.rawByMessageId.set(id, refreshed);
				}
			} catch (error) {
				this.logger.warn(
					`updateMediaMessage failed for ${id}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}

		const content = unwrapMessageContent(raw.message);
		attachFullMediaUrls(content, getUrlFromDirectPath);

		let buffer: Buffer | Uint8Array | null = null;
		const mediaNodes: Array<{ node: any; type: string }> = [
			{ node: content?.imageMessage, type: 'image' },
			{ node: content?.videoMessage, type: 'video' },
			{ node: content?.audioMessage, type: 'audio' },
			{ node: content?.documentMessage, type: 'document' },
			{ node: content?.stickerMessage, type: 'sticker' },
		].filter((item) => item.node?.directPath || item.node?.url);

		// Prefer the full media directPath. Baileys downloadMediaMessage treats
		// `thumbnailDirectPath` without `url` as a thumbnail-only download.
		if (typeof downloadContentFromMessage === 'function') {
			for (const candidate of mediaNodes) {
				try {
					const stream = await downloadContentFromMessage(
						{
							mediaKey: candidate.node.mediaKey,
							directPath: candidate.node.directPath,
							url: candidate.node.url,
						},
						candidate.type,
					);
					const chunks: Buffer[] = [];
					for await (const chunk of stream) {
						chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
					}
					buffer = Buffer.concat(chunks);
					if (buffer.length) break;
				} catch (error) {
					this.logger.warn(
						`downloadContentFromMessage(${candidate.type}) failed for ${id}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				}
			}
		}

		if (
			(!buffer || !(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array) || !buffer.length) &&
			typeof downloadMediaMessage === 'function'
		) {
			try {
				buffer = await downloadMediaMessage(
					raw,
					'buffer',
					{},
					shouldSkipMediaReupload(raw)
						? {}
						: {
								reuploadRequest: this.socket.updateMediaMessage?.bind(this.socket),
							},
				);
			} catch (error) {
				this.logger.warn(
					`downloadMediaMessage failed for ${id}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}

		if (!buffer || !(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array) || !buffer.length) {
			throw new Error('Baileys returned empty media');
		}
		// Keep a live copy so retries are cheap.
		this.rawByMessageId.set(id, raw);
		return { data: Buffer.from(buffer) };
	}

	async downloadStatus(providerStatusId: string, senderWaId?: string | null) {
		const raw = this.resolveStatusRaw(providerStatusId, senderWaId);
		if (!raw?.message) {
			throw new Error('Status media is not available in the current session cache');
		}
		const id = String(raw?.key?.id || providerStatusId || '').trim();
		return this.downloadMedia(id, { rawHint: raw });
	}

	async getStatuses() {
		this.pruneExpiredStatuses();
		return [...this.statusesById.values()];
	}

	async publishStatus() {
		throw new Error('Status publish is not enabled for the Baileys provider yet');
	}

	async viewStatus(statusId: string, senderWaId?: string) {
		if (!this.socket || this.state !== 'connected' || typeof this.socket.readMessages !== 'function') {
			return { ok: false };
		}
		const raw = this.resolveStatusRaw(statusId, senderWaId);
		const key = raw?.key;
		if (!key?.id) return { ok: false };
		await this.socket.readMessages([
			{
				remoteJid: 'status@broadcast',
				id: key.id,
				participant: key.participant || senderWaId || undefined,
				fromMe: Boolean(key.fromMe),
			},
		]);
		return { ok: true };
	}
}
