import { Injectable } from '@nestjs/common';
import { FbAccountStatus, FbConnectionStatus } from '../entities/facebook-engagement.entity';
import { FacebookGraphClient } from './facebook-graph.client';
import { FbEngagementConnectionsService } from './fb-engagement-connections.service';
import { toPostPreview } from './fb-engagement-posts.service';

const FEED_FIELDS =
	'id,message,full_picture,permalink_url,created_time,from{id,name,picture.width(80).height(80)},shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)';
const FEED_LIMIT = 10;
const MAX_PAGES_PER_FEED = 8;

type GraphPaged<T> = { data?: T[]; paging?: { cursors?: { after?: string }; next?: string } };

type GraphStory = {
	id?: string;
	status?: string;
	creation_time?: string;
	media_type?: string;
	url?: string;
	media_url?: string;
};

/**
 * Personal "Facebook Home" inside WhatsApp.
 * Meta Graph no longer exposes friends' news feed, friend online presence, or
 * personal friend stories. Officially available: login identity + Pages the user
 * manages (posts / limited page stories).
 */
@Injectable()
export class FbHomeService {
	constructor(
		private readonly connections: FbEngagementConnectionsService,
		private readonly graph: FacebookGraphClient,
	) {}

	async home(userId: string) {
		const [config, connections, accounts] = await Promise.all([
			Promise.resolve(this.connections.publicConfig()),
			this.connections.listConnections(userId),
			this.connections.listAccounts(userId, true),
		]);
		const activeConnections = connections.filter(
			(row) => row.status === FbConnectionStatus.CONNECTED || row.status === FbConnectionStatus.ERROR,
		);
		const primary = activeConnections[0] || null;
		return {
			connected: activeConnections.length > 0,
			oauthConfigured: config.oauthConfigured,
			scopes: config.scopes,
			graphVersion: config.graphVersion,
			profile: primary
				? {
						id: primary.externalId,
						name: primary.displayName,
						status: primary.status,
						method: primary.method,
						lastSyncedAt: primary.lastSyncedAt,
						pageCount: accounts.length,
					}
				: null,
			pages: accounts.map((account) => ({
				id: account.id,
				externalId: account.externalId,
				name: account.name,
				category: account.category,
				pictureUrl: account.pictureUrl,
				status: account.status,
			})),
			capabilities: {
				pagePosts: true,
				pageStories: true,
				filterByPage: true,
				friendsNewsFeed: false,
				friendOnlinePresence: false,
				personalFriendStories: false,
			},
			limits: {
				friendsNewsFeed:
					'Facebook removed the personal news-feed Graph API. Only Pages you manage can be listed here.',
				friendOnlinePresence:
					'Friend online status is not available through Facebook Graph API for personal accounts.',
				personalFriendStories:
					'Personal friend stories are not available through Graph API. Page stories may appear when Facebook returns them.',
			},
		};
	}

	async people(userId: string) {
		const accounts = await this.connections.listAccounts(userId, true);
		return {
			items: accounts.map((account) => ({
				id: account.id,
				externalId: account.externalId,
				name: account.name,
				pictureUrl: account.pictureUrl,
				category: account.category,
				kind: 'page' as const,
			})),
		};
	}

	async feed(
		userId: string,
		options: { accountId?: string; author?: string; q?: string; after?: string } = {},
	) {
		const accounts = await this.connections.listAccounts(userId, true);
		const selected = options.accountId
			? accounts.filter((account) => account.id === options.accountId)
			: accounts.slice(0, MAX_PAGES_PER_FEED);

		if (!selected.length) {
			return { items: [], nextCursor: null, pagesQueried: 0 };
		}

		const authorNeedle = String(options.author || '')
			.trim()
			.toLowerCase();
		const textNeedle = String(options.q || '')
			.trim()
			.toLowerCase();

		const pageResults = await Promise.all(
			selected.map(async (account) => {
				try {
					const { token } = await this.connections.activeAccountToken(userId, account.id);
					const result = await this.graph.get<
						GraphPaged<{
							id: string;
							message?: string;
							full_picture?: string;
							permalink_url?: string;
							created_time?: string;
							from?: { id?: string; name?: string; picture?: { data?: { url?: string } } };
							shares?: { count?: number };
							reactions?: { summary?: { total_count?: number } };
							comments?: { summary?: { total_count?: number } };
						}>
					>(`/${account.externalId}/posts`, token, {
						fields: FEED_FIELDS,
						limit: FEED_LIMIT,
						...(options.accountId && options.after ? { after: options.after } : {}),
					});
					const items = (result.data ?? []).map((object) => {
						const preview = toPostPreview(object);
						const publishedAt =
							preview.publishedAt instanceof Date
								? preview.publishedAt.toISOString()
								: preview.publishedAt
									? String(preview.publishedAt)
									: null;
						return {
							...preview,
							accountId: account.id,
							pageName: account.name,
							pagePictureUrl: account.pictureUrl,
							authorId: object.from?.id || account.externalId,
							authorPictureUrl: object.from?.picture?.data?.url || account.pictureUrl || null,
							publishedAt,
						};
					});
					return {
						items,
						nextCursor: result.paging?.next ? (result.paging?.cursors?.after ?? null) : null,
					};
				} catch {
					return { items: [], nextCursor: null };
				}
			}),
		);

		let items = pageResults.flatMap((row) => row.items);
		if (authorNeedle) {
			items = items.filter((item) => {
				const hay = `${item.authorName || ''} ${item.pageName || ''} ${item.authorId || ''}`.toLowerCase();
				return hay.includes(authorNeedle);
			});
		}
		if (textNeedle) {
			items = items.filter((item) => String(item.message || '').toLowerCase().includes(textNeedle));
		}

		items.sort((a, b) => {
			const aTime = Date.parse(String(a.publishedAt || '')) || 0;
			const bTime = Date.parse(String(b.publishedAt || '')) || 0;
			return bTime - aTime;
		});

		return {
			items,
			nextCursor: options.accountId ? pageResults[0]?.nextCursor || null : null,
			pagesQueried: selected.length,
		};
	}

	async stories(userId: string, accountId?: string) {
		const accounts = await this.connections.listAccounts(userId, true);
		const selected = accountId ? accounts.filter((account) => account.id === accountId) : accounts.slice(0, 6);
		const items: Array<{
			id: string;
			accountId: string;
			pageName: string;
			pagePictureUrl: string | null;
			status: string | null;
			mediaType: string | null;
			url: string | null;
			createdAt: string | null;
		}> = [];

		for (const account of selected) {
			if (account.status !== FbAccountStatus.ACTIVE) continue;
			try {
				const { token } = await this.connections.activeAccountToken(userId, account.id);
				const result = await this.graph.get<GraphPaged<GraphStory>>(`/${account.externalId}/stories`, token, {
					fields: 'id,status,creation_time,media_type,url,media_url',
					limit: 10,
				});
				for (const story of result.data ?? []) {
					if (!story?.id) continue;
					items.push({
						id: story.id,
						accountId: account.id,
						pageName: account.name,
						pagePictureUrl: account.pictureUrl,
						status: story.status || null,
						mediaType: story.media_type || null,
						url: story.url || story.media_url || null,
						createdAt: story.creation_time || null,
					});
				}
			} catch {
				/* Page stories are often unavailable; keep the tab usable. */
			}
		}

		items.sort((a, b) => {
			const aTime = Date.parse(String(a.createdAt || '')) || 0;
			const bTime = Date.parse(String(b.createdAt || '')) || 0;
			return bTime - aTime;
		});

		return {
			items,
			available: items.length > 0,
			note: items.length
				? null
				: 'No Page stories returned. Personal friend stories are not exposed by Facebook Graph API.',
		};
	}
}
