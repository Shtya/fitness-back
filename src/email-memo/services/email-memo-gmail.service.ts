import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailMemoGmailConnection } from '../entities/email-memo.entity';
import { EmailMemoCryptoService } from './email-memo-crypto.service';
import {
	extractGmailPayload,
	ExtractedGmailMessage,
	gmailRedirectUri,
	GmailOAuthTokens,
	resolveFrontendOrigin,
} from '../utils/email-memo.utils';

const GMAIL_SCOPES = [
	'https://www.googleapis.com/auth/gmail.readonly',
	'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

@Injectable()
export class EmailMemoGmailService {
	private readonly logger = new Logger(EmailMemoGmailService.name);

	constructor(
		private readonly config: ConfigService,
		private readonly jwt: JwtService,
		private readonly crypto: EmailMemoCryptoService,
		@InjectRepository(EmailMemoGmailConnection)
		private readonly connections: Repository<EmailMemoGmailConnection>,
	) {}

	private envRedirectUri() {
		return gmailRedirectUri(
			this.config.get<string>('GOOGLE_REDIRECT_URI') ||
				this.config.get<string>('GOOGLE_REDIRECT_BASE_URL') ||
				process.env.GOOGLE_REDIRECT_URI ||
				process.env.GOOGLE_REDIRECT_BASE_URL,
		);
	}

	private maskClientId(id: string) {
		const value = String(id || '').trim();
		if (value.length < 12) return value ? '••••' : '';
		return `${value.slice(0, 8)}…${value.slice(-6)}`;
	}

	private static readonly MAX_ACCOUNTS = 5;

	async listForUser(userId: string) {
		return this.connections.find({
			where: { userId },
			order: { createdAt: 'ASC' },
		});
	}

	toPublicAccount(row: EmailMemoGmailConnection) {
		return {
			id: row.id,
			connected: row.status === 'connected',
			status: row.status,
			email: row.gmailAddress,
			lastSyncedAt: row.lastSyncedAt,
			watchEnabled: Boolean(row.watchExpiration),
			lastError: row.lastError,
			connectedAt: row.connectedAt,
		};
	}

	private async ensureCredentialsRow(userId: string) {
		const rows = await this.listForUser(userId);
		const withApp = rows.find((row) => row.encryptedOauthApp);
		if (withApp) return withApp;
		if (rows[0]) return rows[0];
		return this.connections.save(
			this.connections.create({
				userId,
				gmailAddress: null,
				encryptedTokens: null,
				status: 'disconnected',
			}),
		);
	}

	private async copyOauthToAll(userId: string, encryptedOauthApp: string, verifiedAt: Date | null) {
		const rows = await this.listForUser(userId);
		for (const row of rows) {
			row.encryptedOauthApp = encryptedOauthApp;
			row.oauthVerifiedAt = verifiedAt;
			if (row.status === 'disconnected') row.status = 'credentials_saved';
			await this.connections.save(row);
		}
	}

	async oauthAppMeta(userId: string) {
		const app = await this.resolveOAuthApp(userId);
		const rows = await this.listForUser(userId);
		const verifiedAt = rows.find((row) => row.oauthVerifiedAt)?.oauthVerifiedAt || null;
		const configured = Boolean(app.clientId && app.clientSecret);
		const easyConnect = app.source === 'env' && configured;
		const verified = Boolean(verifiedAt) || easyConnect;
		return {
			configured,
			verified,
			easyConnect,
			readyToConnect: verified,
			source: app.source,
			clientIdMasked: app.clientId ? this.maskClientId(app.clientId) : '',
			hasClientSecret: Boolean(app.clientSecret),
			redirectUri: this.envRedirectUri(),
			maxAccounts: EmailMemoGmailService.MAX_ACCOUNTS,
		};
	}

	async saveOAuthApp(userId: string, clientId: string, clientSecret?: string) {
		const id = String(clientId || '').trim();
		if (!id) throw new BadRequestException('Google Client ID is required');
		const row = await this.ensureCredentialsRow(userId);
		const previous = row.encryptedOauthApp
			? this.crypto.decrypt<{ clientId: string; clientSecret: string }>(row.encryptedOauthApp)
			: { clientId: '', clientSecret: '' };
		const secret = String(clientSecret || '').trim() || previous.clientSecret;
		if (!secret) throw new BadRequestException('Google Client Secret is required');
		const encrypted = this.crypto.encrypt({ clientId: id, clientSecret: secret });
		row.encryptedOauthApp = encrypted;
		row.oauthVerifiedAt = null;
		if (row.status !== 'connected') row.status = 'credentials_saved';
		row.lastError = null;
		await this.connections.save(row);
		await this.copyOauthToAll(userId, encrypted, null);
		return this.oauthAppMeta(userId);
	}

	async testOAuthApp(userId: string, clientId?: string, clientSecret?: string) {
		if (String(clientId || '').trim()) {
			await this.saveOAuthApp(userId, String(clientId).trim(), clientSecret);
		}
		const app = await this.resolveOAuthApp(userId);
		if (!app.clientId || !app.clientSecret) {
			throw new BadRequestException('Enter your Google Client ID and Client Secret first.');
		}
		const body = new URLSearchParams({
			code: 'email-memo-credential-test',
			client_id: app.clientId,
			client_secret: app.clientSecret,
			redirect_uri: this.envRedirectUri(),
			grant_type: 'authorization_code',
		});
		const res = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
		});
		const raw: any = await res.json().catch(() => ({}));
		const error = String(raw?.error || '');
		if (error === 'invalid_client' || error === 'unauthorized_client') {
			throw new BadRequestException('Google rejected these Client ID / Client Secret values.');
		}
		if (error === 'redirect_uri_mismatch') {
			throw new BadRequestException(
				`Google rejected the redirect URI. Add this exact URI to the OAuth client: ${this.envRedirectUri()}`,
			);
		}
		const rows = await this.listForUser(userId);
		const verifiedAt = new Date();
		for (const row of rows) {
			row.oauthVerifiedAt = verifiedAt;
			await this.connections.save(row);
		}
		return {
			ok: true,
			...(await this.oauthAppMeta(userId)),
		};
	}

	private envOAuthApp() {
		const clientId = (
			this.config.get<string>('GOOGLE_CLIENT_ID') ||
			process.env.GOOGLE_CLIENT_ID ||
			''
		).trim();
		const clientSecret = (
			this.config.get<string>('GOOGLE_CLIENT_SECRET') ||
			process.env.GOOGLE_CLIENT_SECRET ||
			''
		).trim();
		return { clientId, clientSecret, source: 'env' as const };
	}

	private async resolveOAuthApp(userId?: string) {
		const envApp = this.envOAuthApp();
		if (envApp.clientId && envApp.clientSecret) return envApp;
		if (userId) {
			const rows = await this.listForUser(userId);
			const row = rows.find((item) => item.encryptedOauthApp) || rows[0];
			if (row?.encryptedOauthApp) {
				try {
					const app = this.crypto.decrypt<{ clientId: string; clientSecret: string }>(
						row.encryptedOauthApp,
					);
					if (app.clientId && app.clientSecret) {
						return { ...app, source: 'user' as const };
					}
				} catch {
					/* fall through */
				}
			}
		}
		return envApp;
	}

	googleConfigured() {
		const app = this.envOAuthApp();
		return Boolean(app.clientId && app.clientSecret);
	}

	async googleConfiguredForUser(userId: string) {
		const app = await this.resolveOAuthApp(userId);
		return Boolean(app.clientId && app.clientSecret);
	}

	async authUrl(userId: string, locale = 'en', connectionId?: string, returnOrigin?: string, popup = false) {
		const app = await this.resolveOAuthApp(userId);
		if (!app.clientId || !app.clientSecret) {
			throw new BadRequestException(
				'Enter your Google Client ID and Client Secret first, then test them.',
			);
		}
		if (app.source !== 'env') {
			const meta = await this.oauthAppMeta(userId);
			if (!meta.readyToConnect) {
				throw new BadRequestException(
					'Connect with Google is not ready yet. Use your Google Cloud keys in Advanced, test them, then connect.',
				);
			}
		}
		const frontendOrigin = resolveFrontendOrigin(
			returnOrigin,
			this.config.get<string>('FRONTEND_URL'),
		);
		const row = await this.resolveAuthTarget(userId, connectionId);
		const redirectUri = this.envRedirectUri();
		const state = this.jwt.sign(
			{
				purpose: 'email-memo-gmail',
				userId,
				locale,
				connectionId: row.id,
				returnOrigin: frontendOrigin,
				redirectUri,
				popup: Boolean(popup),
			},
			{ expiresIn: '15m' },
		);
		const params = new URLSearchParams({
			client_id: app.clientId,
			redirect_uri: redirectUri,
			response_type: 'code',
			scope: GMAIL_SCOPES,
			access_type: 'offline',
			prompt: 'consent select_account',
			include_granted_scopes: 'true',
			state,
		});
		return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
	}

	private async resolveAuthTarget(userId: string, connectionId?: string) {
		if (connectionId) {
			const row = await this.connections.findOne({ where: { id: connectionId, userId } });
			if (!row) throw new BadRequestException('Gmail connection not found');
			return row;
		}
		const rows = await this.listForUser(userId);
		const pending = rows.find(
			(row) => row.status !== 'connected' && !row.gmailAddress,
		);
		if (pending) return pending;
		if (rows.filter((row) => row.status === 'connected').length >= EmailMemoGmailService.MAX_ACCOUNTS) {
			throw new BadRequestException('Maximum number of Gmail accounts reached');
		}
		const source = rows.find((row) => row.encryptedOauthApp) || rows[0];
		return this.connections.save(
			this.connections.create({
				userId,
				gmailAddress: null,
				encryptedTokens: null,
				encryptedOauthApp: source?.encryptedOauthApp || null,
				oauthVerifiedAt: source?.oauthVerifiedAt || null,
				status: source?.encryptedOauthApp ? 'credentials_saved' : 'disconnected',
			}),
		);
	}

	frontendRedirect(
		locale: string,
		status: 'connected' | 'error',
		error?: string,
		returnOrigin?: string,
		popup?: boolean,
	) {
		const origin = resolveFrontendOrigin(returnOrigin, this.config.get<string>('FRONTEND_URL'));
		const loc = ['en', 'ar'].includes(locale) ? locale : 'en';
		const query = new URLSearchParams({ gmail: status });
		if (error) query.set('error', error.slice(0, 180));
		if (popup) query.set('popup', '1');
		return `${origin}/${loc}/dashboard/email-memo?${query.toString()}`;
	}

	async handleCallback(code: string, state: string) {
		let payload: any;
		try {
			payload = this.jwt.verify(state);
		} catch {
			throw new BadRequestException('Invalid or expired OAuth state');
		}
		if (payload?.purpose !== 'email-memo-gmail' || !payload?.userId) {
			throw new BadRequestException('Invalid OAuth state');
		}
		const tokens = await this.exchangeCode(code, payload.userId, payload.redirectUri);
		const profile = await this.gmailGet(tokens.accessToken, '/gmail/v1/users/me/profile');
		const email = String(profile?.emailAddress || '').trim().toLowerCase();
		if (!email) throw new BadRequestException('Gmail profile did not return an email address');
		const existing = await this.connections.findOne({
			where: { userId: payload.userId, gmailAddress: email },
		});
		let row = payload.connectionId
			? await this.connections.findOne({ where: { id: payload.connectionId, userId: payload.userId } })
			: null;
		if (existing && row && existing.id !== row.id && !row.gmailAddress) {
			await this.connections.remove(row);
			row = existing;
		} else if (existing) {
			row = existing;
		}
		if (!row) {
			row = this.connections.create({ userId: payload.userId });
		}
		const oauthSource = await this.ensureCredentialsRow(payload.userId);
		row.gmailAddress = email;
		row.encryptedOauthApp = row.encryptedOauthApp || oauthSource.encryptedOauthApp;
		row.oauthVerifiedAt = row.oauthVerifiedAt || oauthSource.oauthVerifiedAt || new Date();
		row.encryptedTokens = this.crypto.encrypt(tokens);
		row.historyId = String(profile?.historyId || '');
		row.connectedAt = new Date();
		row.status = 'connected';
		row.lastError = null;
		row.lastSyncedAt = null;
		await this.connections.save(row);
		await this.startWatch(row.id).catch((error) => {
			this.logger.warn(`Gmail watch not started: ${error instanceof Error ? error.message : error}`);
		});
		return {
			userId: payload.userId,
			locale: payload.locale || 'en',
			email,
			returnOrigin: payload.returnOrigin,
			popup: Boolean(payload.popup),
		};
	}

	async disconnect(userId: string, connectionId?: string) {
		const rows = connectionId
			? await this.connections.find({ where: { id: connectionId, userId } })
			: await this.listForUser(userId);
		for (const row of rows) {
			try {
				if (row.encryptedTokens) {
					await this.authedRequest(row, '/gmail/v1/users/me/stop', { method: 'POST' });
				}
			} catch {
				/* ignore */
			}
			row.encryptedTokens = null;
			row.gmailAddress = null;
			row.historyId = null;
			row.watchExpiration = null;
			row.status = row.encryptedOauthApp ? 'credentials_saved' : 'disconnected';
			row.lastError = null;
			await this.connections.save(row);
		}
		return { ok: true };
	}

	async getConnection(userId: string) {
		const rows = await this.listForUser(userId);
		return rows.find((row) => row.status === 'connected') || rows[0] || null;
	}

	async listConnectedForUser(userId: string) {
		return this.connections.find({ where: { userId, status: 'connected' } });
	}

	async getConnectionById(id: string) {
		return this.connections.findOne({ where: { id } });
	}

	async findByAddress(email: string) {
		return this.connections.findOne({
			where: { gmailAddress: String(email || '').trim().toLowerCase() },
		});
	}

	async listConnected() {
		return this.connections.find({ where: { status: 'connected' } });
	}

	pubsubTopic() {
		return this.config.get<string>('GMAIL_PUBSUB_TOPIC')?.trim() || '';
	}

	async startWatch(connectionId: string) {
		const topic = this.pubsubTopic();
		if (!topic) return null;
		const row = await this.connections.findOne({ where: { id: connectionId } });
		if (!row) return null;
		const data = await this.authedRequest(row, '/gmail/v1/users/me/watch', {
			method: 'POST',
			body: JSON.stringify({
				topicName: topic,
				labelIds: ['INBOX'],
				labelFilterBehavior: 'INCLUDE',
			}),
		});
		row.historyId = String(data?.historyId || row.historyId || '');
		row.watchExpiration = data?.expiration ? new Date(Number(data.expiration)) : null;
		row.lastError = null;
		await this.connections.save(row);
		return data;
	}

	async refreshWatches() {
		const rows = await this.listConnected();
		for (const row of rows) {
			try {
				await this.startWatch(row.id);
			} catch (error) {
				row.lastError = error instanceof Error ? error.message : String(error);
				await this.connections.save(row);
			}
		}
	}

	async listInboxMessageIds(
		connection: EmailMemoGmailConnection,
		opts: { max?: number; pageToken?: string; q?: string } = {},
	) {
		const max = Math.min(Math.max(Number(opts.max) || 50, 1), 100);
		const qs = new URLSearchParams({
			maxResults: String(max),
			q: String(opts.q || 'in:inbox'),
		});
		if (opts.pageToken) qs.set('pageToken', String(opts.pageToken));
		const data = await this.authedRequest(connection, `/gmail/v1/users/me/messages?${qs.toString()}`);
		return {
			messageIds: (data?.messages || [])
				.map((item: { id?: string }) => String(item?.id || '').trim())
				.filter(Boolean),
			nextPageToken: data?.nextPageToken || null,
			resultSizeEstimate: Number(data?.resultSizeEstimate || 0),
		};
	}

	async getMessage(connection: EmailMemoGmailConnection, gmailMessageId: string) {
		const raw = await this.authedRequest(
			connection,
			`/gmail/v1/users/me/messages/${encodeURIComponent(gmailMessageId)}?format=full`,
		);
		return extractGmailPayload(raw);
	}

	async listHistoryMessageIds(connection: EmailMemoGmailConnection) {
		if (!connection.historyId) return { messageIds: [] as string[], newHistoryId: '' };
		const ids = new Set<string>();
		let pageToken = '';
		let newHistoryId = connection.historyId;
		try {
			do {
				const qs = new URLSearchParams({
					startHistoryId: connection.historyId,
					historyTypes: 'messageAdded',
				});
				if (pageToken) qs.set('pageToken', pageToken);
				const data = await this.authedRequest(
					connection,
					`/gmail/v1/users/me/history?${qs.toString()}`,
				);
				newHistoryId = String(data?.historyId || newHistoryId);
				for (const item of data?.history || []) {
					for (const added of item.messagesAdded || []) {
						const id = String(added?.message?.id || '').trim();
						if (id) ids.add(id);
					}
				}
				pageToken = data?.nextPageToken || '';
			} while (pageToken);
		} catch (error: any) {
			const status = Number(error?.status || 0);
			if (status === 404 || status === 400) {
				this.logger.warn(`Gmail history expired for ${connection.gmailAddress}; resetting watermark`);
				const profile = await this.authedRequest(connection, '/gmail/v1/users/me/profile');
				return { messageIds: [], newHistoryId: String(profile?.historyId || connection.historyId) };
			}
			throw error;
		}
		return { messageIds: [...ids], newHistoryId };
	}

	async persistHistoryId(connection: EmailMemoGmailConnection, historyId: string) {
		if (!historyId || historyId === connection.historyId) return;
		connection.historyId = historyId;
		connection.lastSyncedAt = new Date();
		await this.connections.save(connection);
	}

	private async exchangeCode(code: string, userId: string, redirectUri?: string): Promise<GmailOAuthTokens> {
		const app = await this.resolveOAuthApp(userId);
		if (!app.clientId || !app.clientSecret) {
			throw new BadRequestException('Google OAuth app is not configured');
		}
		const body = new URLSearchParams({
			code,
			client_id: app.clientId,
			client_secret: app.clientSecret,
			redirect_uri: redirectUri || this.envRedirectUri(),
			grant_type: 'authorization_code',
		});
		const res = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
		});
		const raw: any = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new BadRequestException(raw?.error_description || 'Google token exchange failed');
		}
		if (!raw.refresh_token) {
			throw new BadRequestException(
				'Google did not return a refresh token. Disconnect and reconnect Gmail, then grant access again.',
			);
		}
		return {
			accessToken: raw.access_token,
			refreshToken: raw.refresh_token,
			expiryDate: Date.now() + Number(raw.expires_in || 3500) * 1000,
			scope: raw.scope,
		};
	}

	private async refreshTokens(tokens: GmailOAuthTokens, userId: string): Promise<GmailOAuthTokens> {
		const app = await this.resolveOAuthApp(userId);
		const body = new URLSearchParams({
			client_id: app.clientId,
			client_secret: app.clientSecret,
			refresh_token: tokens.refreshToken,
			grant_type: 'refresh_token',
		});
		const res = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
		});
		const raw: any = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw Object.assign(new Error(raw?.error_description || 'Google token refresh failed'), {
				status: res.status,
			});
		}
		return {
			accessToken: raw.access_token,
			refreshToken: tokens.refreshToken,
			expiryDate: Date.now() + Number(raw.expires_in || 3500) * 1000,
			scope: raw.scope || tokens.scope,
		};
	}

	private async authedRequest(
		connection: EmailMemoGmailConnection,
		path: string,
		init: RequestInit = {},
	) {
		if (!connection.encryptedTokens) {
			throw new Error('Gmail is not connected');
		}
		let tokens = this.crypto.decrypt<GmailOAuthTokens>(connection.encryptedTokens);
		if (!tokens.expiryDate || tokens.expiryDate < Date.now() + 30_000) {
			tokens = await this.refreshTokens(tokens, connection.userId);
			connection.encryptedTokens = this.crypto.encrypt(tokens);
			await this.connections.save(connection);
		}
		try {
			return await this.gmailGet(tokens.accessToken, path, init);
		} catch (error: any) {
			if (Number(error?.status) === 401) {
				tokens = await this.refreshTokens(tokens, connection.userId);
				connection.encryptedTokens = this.crypto.encrypt(tokens);
				await this.connections.save(connection);
				return this.gmailGet(tokens.accessToken, path, init);
			}
			throw error;
		}
	}

	private async gmailGet(accessToken: string, path: string, init: RequestInit = {}) {
		const res = await fetch(`https://gmail.googleapis.com${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				...(init.body ? { 'Content-Type': 'application/json' } : {}),
				...(init.headers || {}),
			},
		});
		const raw = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw Object.assign(new Error(raw?.error?.message || `Gmail API HTTP ${res.status}`), {
				status: res.status,
				raw,
			});
		}
		return raw;
	}
}
