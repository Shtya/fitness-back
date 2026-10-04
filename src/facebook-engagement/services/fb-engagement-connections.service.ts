import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { publicApiOrigin, resolveFrontendOrigin } from '../../email-memo/utils/email-memo.utils';
import {
	FbAccountStatus,
	FbAccountType,
	FbConnectionMethod,
	FbConnectionStatus,
	FbEngagementAccount,
	FbEngagementConnection,
} from '../entities/facebook-engagement.entity';
import { FbErrorClassification, FacebookGraphError, classifyFacebookError } from '../utils/fb-graph-errors';
import { FacebookGraphClient } from './facebook-graph.client';
import { FbEngagementActivityService } from './fb-engagement-activity.service';
import { FbEngagementCryptoService } from './fb-engagement-crypto.service';
import { FbEngagementJobsService } from './fb-engagement-jobs.service';

export const FB_ENGAGEMENT_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_engagement'];
const PUBLISH_SCOPE = 'pages_manage_engagement';
const PUBLISH_TASK = 'MODERATE';
const MAX_PAGE_SYNC_REQUESTS = 10;
const OAUTH_STATE_PURPOSE = 'fb-engagement-oauth';
const OAUTH_CLAIM_PURPOSE = 'fb-engagement-claim';

type GraphPage = {
	id: string;
	name: string;
	category?: string;
	tasks?: string[];
	access_token?: string;
	picture?: { data?: { url?: string } };
};

type GraphPaged<T> = { data?: T[]; paging?: { cursors?: { after?: string }; next?: string } };

type TokenIdentity = { id: string; name: string; type: 'user' | 'page'; category?: string; pictureUrl?: string };

@Injectable()
export class FbEngagementConnectionsService {
	private readonly logger = new Logger(FbEngagementConnectionsService.name);

	constructor(
		private readonly config: ConfigService,
		private readonly jwt: JwtService,
		private readonly graph: FacebookGraphClient,
		private readonly crypto: FbEngagementCryptoService,
		private readonly jobs: FbEngagementJobsService,
		private readonly activity: FbEngagementActivityService,
		@InjectDataSource() private readonly dataSource: DataSource,
		@InjectRepository(FbEngagementConnection)
		private readonly connections: Repository<FbEngagementConnection>,
		@InjectRepository(FbEngagementAccount)
		private readonly accounts: Repository<FbEngagementAccount>,
	) {}

	private appCredentials() {
		const appId = this.config.get<string>('FACEBOOK_APP_ID')?.trim() || '';
		const appSecret = this.config.get<string>('FACEBOOK_APP_SECRET')?.trim() || '';
		return { appId, appSecret, configured: Boolean(appId && appSecret) };
	}

	redirectUri() {
		const configured = this.config.get<string>('FACEBOOK_OAUTH_REDIRECT_URI')?.trim();
		return configured || `${publicApiOrigin()}/api/v1/facebook-engagement/oauth/callback`;
	}

	publicConfig() {
		return {
			oauthConfigured: this.appCredentials().configured,
			redirectUri: this.redirectUri(),
			scopes: FB_ENGAGEMENT_SCOPES,
			graphVersion: this.graph.graphVersion(),
		};
	}

	authUrl(userId: string, locale = 'en', returnOrigin?: string, popup = false) {
		const { appId, configured } = this.appCredentials();
		if (!configured) {
			throw new BadRequestException(
				'Facebook Login is not configured yet. Add FACEBOOK_APP_ID and FACEBOOK_APP_SECRET on the server, or connect with a Page access token.',
			);
		}
		const state = this.jwt.sign(
			{
				purpose: OAUTH_STATE_PURPOSE,
				userId,
				locale: locale === 'ar' ? 'ar' : 'en',
				returnOrigin: resolveFrontendOrigin(returnOrigin, this.config.get<string>('FRONTEND_URL')),
				popup,
			},
			{ expiresIn: '15m' },
		);
		const params = new URLSearchParams({
			client_id: appId,
			redirect_uri: this.redirectUri(),
			state,
			response_type: 'code',
			scope: FB_ENGAGEMENT_SCOPES.join(','),
		});
		return { url: `${this.graph.dialogUrl('/dialog/oauth')}?${params.toString()}` };
	}

	/**
	 * The callback only signs a short-lived claim bound to the user that started the flow.
	 * The logged-in frontend must redeem it, so a link crafted by someone else cannot attach
	 * the visitor's Pages to the attacker's account.
	 */
	callbackRedirect(code: string | undefined, state: string | undefined, error?: string) {
		let payload: { purpose?: string; userId?: string; locale?: string; returnOrigin?: string; popup?: boolean } = {};
		try {
			payload = state ? this.jwt.verify(state) : {};
		} catch {
			payload = {};
		}
		const origin = resolveFrontendOrigin(payload.returnOrigin, this.config.get<string>('FRONTEND_URL'));
		const locale = payload.locale === 'ar' ? 'ar' : 'en';
		const query = new URLSearchParams();
		if (payload.popup) query.set('popup', '1');
		const base = `${origin}/${locale}/dashboard/facebook-engagement/accounts`;

		if (payload.purpose !== OAUTH_STATE_PURPOSE || !payload.userId) {
			query.set('facebook', 'error');
			query.set('error', 'Invalid or expired sign-in session. Try connecting again.');
			return `${base}?${query.toString()}`;
		}
		if (error || !code) {
			query.set('facebook', 'error');
			query.set('error', (error || 'Facebook did not return an authorization code').slice(0, 180));
			return `${base}?${query.toString()}`;
		}
		const claim = this.jwt.sign(
			{ purpose: OAUTH_CLAIM_PURPOSE, userId: payload.userId, code },
			{ expiresIn: '10m' },
		);
		query.set('facebook', 'pending');
		return `${base}?${query.toString()}#fbclaim=${encodeURIComponent(claim)}`;
	}

	async completeOAuth(userId: string, claim: string) {
		let payload: { purpose?: string; userId?: string; code?: string };
		try {
			payload = this.jwt.verify(claim);
		} catch {
			throw new BadRequestException('The Facebook sign-in expired. Connect again.');
		}
		if (payload.purpose !== OAUTH_CLAIM_PURPOSE || !payload.code) {
			throw new BadRequestException('Invalid Facebook sign-in.');
		}
		if (payload.userId !== userId) {
			throw new ForbiddenException('This Facebook sign-in was started by a different user.');
		}

		const { appId, appSecret, configured } = this.appCredentials();
		if (!configured) throw new BadRequestException('Facebook Login is not configured on the server.');

		const shortLived = await this.graphCall(() =>
			this.graph.get<{ access_token: string }>('/oauth/access_token', null, {
				client_id: appId,
				client_secret: appSecret,
				redirect_uri: this.redirectUri(),
				code: payload.code,
			}),
		);
		const longLived = await this.exchangeLongLived(shortLived.access_token);
		const identity = await this.graphCall(() =>
			this.graph.get<{ id: string; name: string }>('/me', longLived.token, { fields: 'id,name' }),
		);
		const scopes = await this.grantedScopes(longLived.token);
		const connection = await this.upsertConnection(userId, FbConnectionMethod.OAUTH, {
			id: identity.id,
			name: identity.name,
			token: longLived.token,
			expiresAt: longLived.expiresAt,
			scopes,
		});
		const pages = await this.syncUserPages(connection, longLived.token, scopes);
		await this.activity.log(userId, {
			actorUserId: userId,
			action: 'connection.connected',
			level: 'success',
			message: `Connected Facebook account ${identity.name} with ${pages.length} Page(s).`,
			details: { connectionId: connection.id, method: 'oauth', scopes },
		});
		return this.connectionSummary(userId, connection.id);
	}

	async connectWithToken(userId: string, accessToken: string) {
		const identity = await this.identifyToken(accessToken);
		if (identity.type === 'user') {
			const exchanged = this.appCredentials().configured
				? await this.exchangeLongLived(accessToken).catch(() => ({ token: accessToken, expiresAt: null }))
				: { token: accessToken, expiresAt: null };
			const scopes = await this.grantedScopes(exchanged.token);
			const connection = await this.upsertConnection(userId, FbConnectionMethod.TOKEN, {
				id: identity.id,
				name: identity.name,
				token: exchanged.token,
				expiresAt: exchanged.expiresAt,
				scopes,
			});
			const pages = await this.syncUserPages(connection, exchanged.token, scopes);
			await this.activity.log(userId, {
				actorUserId: userId,
				action: 'connection.connected',
				level: 'success',
				message: `Connected ${identity.name} with a user token (${pages.length} Page(s)).`,
				details: { connectionId: connection.id, method: 'token', tokenType: 'user' },
			});
			return this.connectionSummary(userId, connection.id);
		}

		const connection = await this.upsertConnection(userId, FbConnectionMethod.TOKEN, {
			id: identity.id,
			name: identity.name,
			token: null,
			expiresAt: null,
			scopes: [],
		});
		await this.upsertPageAccount(connection, {
			id: identity.id,
			name: identity.name,
			category: identity.category,
			picture: identity.pictureUrl ? { data: { url: identity.pictureUrl } } : undefined,
			access_token: accessToken,
		}, { canPublish: true });
		await this.activity.log(userId, {
			actorUserId: userId,
			action: 'connection.connected',
			level: 'success',
			message: `Connected Page ${identity.name} with a Page access token.`,
			details: { connectionId: connection.id, method: 'token', tokenType: 'page' },
		});
		return this.connectionSummary(userId, connection.id);
	}

	async sync(userId: string, connectionId: string) {
		const connection = await this.connections
			.createQueryBuilder('connection')
			.addSelect('connection.encryptedToken')
			.where('connection.id = :connectionId AND connection.ownerUserId = :userId', { connectionId, userId })
			.getOne();
		if (!connection) throw new NotFoundException('Connection not found');
		if (connection.status === FbConnectionStatus.DISCONNECTED) {
			throw new BadRequestException('This connection is disconnected. Connect it again.');
		}

		try {
			if (connection.encryptedToken) {
				const token = this.crypto.decrypt(connection.encryptedToken);
				const scopes = await this.grantedScopes(token);
				await this.connections.update({ id: connection.id }, { scopes });
				await this.syncUserPages(connection, token, scopes);
			} else {
				const account = await this.accounts
					.createQueryBuilder('account')
					.addSelect('account.encryptedToken')
					.where('account.connectionId = :connectionId', { connectionId })
					.getOne();
				if (!account?.encryptedToken) throw new BadRequestException('No stored token for this connection.');
				const identity = await this.identifyToken(this.crypto.decrypt(account.encryptedToken));
				await this.accounts.update(
					{ id: account.id },
					{
						name: identity.name,
						category: identity.category ?? account.category,
						pictureUrl: identity.pictureUrl ?? account.pictureUrl,
						status: FbAccountStatus.ACTIVE,
						lastError: null,
						lastSyncedAt: new Date(),
					},
				);
				await this.connections.update(
					{ id: connection.id },
					{ status: FbConnectionStatus.CONNECTED, lastError: null, lastSyncedAt: new Date() },
				);
			}
		} catch (error) {
			const classification = classifyFacebookError(
				error instanceof BadRequestException ? error.cause : error,
			);
			if (classification.invalidatesToken) {
				await this.connections.update(
					{ id: connection.id },
					{ status: FbConnectionStatus.EXPIRED, lastError: classification.userMessage },
				);
			}
			throw error;
		}
		await this.activity.log(userId, {
			actorUserId: userId,
			action: 'connection.synced',
			message: `Refreshed Pages for ${connection.displayName ?? 'connection'}.`,
			details: { connectionId },
		});
		return this.connectionSummary(userId, connectionId);
	}

	async disconnect(userId: string, connectionId: string) {
		const connection = await this.connections.findOne({ where: { id: connectionId, ownerUserId: userId } });
		if (!connection) throw new NotFoundException('Connection not found');

		await this.dataSource.transaction(async (manager) => {
			const accountRows = await manager.getRepository(FbEngagementAccount).find({ where: { connectionId } });
			await this.jobs.cancelQueued(
				userId,
				{ accountIds: accountRows.map((row) => row.id) },
				'Account disconnected',
				manager,
			);
			await manager.getRepository(FbEngagementAccount).update(
				{ connectionId },
				{ status: FbAccountStatus.REVOKED, canPublishComments: false, encryptedToken: null },
			);
			await manager.getRepository(FbEngagementConnection).update(
				{ id: connectionId },
				{ status: FbConnectionStatus.DISCONNECTED, encryptedToken: null },
			);
		});
		await this.activity.log(userId, {
			actorUserId: userId,
			action: 'connection.disconnected',
			level: 'warning',
			message: `Disconnected ${connection.displayName ?? 'Facebook connection'}. Queued comments were cancelled.`,
			details: { connectionId },
		});
		return { ok: true };
	}

	async listConnections(userId: string) {
		const [rows, accounts] = await Promise.all([
			this.connections.find({
				where: { ownerUserId: userId, status: Not(FbConnectionStatus.DISCONNECTED) },
				order: { createdAt: 'DESC' },
			}),
			this.accounts.find({ where: { ownerUserId: userId }, order: { name: 'ASC' } }),
		]);
		return rows.map((row) => ({
			...row,
			accounts: accounts.filter((account) => account.connectionId === row.id),
		}));
	}

	listAccounts(userId: string, onlyActive = false) {
		return this.accounts.find({
			where: {
				ownerUserId: userId,
				...(onlyActive ? { status: FbAccountStatus.ACTIVE } : { status: Not(FbAccountStatus.REVOKED) }),
			},
			order: { name: 'ASC' },
		});
	}

	async getAccount(userId: string, accountId: string) {
		const account = await this.accounts.findOne({ where: { id: accountId, ownerUserId: userId } });
		if (!account) throw new NotFoundException('Page not found');
		return account;
	}

	findAccounts(userId: string, ids: string[]) {
		if (!ids.length) return Promise.resolve([] as FbEngagementAccount[]);
		return this.accounts.find({ where: { ownerUserId: userId, id: In(ids) } });
	}

	async accountToken(accountId: string) {
		const row = await this.accounts
			.createQueryBuilder('account')
			.addSelect('account.encryptedToken')
			.where('account.id = :accountId', { accountId })
			.getOne();
		if (!row?.encryptedToken) return null;
		return this.crypto.decrypt(row.encryptedToken);
	}

	async activeAccountToken(userId: string, accountId: string) {
		const account = await this.getAccount(userId, accountId);
		if (account.status !== FbAccountStatus.ACTIVE) {
			throw new BadRequestException('This Page connection is not active. Reconnect it first.');
		}
		const token = await this.accountToken(account.id);
		if (!token) throw new BadRequestException('No access token stored for this Page. Reconnect it.');
		return { account, token };
	}

	async recordAccountFailure(accountId: string, classification: FbErrorClassification) {
		if (classification.invalidatesToken) {
			const account = await this.accounts.findOne({ where: { id: accountId } });
			await this.accounts.update(
				{ id: accountId },
				{ status: FbAccountStatus.ERROR, lastError: classification.userMessage },
			);
			if (account) {
				await this.connections.update(
					{ id: account.connectionId },
					{ status: FbConnectionStatus.EXPIRED, lastError: classification.userMessage },
				);
			}
			return;
		}
		if (classification.kind === 'PERMISSION_DENIED') {
			await this.accounts.update(
				{ id: accountId },
				{ canPublishComments: false, lastError: classification.userMessage },
			);
		}
	}

	private async connectionSummary(userId: string, connectionId: string) {
		const connection = await this.connections.findOne({ where: { id: connectionId, ownerUserId: userId } });
		const accounts = await this.accounts.find({
			where: { connectionId, status: Not(FbAccountStatus.REVOKED) },
			order: { name: 'ASC' },
		});
		return { ...connection, accounts };
	}

	private async graphCall<T>(call: () => Promise<T>): Promise<T> {
		try {
			return await call();
		} catch (error) {
			const classification = classifyFacebookError(error);
			const message =
				error instanceof FacebookGraphError && classification.kind === 'UNKNOWN'
					? error.message
					: classification.userMessage;
			throw new BadRequestException(message, { cause: error });
		}
	}

	private async exchangeLongLived(token: string) {
		const { appId, appSecret } = this.appCredentials();
		const result = await this.graphCall(() =>
			this.graph.get<{ access_token: string; expires_in?: number }>('/oauth/access_token', null, {
				grant_type: 'fb_exchange_token',
				client_id: appId,
				client_secret: appSecret,
				fb_exchange_token: token,
			}),
		);
		return {
			token: result.access_token,
			expiresAt: result.expires_in ? new Date(Date.now() + result.expires_in * 1000) : null,
		};
	}

	private async grantedScopes(token: string) {
		try {
			const result = await this.graph.get<{ data?: Array<{ permission: string; status: string }> }>(
				'/me/permissions',
				token,
			);
			return (result.data ?? []).filter((row) => row.status === 'granted').map((row) => row.permission);
		} catch (error) {
			this.logger.warn(`Could not read granted permissions: ${error instanceof Error ? error.message : error}`);
			return [];
		}
	}

	private async identifyToken(token: string): Promise<TokenIdentity> {
		const me = await this.graphCall(() =>
			this.graph.get<{ id: string; name: string; metadata?: { type?: string } }>('/me', token, {
				fields: 'id,name',
				metadata: 1,
			}),
		);
		let type: 'user' | 'page' | null =
			me.metadata?.type === 'page' ? 'page' : me.metadata?.type === 'user' ? 'user' : null;
		if (!type) {
			try {
				await this.graph.get('/me/accounts', token, { limit: 1 });
				type = 'user';
			} catch {
				type = 'page';
			}
		}
		if (type === 'user') return { id: me.id, name: me.name, type };

		const page = await this.graphCall(() =>
			this.graph.get<GraphPage>('/me', token, { fields: 'id,name,category,picture{url}' }),
		);
		return {
			id: page.id,
			name: page.name,
			type: 'page',
			category: page.category,
			pictureUrl: page.picture?.data?.url,
		};
	}

	private async upsertConnection(
		userId: string,
		method: FbConnectionMethod,
		input: { id: string; name: string; token: string | null; expiresAt: Date | null; scopes: string[] },
	) {
		const patch = {
			displayName: input.name,
			encryptedToken: input.token ? this.crypto.encrypt(input.token) : null,
			tokenExpiresAt: input.expiresAt,
			scopes: input.scopes,
			status: FbConnectionStatus.CONNECTED,
			lastError: null,
			lastSyncedAt: new Date(),
		};
		const existing = await this.connections.findOne({
			where: { ownerUserId: userId, method, externalId: input.id },
		});
		if (existing) {
			await this.connections.update({ id: existing.id }, patch);
			return { ...existing, ...patch };
		}
		return this.connections.save(
			this.connections.create({ ownerUserId: userId, method, externalId: input.id, ...patch }),
		);
	}

	private async syncUserPages(connection: FbEngagementConnection, userToken: string, scopes: string[]) {
		const pages: GraphPage[] = [];
		let after: string | undefined;
		for (let request = 0; request < MAX_PAGE_SYNC_REQUESTS; request += 1) {
			const result = await this.graphCall(() =>
				this.graph.get<GraphPaged<GraphPage>>('/me/accounts', userToken, {
					fields: 'id,name,category,tasks,access_token,picture{url}',
					limit: 100,
					after,
				}),
			);
			pages.push(...(result.data ?? []));
			after = result.paging?.next ? result.paging?.cursors?.after : undefined;
			if (!after) break;
		}

		const scopeKnown = scopes.length > 0;
		const hasPublishScope = !scopeKnown || scopes.includes(PUBLISH_SCOPE);
		for (const page of pages) {
			const tasks = page.tasks ?? [];
			await this.upsertPageAccount(connection, page, {
				canPublish: hasPublishScope && tasks.includes(PUBLISH_TASK) && Boolean(page.access_token),
			});
		}

		const seen = pages.map((page) => page.id);
		await this.accounts.update(
			seen.length
				? { connectionId: connection.id, externalId: Not(In(seen)) }
				: { connectionId: connection.id },
			{ status: FbAccountStatus.REVOKED, canPublishComments: false, encryptedToken: null },
		);
		await this.connections.update(
			{ id: connection.id },
			{ status: FbConnectionStatus.CONNECTED, lastError: null, lastSyncedAt: new Date() },
		);
		return pages;
	}

	private async upsertPageAccount(
		connection: FbEngagementConnection,
		page: GraphPage,
		options: { canPublish: boolean },
	) {
		const patch = {
			connectionId: connection.id,
			name: page.name,
			category: page.category ?? null,
			pictureUrl: page.picture?.data?.url ?? null,
			tasks: page.tasks ?? [],
			canPublishComments: options.canPublish,
			encryptedToken: page.access_token ? this.crypto.encrypt(page.access_token) : null,
			status: page.access_token ? FbAccountStatus.ACTIVE : FbAccountStatus.ERROR,
			lastError: page.access_token ? null : 'Facebook did not return a Page access token.',
			lastSyncedAt: new Date(),
		};
		const existing = await this.accounts.findOne({
			where: { ownerUserId: connection.ownerUserId, type: FbAccountType.PAGE, externalId: page.id },
		});
		if (existing) {
			await this.accounts.update({ id: existing.id }, patch);
			return;
		}
		await this.accounts.insert({
			ownerUserId: connection.ownerUserId,
			type: FbAccountType.PAGE,
			externalId: page.id,
			...patch,
		});
	}
}
