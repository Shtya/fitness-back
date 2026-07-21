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
		reactions: true,
		messageActions: true,
	};

	private readonly logger = new Logger(WppConnectProvider.name);
	private client: any;
	private listeners: Array<(event: WhatsAppProviderEvent) => void | Promise<void>> = [];
	private qr: string | null = null;
	private state = 'disconnected';
	private emitChain: Promise<void> = Promise.resolve();
	private authReconcileTimer: ReturnType<typeof setInterval> | null = null;
	private authReconcileStopTimer: ReturnType<typeof setTimeout> | null = null;
	private statusChangeTimer: ReturnType<typeof setTimeout> | null = null;

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
		this.authReconcileStopTimer = setTimeout(() => this.stopAuthReconciliation(), 5 * 60 * 1000);
	}

	private async publishQr(base64Qr: string, rawCode?: string) {
		// Ignore a spurious QR only while the provider is still genuinely authenticated.
		if (this.state === 'connected') {
			try {
				if (await this.client?.isAuthenticated?.()) return;
			} catch {
				// Authentication is no longer valid, so expose the new QR below.
			}
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
		this.state = 'qr_pending';
		this.emit({ type: 'qr', qr: value });
		this.emit({ type: 'connection', status: this.state });
	}

	private async markConnected() {
		if (this.state === 'connected') return;
		this.state = 'connected';
		this.qr = null;
		this.stopAuthReconciliation();
		let phoneNumber: string | undefined;
		try {
			const host = await this.client?.getHostDevice?.();
			phoneNumber = host?.wid?.user || host?.id?.user;
		} catch {}
		this.emit({ type: 'connection', status: this.state, phoneNumber });
	}

	async disconnect() {
		this.stopAuthReconciliation();
		if (this.statusChangeTimer) {
			clearTimeout(this.statusChangeTimer);
			this.statusChangeTimer = null;
		}
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
			let lastError: unknown;
			for (let attempt = 1; attempt <= 5; attempt += 1) {
				try {
					const listed = await withTimeout(
						this.client.listChats({ count }),
						25000,
						'listChats',
					);
					if (Array.isArray(listed) && listed.length) return listed;
					lastError = new Error('WhatsApp chat store is not ready yet');
				} catch (error) {
					lastError = error;
				}
				if (attempt < 5) {
					await new Promise(resolve => setTimeout(resolve, 2000));
				}
			}
			throw lastError instanceof Error
				? lastError
				: new Error('Could not read chats from WhatsApp');
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
			messages = await this.withTimeout(
				this.client.getMessages(chatId, {
					count,
					id: options.before || options.after || undefined,
					direction: options.before ? 'before' : options.after ? 'after' : undefined,
				}),
				30000,
				`getMessages(${chatId})`,
			);
		} else {
			messages = await this.withTimeout(
				this.client.getAllMessagesInChat(chatId, true, false),
				30000,
				`getAllMessagesInChat(${chatId})`,
			);
			messages = messages.slice(-count);
		}
		return (messages || [])
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

	private async convertVoiceToOgg(filePath: string): Promise<string> {
		const path = require('path');
		const os = require('os');
		const fs = require('fs');
		const { spawn } = require('child_process');
		const outputPath = path.join(
			os.tmpdir(),
			`whatsapp-voice-${this.accountId}-${Date.now()}-${Math.random()
				.toString(36)
				.slice(2)}.ogg`,
		);
		const executable = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
		try {
			await new Promise<void>((resolve, reject) => {
				const processHandle = spawn(
					executable,
					[
						'-y',
						'-i',
						filePath,
						'-vn',
						'-ac',
						'1',
						'-ar',
						'48000',
						'-c:a',
						'libopus',
						'-b:a',
						'32k',
						'-application',
						'voip',
						'-f',
						'ogg',
						outputPath,
					],
					{ windowsHide: true },
				);
				let stderr = '';
				const timer = setTimeout(() => {
					processHandle.kill();
					reject(new Error('Voice conversion timed out after 30000ms'));
				}, 30000);
				processHandle.stderr?.on('data', (chunk: Buffer) => {
					stderr = `${stderr}${chunk.toString()}`.slice(-2000);
				});
				processHandle.once('error', (error: Error) => {
					clearTimeout(timer);
					reject(error);
				});
				processHandle.once('close', (code: number) => {
					clearTimeout(timer);
					if (code === 0) resolve();
					else reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
				});
			});
			const converted = await fs.promises.stat(outputPath);
			if (!converted?.size) throw new Error('Converted voice file is empty');
			return outputPath;
		} catch (error) {
			await fs.promises.rm(outputPath, { force: true }).catch(() => {});
			throw error;
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
				const lower = filename.toLowerCase();
				const isWebm =
					lower.endsWith('.webm') || String(options.mimeType || '').includes('webm');
				let sendPath = filePath;
				let sendFilename = filename;
				let convertedPath: string | null = null;
				if (isWebm) {
					convertedPath = await this.convertVoiceToOgg(filePath);
					sendPath = convertedPath;
					sendFilename = filename.replace(/\.webm$/i, '.ogg');
					if (sendFilename === filename) sendFilename = `${filename}.ogg`;
				}
				try {
				const buffer: Buffer = await fs.promises.readFile(sendPath);
				if (!buffer?.length) throw new Error('Voice file is empty');
				const mimeWithParameters =
					convertedPath
						? 'audio/ogg'
						: options.mimeType ||
							(lower.endsWith('.ogg')
						? 'audio/ogg; codecs=opus'
						: lower.endsWith('.mp3')
							? 'audio/mpeg'
							: lower.endsWith('.m4a') || lower.endsWith('.mp4')
								? 'audio/mp4'
								: isWebm
									? 'audio/webm; codecs=opus'
									: 'audio/ogg; codecs=opus');
				// WPP validates data URLs against a strict MIME pattern. Codec
				// parameters (especially the space in "; codecs=opus") make an
				// otherwise valid recording fail with `invalid_data_url`.
				const mime = String(mimeWithParameters).split(';')[0].trim() || 'audio/ogg';
				const base64 = `data:${mime};base64,${buffer.toString('base64')}`;
				const sendAudio = (isPtt: boolean) => {
					if (typeof this.client.sendPttFromBase64 === 'function') {
						return this.client.sendPttFromBase64(
							target,
							base64,
							sendFilename,
							options.caption || '',
							options.quotedProviderMessageId,
							undefined,
							isPtt,
						);
					}
					return this.client.sendFile(target, base64, {
						type: 'audio',
						isPtt,
						filename: sendFilename,
						caption: options.caption || '',
						quotedMsg: options.quotedProviderMessageId,
						waitForAck: true,
					});
				};
				// Browser MediaRecorder usually produces webm/opus. WhatsApp Web often
				// rejects that as PTT (cryptic puppeteer "t" errors) — send as audio first.
				const attempts = convertedPath ? [true, false] : isWebm ? [false, true] : [true, false];
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
						this.client.sendFile(target, sendPath, {
							filename: sendFilename,
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
				} finally {
					if (convertedPath) {
						await fs.promises.rm(convertedPath, { force: true }).catch(() => {});
					}
				}
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
		if (this.state !== 'connected' || !this.client?.page) {
			return [];
		}
		const mainReady = await this.waitForWhatsAppMainReady(12_000);
		if (!mainReady) {
			this.logger.warn('Status fetch skipped: WhatsApp main is not ready yet');
			return [];
		}
		const TIMEOUT_MS = 20_000;
		try {
			const items = await Promise.race([
				this.collectStatusesFromPage(),
				new Promise<any[]>(resolve => setTimeout(() => resolve([]), TIMEOUT_MS)),
			]);
			const list = Array.isArray(items) ? items : [];
			if (list.length) {
				this.logger.log(`Fetched ${list.length} WhatsApp status item(s)`);
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
			const MAX_CONTACTS = 20;
			const MAX_MSG_SCAN = 2500;

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
					if (typeof store.loadMore === 'function') await store.loadMore();
				} catch {
					/* ignore */
				}
				await new Promise(resolve => setTimeout(resolve, 600));

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
					if (processed >= MAX_CONTACTS) break;
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
										await status.loadMore(12);
									}
								})(),
								new Promise((_, reject) =>
									setTimeout(() => reject(new Error('status load timeout')), 400),
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
									await mine.loadMore(12);
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

			if (output.length === 0) {
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
							'',
					);
					if (!contactId || contactId === 'status@broadcast') continue;
					push(msg, contactId, msg?.notifyName || null);
				}
			}

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
