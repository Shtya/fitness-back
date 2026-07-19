import { Logger } from '@nestjs/common';
import {
	NormalizedWhatsAppMessage,
	WhatsAppProvider,
	WhatsAppProviderCapabilities,
	WhatsAppProviderEvent,
} from './whatsapp-provider';
import { whatsAppTimestampToDate } from '../utils/whatsapp-time';

declare const require: any;

function serializedId(value: any): string | null {
	return value?._serialized || value?.id || (typeof value === 'string' ? value : null);
}

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
	const normalizedType = type === 'chat' ? 'text' : type === 'ptt' ? 'audio' : type;

	const reliableTimestamp = whatsAppTimestampToDate(message?.timestamp ?? message?.t);

	return {
		providerMessageId,
		chatId,
		senderWaId: serializedId(message?.author) || serializedId(message?.sender?.id) || null,
		fromMe,
		type: normalizedType,
		text: displayText(message, normalizedType),
		// Never invent "now" for history — that pushes months-old chats to the top as "18 min".
		timestamp: reliableTimestamp || new Date(0),
		timestampReliable: Boolean(reliableTimestamp),
		quotedProviderMessageId:
			serializedId(message?.quotedMsg?.id) ||
			serializedId(message?.quotedMessageId) ||
			null,
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
		raw: message,
	};
}

function pathExtFromMime(mime?: string | null) {
	const value = String(mime || '').toLowerCase();
	if (value.includes('ogg')) return '.ogg';
	if (value.includes('webm')) return '.webm';
	if (value.includes('mpeg') || value.includes('mp3')) return '.mp3';
	if (value.includes('mp4') || value.includes('m4a')) return '.m4a';
	return '';
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
	};

	private readonly logger = new Logger(WppConnectProvider.name);
	private client: any;
	private listeners: Array<(event: WhatsAppProviderEvent) => void | Promise<void>> = [];
	private qr: string | null = null;
	private state = 'disconnected';
	private emitChain: Promise<void> = Promise.resolve();

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

	async connect() {
		let wppconnect: any;
		try {
			wppconnect = require('@wppconnect-team/wppconnect');
		} catch {
			throw new Error(
				'@wppconnect-team/wppconnect is not installed. Install it before connecting an account.',
			);
		}

		this.state = 'connecting';
		this.emit({ type: 'connection', status: this.state });
		// waitForLogin:false → create() returns once Chromium/WA-JS are up so HTTP
		// /connect does not hang while the phone is stuck on SYNCING.
		// deviceSyncTimeout:0 → do not auto-close the browser after 180s of sync.
		this.client = await wppconnect.create({
			session: this.accountId,
			tokenStore: this.tokenStore,
			headless: true,
			waitForLogin: false,
			autoClose: 0,
			deviceSyncTimeout: 0,
			disableWelcome: true,
			updatesLog: false,
			logQR: false,
			puppeteerOptions: {
				executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined,
				args: ['--no-sandbox', '--disable-setuid-sandbox'],
			},
			catchQR: (base64Qr: string, _ascii: string, _attempt: number, rawCode: string) => {
				this.publishQr(base64Qr, rawCode);
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
				if (['phoneNotConnected', 'browserClose', 'serverClose', 'autocloseCalled'].includes(String(status))) {
					this.logger.warn(`WhatsApp statusFind: ${status}`);
				}
			},
		});

		this.client.onMessage((message: any) => {
			const normalized = normalizeMessage(message);
			// Outbound echoes must never inflate unread / create fake inbound rows.
			if (normalized.fromMe) return;
			if (normalized.providerMessageId && normalized.chatId) {
				this.emit({ type: 'message', message: normalized });
			}
		});
		if (typeof this.client.onAnyMessage === 'function') {
			this.client.onAnyMessage((message: any) => {
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
		this.client.onStateChange((state: string) => {
			const value = String(state);
			if (['CONNECTED', 'MAIN', 'CONNECTED_PHONE'].includes(value)) {
				this.markConnected();
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

		// If the session token is already valid, mark connected immediately so the
		// dashboard stops blocking on /connect while WhatsApp Web finishes SYNCING.
		try {
			const authenticated = await this.client.isAuthenticated?.();
			if (authenticated) {
				await this.markConnected();
			}
		} catch (error) {
			this.logger.warn(`Could not probe WhatsApp auth state: ${String(error)}`);
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
	}

	private async publishQr(base64Qr: string, rawCode?: string) {
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
		this.state = 'qr_pending';
		this.emit({ type: 'qr', qr: value });
		this.emit({ type: 'connection', status: this.state });
	}

	private async markConnected() {
		if (this.state === 'connected') return;
		this.state = 'connected';
		this.qr = null;
		let phoneNumber: string | undefined;
		try {
			const host = await this.client?.getHostDevice?.();
			phoneNumber = host?.wid?.user || host?.id?.user;
		} catch {}
		this.emit({ type: 'connection', status: this.state, phoneNumber });
	}

	async disconnect() {
		await this.client?.close?.();
		this.client = null;
		this.qr = null;
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

	getState() {
		return this.state;
	}

	async getChats(limit = 50) {
		const count = Math.min(Math.max(Number(limit) || 50, 1), 200);
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

		// Prefer a bounded listChats call — getAllChats can hang forever on large inboxes.
		if (typeof this.client?.listChats === 'function') {
			try {
				const listed = await withTimeout(
					this.client.listChats({ count, onlyUsers: false }),
					25000,
					'listChats',
				);
				if (Array.isArray(listed) && listed.length) return listed;
			} catch (error) {
				this.logger.warn(
					`listChats failed/timeout for ${this.accountId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}
		if (typeof this.client?.getAllChats === 'function') {
			try {
				const chats =
					(await withTimeout(this.client.getAllChats(), 20000, 'getAllChats')) || [];
				return (Array.isArray(chats) ? chats : []).slice(0, count);
			} catch (error) {
				this.logger.warn(
					`getAllChats failed/timeout for ${this.accountId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}
		return [];
	}

	async getMessages(
		chatId: string,
		options: { limit?: number; before?: string; after?: string } = {},
	) {
		const count = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
		let messages: any[] = [];
		if (this.client?.getMessages) {
			messages = await this.client.getMessages(chatId, {
				count,
				id: options.before || options.after || undefined,
				direction: options.before ? 'before' : options.after ? 'after' : undefined,
			});
		} else {
			messages = await this.client.getAllMessagesInChat(chatId, true, false);
			messages = messages.slice(-count);
		}
		return (messages || [])
			.map(normalizeMessage)
			.sort((a: any, b: any) => {
				const aTime = new Date(a?.providerTimestamp || 0).getTime();
				const bTime = new Date(b?.providerTimestamp || 0).getTime();
				if (aTime !== bTime) return aTime - bTime;
				return String(a?.providerMessageId || '').localeCompare(
					String(b?.providerMessageId || ''),
				);
			})
			.slice(-count);
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
		try {
			if (typeof this.client.getPnLidEntry === 'function') {
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
					if (digits) candidates.add(`${digits}@c.us`);
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

	async sendText(chatId: string, text: string, quotedProviderMessageId?: string) {
		const targets = await this.resolveSendableChatIds(chatId);
		let lastError: unknown;
		for (const target of targets) {
			try {
				const sendPromise = async () => {
					if (quotedProviderMessageId && this.client.reply) {
						return this.client.reply(target, text, quotedProviderMessageId);
					}
					try {
						return await this.client.sendText(target, text, {
							createChat: true,
							waitForAck: true,
							...(quotedProviderMessageId
								? { quotedMsg: quotedProviderMessageId }
								: {}),
						});
					} catch (error) {
						// Older clients reject unknown options — retry plain send.
						if (quotedProviderMessageId) throw error;
						return this.client.sendText(target, text);
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

	async sendMedia(
		chatId: string,
		filePath: string,
		options: {
			caption?: string;
			fileName?: string;
			isVoice?: boolean;
			mimeType?: string | null;
			quotedProviderMessageId?: string;
		} = {},
	) {
		const targets = await this.resolveSendableChatIds(chatId);
		const filename = options.fileName || require('path').basename(filePath) || 'file';
		let lastError: unknown;

		const sendToTarget = async (target: string) => {
			if (options.isVoice) {
				const fs = require('fs');
				const buffer: Buffer = await fs.promises.readFile(filePath);
				if (!buffer?.length) throw new Error('Voice file is empty');
				const lower = filename.toLowerCase();
				const isWebm =
					lower.endsWith('.webm') || String(options.mimeType || '').includes('webm');
				const mime =
					options.mimeType ||
					(lower.endsWith('.ogg')
						? 'audio/ogg; codecs=opus'
						: lower.endsWith('.mp3')
							? 'audio/mpeg'
							: lower.endsWith('.m4a') || lower.endsWith('.mp4')
								? 'audio/mp4'
								: isWebm
									? 'audio/webm; codecs=opus'
									: 'audio/ogg; codecs=opus');
				const base64 = `data:${mime};base64,${buffer.toString('base64')}`;
				const sendAudio = (isPtt: boolean) =>
					this.client.sendFile(target, base64, {
						type: 'audio',
						isPtt,
						filename,
						caption: options.caption || '',
						quotedMsg: options.quotedProviderMessageId,
						waitForAck: true,
					});
				// Browser MediaRecorder usually produces webm/opus. WhatsApp Web often
				// rejects that as PTT (cryptic puppeteer "t" errors) — send as audio first.
				const attempts = isWebm ? [false, true] : [true, false];
				let voiceError: unknown;
				for (const isPtt of attempts) {
					try {
						return await this.withTimeout(
							sendAudio(isPtt),
							60000,
							`sendVoice(${target},isPtt=${isPtt})`,
						);
					} catch (error) {
						voiceError = error;
						this.logger.warn(
							`Voice send failed (isPtt=${isPtt}): ${
								error instanceof Error ? error.message : String(error)
							}`,
						);
					}
				}
				try {
					return await this.withTimeout(
						this.client.sendFile(target, filePath, {
							filename,
							caption: options.caption || '',
							quotedMsg: options.quotedProviderMessageId,
							waitForAck: true,
						}),
						60000,
						`sendVoiceFile(${target})`,
					);
				} catch (error) {
					voiceError = error;
				}
				const detail =
					voiceError instanceof Error
						? voiceError.message
						: typeof voiceError === 'string'
							? voiceError
							: JSON.stringify(voiceError);
				throw new Error(`Failed to send voice note: ${detail || 'unknown WhatsApp error'}`);
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

	downloadMedia(providerMessageId: string) {
		return this.client.downloadMedia(providerMessageId);
	}

	/**
	 * Download status/story media at full quality.
	 * Status IDs often need `false_status@broadcast_<id>_<participant@c.us>`.
	 * Never return message.body — that is only a tiny WhatsApp thumbnail.
	 */
	async downloadStatus(providerStatusId: string, senderWaId?: string | null) {
		const statusId = String(providerStatusId || '');
		if (!statusId) throw new Error('downloadStatus: status id is required');
		const sender = senderWaId ? String(senderWaId) : '';

		try {
			const dataUri = await this.client.page.evaluate(
				async (targetId: string, targetSender: string) => {
					const browserWindow: any = window as any;
					const WPP = browserWindow.WPP;
					if (!WPP) throw new Error('WhatsApp WPP is not ready');

					const MIN_FULL_BYTES = 3_000;

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
						const hexMatch = text.match(/_([0-9A-Fa-f]{10,}|3A[0-9A-Fa-f]+)(?:_|$)/);
						if (hexMatch?.[1]) return hexMatch[1];
						return text;
					};

					const targetKey = extractKey(targetId);

					const idCandidates = (msg: any): string[] => {
						const values = [
							msg?.id?._serialized,
							typeof msg?.id === 'string' ? msg.id : null,
							msg?.rowId != null ? String(msg.rowId) : null,
							msg?.id?.id != null ? String(msg.id.id) : null,
							buildFullId(msg, targetSender),
						];
						return [...new Set(values.filter(Boolean).map(String))];
					};

					const matches = (msg: any) => {
						const candidates = idCandidates(msg);
						if (candidates.includes(targetId)) return true;
						if (targetKey && candidates.some(c => c.includes(targetKey))) return true;
						if (msg?.id?.id && String(msg.id.id) === targetKey) return true;
						if (targetSender) {
							const participant = participantOf(msg);
							const senderMatch =
								participant === targetSender ||
								participant.includes(targetSender) ||
								targetSender.includes(participant) ||
								participant.replace(/@.*/, '') ===
									targetSender.replace(/@.*/, '');
							if (senderMatch && targetKey && String(msg?.id?.id || '') === targetKey) {
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
							return `data:${mimeHint || 'application/octet-stream'};base64,${blob}`;
						}
						// OpaqueData / WhatsApp wrappers
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
							reader.onerror = () => reject(new Error('Failed to read media blob'));
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
								const cached = await LruMediaStore.get(filehash).catch(() => null);
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

						// Mirror wa-js downloadMedia: force expensive user-initiated download.
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
							buildFullId(msg, targetSender),
							msg?.id?._serialized,
							targetSender && targetKey
								? `false_status@broadcast_${targetKey}_${targetSender}`
								: null,
							targetId,
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

					let found: any = null;
					const store = WPP?.whatsapp?.StatusV3Store;

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

					if (store) {
						try {
							if (typeof store.sync === 'function') await store.sync();
							if (typeof store.loadMore === 'function') await store.loadMore();
						} catch {
							/* ignore */
						}

						const models =
							(typeof store.getUnexpired === 'function' && store.getUnexpired(true)) ||
							(typeof store.getModelsArray === 'function' && store.getModelsArray()) ||
							store.models ||
							[];

						// Prefer the sender's status collection when we know it.
						const ordered = [...models].sort((a, b) => {
							const aId = String(a?.id?._serialized || a?.id || '');
							const bId = String(b?.id?._serialized || b?.id || '');
							if (targetSender && aId === targetSender) return -1;
							if (targetSender && bId === targetSender) return 1;
							return 0;
						});

						for (const status of ordered) {
							const contactId = String(
								status?.id?._serialized ||
									(typeof status?.id?.toString === 'function'
										? status.id.toString()
										: status?.id) ||
									'',
							);
							if (targetSender && contactId) {
								const sameContact =
									contactId === targetSender ||
									contactId.replace(/@.*/, '') ===
										targetSender.replace(/@.*/, '') ||
									contactId.includes(targetSender.replace(/@.*/, '')) ||
									targetSender.includes(contactId.replace(/@.*/, ''));
								if (!sameContact) continue;
							}
							try {
								if (typeof status.loadMore === 'function') await status.loadMore(50);
								if (typeof status.loadStatusMsgs === 'function') {
									await status.loadStatusMsgs();
								}
							} catch {
								/* ignore */
							}
							found = collectMsgs(status).find(matches) || null;
							if (found) break;
						}

						if (!found) {
							try {
								const mine =
									(typeof store.getMyStatus === 'function' && store.getMyStatus()) ||
									(WPP?.status?.getMyStatus && (await WPP.status.getMyStatus()));
								if (mine) {
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

					if (!found) {
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
				sender,
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
		const direct = await this.client.getAllStatuses?.();
		if (Array.isArray(direct) && direct.length) return direct;
		try {
			return await this.client.page.evaluate(async () => {
				const browserWindow: any = window as any;
				const output: any[] = [];
				const seen = new Set<string>();

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

				const store = browserWindow.WPP?.whatsapp?.StatusV3Store;
				if (store) {
					for (let round = 0; round < 3; round += 1) {
						try {
							if (typeof store.sync === 'function') await store.sync();
							if (typeof store.loadMore === 'function') await store.loadMore();
						} catch {
							/* ignore */
						}
						await new Promise(resolve => setTimeout(resolve, 600));
					}

					const models =
						(typeof store.getUnexpired === 'function' && store.getUnexpired(true)) ||
						(typeof store.getModelsArray === 'function' && store.getModelsArray()) ||
						store.models ||
						[];

					for (const status of models) {
						const sender = String(
							status?.id?._serialized ||
								(typeof status?.id?.toString === 'function'
									? status.id.toString()
									: status?.id) ||
								'',
						);
						if (!sender || sender === 'status@broadcast') continue;

						let previousCount = -1;
						for (let round = 0; round < 4; round += 1) {
							try {
								if (typeof status.loadMore === 'function') await status.loadMore(50);
								if (typeof status.loadStatusMsgs === 'function') {
									await status.loadStatusMsgs();
								}
							} catch {
								/* ignore */
							}
							let count = 0;
							try {
								if (typeof status.getAllMsgs === 'function') {
									count = (status.getAllMsgs() || []).length;
								} else if (status.msgs?.getModelsArray) {
									count = (status.msgs.getModelsArray() || []).length;
								} else {
									count = Number(status.msgsLength || status.totalCount || 0);
								}
							} catch {
								count = 0;
							}
							if (count === previousCount) break;
							previousCount = count;
							await new Promise(resolve => setTimeout(resolve, 300));
						}

						let messages: any[] = [];
						try {
							if (typeof status.getAllMsgs === 'function') {
								messages = status.getAllMsgs() || [];
							} else if (status.msgs?.getModelsArray) {
								messages = status.msgs.getModelsArray() || [];
							} else if (Array.isArray(status.msgs?.models)) {
								messages = status.msgs.models;
							} else if (Array.isArray(status.msgs)) {
								messages = status.msgs;
							}
						} catch {
							messages = [];
						}
						const contactName =
							status?.contact?.name || status?.contact?.pushname || null;
						if (messages.length === 0 && status.lastStatus) {
							push(status.lastStatus, sender, contactName);
						}
						for (const message of messages) {
							push(message, sender, contactName);
						}
					}

					try {
						const mine =
							(typeof store.getMyStatus === 'function' && store.getMyStatus()) ||
							(browserWindow.WPP?.status?.getMyStatus &&
								(await browserWindow.WPP.status.getMyStatus()));
						if (mine) {
							try {
								if (typeof mine.loadMore === 'function') await mine.loadMore(50);
								if (typeof mine.loadStatusMsgs === 'function') {
									await mine.loadStatusMsgs();
								}
							} catch {
								/* ignore */
							}
							const myId = String(
								mine.id?._serialized ||
									(typeof mine.id?.toString === 'function'
										? mine.id.toString()
										: '') ||
									'',
							);
							if (myId) {
								let msgs: any[] = [];
								if (typeof mine.getAllMsgs === 'function') {
									msgs = mine.getAllMsgs() || [];
								}
								for (const msg of msgs) {
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

				// Always merge MsgStore broadcast statuses as a safety net.
				const msgStore = browserWindow.WPP?.whatsapp?.MsgStore;
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
					if (!isStatus) continue;
					const contactId = String(
						msg?.author?._serialized ||
							msg?.author ||
							msg?.from?._serialized ||
							msg?.from ||
							'',
					);
					if (!contactId || contactId === 'status@broadcast') continue;
					push(msg, contactId, msg?.notifyName || null);
				}

				return output;
			});
		} catch (error) {
			this.logger.warn(`Status synchronization is unavailable: ${String(error)}`);
			throw error instanceof Error
				? error
				: new Error('Status synchronization is unavailable');
		}
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
