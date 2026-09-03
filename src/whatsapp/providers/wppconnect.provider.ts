import { Logger } from '@nestjs/common';
import {
	isServerlessRuntime,
	resolveChromeExecutablePath,
} from '../../common/chrome-executable';
import {
	NormalizedWhatsAppMessage,
	WhatsAppEmbeddedQuote,
	WhatsAppProvider,
	WhatsAppProviderCapabilities,
	WhatsAppProviderEvent,
	WhatsAppSendQuoteOptions,
} from './whatsapp-provider';
import {
	forceReleaseWppBrowserProfile,
	isBrowserAlreadyRunningError,
	resolveWppUserDataDir,
} from '../utils/whatsapp-browser-profile';
import {
	providerChatActivityMs,
	providerChatActivityRank,
	whatsAppTimestampToDate,
} from '../utils/whatsapp-time';
import { extractWhatsAppLocation } from '../utils/whatsapp-location';
import {
	dataUrlMime,
	ensureWhatsAppVoiceOgg,
	isValidWhatsAppVoiceOggFile,
	WHATSAPP_VOICE_MIME,
} from '../utils/whatsapp-voice-ogg';
import { enrichContactMessageNormalized, isContactMessageType } from '../utils/whatsapp-contact';

declare const require: any;

function serializedId(value: any): string | null {
	return value?._serialized || value?.id || (typeof value === 'string' ? value : null);
}

/** WA-JS states that no stored profile can recover from — a rescan is the only fix. */
const SESSION_INVALID_STATES: Record<string, string> = {
	UNPAIRED: 'WhatsApp removed this linked device. Scan the QR code again to reconnect.',
	UNPAIRED_IDLE:
		'WhatsApp removed this linked device. Scan the QR code again to reconnect.',
	CONFLICT:
		'This WhatsApp session was opened somewhere else and took over the link. Scan the QR code again.',
	DEPRECATED_VERSION:
		'WhatsApp Web rejected this client version. Scan the QR code again after the server updates.',
	TOS_BLOCK: 'WhatsApp blocked this account (terms of service).',
	SMB_TOS_BLOCK: 'WhatsApp blocked this business account (terms of service).',
};

function looksLikeMediaPayload(value: unknown) {
	const text = String(value || '');
	return (
		text.startsWith('/9j/') ||
		text.startsWith('data:') ||
		text.startsWith('iVBOR') ||
		text.startsWith('AAAA') ||
		text.length > 400
	);
}

function displayText(message: any, type: string) {
	const caption = message?.caption || message?.content || null;
	if (type === 'text' || type === 'chat') {
		const body = message?.body || caption;
		return looksLikeMediaPayload(body) ? null : body || null;
	}
	return caption && !looksLikeMediaPayload(caption) ? caption : null;
}

function detectFromMe(message: any): boolean {
	if (message?.fromMe || message?.id?.fromMe || message?.isMe) {
		return true;
	}
	const id = String(serializedId(message?.id) || message?.messageId || '');
	// WhatsApp serialized ids encode ownership as "true_<remote>_<id>..." / "false_..."
	if (/^true_/i.test(id)) return true;
	if (/^false_/i.test(id)) return false;
	return false;
}

export function isStatusMessage(message: any): boolean {
	if (message?.isStatusV3) return true;
	const ids = [
		serializedId(message?.id),
		serializedId(message?.id?.remote),
		serializedId(message?.chatId),
		serializedId(message?.from),
		serializedId(message?.to),
	].filter(Boolean);
	return ids.some(value => String(value).includes('status@broadcast'));
}

function normalizeMessage(message: any): NormalizedWhatsAppMessage {
	const fromMe = detectFromMe(message);
	const providerMessageId =
		serializedId(message?.id) ||
		String(message?.messageId || message?.rowId || '');
	const chatId =
		serializedId(message?.chatId) ||
		(fromMe
			? serializedId(message?.to) || serializedId(message?.from)
			: serializedId(message?.from) || serializedId(message?.to)) ||
		String(message?.from || message?.to || '');
	const type = String(message?.type || (message?.isMedia ? 'document' : 'text')).toLowerCase();
	const mediaTypes = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker']);
	let normalizedType = type === 'chat' ? 'text' : type === 'ptt' ? 'audio' : type;
	if (
		!isContactMessageType(normalizedType) &&
		(message?.vcard ||
			message?.vcardFormattedName ||
			(Array.isArray(message?.vcardList) && message.vcardList.length))
	) {
		normalizedType = 'contact';
	}
	if (isContactMessageType(normalizedType)) normalizedType = 'contact';

	const reliableTimestamp = whatsAppTimestampToDate(message?.timestamp ?? message?.t);

	const base: NormalizedWhatsAppMessage = {
		providerMessageId,
		chatId,
		senderWaId: serializedId(message?.author) || serializedId(message?.sender?.id) || null,
		fromMe,
		type: normalizedType,
		text:
			normalizedType === 'contact'
				? String(
						message?.vcardFormattedName ||
							message?.notifyName ||
							message?.body ||
							message?.caption ||
							'',
					).trim() || null
				: displayText(message, normalizedType),
		// Never invent "now" for history — that pushes months-old chats to the top as "18 min".
		timestamp: reliableTimestamp || new Date(0),
		timestampReliable: Boolean(reliableTimestamp),
		quotedProviderMessageId:
			serializedId(message?.quotedMsg?.id) ||
			serializedId(message?.quotedMsgId) ||
			serializedId(message?.quotedMessageId) ||
			null,
		isForwarded: Boolean(message?.isForwarded || Number(message?.forwardingScore) > 0),
		isStarred: Boolean(message?.star || message?.isStarred),
		contactName: message?.notifyName || message?.sender?.pushname || null,
		attachments: mediaTypes.has(type)
			? [
					{
						type: type === 'ptt' ? 'audio' : type,
						mimeType: message?.mimetype || null,
						fileName: (() => {
							const base = message?.filename || null;
							const durationSec = Number(
								message?.duration ?? message?.mediaData?.duration,
							);
							if (
								(type === 'ptt' || type === 'audio') &&
								Number.isFinite(durationSec) &&
								durationSec > 0
							) {
								if (base && /voice-\d+s/i.test(String(base))) return base;
								const fromBase = String(base || '').match(/(\.[a-z0-9]{2,5})$/i)?.[1];
								const ext =
									pathExtFromMime(message?.mimetype) || fromBase || '.ogg';
								return `voice-${Math.round(durationSec)}s${ext}`;
							}
							return base;
						})(),
						fileSizeBytes: message?.size || null,
						providerMediaId: providerMessageId,
					},
				]
			: [],
		location: extractWhatsAppLocation({ type: normalizedType, raw: message }),
		raw: message,
	};
	return enrichContactMessageNormalized(base);
}

function pathExtFromMime(mime?: string | null) {
	const value = String(mime || '').toLowerCase();
	if (value.includes('ogg')) return '.ogg';
	if (value.includes('webm')) return '.webm';
	if (value.includes('mpeg') || value.includes('mp3')) return '.mp3';
	if (value.includes('mp4') || value.includes('m4a')) return '.m4a';
	return '';
}

function normalizeSendQuoteOptions(
	quote?: string | WhatsAppSendQuoteOptions,
): WhatsAppSendQuoteOptions | null {
	if (!quote) return null;
	if (typeof quote === 'string') {
		const id = quote.trim();
		return id ? { quotedProviderMessageId: id } : null;
	}
	if (quote.quotedProviderMessageId || quote.embeddedQuote) return quote;
	return null;
}

function embeddedQuotePrefix(quote?: WhatsAppEmbeddedQuote | null): string {
	if (!quote) return '';
	const type = String(quote.type || 'text').toLowerCase();
	const text = String(quote.text || '').trim();
	if (text) return `↩ ${text}`;
	if (['image', 'sticker'].includes(type)) return '↩ Photo';
	if (type === 'video') return '↩ Video';
	if (['audio', 'ptt', 'voice'].includes(type)) return '↩ Voice message';
	if (type === 'document') return '↩ Document';
	return '↩ Message';
}

function withEmbeddedQuotePrefix(
	text: string,
	quote?: WhatsAppEmbeddedQuote | null,
): string {
	const prefix = embeddedQuotePrefix(quote);
	if (!prefix) return text;
	const body = String(text || '').trim();
	return body ? `${prefix}\n${body}` : prefix;
}

export class WppConnectProvider implements WhatsAppProvider {
	readonly name = 'wppconnect';
	readonly capabilities: WhatsAppProviderCapabilities = {
		qr: true,
		history: true,
		contacts: true,
		groups: true,
		groupParticipants: true,
		mediaDownload: true,
		statusFetch: true,
		statusPublish: true,
		statusView: true,
		reactions: true,
		messageActions: true,
	};

	private readonly logger = new Logger(WppConnectProvider.name);
	private client: any;
	private listeners: Array<(event: WhatsAppProviderEvent) => void | Promise<void>> = [];
	private qr: string | null = null;
	private pairingCode: string | null = null;
	private state = 'disconnected';
	private emitChain: Promise<void> = Promise.resolve();
	private authReconcileTimer: ReturnType<typeof setInterval> | null = null;
	private authReconcileStopTimer: ReturnType<typeof setTimeout> | null = null;
	private statusChangeTimer: ReturnType<typeof setTimeout> | null = null;
	/** Distinguishes "never linked yet" from "was linked and lost the pairing". */
	private everConnected = false;
	/** Chromium emits UNPAIRED while tearing down; that must not look like a logout. */
	private closing = false;
	private sessionInvalidTimer: ReturnType<typeof setTimeout> | null = null;
	/** Pause getMessages storms when WA Store/.get is broken or still hydrating. */
	private chatStoreCooldownUntil = 0;
	private chatStoreFailStreak = 0;
	/** wppconnect's deprecated wapi history loaders are gone from recent WA Web builds. */
	private legacyHistoryApiGone = false;
	/** Coalesce parallel getChats callers (bootstrap + reconcile + wait probes). */
	private getChatsInFlight: Promise<any[]> | null = null;
	/** Serialize history reads — parallel getMessages storms break ChatStore.get. */
	private getMessagesChain: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly accountId: string,
		private readonly tokenStore: any,
	) {}

	onEvent(listener: (event: WhatsAppProviderEvent) => void | Promise<void>) {
		this.listeners.push(listener);
	}

	private emit(event: WhatsAppProviderEvent) {
		for (const listener of this.listeners) {
			// Serialize listener work so Nest/TypeORM do not open dozens of DB
			// connections when WhatsApp floods onMessage during history sync.
			this.emitChain = this.emitChain
				.then(() => Promise.resolve(listener(event)))
				.catch(error =>
					this.logger.error(`WhatsApp provider event failed: ${event.type}`, error),
				);
		}
	}

	private emitStatusChanged() {
		if (this.statusChangeTimer) clearTimeout(this.statusChangeTimer);
		this.statusChangeTimer = setTimeout(() => {
			this.statusChangeTimer = null;
			this.emit({ type: 'status_changed' });
		}, 750);
	}

	async connect(phoneNumber?: string) {
		if (isServerlessRuntime()) {
			throw new Error(
				'WhatsApp (wppconnect) cannot run on Vercel/serverless. Deploy the API on a persistent VPS/PM2 host with Chrome/Chromium installed, and leave CHROME_EXECUTABLE_PATH empty or set it to a path that exists on that server.',
			);
		}

		let wppconnect: any;
		try {
			wppconnect = require('@wppconnect-team/wppconnect');
		} catch {
			throw new Error(
				'@wppconnect-team/wppconnect is not installed. Install it before connecting an account.',
			);
		}

		const executablePath = resolveChromeExecutablePath(
			process.env.CHROME_EXECUTABLE_PATH,
		);
		if (process.env.CHROME_EXECUTABLE_PATH && !executablePath) {
			this.logger.warn(
				`CHROME_EXECUTABLE_PATH is set but not found on this host (${process.env.CHROME_EXECUTABLE_PATH}). Falling back to auto-discovery.`,
			);
		}

		// A phone number here makes wppconnect skip QR generation entirely and
		// request an 8-character pairing code instead (WPP.conn.genLinkDeviceCodeForPhoneNumber).
		const normalizedPhone = phoneNumber ? String(phoneNumber).replace(/[^\d]/g, '') : '';
		this.qr = null;
		this.pairingCode = null;
		this.closing = false;
		this.clearSessionInvalidCheck();

		this.state = 'connecting';
		this.emit({ type: 'connection', status: this.state });
		// waitForLogin:false → create() returns once Chromium/WA-JS are up so HTTP
		// /connect does not hang while the phone is stuck on SYNCING.
		// deviceSyncTimeout:0 → do not auto-close the browser after 180s of sync.
		const createOptions = {
			session: this.accountId,
			folderNameToken:
				process.env.WHATSAPP_TOKEN_FOLDER ||
				process.env.WPPCONNECT_TOKEN_FOLDER ||
				'./tokens',
			tokenStore: this.tokenStore,
			headless: true,
			waitForLogin: false,
			autoClose: 0,
			deviceSyncTimeout: 0,
			disableWelcome: true,
			updatesLog: false,
			logQR: false,
			...(normalizedPhone ? { phoneNumber: normalizedPhone } : {}),
			puppeteerOptions: {
				...(executablePath ? { executablePath } : {}),
				userDataDir: resolveWppUserDataDir(this.accountId),
				// --disable-dev-shm-usage: Docker limits /dev/shm to 64MB by default, which
				// crashes Chromium's renderer under normal load; force it to use /tmp instead.
				args: [
					'--no-sandbox',
					'--disable-setuid-sandbox',
					'--disable-dev-shm-usage',
					'--disable-gpu',
				],
			},
			catchQR: (base64Qr: string, _ascii: string, _attempt: number, rawCode: string) => {
				this.publishQr(base64Qr, rawCode);
			},
			catchLinkCode: (code: string) => {
				this.publishLinkCode(code);
			},
			statusFind: (status: string) => {
				const connected = [
					'isLogged',
					'qrReadSuccess',
					'successChat',
					'chatsAvailable',
					'inChat',
				];
				if (connected.includes(String(status))) this.markConnected();
				if (
					['phoneNotConnected', 'browserClose', 'serverClose', 'autocloseCalled'].includes(
						String(status),
					)
				) {
					// Ignore closes we initiated, and startup blips while Chromium is
					// still launching — marking broken here caused reconnect storms.
					if (this.closing) {
						this.logger.debug(`WhatsApp statusFind: ${status} ignored (closing)`);
						return;
					}
					if (this.state === 'connecting' || this.state === 'qr_pending') {
						this.logger.warn(
							`WhatsApp statusFind: ${status} during ${this.state} — ignored`,
						);
						return;
					}
					this.logger.warn(`WhatsApp statusFind: ${status}`);
					void this.markSessionBroken(
						`WhatsApp Web closed (${status}). Reconnect the account from the dashboard.`,
					);
				}
			},
		};

		try {
			this.client = await wppconnect.create(createOptions);
		} catch (error) {
			if (!isBrowserAlreadyRunningError(error)) throw error;
			this.logger.warn(
				`Chromium profile locked for ${this.accountId}; releasing zombie browser and retrying once`,
			);
			await forceReleaseWppBrowserProfile(this.accountId);
			this.client = await wppconnect.create(createOptions);
		}

		this.client.onMessage((message: any) => {
			if (isStatusMessage(message)) {
				this.emitStatusChanged();
				return;
			}
			const normalized = normalizeMessage(message);
			// Outbound echoes must never inflate unread / create fake inbound rows.
			if (normalized.fromMe) return;
			if (normalized.providerMessageId && normalized.chatId) {
				this.emit({ type: 'message', message: normalized });
			}
		});
		if (typeof this.client.onAnyMessage === 'function') {
			this.client.onAnyMessage((message: any) => {
				if (isStatusMessage(message)) {
					this.emitStatusChanged();
					return;
				}
				const normalized = normalizeMessage(message);
				// Capture phone-side outbound so the CRM stays in sync, without unread.
				if (!normalized.fromMe || !normalized.providerMessageId || !normalized.chatId) {
					return;
				}
				this.emit({ type: 'message', message: normalized });
			});
		}
		this.client.onAck((ack: any) => {
			const value = Number(ack?.ack);
			const status =
				value <= 0 ? 'failed' : value === 1 ? 'sent' : value === 2 ? 'delivered' : value === 3 ? 'read' : 'played';
			const providerMessageId = serializedId(ack?.id);
			if (providerMessageId) {
				this.emit({ type: 'message_status', providerMessageId, status });
			}
		});
		if (typeof this.client.onPresenceChanged === 'function') {
			this.client.onPresenceChanged((presence: any) => {
				const chatId = serializedId(presence?.id) || String(presence?.id || '');
				if (!chatId) return;

				// Try to extract sender name from participant list for groups
				const participants = Array.isArray(presence?.participants) ? presence.participants : [];
				const firstParticipant = participants[0];
				const senderName = String(firstParticipant?.name || firstParticipant?.shortName || '');

				this.emit({
					type: 'presence',
					payload: {
						chatId,
						isOnline: Boolean(presence?.isOnline),
						isGroup: Boolean(presence?.isGroup),
						state: String(presence?.state || 'unavailable'),
						t: Number(presence?.t) || Date.now(),
						participants: participants.length ? participants : undefined,
						senderName,
						lastSeen: Number(presence?.lastSeen || 0),
					},
				});
			});
		}
		if (typeof this.client.onReactionMessage === 'function') {
			this.client.onReactionMessage((reaction: any) => {
				const messageId = serializedId(reaction?.msgId);
				if (!messageId) return;
				void this.getReactions(messageId)
					.then(reactions =>
						this.emit({
							type: 'message_reactions',
							providerMessageId: messageId,
							reactions,
						}),
					)
					.catch(error =>
						this.logger.warn(
							`Could not refresh reactions for ${messageId}: ${
								error instanceof Error ? error.message : String(error)
							}`,
						),
					);
			});
		}
		if (typeof this.client.onRevokedMessage === 'function') {
			this.client.onRevokedMessage((revoked: any) => {
				const messageId = serializedId(revoked?.refId);
				if (messageId) {
					this.emit({
						type: 'message_deleted',
						providerMessageId: messageId,
						mode: 'everyone',
					});
				}
			});
		}
		this.client.onStateChange((state: string) => {
			const value = String(state);
			if (['CONNECTED', 'MAIN', 'CONNECTED_PHONE'].includes(value)) {
				this.clearChatStoreCooldown();
				this.markConnected();
				return;
			}
			const invalidReason = SESSION_INVALID_STATES[value];
			// UNPAIRED is also the normal state of a fresh profile waiting for its
			// first scan, so only a session that was already live counts as lost.
			if (invalidReason && this.everConnected && !this.closing) {
				this.scheduleSessionInvalidCheck(invalidReason);
				return;
			}
			// Phone often stays on SYNCING for a long time after auth; treat as usable.
			if (['SYNCING', 'NORMAL', 'PAIRING'].includes(value)) {
				void this.client
					?.isAuthenticated?.()
					.then((ok: boolean) => {
						if (ok) this.markConnected();
					})
					.catch(() => undefined);
			}
		});
		if (typeof this.client.onInterfaceChange === 'function') {
			this.client.onInterfaceChange((state: any) => {
				const display = String(state?.displayInfo || state?.mode || state || '');
				if (/MAIN|NORMAL/i.test(display)) {
					this.clearChatStoreCooldown();
				}
			});
		}

		// If the session token is already valid, mark connected immediately so the
		// dashboard stops blocking on /connect while WhatsApp Web finishes SYNCING.
		try {
			const authenticated = await this.client.isAuthenticated?.();
			if (authenticated) {
				await this.markConnected();
			}
		} catch (error) {
			const detail = String(error || '');
			// WPP injects after page load — probing too early is normal noise.
			if (/WPP is not defined/i.test(detail)) {
				this.logger.debug(`WhatsApp auth probe waiting for WPP: ${detail}`);
			} else {
				this.logger.warn(`Could not probe WhatsApp auth state: ${detail}`);
			}
		}

		// Continue login/sync in the background — never await this in connect().
		void this.client
			.waitForLogin?.()
			.then((ok: boolean) => {
				if (ok) this.markConnected();
			})
			.catch((error: any) => {
				this.logger.warn(
					`waitForLogin ended: ${error?.message || error || 'unknown'}`,
				);
			});
		this.startAuthReconciliation();
	}

	private stopAuthReconciliation() {
		if (this.authReconcileTimer) {
			clearInterval(this.authReconcileTimer);
			this.authReconcileTimer = null;
		}
		if (this.authReconcileStopTimer) {
			clearTimeout(this.authReconcileStopTimer);
			this.authReconcileStopTimer = null;
		}
	}

	/** Phone may already be linked while WA Web is still on the QR/sync screen. */
	private startAuthReconciliation() {
		this.stopAuthReconciliation();
		const timeoutMs = Math.min(
			Math.max(
				Number(process.env.WHATSAPP_AUTH_RECONCILE_TIMEOUT_MS) || 5 * 60 * 1000,
				30_000,
			),
			15 * 60 * 1000,
		);
		const probe = async () => {
			if (this.state === 'connected') {
				this.stopAuthReconciliation();
				return;
			}
			try {
				const authenticated = await this.client?.isAuthenticated?.();
				if (authenticated) {
					await this.markConnected();
					return;
				}
				const connected = await this.client?.isConnected?.();
				if (connected) {
					await this.markConnected();
				}
			} catch {
				/* session still warming up */
			}
		};
		void probe();
		this.authReconcileTimer = setInterval(() => {
			void probe();
		}, 3000);
		this.authReconcileStopTimer = setTimeout(() => {
			void this.failIfStillConnecting(
				`WhatsApp connection timed out after ${Math.round(timeoutMs / 1000)}s. Restart the connection.`,
			);
		}, timeoutMs);
		// Pairing watchdogs must never be the reason the process cannot exit.
		this.authReconcileTimer.unref?.();
		this.authReconcileStopTimer.unref?.();
	}

	/**
	 * Avoid leaving accounts stuck forever on connecting/qr_pending when the
	 * browser session never reaches an authenticated state.
	 */
	private async failIfStillConnecting(reason: string) {
		this.stopAuthReconciliation();
		if (
			this.state === 'connected' ||
			this.state === 'disconnected' ||
			this.state === 'error'
		) {
			return;
		}
		const previous = this.state;
		this.logger.warn(
			`WhatsApp auth reconciliation failed for ${this.accountId} (was ${previous}): ${reason}`,
		);
		try {
			await this.client?.close?.();
		} catch {
			/* ignore close errors during timeout cleanup */
		}
		this.client = null;
		this.qr = null;
		this.pairingCode = null;
		this.state = 'error';
		this.emit({
			type: 'connection',
			status: this.state,
			error: reason,
		});
	}

	private async publishQr(base64Qr: string, rawCode?: string) {
		// During session restore WPP may emit a QR before auth settles. If the
		// client is already authenticated, promote to connected — never qr_pending.
		try {
			if (await this.client?.isAuthenticated?.()) {
				await this.markConnected();
				return;
			}
		} catch {
			// Not authenticated — expose the new QR below.
		}
		let value = String(base64Qr || '');
		if (!value.startsWith('data:image') && value.length > 64) {
			value = `data:image/png;base64,${value}`;
		}
		if (!value.startsWith('data:image') && rawCode) {
			try {
				const qrcode = require('qrcode');
				value = await qrcode.toDataURL(rawCode, { margin: 1, width: 320 });
			} catch {
				value = rawCode;
			}
		}
		if (!value || value === this.qr) return;
		this.qr = value;
		this.enterQrPending();
		this.emit({ type: 'qr', qr: value });
		this.emit({ type: 'connection', status: this.state });
	}

	private async publishLinkCode(code: string) {
		try {
			if (await this.client?.isAuthenticated?.()) {
				await this.markConnected();
				return;
			}
		} catch {
			// Not authenticated — expose the new code below.
		}
		const value = String(code || '').trim();
		if (!value || value === this.pairingCode) return;
		this.pairingCode = value;
		this.enterQrPending();
		this.emit({ type: 'pairing_code', code: value });
		this.emit({ type: 'connection', status: this.state });
	}

	/**
	 * WhatsApp Web is offering a scan screen. It reports UNPAIRED while doing so,
	 * which is correct rather than a lost pairing — wiping the profile here would
	 * destroy the very QR the user is about to scan.
	 */
	private enterQrPending() {
		this.state = 'qr_pending';
		this.everConnected = false;
		this.clearSessionInvalidCheck();
	}

	private async markConnected() {
		if (this.state === 'connected') return;
		this.clearChatStoreCooldown();
		this.clearSessionInvalidCheck();
		this.everConnected = true;
		this.state = 'connected';
		this.qr = null;
		this.pairingCode = null;
		this.stopAuthReconciliation();
		let phoneNumber: string | undefined;
		try {
			const host = await this.client?.getHostDevice?.();
			phoneNumber = host?.wid?.user || host?.id?.user;
		} catch {}
		this.emit({ type: 'connection', status: this.state, phoneNumber });
	}

	/** Chromium/WA Web page died while Nest still thought the session was connected. */
	static isSessionDeadError(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error || '');
		const stack = error instanceof Error ? error.stack || '' : '';
		return /detached Frame|Target closed|Session closed|Protocol error|Execution context was destroyed|Navigating frame was detached|page has been closed|Browser has been closed|Connection closed|Attempted to use detached Frame|Session closed\./i.test(
			`${message}\n${stack}`,
		);
	}

	/** Store/API broken for the whole session (cooldown is appropriate). */
	static isStoreBrokenError(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error || '');
		// Do NOT treat per-chat "undefined.get" / assertGetChat glitches as session-wide
		// store death — those are often one bad JID while listChats still works.
		return /Store is not ready|Chat store is not ready|main UI still syncing|cooling down/i.test(
			message,
		);
	}

	/**
	 * wppconnect still ships loadEarlierMessages / loadAndGetAllMessagesInChat, but
	 * they call wapi's `loadEarlierMsgs`, which recent WhatsApp Web builds dropped.
	 * Retrying them costs a 20s timeout per chat and buries the real failure in logs.
	 */
	static isLegacyHistoryApiGone(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error || '');
		return /loadEarlierMsgs is not a function/i.test(message);
	}

	/** Per-chat WA-JS glitch (missing Chat.get / assertGetChat) — try next alias. */
	static isTransientChatAccessError(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error || '');
		return /Cannot read properties of undefined \(reading ['"]?get['"]?\)|Cannot read property ['"]?get['"]? of undefined|is not a function|assertGetChat/i.test(
			message,
		);
	}

	/** Missing chat id only — must NOT cool down the whole account. */
	static isChatNotFoundError(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error || '');
		return /chat not found|No chat found/i.test(message);
	}

	/**
	 * WhatsApp Web Store/API glitch inside the page (often after WA Web updates or
	 * while the chat store is still hydrating). Page may still be alive — do not
	 * mark the whole session dead; callers should soft-fail and use DB cache.
	 */
	static isWhatsAppRuntimeError(error: unknown): boolean {
		return (
			WppConnectProvider.isStoreBrokenError(error) ||
			WppConnectProvider.isTransientChatAccessError(error) ||
			WppConnectProvider.isChatNotFoundError(error)
		);
	}

	private clearChatStoreCooldown() {
		this.chatStoreFailStreak = 0;
		this.chatStoreCooldownUntil = 0;
	}

	private tripChatStoreCooldown(reason: string) {
		this.chatStoreFailStreak += 1;
		const cooldownMs = Math.min(60_000, 10_000 * Math.max(1, this.chatStoreFailStreak));
		this.chatStoreCooldownUntil = Date.now() + cooldownMs;
		this.logger.warn(
			`Chat store cooldown ${Math.round(cooldownMs / 1000)}s for ${this.accountId}: ${reason}`,
		);
	}

	/** Soft delay while WA Web is still SYNCING — do not escalate fail streak. */
	private tripMainNotReadyBackoff(reason: string) {
		const cooldownMs = 4_000;
		this.chatStoreCooldownUntil = Math.max(this.chatStoreCooldownUntil, Date.now() + cooldownMs);
		this.logger.warn(
			`Chat store brief wait ${Math.round(cooldownMs / 1000)}s for ${this.accountId}: ${reason}`,
		);
	}

	private assertChatStoreAvailable(label: string) {
		const remaining = this.chatStoreCooldownUntil - Date.now();
		if (remaining <= 0) return;
		throw new Error(
			`WhatsApp chat store is not ready yet (cooling down ${Math.ceil(remaining / 1000)}s): ${label}`,
		);
	}

	/** Fast probe: ChatStore has at least one loaded chat model. */
	async isChatStoreHydrated(): Promise<boolean> {
		const page = this.client?.page;
		if (!page || this.state !== 'connected') return false;
		try {
			const count = await this.withTimeout(
				page.evaluate(() => {
					const Store = (window as any).Store;
					try {
						if (typeof Store?.Chat?.getModelsArray === 'function') {
							return Store.Chat.getModelsArray()?.length || 0;
						}
						if (Store?.Chat?.models) {
							const models = Store.Chat.models;
							if (Array.isArray(models)) return models.length;
							if (typeof models?.length === 'number') return models.length;
						}
					} catch {
						return 0;
					}
					// Store.Chat existing with 0 models is NOT hydrated — treating it
					// as ready caused 20–30s empty getMessages storms that crash Chromium.
					return 0;
				}),
				3_000,
				'isChatStoreHydrated',
			);
			return Number(count) > 0;
		} catch {
			return false;
		}
	}

	private clearSessionInvalidCheck() {
		if (!this.sessionInvalidTimer) return;
		clearTimeout(this.sessionInvalidTimer);
		this.sessionInvalidTimer = null;
	}

	/**
	 * Wiping the profile is destructive, so never act on a single state event:
	 * reconnects and shutdowns both flash UNPAIRED for a moment. Re-probe the live
	 * page after a delay and only give up when it is still unauthenticated.
	 */
	private scheduleSessionInvalidCheck(reason: string) {
		if (this.sessionInvalidTimer) return;
		this.sessionInvalidTimer = setTimeout(async () => {
			this.sessionInvalidTimer = null;
			if (this.closing || !this.client || this.state === 'connected') return;
			// A scan screen is already the recovery path — nothing left to wipe.
			if (this.state === 'qr_pending' || this.qr || this.pairingCode) return;
			try {
				if (await this.client.isAuthenticated?.()) return;
				const state = String((await this.client.getConnectionState?.()) || '');
				if (state && !SESSION_INVALID_STATES[state]) return;
			} catch {
				// A dead page cannot prove the pairing is gone — leave the profile alone.
				return;
			}
			await this.markSessionInvalid(reason);
		}, 15_000);
		this.sessionInvalidTimer.unref?.();
	}

	/** Pairing is gone for good — the caller wipes the profile and asks for a rescan. */
	private async markSessionInvalid(reason: string) {
		this.closing = true;
		this.clearSessionInvalidCheck();
		this.stopAuthReconciliation();
		if (this.statusChangeTimer) {
			clearTimeout(this.statusChangeTimer);
			this.statusChangeTimer = null;
		}
		this.everConnected = false;
		this.logger.error(`WhatsApp session invalidated for ${this.accountId}: ${reason}`);
		try {
			await this.client?.close?.();
		} catch {
			/* ignore close errors on a dead page */
		}
		this.client = null;
		this.qr = null;
		this.pairingCode = null;
		this.state = 'error';
		this.emit({ type: 'session_invalid', reason });
	}

	private async markSessionBroken(reason: string) {
		if (this.closing && this.state === 'error') return;
		this.closing = true;
		this.clearSessionInvalidCheck();
		this.stopAuthReconciliation();
		if (this.statusChangeTimer) {
			clearTimeout(this.statusChangeTimer);
			this.statusChangeTimer = null;
		}
		const previous = this.state;
		this.logger.error(
			`WhatsApp browser session broken for ${this.accountId} (was ${previous}): ${reason}`,
		);
		try {
			await this.client?.close?.();
		} catch {
			/* ignore close errors on a dead page */
		}
		this.client = null;
		this.qr = null;
		this.pairingCode = null;
		this.state = 'error';
		this.emit({
			type: 'connection',
			status: this.state,
			error: reason,
		});
	}

	private async rethrowIfSessionDead(label: string, error: unknown): Promise<never> {
		if (WppConnectProvider.isSessionDeadError(error)) {
			const friendly =
				'WhatsApp Web session died on the server (browser page closed). Reconnect the account, then try again.';
			await this.markSessionBroken(`${friendly} [${label}]`);
			throw new Error(friendly);
		}
		throw error instanceof Error ? error : new Error(String(error));
	}

	async disconnect() {
		this.closing = true;
		this.clearSessionInvalidCheck();
		this.stopAuthReconciliation();
		if (this.statusChangeTimer) {
			clearTimeout(this.statusChangeTimer);
			this.statusChangeTimer = null;
		}
		await this.client?.close?.();
		this.client = null;
		this.qr = null;
		this.pairingCode = null;
		this.state = 'disconnected';
		this.emit({ type: 'connection', status: this.state });
	}

	async logout() {
		try {
			await this.client?.logout?.();
		} finally {
			await this.tokenStore.removeToken(this.accountId);
			await this.disconnect();
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
		return Math.max(0, this.chatStoreCooldownUntil - Date.now());
	}

	resetChatStoreCooldown() {
		this.clearChatStoreCooldown();
	}

	/** Prefer attempting history when the session can already list chats. */
	async isHistoryReady() {
		if (this.state !== 'connected' || !this.client) return false;
		if (this.getChatStoreCooldownMs() > 0) return false;
		const mainReady = await this.waitForWhatsAppMainReady(1_200);
		if (mainReady) return true;
		// listChats often works before isMainReady() flips true. Allow history
		// attempts in that window so open-chat is not stuck behind a soft gate.
		try {
			const sample = await this.withTimeout(
				Promise.resolve(this.client.listChats?.({ count: 1 }) ?? []),
				5_000,
				'isHistoryReady.listChats',
			);
			return Array.isArray(sample);
		} catch {
			this.tripMainNotReadyBackoff('WhatsApp main not ready (history probe)');
			return false;
		}
	}

	/** WhatsApp orders the inbox by pinned first, then most recent activity. */
	private static sortChatsByActivity(chats: any[]): any[] {
		return [...chats].sort((a, b) => {
			const pinned = Number(Boolean(b?.pin)) - Number(Boolean(a?.pin));
			if (pinned) return pinned;
			const aRank = providerChatActivityRank(a);
			const bRank = providerChatActivityRank(b);
			// Message-backed activity must win over metadata-only group `t` bumps
			// so fresh links do not fill the sync window with silent groups.
			if (aRank.hasMessage !== bRank.hasMessage) {
				return aRank.hasMessage ? -1 : 1;
			}
			return bRank.ms - aRank.ms;
		});
	}

	async getChats(limit = 50) {
		if (this.state !== 'connected') {
			throw new Error('WhatsApp chat store is not ready yet');
		}
		// Cap high enough for large inboxes; metadata sync is cheap vs message hydrate.
		const count = Math.min(Math.max(Number(limit) || 50, 1), 1000);

		// Bootstrap, waitForInboxReady, and 30s reconcile used to stampede listChats /
		// getAllChats in parallel — ChatStore stays empty and every caller times out.
		if (this.getChatsInFlight) {
			const shared = await this.getChatsInFlight;
			return WppConnectProvider.sortChatsByActivity(shared).slice(0, count);
		}

		this.getChatsInFlight = this.fetchChatsFromStore()
			.finally(() => {
				this.getChatsInFlight = null;
			});
		const chats = await this.getChatsInFlight;
		return WppConnectProvider.sortChatsByActivity(chats).slice(0, count);
	}

	private async fetchChatsFromStore(): Promise<any[]> {
		const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				return await Promise.race([
					promise,
					new Promise<T>((_, reject) => {
						timer = setTimeout(
							() => reject(new Error(`${label} timed out after ${ms}ms`)),
							ms,
						);
					}),
				]);
			} finally {
				if (timer) clearTimeout(timer);
			}
		};

		let lastError: unknown = new Error(
			'Could not load chats from WhatsApp — chat list was empty after retries. The session may still be syncing; try again shortly.',
		);
		let sawEmptyStore = false;

		const tryListChats = async (options?: Record<string, unknown>) => {
			const client = this.client;
			if (!client || this.state !== 'connected') {
				throw new Error('WhatsApp chat store is not ready yet');
			}
			if (typeof client.listChats !== 'function') return null;
			const listed = await withTimeout(
				client.listChats(options || { ignoreGroupMetadata: true }),
				12_000,
				'listChats',
			);
			if (Array.isArray(listed) && listed.length) return listed;
			if (Array.isArray(listed)) sawEmptyStore = true;
			return null;
		};

		// Prefer listChats only. Never fall back to deprecated getAllChats — it
		// stamps the renderer while ChatStore is empty and often ends in browserClose.
		for (let attempt = 1; attempt <= 2; attempt += 1) {
			try {
				const listed =
					(await tryListChats({ ignoreGroupMetadata: true })) ||
					(await tryListChats({ count: 300 }));
				if (listed?.length) return listed;
				lastError = new Error('WhatsApp chat store is not ready yet');
				if (Array.isArray(listed) || listed === null) sawEmptyStore = true;
			} catch (error) {
				lastError = error;
				if (WppConnectProvider.isSessionDeadError(error)) {
					await this.rethrowIfSessionDead('listChats', error);
				}
			}
			if (attempt < 2) {
				await new Promise((resolve) => setTimeout(resolve, 1200));
			}
		}

		// MAIN can be NORMAL while ChatStore is still hydrating. Returning [] lets
		// bootstrap/reconcile finish quietly so the UI can retry without error toasts.
		const mainReady = await this.waitForWhatsAppMainReady(1_500);
		if (mainReady || sawEmptyStore) {
			this.logger.warn(
				`getChats: MAIN ready but ChatStore still empty for ${this.accountId} — returning [] for retry`,
			);
			this.tripMainNotReadyBackoff('ChatStore empty during getChats');
			return [];
		}

		throw lastError instanceof Error
			? lastError
			: new Error(
					'Could not load chats from WhatsApp — chat list was empty after retries. The session may still be syncing; try again shortly.',
				);
	}

	private async fetchMessagesForChat(
		chatId: string,
		count: number,
		options: { before?: string; after?: string; loadEarlier?: boolean } = {},
	): Promise<any[]> {
		const target = String(chatId || '').trim();
		if (!target || !this.client) return [];

		const softClientCall = async <T>(
			label: string,
			run: () => Promise<T>,
			fallback: T,
		): Promise<T> => {
			try {
				return await this.withTimeout(run(), 20_000, label);
			} catch (error) {
				if (WppConnectProvider.isSessionDeadError(error)) throw error;
				const detail = error instanceof Error ? error.message : String(error);
				if (WppConnectProvider.isLegacyHistoryApiGone(error)) {
					this.legacyHistoryApiGone = true;
					this.logger.warn(
						`${label} is unavailable on this WhatsApp Web build — skipping the deprecated history loaders from now on.`,
					);
					return fallback;
				}
				// Chat-not-found / undefined.get must not abort the whole hydrate path.
				if (
					WppConnectProvider.isChatNotFoundError(error) ||
					WppConnectProvider.isTransientChatAccessError(error) ||
					WppConnectProvider.isStoreBrokenError(error) ||
					/timed out after/i.test(detail)
				) {
					// Alias misses are expected while ChatStore keys on @lid — keep quiet.
					if (WppConnectProvider.isChatNotFoundError(error)) {
						this.logger.debug(`${label} soft-failed for ${this.accountId}: ${detail}`);
					} else {
						this.logger.warn(`${label} soft-failed for ${this.accountId}: ${detail}`);
					}
					return fallback;
				}
				this.logger.warn(`${label} soft-failed for ${this.accountId}: ${detail}`);
				return fallback;
			}
		};

		const viaClientGetMessages = async (id: string) => {
			if (!this.client?.getMessages) return [];
			// wa-js assertGetChat crashes when Store.Chat is missing — common for
			// @lid / @g.us while the store is still hydrating. Skip the client path
			// when we have a live page (page hydrate is safer). Keep client path for
			// unit tests / mocks that have no Puppeteer page.
			if (
				this.client?.page &&
				(id.endsWith('@lid') ||
					id.endsWith('@hosted.lid') ||
					id.endsWith('@g.us'))
			) {
				return [];
			}
			const messages = await softClientCall(
				`getMessages(${id})`,
				() =>
					this.client.getMessages(id, {
						count,
						id: options.before || options.after || undefined,
						direction: options.before ? 'before' : options.after ? 'after' : undefined,
					}),
				[] as any[],
			);
			return Array.isArray(messages) ? messages : [];
		};

		const preferPageFirst =
			target.endsWith('@lid') ||
			target.endsWith('@hosted.lid') ||
			target.endsWith('@g.us');

		let messages: any[] = [];
		if (preferPageFirst) {
			messages = await this.fetchMessagesViaPage(target, count, options);
			if (messages.length) return messages;
		}

		messages = await viaClientGetMessages(target);
		if (messages.length) return messages;

		const resolved = (await this.ensureChatId(target)) || target;
		if (resolved !== target) {
			if (preferPageFirst) {
				messages = await this.fetchMessagesViaPage(resolved, count, options);
				if (messages.length) return messages;
			}
			messages = await viaClientGetMessages(resolved);
			if (messages.length) return messages;
		}

		// Prefer page/list hydrate — avoids wa-js assertGetChat on bad JIDs.
		messages = await this.fetchMessagesViaPage(resolved, count, options);
		if (messages.length) return messages;
		if (resolved !== target) {
			messages = await this.fetchMessagesViaPage(target, count, options);
			if (messages.length) return messages;
		}

		// Legacy loaders also go through assertGetChat — skip for LID/groups.
		// Open-chat must not call these: they pull archive from the phone.
		const allowHistoryPull = Boolean(options.loadEarlier || options.before);
		if (
			allowHistoryPull &&
			!preferPageFirst &&
			!this.legacyHistoryApiGone &&
			typeof this.client.loadEarlierMessages === 'function'
		) {
			await softClientCall(
				`loadEarlierMessages(${resolved})`,
				() => this.client.loadEarlierMessages(resolved),
				null,
			);
			messages = await viaClientGetMessages(resolved);
			if (messages.length) return messages;
			messages = await this.fetchMessagesViaPage(resolved, count, options);
			if (messages.length) return messages;
		}

		if (
			allowHistoryPull &&
			!preferPageFirst &&
			!this.legacyHistoryApiGone &&
			typeof this.client.loadAndGetAllMessagesInChat === 'function'
		) {
			const all = await softClientCall(
				`loadAndGetAllMessagesInChat(${resolved})`,
				() => this.client.loadAndGetAllMessagesInChat(resolved, true, true),
				[] as any[],
			);
			if (Array.isArray(all) && all.length) return all.slice(-count);
		}

		if (
			allowHistoryPull &&
			!preferPageFirst &&
			!this.legacyHistoryApiGone &&
			typeof this.client.getAllMessagesInChat === 'function'
		) {
			const all = await softClientCall(
				`getAllMessagesInChat(${resolved})`,
				() => this.client.getAllMessagesInChat(resolved, true, false),
				[] as any[],
			);
			if (Array.isArray(all) && all.length) return all.slice(-count);
		}
		return [];
	}

	/** Last-resort history read via WA-JS / ChatStore in the linked-device page. */
	private async fetchMessagesViaPage(
		chatId: string,
		count: number,
		options: { before?: string; after?: string; loadEarlier?: boolean } = {},
	): Promise<any[]> {
		const page = this.client?.page;
		const target = String(chatId || '').trim();
		if (!page || !target) return [];
		try {
			const list = await this.withTimeout(
				page.evaluate(
					async (
						id: string,
						limit: number,
						cursor: { before?: string; after?: string },
						allowHistoryPull: boolean,
					) => {
						const w = window as any;
						const WPP = w.WPP;
						const Store = w.Store;
						const asSerialized = (value: any) =>
							value?._serialized ||
							value?.id?._serialized ||
							(typeof value?.id === 'string' ? value.id : null) ||
							(typeof value === 'string' ? value : null);

						const userPart = String(id || '').split('@')[0];
						const matchesId = (sid: string) => {
							const value = String(sid || '');
							return (
								value === id ||
								(userPart && (value.startsWith(`${userPart}@`) || value === userPart))
							);
						};

						const readChatModels = (chat: any): any[] => {
							if (!chat) return [];
							try {
								if (typeof chat.msgs?.getModelsArray === 'function') {
									return chat.msgs.getModelsArray() || [];
								}
							} catch {
								/* ignore */
							}
							try {
								if (Array.isArray(chat.msgs?.models)) return chat.msgs.models;
								if (chat.msgs?.models && typeof chat.msgs.models.values === 'function') {
									return [...chat.msgs.models.values()];
								}
							} catch {
								/* ignore */
							}
							const last = chat.lastMessage || chat.lastMsg || null;
							return last ? [last] : [];
						};

						const findChatWithoutAssert = async () => {
							// Prefer list/scan — avoids wa-js assertGetChat which throws
							// "Cannot read properties of undefined (reading 'get')".
							try {
								const listed =
									(typeof WPP?.chat?.list === 'function'
										? await WPP.chat.list({ count: 800 })
										: typeof Store?.Chat?.getModelsArray === 'function'
											? Store.Chat.getModelsArray()
											: []) || [];
								const match = listed.find((chat: any) =>
									matchesId(String(asSerialized(chat) || '')),
								);
								if (match) return match;
							} catch {
								/* ignore */
							}
							try {
								if (Store?.Chat?.get) {
									const direct = Store.Chat.get(id);
									if (direct) return direct;
								}
							} catch {
								/* ignore */
							}
							try {
								if (typeof WPP?.chat?.get === 'function') {
									const direct = WPP.chat.get(id);
									if (direct) return direct;
								}
							} catch {
								/* ignore */
							}
							try {
								if (typeof WPP?.chat?.find === 'function') {
									return await WPP.chat.find(id);
								}
							} catch {
								/* ignore */
							}
							return null;
						};

						let chat = await findChatWithoutAssert();
						if (allowHistoryPull) {
							try {
								if (chat && typeof WPP?.chat?.openChatBottom === 'function') {
									const sid = asSerialized(chat) || id;
									await WPP.chat.openChatBottom(sid).catch(() => null);
								}
							} catch {
								/* ignore */
							}
						}

						// Only call WPP.chat.getMessages when ChatStore exists —
						// otherwise wa-js assertGetChat → undefined reading 'get'.
						const chatStoreReady = Boolean(Store?.Chat?.get);
						let fromApi: any[] = [];
						const sid = asSerialized(chat) || id;
						if (
							allowHistoryPull &&
							chatStoreReady &&
							typeof WPP?.chat?.getMessages === 'function'
						) {
							try {
								const opts: Record<string, unknown> = { count: limit };
								if (cursor.before) {
									opts.direction = 'before';
									opts.id = cursor.before;
								} else if (cursor.after) {
									opts.direction = 'after';
									opts.id = cursor.after;
								}
								fromApi = (await WPP.chat.getMessages(sid, opts)) || [];
							} catch {
								fromApi = [];
							}
						}

						if (allowHistoryPull) {
							try {
								if (typeof chat?.msgs?.loadEarlierMsgs === 'function') {
									await chat.msgs.loadEarlierMsgs();
								} else if (
									chatStoreReady &&
									!fromApi.length &&
									typeof WPP?.chat?.getMessages === 'function' &&
									!cursor.before &&
									!cursor.after
								) {
									// Never count:-1 (full archive). Bound older pages to `limit`.
									fromApi =
										(await WPP.chat.getMessages(sid, {
											count: Math.min(Math.max(limit, 1), 50),
										})) || [];
								}
							} catch {
								/* ignore */
							}
						}
						if (!chat) chat = await findChatWithoutAssert();

						const fromStore = readChatModels(chat);
						const merged = new Map<string, any>();
						for (const msg of [...fromStore, ...(Array.isArray(fromApi) ? fromApi : [])]) {
							const key = String(
								asSerialized(msg?.id) || msg?.rowId || msg?.t || Math.random(),
							);
							if (!merged.has(key)) merged.set(key, msg);
						}
						const all = [...merged.values()].sort((a, b) => {
							const at = Number(a?.t || a?.timestamp || 0);
							const bt = Number(b?.t || b?.timestamp || 0);
							return at - bt;
						});
						return all.slice(-Math.max(1, limit));
					},
					target,
					count,
					{ before: options.before, after: options.after },
					Boolean(options.loadEarlier || options.before),
				),
				10_000,
				`fetchMessagesViaPage(${target})`,
			);
			return Array.isArray(list) ? list : [];
		} catch (error) {
			this.logger.warn(
				`fetchMessagesViaPage(${target}) failed for ${this.accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return [];
		}
	}

	/** Resolve a chat that exists in WA Web even when assertGetChat fails. */
	private async ensureChatId(chatId: string): Promise<string | null> {
		const page = this.client?.page;
		const target = String(chatId || '').trim();
		if (!page || !target) return null;
		try {
			return await this.withTimeout(
				page.evaluate(async (id: string) => {
					const w = window as any;
					const WPP = w.WPP;
					const Store = w.Store;
					if (!WPP?.chat && !Store?.Chat) return null;
					const asSerialized = (chat: any) =>
						chat?.id?._serialized || chat?.id || null;
					const userPart = String(id || '').split('@')[0];
					const matchesId = (sid: string) => {
						const value = String(sid || '');
						return (
							value === id ||
							(userPart && (value.startsWith(`${userPart}@`) || value === userPart))
						);
					};
					try {
						const listed =
							(typeof WPP?.chat?.list === 'function'
								? await WPP.chat.list({ count: 800 })
								: typeof Store?.Chat?.getModelsArray === 'function'
									? Store.Chat.getModelsArray()
									: []) || [];
						const match = listed.find((chat: any) =>
							matchesId(String(asSerialized(chat) || '')),
						);
						if (match) return asSerialized(match);
					} catch {
						/* ignore */
					}
					try {
						const existing = WPP?.chat?.get?.(id) || Store?.Chat?.get?.(id);
						if (existing) return asSerialized(existing);
					} catch {
						/* ignore */
					}
					try {
						if (typeof WPP?.chat?.find === 'function') {
							const found = await WPP.chat.find(id);
							if (found) return asSerialized(found);
						}
					} catch {
						/* ignore */
					}
					return null;
				}, target),
				12000,
				`ensureChatId(${target})`,
			);
		} catch (error) {
			this.logger.warn(
				`ensureChatId(${target}) failed for ${this.accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return null;
		}
	}

	async getMessages(
		chatId: string,
		options: {
			limit?: number;
			before?: string;
			after?: string;
			aliases?: string[];
			loadEarlier?: boolean;
		} = {},
	) {
		const run = () => this.getMessagesExclusive(chatId, options);
		const next = this.getMessagesChain.then(run, run);
		this.getMessagesChain = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	async fetchMessage(
		chatId: string,
		providerMessageId: string,
	): Promise<NormalizedWhatsAppMessage | null> {
		const id = String(providerMessageId || '').trim();
		if (!id || this.state !== 'connected' || !this.client) return null;

		const asNormalized = (raw: any): NormalizedWhatsAppMessage | null => {
			if (!raw) return null;
			const message = Array.isArray(raw) ? raw[0] : raw;
			if (!message) return null;
			try {
				return normalizeMessage(message);
			} catch {
				return null;
			}
		};

		const chat = String(chatId || '').trim();
		const candidates = [id];
		if (chat && !/^true_/i.test(id) && !/^false_/i.test(id)) {
			candidates.push(`false_${chat}_${id}`, `true_${chat}_${id}`);
		}

		let fallback: NormalizedWhatsAppMessage | null = null;
		const keep = (normalized: NormalizedWhatsAppMessage | null) => {
			if (!normalized) return null;
			if (extractWhatsAppLocation(normalized)) return normalized;
			if (!fallback) fallback = normalized;
			return null;
		};

		if (typeof this.client.getMessageById === 'function') {
			for (const candidate of candidates) {
				try {
					const located = keep(asNormalized(await this.client.getMessageById(candidate)));
					if (located) return located;
				} catch {
					/* next candidate */
				}
			}
		}

		if (typeof this.client.getMessage === 'function') {
			for (const candidate of candidates) {
				try {
					const located = keep(
						asNormalized(await this.client.getMessage(chat || candidate, candidate)),
					);
					if (located) return located;
				} catch {
					try {
						const located = keep(asNormalized(await this.client.getMessage(candidate)));
						if (located) return located;
					} catch {
						/* next candidate */
					}
				}
			}
		}

		try {
			const recent = await this.getMessages(chatId, { limit: 200 });
			const found =
				recent.find(
					(item) =>
						item.providerMessageId === id || candidates.includes(item.providerMessageId),
				) || null;
			const located = keep(found);
			if (located) return located;
		} catch {
			/* ChatStore may still be hydrating */
		}

		return fallback;
	}

	private async getMessagesExclusive(
		chatId: string,
		options: {
			limit?: number;
			before?: string;
			after?: string;
			aliases?: string[];
			loadEarlier?: boolean;
		} = {},
	) {
		if (this.state !== 'connected' || !this.client) {
			throw new Error(
				'WhatsApp account is not connected. Reconnect the account, then try again.',
			);
		}
		this.assertChatStoreAvailable(`getMessages(${chatId})`);
		// Prefer MAIN, but do not refuse forever when inbox list already works.
		const mainReady = await this.waitForWhatsAppMainReady(2_000);
		if (!mainReady) {
			this.logger.warn(
				`getMessages(${chatId}): isMainReady still false — attempting fetch anyway for ${this.accountId}`,
			);
		}
		// Empty ChatStore → every alias fails with Chat not found / undefined.get.
		// Fail fast so open-chat + UI retries are not drowned by a history stampede.
		// Skip the probe when there is no Puppeteer page (unit tests / mocks).
		if (this.client?.page) {
			const storeHydrated = await this.isChatStoreHydrated();
			if (!storeHydrated) {
				this.tripMainNotReadyBackoff('ChatStore empty during getMessages');
				this.logger.warn(
					`getMessages(${chatId}): ChatStore empty for ${this.accountId} — returning []`,
				);
				return [];
			}
		}
		const count = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
		const loadEarlier = Boolean(options.loadEarlier || options.before);
		let messages: any[] = [];
		const chatIds = await this.resolveSendableChatIds(chatId);
		const primary = String(chatId || '').trim();
		const primaryUser = primary.includes('@') ? primary.split('@')[0] : '';
		const isLid =
			primary.endsWith('@lid') || primary.endsWith('@hosted.lid');
		const aliasIds = (options.aliases || [])
			.map((id) => String(id || '').trim())
			.filter(Boolean)
			.filter((id) => {
				// LID numeric id stored as "phone" produced bogus @c.us candidates.
				if (!isLid || !primaryUser) return true;
				const user = id.includes('@') ? id.split('@')[0] : id;
				if (user !== primaryUser) return true;
				return !(id.endsWith('@c.us') || id.endsWith('@s.whatsapp.net'));
			});
		// Prefer the conversation's own JID (often @lid) before phone aliases.
		// Phone-first caused Chat not found storms when ChatStore only had LID keys.
		const isGroup = primary.endsWith('@g.us');
		const merged = [...chatIds, primary, ...aliasIds];
		let candidates = [...new Set(merged.filter(Boolean))];
		// Open-chat: one primary + at most one fallback. Alias storms hit the phone.
		if (!loadEarlier) {
			candidates = candidates.slice(0, 2);
		}
		const tried = new Set<string>();
		let lastChatMissingError: unknown = null;
		try {
			for (const candidate of candidates) {
				const queue = [candidate];
				while (queue.length) {
					const current = String(queue.shift() || '').trim();
					if (!current || tried.has(current)) continue;
					tried.add(current);
					try {
						// For LID threads, page-hydrate every candidate (including phone
						// aliases) — never fall through to client.getMessages on @c.us
						// aliases (assertGetChat → Chat not found noise).
						const isPhoneAlias =
							current.endsWith('@c.us') || current.endsWith('@s.whatsapp.net');
						const lidPhoneAliasOnly = isLid && isPhoneAlias;
						if (
							isLid ||
							isGroup ||
							current.endsWith('@lid') ||
							current.endsWith('@hosted.lid') ||
							current.endsWith('@g.us')
						) {
							messages = await this.fetchMessagesViaPage(current, count, options);
							if (!messages.length && !lidPhoneAliasOnly) {
								messages = await this.fetchMessagesForChat(current, count, options);
							}
						} else {
							messages = await this.fetchMessagesForChat(current, count, options);
						}
						lastChatMissingError = null;
						if (Array.isArray(messages) && messages.length) {
							this.clearChatStoreCooldown();
							this.logger.log(
								`getMessages(${chatId}) hydrated ${messages.length} via ${current} for ${this.accountId}`,
							);
							return messages
								.map(normalizeMessage)
								.sort((a: any, b: any) => {
									const aTime = new Date(a?.timestamp || 0).getTime();
									const bTime = new Date(b?.timestamp || 0).getTime();
									if (aTime !== bTime) return aTime - bTime;
									return String(a?.providerMessageId || '').localeCompare(
										String(b?.providerMessageId || ''),
									);
								})
								.slice(-count);
						}
						const resolved = await this.ensureChatId(current);
						if (resolved && !tried.has(resolved)) queue.push(resolved);
						continue;
					} catch (error) {
						if (WppConnectProvider.isSessionDeadError(error)) throw error;
						const detail = error instanceof Error ? error.message : String(error);
						this.logger.warn(
							`getMessages(${current}) failed for ${this.accountId}: ${detail}`,
						);
						// Per-chat glitches must not cool down the whole linked session.
						if (
							WppConnectProvider.isChatNotFoundError(error) ||
							WppConnectProvider.isTransientChatAccessError(error)
						) {
							lastChatMissingError = error;
							const resolved = await this.ensureChatId(current);
							if (resolved && !tried.has(resolved)) queue.push(resolved);
							continue;
						}
						if (WppConnectProvider.isStoreBrokenError(error)) {
							this.tripMainNotReadyBackoff(detail);
							const resolved = await this.ensureChatId(current);
							if (resolved && !tried.has(resolved)) queue.push(resolved);
							continue;
						}
						if (/timed out after/i.test(detail)) {
							const resolved = await this.ensureChatId(current);
							if (resolved && !tried.has(resolved)) queue.push(resolved);
							continue;
						}
						throw error instanceof Error ? error : new Error(String(error));
					}
				}
			}
			if (lastChatMissingError) {
				this.logger.warn(
					`getMessages(${chatId}) no usable candidate after: ${candidates.join(', ')}`,
				);
				this.clearChatStoreCooldown();
				return [];
			}
			this.logger.warn(
				`getMessages(${chatId}) returned empty after trying: ${candidates.join(', ')}`,
			);
			this.clearChatStoreCooldown();
			return [];
		} catch (error) {
			if (WppConnectProvider.isSessionDeadError(error)) {
				await this.rethrowIfSessionDead(`getMessages(${chatId})`, error);
			}
			const detail = error instanceof Error ? error.message : String(error);
			if (
				WppConnectProvider.isTransientChatAccessError(error) ||
				WppConnectProvider.isChatNotFoundError(error)
			) {
				this.logger.warn(
					`getMessages(${chatId}) soft-empty for ${this.accountId}: ${detail}`,
				);
				return [];
			}
			if (
				WppConnectProvider.isStoreBrokenError(error) ||
				/timed out after|chat store is not ready/i.test(detail)
			) {
				if (!/cooling down|chat store is not ready yet/i.test(detail)) {
					this.tripMainNotReadyBackoff(detail);
				}
				throw new Error(
					detail.startsWith('WhatsApp chat store is not ready yet')
						? detail
						: `WhatsApp chat store is not ready yet: ${detail}`,
				);
			}
			this.logger.warn(
				`getMessages(${chatId}) failed for ${this.accountId}: ${detail}`,
			);
			throw error instanceof Error ? error : new Error(String(error));
		}
	}

	getContacts() {
		if (!this.client?.getAllContacts) return Promise.resolve([]);
		return Promise.race([
			this.client.getAllContacts(),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('getAllContacts timed out after 20000ms')), 20000),
			),
		]).catch(error => {
			this.logger.warn(
				`getContacts failed/timeout for ${this.accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return [];
		});
	}

	async resolveContactIdentity(chatId: string) {
		if (!chatId || typeof this.client?.getPnLidEntry !== 'function') return null;
		try {
			const entry = await this.client.getPnLidEntry(chatId);
			const phoneWid = serializedId(entry?.phoneNumber);
			const contact = entry?.contact || {};
			return {
				phoneNumber: phoneWid ? phoneWid.split('@')[0] || null : null,
				name:
					contact.name ||
					contact.verifiedName ||
					contact.pushname ||
					contact.shortName ||
					null,
			};
		} catch {
			return null;
		}
	}

	async getProfilePictureUrl(chatId: string): Promise<string | null> {
		if (!chatId || !this.client) return null;
		try {
			if (typeof this.client.getProfilePicFromServer === 'function') {
				const pic = await this.client.getProfilePicFromServer(chatId);
				const url = String(pic?.eurl || pic?.imgFull || pic?.imgUrl || '').trim();
				if (url) return url;
			}
		} catch {
			/* ignore */
		}
		return null;
	}

	getGroups() {
		return this.client.getAllGroups();
	}

	getGroupParticipants(groupId: string) {
		return this.client.getGroupMembers(groupId);
	}

	private async resolveSendableChatIds(chatId: string): Promise<string[]> {
		const original = String(chatId || '').trim();
		if (!original) return [];
		const candidates = new Set<string>([original]);
		// getPnLidEntry only accepts @c.us / @lid — groups (@g.us) and broadcasts throw.
		const canResolvePnLid =
			original.endsWith('@c.us') ||
			original.endsWith('@lid') ||
			original.endsWith('@hosted.lid');
		try {
			if (canResolvePnLid && typeof this.client.getPnLidEntry === 'function') {
				const entry = await this.client.getPnLidEntry(original);
				const lid =
					serializedId(entry?.lid) ||
					serializedId(entry?.lidUser) ||
					(entry?.lid ? String(entry.lid) : null);
				const phone =
					serializedId(entry?.phoneNumber) ||
					serializedId(entry?.pn) ||
					serializedId(entry?.user) ||
					null;
				if (lid) candidates.add(String(lid).includes('@') ? String(lid) : `${lid}@lid`);
				if (phone) {
					const digits = String(phone).replace(/[^\d]/g, '');
					if (digits) {
						candidates.add(`${digits}@c.us`);
						candidates.add(`${digits}@s.whatsapp.net`);
					}
				}
			}
		} catch (error) {
			this.logger.warn(
				`getPnLidEntry failed for ${original}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}

		// Common WhatsApp Web migrations between phone JIDs and linked IDs.
		if (original.endsWith('@c.us')) {
			const user = original.split('@')[0];
			if (user) candidates.add(`${user}@s.whatsapp.net`);
		} else if (original.endsWith('@s.whatsapp.net')) {
			const user = original.split('@')[0];
			if (user) candidates.add(`${user}@c.us`);
		} else if (original.endsWith('@lid')) {
			// Prefer LID first (WhatsApp multi-device), then phone aliases if resolved.
			const ordered = [original, ...[...candidates].filter(id => id !== original)];
			return ordered;
		}

		return [...candidates];
	}

	private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
		let timer: NodeJS.Timeout | undefined;
		try {
			return await Promise.race([
				promise,
				new Promise<T>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error(`${label} timed out after ${ms}ms`)),
						ms,
					);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private isRetriableSendError(error: unknown) {
		const text = String(
			error instanceof Error ? error.message : error || '',
		).toLowerCase();
		return (
			text.includes('lid') ||
			text.includes('no lid') ||
			text.includes('not provided') ||
			text.includes('wid') ||
			text.includes('chat not found') ||
			text.includes('not found') ||
			text.includes('invalid chat') ||
			text.includes('timed out')
		);
	}

	async sendText(chatId: string, text: string, quote?: string | WhatsAppSendQuoteOptions) {
		const quoteOptions = normalizeSendQuoteOptions(quote);
		const quotedProviderMessageId = quoteOptions?.quotedProviderMessageId;
		const outbound = quoteOptions?.embeddedQuote
			? withEmbeddedQuotePrefix(text, quoteOptions.embeddedQuote)
			: text;
		const targets = await this.resolveSendableChatIds(chatId);
		let lastError: unknown;
		for (const target of targets) {
			try {
				const sendPromise = async () => {
					if (quotedProviderMessageId && this.client.reply) {
						return this.client.reply(target, outbound, quotedProviderMessageId);
					}
					try {
						return await this.client.sendText(target, outbound, {
							createChat: true,
							waitForAck: true,
							...(quotedProviderMessageId
								? { quotedMsg: quotedProviderMessageId }
								: {}),
						});
					} catch (error) {
						// Older clients reject unknown options — retry plain send.
						if (quotedProviderMessageId) throw error;
						return this.client.sendText(target, outbound);
					}
				};
				return await this.withTimeout(sendPromise(), 45000, `sendText(${target})`);
			} catch (error) {
				lastError = error;
				this.logger.warn(
					`sendText failed for ${target}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				if (!this.isRetriableSendError(error) && targets.length === 1) break;
			}
		}
		const detail =
			lastError instanceof Error
				? lastError.message
				: typeof lastError === 'string'
					? lastError
					: JSON.stringify(lastError);
		throw new Error(`Failed to send WhatsApp text: ${detail || 'unknown provider error'}`);
	}

	private async sendVoiceNote(
		target: string,
		filePath: string,
		options: {
			caption?: string;
			fileName?: string;
			mimeType?: string | null;
			quotedProviderMessageId?: string;
			voiceAlreadyConverted?: boolean;
		},
	) {
		const fs = require('fs/promises');
		let sendPath = filePath;
		let sendFilename = options.fileName || require('path').basename(filePath) || 'voice.ogg';
		let voiceCleanup: (() => Promise<void>) | undefined;
		const needsEncode =
			!options.voiceAlreadyConverted || !(await isValidWhatsAppVoiceOggFile(filePath));
		if (needsEncode) {
			const converted = await ensureWhatsAppVoiceOgg(filePath, {
				mimeType: options.mimeType,
				fileName: sendFilename,
			});
			sendPath = converted.filePath;
			sendFilename = converted.fileName;
			voiceCleanup = converted.cleanup;
		}
		try {
			const buffer: Buffer = await fs.readFile(sendPath);
			if (!buffer?.length || buffer.subarray(0, 4).toString('ascii') !== 'OggS') {
				throw new Error('Voice file is not valid OGG/Opus');
			}
			const dataUrl = `data:${dataUrlMime(WHATSAPP_VOICE_MIME)};base64,${buffer.toString('base64')}`;
			const page = this.client?.page;
			if (page) {
				try {
					const result = await this.withTimeout(
						page.evaluate(
							async ({
								to,
								content,
								filename,
								caption,
								quotedMessageId,
							}: {
								to: string;
								content: string;
								filename: string;
								caption: string;
								quotedMessageId?: string;
							}) => {
								const w = window as any;
								return w.WPP.chat.sendFileMessage(to, content, {
									type: 'audio',
									isPtt: true,
									waveform: true,
									mimetype: 'audio/ogg;codecs=opus',
									filename,
									caption,
									quotedMsg: quotedMessageId || undefined,
									waitForAck: true,
								});
							},
							{
								to: target,
								content: dataUrl,
								filename: sendFilename,
								caption: options.caption || '',
								quotedMessageId: options.quotedProviderMessageId,
							},
						),
						90_000,
						`sendVoicePtt(${target})`,
					);
					this.logger.log(
						`Voice PTT sent to ${target}: ${buffer.length} bytes (${sendFilename})`,
					);
					return result;
				} catch (error) {
					this.logger.warn(
						`WPP voice send failed for ${target}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				}
			}
			if (typeof this.client?.sendPttFromBase64 === 'function') {
				return await this.withTimeout(
					this.client.sendPttFromBase64(
						target,
						dataUrl,
						sendFilename,
						options.caption || '',
						options.quotedProviderMessageId,
						undefined,
						true,
					),
					90_000,
					`sendPttFromBase64(${target})`,
				);
			}
			throw new Error('WhatsApp voice send is unavailable (browser page not ready)');
		} finally {
			await voiceCleanup?.();
		}
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
			voiceAlreadyConverted?: boolean;
			quotedProviderMessageId?: string;
			embeddedQuote?: WhatsAppEmbeddedQuote;
		} = {},
	) {
		if (options.embeddedQuote) {
			options.caption = withEmbeddedQuotePrefix(
				options.caption || '',
				options.embeddedQuote,
			);
		}
		const targets = await this.resolveSendableChatIds(chatId);
		const filename = options.fileName || require('path').basename(filePath) || 'file';
		let lastError: unknown;

		const sendToTarget = async (target: string) => {
			if (options.isSticker) {
				const isGif =
					String(options.mimeType || '').includes('gif') ||
					filename.toLowerCase().endsWith('.gif');
				if (typeof this.client?.sendImageAsStickerGif === 'function' && isGif) {
					return this.withTimeout(
						this.client.sendImageAsStickerGif(target, filePath),
						60000,
						`sendStickerGif(${target})`,
					);
				}
				if (typeof this.client?.sendImageAsSticker === 'function') {
					return this.withTimeout(
						this.client.sendImageAsSticker(target, filePath),
						60000,
						`sendSticker(${target})`,
					);
				}
				return this.withTimeout(
					this.client.sendFile(target, filePath, {
						filename,
						type: 'sticker',
						waitForAck: true,
					}),
					60000,
					`sendStickerFile(${target})`,
				);
			}
			if (options.isVoice) {
				return this.sendVoiceNote(target, filePath, {
					caption: options.caption,
					fileName: filename,
					mimeType: options.mimeType,
					quotedProviderMessageId: options.quotedProviderMessageId,
					voiceAlreadyConverted: options.voiceAlreadyConverted,
				});
			}
			return this.withTimeout(
				this.client.sendFile(target, filePath, {
					filename,
					caption: options.caption || '',
					quotedMsg: options.quotedProviderMessageId,
					waitForAck: true,
				}),
				60000,
				`sendFile(${target})`,
			);
		};

		for (const target of targets) {
			try {
				return await sendToTarget(target);
			} catch (error) {
				lastError = error;
				this.logger.warn(
					`sendMedia failed for ${target}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				if (!this.isRetriableSendError(error) && targets.length === 1) break;
			}
		}
		const detail =
			lastError instanceof Error
				? lastError.message
				: typeof lastError === 'string'
					? lastError
					: JSON.stringify(lastError);
		throw new Error(`Failed to send WhatsApp media: ${detail || 'unknown provider error'}`);
	}

	async sendReaction(providerMessageId: string, emoji: string | false) {
		if (typeof this.client?.sendReactionToMessage !== 'function') {
			throw new Error('Message reactions are not supported by this WhatsApp session');
		}
		return this.client.sendReactionToMessage(providerMessageId, emoji);
	}

	async getReactions(providerMessageId: string) {
		if (typeof this.client?.getReactions !== 'function') return [];
		const result = await this.client.getReactions(providerMessageId);
		const senders = Array.isArray(result?.reactions)
			? result.reactions.flatMap((group: any) =>
					Array.isArray(group?.senders) ? group.senders : [],
				)
			: [];
		const byMeRaw = result?.reactionByMe;
		const byMeId = serializedId(byMeRaw?.id);
		const filteredSenders = senders.filter(
			(reaction: any) =>
				(!byMeId || serializedId(reaction?.id) !== byMeId) &&
				(!byMeRaw?.senderUserJid ||
					reaction?.senderUserJid !== byMeRaw.senderUserJid),
		);
		const byMe = byMeRaw?.reactionText
			? [{ ...result.reactionByMe, senderUserJid: 'me' }]
			: [];
		const unique = new Map<string, any>();
		for (const reaction of [...filteredSenders, ...byMe]) {
			const actorKey = String(reaction?.senderUserJid || 'unknown');
			const emoji = String(reaction?.reactionText || '').trim();
			if (!emoji) continue;
			unique.set(actorKey, {
				actorKey,
				emoji,
				timestamp: reaction?.timestamp
					? new Date(Number(reaction.timestamp) * 1000)
					: null,
			});
		}
		return [...unique.values()];
	}

	async forwardMessage(chatId: string, providerMessageId: string) {
		if (typeof this.client?.forwardMessagesV2 === 'function') {
			return this.client.forwardMessagesV2(chatId, providerMessageId, {
				displayCaptionText: true,
			});
		}
		if (typeof this.client?.forwardMessage === 'function') {
			return this.client.forwardMessage(chatId, providerMessageId);
		}
		throw new Error('Message forwarding is not supported by this WhatsApp session');
	}

	async deleteMessage(
		chatId: string,
		providerMessageId: string,
		mode: 'local' | 'everyone',
	) {
		if (typeof this.client?.deleteMessage !== 'function') {
			throw new Error('Message deletion is not supported by this WhatsApp session');
		}
		return this.client.deleteMessage(
			chatId,
			providerMessageId,
			mode === 'local',
			true,
		);
	}

	async starMessage(providerMessageId: string, starred: boolean) {
		if (typeof this.client?.starMessage !== 'function') {
			throw new Error('Starring messages is not supported by this WhatsApp session');
		}
		return this.client.starMessage(providerMessageId, starred);
	}

	async pinMessage(providerMessageId: string, pinned: boolean) {
		const page = this.client?.page;
		if (!page?.evaluate) {
			throw new Error('Pinning messages is not supported by this WhatsApp session');
		}
		return page.evaluate(
			({ messageId, shouldPin }: { messageId: string; shouldPin: boolean }) => {
				const wpp = (globalThis as any).WPP;
				return wpp.chat.pinMsg(
					messageId,
					shouldPin,
					wpp.whatsapp.PinExpiryDurationOption.SevenDays,
				);
			},
			{ messageId: providerMessageId, shouldPin: pinned },
		);
	}

	async getMessageInfo(providerMessageId: string) {
		const message =
			typeof this.client?.getMessageById === 'function'
				? await this.client.getMessageById(providerMessageId)
				: null;
		const page = this.client?.page;
		const acknowledgements = page?.evaluate
			? await page
					.evaluate((messageId: string) => {
						const wpp = (globalThis as any).WPP;
						return wpp.chat.getMessageACK(messageId);
					}, providerMessageId)
					.catch(() => null)
			: null;
		return {
			message: message
				? {
						id: serializedId(message.id),
						type: message.type,
						timestamp: message.timestamp || message.t,
						ack: message.ack,
						fromMe: Boolean(message.fromMe || message.id?.fromMe),
					}
				: null,
			acknowledgements,
		};
	}

	async markChatRead(chatId: string) {
		const targets = await this.resolveSendableChatIds(chatId);
		let lastError: unknown;
		for (const target of targets) {
			try {
				return await this.client.sendSeen(target);
			} catch (error) {
				lastError = error;
				if (!this.isRetriableSendError(error) && targets.length === 1) break;
			}
		}
		if (lastError) throw lastError;
	}

	async subscribePresence(chatId: string | string[]) {
		if (!this.client || typeof this.client.subscribePresence !== 'function') return 0;
		try {
			return await this.client.subscribePresence(chatId);
		} catch (error) {
			this.logger.debug(
				`subscribePresence failed for ${this.accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return 0;
		}
	}

	async unsubscribePresence(chatId: string | string[]) {
		if (!this.client || typeof this.client.unsubscribePresence !== 'function') return 0;
		try {
			return await this.client.unsubscribePresence(chatId);
		} catch {
			return 0;
		}
	}

	downloadMedia(providerMessageId: string, _options?: { rawHint?: any }) {
		return this.client.downloadMedia(providerMessageId);
	}

	/**
	 * Download status/story media at full quality.
	 * Status IDs often need `false_status@broadcast_<id>_<participant@c.us|@lid>`.
	 * Never return message.body — that is only a tiny WhatsApp thumbnail.
	 */
	async downloadStatus(providerStatusId: string, senderWaId?: string | null) {
		const statusId = String(providerStatusId || '');
		if (!statusId) throw new Error('downloadStatus: status id is required');
		const participantFromId =
			statusId.match(/status@broadcast_[^_]+_(.+)$/i)?.[1]?.trim() || '';
		const senderSeed = String(senderWaId || participantFromId || '').trim();
		const senderCandidates = senderSeed
			? await this.resolveSendableChatIds(senderSeed)
			: [];
		if (participantFromId && !senderCandidates.includes(participantFromId)) {
			senderCandidates.unshift(participantFromId);
		}

		try {
			const dataUri = await this.client.page.evaluate(
				async (targetId: string, targetSenders: string[]) => {
					const browserWindow: any = window as any;
					const WPP = browserWindow.WPP;
					if (!WPP) throw new Error('WhatsApp WPP is not ready');

					const MIN_FULL_BYTES = 3_000;
					const senders = Array.isArray(targetSenders)
						? targetSenders.filter(Boolean).map(String)
						: [];

					const bare = (value: string) =>
						String(value || '')
							.trim()
							.toLowerCase()
							.replace(/@.*/, '');

					const identityTokens = (value: unknown): string[] => {
						const text = String(value || '').trim().toLowerCase();
						if (!text) return [];
						const tokens = new Set<string>([text, bare(text)]);
						try {
							const contact =
								WPP?.whatsapp?.ContactStore?.get?.(text) ||
								WPP?.contact?.get?.(text);
							const extras = [
								contact?.id?._serialized,
								contact?.id,
								contact?.phoneNumber?._serialized,
								contact?.phoneNumber,
								contact?.lid?._serialized,
								contact?.lid,
							];
							for (const extra of extras) {
								const serialized = String(
									extra?._serialized || extra || '',
								).trim();
								if (!serialized) continue;
								tokens.add(serialized.toLowerCase());
								tokens.add(bare(serialized));
							}
						} catch {
							/* contact lookup optional */
						}
						return [...tokens].filter(Boolean);
					};

					const senderAliasSet = new Set<string>();
					for (const sender of senders) {
						for (const token of identityTokens(sender)) senderAliasSet.add(token);
					}
					const participantFromTarget =
						targetId.match(/status@broadcast_[^_]+_(.+)$/i)?.[1] || '';
					for (const token of identityTokens(participantFromTarget)) {
						senderAliasSet.add(token);
					}

					const sameIdentity = (left: unknown, right?: unknown) => {
						const leftTokens = identityTokens(left);
						if (!leftTokens.length) return false;
						if (right != null && String(right)) {
							const rightTokens = new Set(identityTokens(right));
							return leftTokens.some(token => rightTokens.has(token));
						}
						return leftTokens.some(token => senderAliasSet.has(token));
					};

					const participantOf = (msg: any, fallback = '') =>
						String(
							msg?.id?.participant?._serialized ||
								msg?.id?.participant ||
								msg?.author?._serialized ||
								msg?.author ||
								fallback ||
								'',
						);

					const buildFullId = (msg: any, fallbackSender = '') => {
						if (msg?.id?._serialized) return String(msg.id._serialized);
						const fromMe = msg?.id?.fromMe || msg?.fromMe ? 'true' : 'false';
						const remote = String(msg?.id?.remote || 'status@broadcast');
						const id = msg?.id?.id != null ? String(msg.id.id) : '';
						const participant = participantOf(msg, fallbackSender);
						if (!id) return '';
						return participant
							? `${fromMe}_${remote}_${id}_${participant}`
							: `${fromMe}_${remote}_${id}`;
					};

					const extractKey = (value: string) => {
						const text = String(value || '');
						const statusMatch = text.match(/status@broadcast_([^_]+)/i);
						if (statusMatch?.[1]) return statusMatch[1];
						const hexMatch = text.match(
							/_([0-9A-Fa-f]{10,}|3A[0-9A-Fa-f]+)(?:_|$)/,
						);
						if (hexMatch?.[1]) return hexMatch[1];
						return text;
					};

					const targetKey = extractKey(targetId);

					const alternateStatusIds = (): string[] => {
						const ids = new Set<string>([targetId]);
						if (!targetKey) return [...ids];
						const participants = [
							...senders,
							participantFromTarget,
							...[...senderAliasSet].filter(token => token.includes('@')),
						].filter(Boolean);
						for (const participant of participants) {
							ids.add(`false_status@broadcast_${targetKey}_${participant}`);
							ids.add(`true_status@broadcast_${targetKey}_${participant}`);
						}
						ids.add(`false_status@broadcast_${targetKey}`);
						ids.add(`true_status@broadcast_${targetKey}`);
						return [...ids];
					};

					const idCandidates = (msg: any): string[] => {
						const values = [
							msg?.id?._serialized,
							typeof msg?.id === 'string' ? msg.id : null,
							msg?.rowId != null ? String(msg.rowId) : null,
							msg?.id?.id != null ? String(msg.id.id) : null,
							buildFullId(msg, senders[0] || ''),
						];
						return [...new Set(values.filter(Boolean).map(String))];
					};

					const matches = (msg: any) => {
						const candidates = idCandidates(msg);
						if (candidates.includes(targetId)) return true;
						if (targetKey && candidates.some(c => c.includes(targetKey))) {
							return true;
						}
						if (msg?.id?.id && String(msg.id.id) === targetKey) return true;
						if (senderAliasSet.size) {
							const participant = participantOf(msg);
							if (
								sameIdentity(participant) &&
								targetKey &&
								String(msg?.id?.id || '') === targetKey
							) {
								return true;
							}
						}
						return false;
					};

					const blobSize = (blob: any) => {
						if (!blob) return 0;
						if (typeof blob === 'string') {
							const raw = blob.replace(/^data:[^;]+;base64,/, '');
							return Math.floor((raw.length * 3) / 4);
						}
						return Number(blob.size || blob.byteLength || 0);
					};

					const toDataUri = async (blob: any, mimeHint?: string) => {
						if (!blob) return null;
						if (typeof blob === 'string') {
							if (blob.startsWith('data:')) return blob;
							return `data:${dataUrlMime(mimeHint)};base64,${blob}`;
						}
						try {
							if (typeof blob.forceToBlob === 'function') {
								blob = blob.forceToBlob();
							} else if (typeof blob === 'object' && blob._blob) {
								blob = blob._blob;
							}
						} catch {
							/* ignore */
						}
						if (WPP?.util?.blobToBase64) {
							return await WPP.util.blobToBase64(blob);
						}
						return await new Promise<string>((resolve, reject) => {
							const reader = new FileReader();
							reader.onloadend = () => resolve(String(reader.result || ''));
							reader.onerror = () =>
								reject(new Error('Failed to read media blob'));
							reader.readAsDataURL(blob);
						});
					};

					const isAcceptable = (blob: any, typeHint?: string) => {
						const size = blobSize(blob);
						if (!size) return false;
						const type = String(typeHint || '').toLowerCase();
						if (type.includes('video')) return size >= 20_000;
						return size >= MIN_FULL_BYTES;
					};

					const readCachedBlob = async (msg: any) => {
						const mediaData = msg?.mediaData;
						if (!mediaData) return null;
						const mime = mediaData.mimetype || msg.mimetype;
						const filehash = mediaData.filehash || msg.filehash;

						try {
							const LruMediaStore = WPP?.whatsapp?.LruMediaStore;
							if (filehash && typeof LruMediaStore?.get === 'function') {
								const cached = await LruMediaStore.get(filehash).catch(
									() => null,
								);
								if (cached) {
									const buffer =
										cached instanceof ArrayBuffer
											? cached
											: cached?.buffer || cached;
									if (buffer) {
										const blob = new Blob([buffer], {
											type: mime || 'application/octet-stream',
										});
										if (isAcceptable(blob, mime)) return blob;
									}
								}
							}
						} catch {
							/* ignore */
						}

						try {
							const MediaBlobCache = WPP?.whatsapp?.MediaBlobCache;
							if (filehash && MediaBlobCache?.has?.(filehash)) {
								const blob = MediaBlobCache.get(filehash);
								if (isAcceptable(blob, mime)) return blob;
							}
						} catch {
							/* ignore */
						}

						try {
							if (mediaData.mediaBlob) {
								const blob =
									typeof mediaData.mediaBlob.forceToBlob === 'function'
										? mediaData.mediaBlob.forceToBlob()
										: typeof mediaData.mediaBlob === 'function'
											? mediaData.mediaBlob()
											: mediaData.mediaBlob;
								if (isAcceptable(blob, mime)) return blob;
							}
						} catch {
							/* ignore */
						}
						return null;
					};

					const forceDownloadMsg = async (msg: any) => {
						const mimeHint = msg?.mimetype || msg?.mediaData?.mimetype || msg?.type;

						try {
							if (typeof msg.downloadMedia === 'function') {
								await msg.downloadMedia({
									downloadEvenIfExpensive: true,
									rmrReason: 1,
									isUserInitiated: true,
								});
							}
						} catch {
							/* continue */
						}

						for (let attempt = 0; attempt < 30; attempt += 1) {
							const cached = await readCachedBlob(msg);
							if (cached) return cached;
							await new Promise(resolve => setTimeout(resolve, 200));
						}

						const fullIds = [
							buildFullId(msg, senders[0] || ''),
							msg?.id?._serialized,
							...alternateStatusIds(),
						].filter(Boolean);

						for (const id of fullIds) {
							try {
								const media = await WPP.chat.downloadMedia(String(id));
								if (isAcceptable(media, mimeHint)) return media;
							} catch {
								/* continue */
							}
						}

						try {
							const downloadManager =
								WPP?.whatsapp?.DownloadManager ||
								browserWindow.Store?.DownloadManager;
							const directPath = msg.directPath || msg.mediaData?.directPath;
							const mediaKey = msg.mediaKey || msg.mediaData?.mediaKey;
							if (
								downloadManager?.downloadAndMaybeDecrypt &&
								directPath &&
								mediaKey
							) {
								const decrypted = await downloadManager.downloadAndMaybeDecrypt({
									directPath,
									encFilehash: msg.encFilehash || msg.mediaData?.encFilehash,
									filehash: msg.filehash || msg.mediaData?.filehash,
									mediaKey,
									mediaKeyTimestamp:
										msg.mediaKeyTimestamp || msg.mediaData?.mediaKeyTimestamp,
									mimetype: mimeHint,
									type: msg.type,
									signal: (AbortController ? new AbortController() : null)
										?.signal,
								});
								if (isAcceptable(decrypted, mimeHint)) return decrypted;
							}
						} catch {
							/* continue */
						}

						return null;
					};

					const collectMsgs = (status: any) => {
						const messages =
							(typeof status.getAllMsgs === 'function' && status.getAllMsgs()) ||
							status.msgs?.getModelsArray?.() ||
							status.msgs?.models ||
							[];
						return [
							...(Array.isArray(messages) ? messages : []),
							...(status.lastStatus ? [status.lastStatus] : []),
						];
					};

					const contactIdOf = (status: any) =>
						String(
							status?.id?._serialized ||
								(typeof status?.id?.toString === 'function'
									? status.id.toString()
									: status?.id) ||
								'',
						);

					const ensureStatusMsgs = async (status: any) => {
						try {
							await Promise.race([
								(async () => {
									if (typeof status.loadMore === 'function') {
										await status.loadMore(50);
									}
									if (typeof status.loadStatusMsgs === 'function') {
										await status.loadStatusMsgs();
									}
								})(),
								new Promise(resolve => setTimeout(resolve, 2500)),
							]);
						} catch {
							/* ignore */
						}
					};

					let found: any = null;

					// Direct id lookup first (works even when StatusV3 contact is keyed
					// differently for @lid vs @c.us).
					for (const candidateId of alternateStatusIds()) {
						try {
							if (typeof WPP?.chat?.getMessageById === 'function') {
								const msg = await WPP.chat.getMessageById(candidateId);
								if (msg && (matches(msg) || candidateId === targetId)) {
									found = Array.isArray(msg) ? msg[0] : msg;
									if (found) break;
								}
							}
						} catch {
							/* continue */
						}
						try {
							const msgStore = WPP?.whatsapp?.MsgStore;
							const msg =
								(typeof msgStore?.get === 'function' && msgStore.get(candidateId)) ||
								null;
							if (msg) {
								found = msg;
								break;
							}
						} catch {
							/* continue */
						}
					}

					const store = WPP?.whatsapp?.StatusV3Store;
					if (!found && store) {
						try {
							if (typeof store.sync === 'function') await store.sync();
							if (typeof store.loadMore === 'function') await store.loadMore();
						} catch {
							/* ignore */
						}

						const modelPools = [
							typeof store.getUnexpired === 'function'
								? store.getUnexpired(true)
								: null,
							typeof store.getModelsArray === 'function'
								? store.getModelsArray()
								: null,
							store.models,
							store._models,
						];
						const modelMap = new Map<string, any>();
						for (const pool of modelPools) {
							const models = Array.isArray(pool)
								? pool
								: pool instanceof Map
									? [...pool.values()]
									: [];
							for (const model of models) {
								const id = contactIdOf(model) || `anon-${modelMap.size}`;
								if (!modelMap.has(id)) modelMap.set(id, model);
							}
						}

						for (const sender of senders) {
							try {
								const byApi =
									(typeof WPP?.status?.get === 'function' &&
										WPP.status.get(sender)) ||
									(typeof store.get === 'function' && store.get(sender)) ||
									null;
								if (byApi) {
									const id = contactIdOf(byApi) || sender;
									modelMap.set(id, byApi);
								}
							} catch {
								/* continue */
							}
						}

						const models = [...modelMap.values()];
						const preferred = models.filter(status =>
							sameIdentity(contactIdOf(status)),
						);
						const ordered = [
							...preferred,
							...models.filter(status => !sameIdentity(contactIdOf(status))),
						];

						// Pass 1: preferred sender contacts. Pass 2: every contact by msg key.
						for (const restrictToSender of [true, false]) {
							if (found) break;
							const scanList = restrictToSender ? preferred : ordered;
							for (const status of scanList) {
								await ensureStatusMsgs(status);
								found = collectMsgs(status).find(matches) || null;
								if (found) break;
							}
						}

						if (!found) {
							try {
								const mine =
									(typeof store.getMyStatus === 'function' &&
										store.getMyStatus()) ||
									(WPP?.status?.getMyStatus &&
										(await WPP.status.getMyStatus()));
								if (mine) {
									await ensureStatusMsgs(mine);
									found = collectMsgs(mine).find(matches) || null;
								}
							} catch {
								/* ignore */
							}
						}
					}

					if (!found) {
						const msgStore = WPP?.whatsapp?.MsgStore;
						const msgs =
							(typeof msgStore?.getModelsArray === 'function' &&
								msgStore.getModelsArray()) ||
							msgStore?.models ||
							[];
						for (const msg of msgs) {
							const isStatus =
								msg?.isStatusV3 ||
								msg?.id?.remote === 'status@broadcast' ||
								String(msg?.from || '').includes('status@broadcast') ||
								String(msg?.to || '').includes('status@broadcast');
							if (!isStatus || !matches(msg)) continue;
							found = msg;
							break;
						}
					}

					// Last resort: try downloading by known ids without a Msg model.
					if (!found) {
						for (const candidateId of alternateStatusIds()) {
							try {
								const media = await WPP.chat.downloadMedia(candidateId);
								if (isAcceptable(media, 'image')) {
									const uri = await toDataUri(media, 'image/jpeg');
									if (uri) return uri;
								}
							} catch {
								/* continue */
							}
						}
						throw new Error(
							`Status message not found in WhatsApp store for id ${targetId}`,
						);
					}

					const mimeHint =
						found.mimetype ||
						found.mediaData?.mimetype ||
						(String(found.type || '').includes('video')
							? 'video/mp4'
							: String(found.type || '').includes('sticker')
								? 'image/webp'
								: 'image/jpeg');
					const blob = await forceDownloadMsg(found);
					if (!blob) {
						throw new Error(
							'Full status media could not be downloaded from WhatsApp',
						);
					}
					const uri = await toDataUri(blob, mimeHint);
					if (!uri) {
						throw new Error('Status media could not be encoded');
					}
					return uri;
				},
				statusId,
				senderCandidates,
			);

			return dataUri;
		} catch (error: any) {
			const detail =
				error?.message ||
				(typeof error === 'string' ? error : null) ||
				'Status media download failed';
			this.logger.warn(
				`downloadStatus failed for ${statusId}: ${detail === 'Object' ? 'WhatsApp store lookup failed' : detail}`,
			);
			throw new Error(
				detail === 'Object' || detail.includes('_serialized')
					? 'Status media is unavailable from WhatsApp. Refresh stories and try again.'
					: detail,
			);
		}
	}

	async getStatuses() {
		if (this.state !== 'connected' || !this.client?.page) {
			return [];
		}
		const mainReady = await this.waitForWhatsAppMainReady(12_000);
		if (!mainReady) {
			this.logger.warn('Status fetch skipped: WhatsApp main is not ready yet');
			return [];
		}
		const TIMEOUT_MS = 45_000;
		try {
			const items = await Promise.race([
				this.collectStatusesFromPage(),
				new Promise<any[]>(resolve => setTimeout(() => resolve([]), TIMEOUT_MS)),
			]);
			const list = Array.isArray(items) ? items : [];
			if (list.length) {
				this.logger.log(`Fetched ${list.length} WhatsApp status item(s) from StatusV3Store`);
			} else {
				this.logger.warn('WhatsApp status store returned no items');
			}
			return list;
		} catch (error) {
			this.logger.warn(`Status synchronization is unavailable: ${String(error)}`);
			return [];
		}
	}

	private async waitForWhatsAppMainReady(maxMs = 12_000) {
		const page = this.client?.page;
		if (!page) return false;
		const started = Date.now();
		while (Date.now() - started < maxMs) {
			try {
				const ready = await page.evaluate(() => {
					const w = window as any;
					return Boolean(w.WPP?.conn?.isMainReady?.());
				});
				if (ready) return true;
			} catch {
				/* page may still be loading */
			}
			await new Promise(resolve => setTimeout(resolve, 400));
		}
		return false;
	}

	private async collectStatusesFromPage() {
		return this.client.page.evaluate(async () => {
			const browserWindow: any = window as any;
			const output: any[] = [];
			const seen = new Set<string>();
			const MAX_MSG_SCAN = 8000;

			const identityKeys = (value: unknown): string[] => {
				const text = String(value || '').trim();
				if (!text) return [];
				const keys = new Set<string>([text.toLowerCase()]);
				const broadcastMatch = text.match(/status@broadcast_([^_]+)/i);
				if (broadcastMatch?.[1]) keys.add(broadcastMatch[1].toLowerCase());
				const hexMatch = text.match(/_([0-9A-Fa-f]{10,}|3A[0-9A-Fa-f]+)(?:_|$)/);
				if (hexMatch?.[1]) keys.add(hexMatch[1].toLowerCase());
				const bare = text.includes('_') ? text.split('_').pop() || '' : text;
				if (/^[0-9A-Fa-f]{10,}$/i.test(bare) || /^3A[0-9A-Fa-f]+$/i.test(bare)) {
					keys.add(bare.toLowerCase());
				}
				if (/^\d+$/.test(text)) keys.add(text);
				return [...keys];
			};

			const looksLikeMedia = (value: unknown) => {
				const text = String(value || '');
				return (
					text.startsWith('/9j/') ||
					text.startsWith('data:') ||
					text.startsWith('iVBOR') ||
					text.startsWith('AAAA') ||
					text.length > 400
				);
			};

			const resolveId = (message: any): string => {
				if (message?.id?._serialized) return String(message.id._serialized);
				if (typeof message?.id === 'string' && message.id.includes('_')) {
					return message.id;
				}
				if (
					message?.id &&
					typeof message.id === 'object' &&
					message.id.remote != null &&
					message.id.id != null
				) {
					const fromMe = message.id.fromMe ? 'true' : 'false';
					const remote = message.id.remote;
					const id = message.id.id;
					const participant =
						message.id.participant?._serialized ||
						message.id.participant ||
						message.author?._serialized ||
						message.author ||
						'';
					return participant
						? `${fromMe}_${remote}_${id}_${participant}`
						: `${fromMe}_${remote}_${id}`;
				}
				if (message?.rowId != null) return String(message.rowId);
				if (message?.id?.id != null) return String(message.id.id);
				return typeof message?.id === 'string' ? message.id : '';
			};

			const resolveType = (message: any): string => {
				const raw = String(message?.type || '').toLowerCase();
				if (raw === 'chat') return 'text';
				if (raw) return raw;
				const mime = String(message?.mimetype || message?.mediaData?.mimetype || '');
				if (mime.startsWith('video/')) return 'video';
				if (mime.startsWith('image/') || message?.mediaData) return 'image';
				if (message?.isStatusV3) return 'image';
				return 'text';
			};

			const push = (message: any, sender: string, contactName?: string) => {
				const id = resolveId(message);
				if (!id) return;
				const keys = identityKeys(id);
				if (keys.some(key => seen.has(key))) return;
				for (const key of keys) seen.add(key);
				const rawCaption = message?.caption || message?.text || null;
				const rawBody = message?.body || null;
				const caption =
					(rawCaption && !looksLikeMedia(rawCaption) ? rawCaption : null) ||
					(rawBody && !looksLikeMedia(rawBody) ? rawBody : null);
				output.push({
					id,
					from: sender,
					sender,
					contactName: contactName || null,
					type: resolveType(message),
					caption,
					body: caption,
					timestamp: message?.t || message?.timestamp || null,
					fromMe: Boolean(message?.id?.fromMe || message?.fromMe),
					isOwn: Boolean(message?.id?.fromMe || message?.fromMe),
				});
			};

			const scanMsgStoreForStatuses = () => {
				const msgStore = browserWindow.WPP?.whatsapp?.MsgStore;
				const msgs =
					(typeof msgStore?.getModelsArray === 'function' &&
						msgStore.getModelsArray()) ||
					msgStore?.models ||
					[];
				const start = Math.max(0, msgs.length - MAX_MSG_SCAN);
				for (let index = msgs.length - 1; index >= start; index -= 1) {
					const msg = msgs[index];
					const isStatus =
						msg?.isStatusV3 ||
						msg?.id?.remote === 'status@broadcast' ||
						String(msg?.from || '').includes('status@broadcast') ||
						String(msg?.to || '').includes('status@broadcast');
					if (!isStatus) continue;
					const contactId = String(
						msg?.author?._serialized ||
							msg?.author ||
							msg?.from?._serialized ||
							msg?.from ||
							msg?.id?.participant?._serialized ||
							msg?.id?.participant ||
							'',
					);
					if (!contactId || contactId === 'status@broadcast') continue;
					push(msg, contactId, msg?.notifyName || null);
				}
			};

			const readMessages = (status: any): any[] => {
				try {
					if (typeof status?.getAllMsgs === 'function') {
						return status.getAllMsgs() || [];
					}
					if (status?.msgs?.getModelsArray) {
						return status.msgs.getModelsArray() || [];
					}
					if (Array.isArray(status?.msgs?.models)) return status.msgs.models;
					if (Array.isArray(status?.msgs)) return status.msgs;
				} catch {
					/* ignore */
				}
				return [];
			};

			const resolveSender = (status: any) =>
				String(
					status?.id?._serialized ||
						(typeof status?.id?.toString === 'function'
							? status.id.toString()
							: status?.id) ||
						'',
				);

			const waitForStatusStore = async () => {
				const started = Date.now();
				let syncRequested = false;
				while (Date.now() - started < 10_000) {
					const store = browserWindow.WPP?.whatsapp?.StatusV3Store;
					if (store) {
						if (!syncRequested) {
							syncRequested = true;
							try {
								if (typeof store.sync === 'function') {
								await store.sync();
							}
							} catch {
								/* store may already be synchronizing */
							}
						}
						if (typeof store.hasSynced === 'function' && store.hasSynced()) {
							return store;
						}
						let unexpired = null;
						try {
							unexpired =
								typeof store.getUnexpired === 'function'
									? store.getUnexpired(true)
									: null;
						} catch {
							/* API shape differs between WhatsApp Web versions */
						}
						if (Array.isArray(unexpired) && unexpired.length > 0) {
							return store;
						}
					}
					try {
						if (browserWindow.WPP?.conn?.isMainReady?.()) {
							const lateStore = browserWindow.WPP?.whatsapp?.StatusV3Store;
							if (lateStore) return lateStore;
						}
					} catch {
						/* ignore */
					}
					await new Promise(resolve => setTimeout(resolve, 350));
				}
				return browserWindow.WPP?.whatsapp?.StatusV3Store || null;
			};

			const store = await waitForStatusStore();
			if (store) {
				try {
					if (typeof store.sync === 'function') await store.sync();
					for (let round = 0; round < 4; round += 1) {
						if (typeof store.loadMore === 'function') {
							await store.loadMore();
						}
						await new Promise(resolve => setTimeout(resolve, 350));
					}
				} catch {
					/* ignore */
				}
				await new Promise(resolve => setTimeout(resolve, 800));

				const modelMap = new Map<string, any>();
				const addModel = (model: any) => {
					const sender = resolveSender(model);
					if (!model) return;
					const key =
						sender && sender !== 'status@broadcast'
							? sender
							: `status-model-${modelMap.size}`;
					if (!modelMap.has(key)) modelMap.set(key, model);
				};
				const safeRead = (reader: () => any) => {
					try {
						return reader();
					} catch {
						return null;
					}
				};
				const pools = [
					safeRead(() => store.getUnexpired?.(true)),
					safeRead(() => store.getUnexpired?.()),
					safeRead(() => store.getModelsArray?.()),
					store.models,
					store._models,
				];
				for (const pool of pools) {
					const models = Array.isArray(pool)
						? pool
						: pool instanceof Map
							? [...pool.values()]
							: [];
					for (const model of models) addModel(model);
				}

				let processed = 0;
				for (const status of modelMap.values()) {
					processed += 1;
					const sender = resolveSender(status);
					let messages = readMessages(status);
					if (messages.length === 0) {
						try {
							await Promise.race([
								(async () => {
									if (typeof status.loadStatusMsgs === 'function') {
										await status.loadStatusMsgs();
									} else if (typeof status.loadMore === 'function') {
										await status.loadMore(80);
									}
								})(),
								new Promise((_, reject) =>
									setTimeout(() => reject(new Error('status load timeout')), 4500),
								),
							]);
							messages = readMessages(status);
						} catch {
							messages = readMessages(status);
						}
					}
					const contactName =
						status?.contact?.name || status?.contact?.pushname || null;
					if (messages.length === 0 && status.lastStatus) {
						const lastSender = String(
							status.lastStatus?.author?._serialized ||
								status.lastStatus?.author ||
								status.lastStatus?.id?.participant?._serialized ||
								status.lastStatus?.id?.participant ||
								sender,
						);
						push(status.lastStatus, lastSender, contactName);
					}
					for (const message of messages) {
						const messageSender = String(
							message?.author?._serialized ||
								message?.author ||
								message?.id?.participant?._serialized ||
								message?.id?.participant ||
								message?.from?._serialized ||
								message?.from ||
								sender,
						);
						if (messageSender && messageSender !== 'status@broadcast') {
							push(message, messageSender, contactName);
						}
					}
				}

				// Enrich from WPP.status API for contacts not fully hydrated in StatusV3Store.
				try {
					const wppStatus = browserWindow.WPP?.status;
					if (wppStatus && typeof wppStatus.get === 'function') {
						for (const status of modelMap.values()) {
							const sender = resolveSender(status);
							if (!sender || sender === 'status@broadcast') continue;
							try {
								const byApi = await wppStatus.get(sender);
								if (!byApi) continue;
								const contactName =
									byApi?.contact?.name || byApi?.contact?.pushname || null;
								let messages = readMessages(byApi);
								if (messages.length === 0 && byApi.lastStatus) {
									push(byApi.lastStatus, sender, contactName);
								}
								for (const message of messages) {
									const messageSender = String(
										message?.author?._serialized ||
											message?.author ||
											message?.id?.participant?._serialized ||
											message?.id?.participant ||
											sender,
									);
									if (messageSender && messageSender !== 'status@broadcast') {
										push(message, messageSender, contactName);
									}
								}
							} catch {
								/* per-contact */
							}
						}
					}
				} catch {
					/* ignore */
				}

				try {
					const mine =
						(typeof store.getMyStatus === 'function' && store.getMyStatus()) ||
						(browserWindow.WPP?.status?.getMyStatus &&
							(await browserWindow.WPP.status.getMyStatus()));
					if (mine) {
						let myMessages = readMessages(mine);
						if (myMessages.length === 0) {
							try {
								if (typeof mine.loadStatusMsgs === 'function') {
									await mine.loadStatusMsgs();
								} else if (typeof mine.loadMore === 'function') {
									await mine.loadMore(50);
								}
								myMessages = readMessages(mine);
							} catch {
								myMessages = readMessages(mine);
							}
						}
						const myId = resolveSender(mine);
						if (myId) {
							for (const msg of myMessages) {
								push(
									{
										...msg,
										fromMe: true,
										id: msg.id || { _serialized: msg.id, fromMe: true },
									},
									myId,
									'You',
								);
							}
						}
					}
				} catch {
					/* ignore */
				}
			}

			// StatusV3Store often hydrates slowly; MsgStore still holds recent status
			// messages even when the store snapshot is partial — always merge both.
			scanMsgStoreForStatuses();

			return output;
		});
	}

	private normalizeProviderStatus(item: any) {
		if (!item || typeof item !== 'object') return null;
		const id = String(
			item?.id?._serialized ||
				(typeof item?.id === 'string' || typeof item?.id === 'number' ? item.id : '') ||
				item?.messageId ||
				'',
		).trim();
		if (!id) return null;
		const senderWaId = String(
			item?.author?._serialized ||
				item?.from?._serialized ||
				item?.sender ||
				item?.author ||
				item?.from ||
				'',
		).trim();
		const rawCaption = item?.caption || item?.text || null;
		const rawBody = item?.body || null;
		const looksLikeMedia = (value: unknown) => {
			const text = String(value || '');
			return (
				text.startsWith('/9j/') ||
				text.startsWith('data:') ||
				text.startsWith('iVBOR') ||
				text.startsWith('AAAA') ||
				text.length > 400
			);
		};
		const caption =
			(rawCaption && !looksLikeMedia(rawCaption) ? rawCaption : null) ||
			(rawBody && !looksLikeMedia(rawBody) ? rawBody : null);
		const rawType = String(item?.type || '').toLowerCase();
		let type = rawType === 'chat' ? 'text' : rawType;
		if (!type) {
			const mime = String(item?.mimetype || item?.mediaData?.mimetype || '');
			if (mime.startsWith('video/')) type = 'video';
			else if (mime.startsWith('image/') || item?.mediaData) type = 'image';
			else type = item?.isStatusV3 ? 'image' : 'text';
		}
		return {
			id,
			from: senderWaId || undefined,
			sender: senderWaId || undefined,
			contactName: item?.contactName || item?.notifyName || item?.sender?.pushname || null,
			type,
			caption,
			body: caption,
			timestamp: item?.timestamp ?? item?.t ?? null,
			fromMe: Boolean(item?.id?.fromMe || item?.fromMe),
			isOwn: Boolean(item?.id?.fromMe || item?.fromMe || item?.isOwn),
		};
	}

	publishStatus(content: string, options: { type: string; caption?: string }) {
		if (options.type === 'text') return this.client.sendTextStatus(content);
		if (options.type === 'image') {
			return this.client.sendImageStatus(content, { caption: options.caption || '' });
		}
		if (options.type === 'video') {
			return this.client.sendVideoStatus(content, { caption: options.caption || '' });
		}
		throw new Error(`Unsupported status type: ${options.type}`);
	}

	viewStatus(statusId: string, senderWaId?: string) {
		const id = String(statusId || '');
		const sender = senderWaId ? String(senderWaId) : '';
		// Bare numeric rowIds cannot be passed to sendReadStatus (expects full WID).
		const looksLikeFullId = id.includes('@') || id.includes('status@broadcast');
		if (this.client.sendReadStatus && sender && looksLikeFullId) {
			return this.client.sendReadStatus(sender, id);
		}
		if (this.client.sendSeenStatus && looksLikeFullId) {
			return this.client.sendSeenStatus(id);
		}
		return Promise.resolve({ skipped: true, reason: 'status id is not a full WhatsApp WID' });
	}
}
