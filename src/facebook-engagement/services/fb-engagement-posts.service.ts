import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResolvePostDto } from '../dto/facebook-engagement.dto';
import { FbEngagementAccount, FbEngagementPost } from '../entities/facebook-engagement.entity';
import { FacebookGraphError, classifyFacebookError } from '../utils/fb-graph-errors';
import {
	FbObjectKind,
	normalizeFacebookPath,
	parseFacebookPostRef,
	POST_REF_ERROR_MESSAGES,
} from '../utils/fb-post-url';
import { FacebookGraphClient } from './facebook-graph.client';
import { FbEngagementConnectionsService } from './fb-engagement-connections.service';

const COUNTS = 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)';
const FIELDS: Record<FbObjectKind | 'minimal', string> = {
	post: `id,message,full_picture,permalink_url,created_time,from{id,name},shares,${COUNTS}`,
	photo: `id,name,picture,link,created_time,from{id,name},${COUNTS}`,
	video: `id,description,picture,permalink_url,created_time,from{id,name},${COUNTS}`,
	minimal: 'id,created_time,from{id,name}',
};
const SCAN_PAGES = 3;
const LIST_LIMIT = 12;

type GraphObject = {
	id: string;
	message?: string;
	name?: string;
	description?: string;
	full_picture?: string;
	picture?: string;
	permalink_url?: string;
	link?: string;
	created_time?: string;
	from?: { id?: string; name?: string };
	shares?: { count?: number };
	reactions?: { summary?: { total_count?: number } };
	comments?: { summary?: { total_count?: number } };
};

type GraphPaged<T> = { data?: T[]; paging?: { cursors?: { after?: string }; next?: string } };

export function toPostPreview(object: GraphObject) {
	const permalink = object.permalink_url ?? object.link ?? null;
	return {
		externalId: object.id,
		permalinkUrl: permalink?.startsWith('/') ? `https://www.facebook.com${permalink}` : permalink,
		message: object.message ?? object.description ?? object.name ?? null,
		imageUrl: object.full_picture ?? object.picture ?? null,
		authorName: object.from?.name ?? null,
		publishedAt: object.created_time ? new Date(object.created_time) : null,
		reactionsCount: object.reactions?.summary?.total_count ?? 0,
		commentsCount: object.comments?.summary?.total_count ?? 0,
		sharesCount: object.shares?.count ?? 0,
	};
}

export function isOwnedByPage(object: Pick<GraphObject, 'id' | 'from'>, pageExternalId: string) {
	if (object.from?.id) return object.from.id === pageExternalId;
	return object.id.startsWith(`${pageExternalId}_`);
}

@Injectable()
export class FbEngagementPostsService {
	constructor(
		private readonly graph: FacebookGraphClient,
		private readonly connections: FbEngagementConnectionsService,
		@InjectRepository(FbEngagementPost)
		private readonly posts: Repository<FbEngagementPost>,
	) {}

	async listPagePosts(userId: string, accountId: string, after?: string) {
		const { account, token } = await this.connections.activeAccountToken(userId, accountId);
		const result = await this.guard(account, () =>
			this.graph.get<GraphPaged<GraphObject>>(`/${account.externalId}/posts`, token, {
				fields: FIELDS.post,
				limit: LIST_LIMIT,
				after,
			}),
		);
		return {
			items: (result.data ?? []).map(toPostPreview),
			nextCursor: result.paging?.next ? (result.paging?.cursors?.after ?? null) : null,
		};
	}

	async resolve(userId: string, dto: ResolvePostDto) {
		const parsed = parseFacebookPostRef(dto.reference);
		if ('reason' in parsed) throw new BadRequestException(POST_REF_ERROR_MESSAGES[parsed.reason]);

		const { account, token } = await this.connections.activeAccountToken(userId, dto.accountId);
		const candidates = [...parsed.candidates];
		if (parsed.kind === 'post' && /^\d+$/.test(parsed.objectId)) {
			candidates.unshift(`${account.externalId}_${parsed.objectId}`);
		}

		for (const candidate of [...new Set(candidates)]) {
			const object = await this.fetchObject(account, candidate, parsed.kind, token);
			if (!object) continue;
			if (!isOwnedByPage(object, account.externalId)) {
				throw new BadRequestException(
					`This post was not published by ${account.name}. Facebook only lets a Page comment on its own posts.`,
				);
			}
			return this.saveSnapshot(userId, account, object);
		}

		const scanned = await this.scanRecentPosts(account, token, parsed.objectId, parsed.normalizedUrl);
		if (scanned) return this.saveSnapshot(userId, account, scanned);

		throw new BadRequestException(
			`Could not find this post on ${account.name}. Make sure the link is a post published by this Page, or pick it from the list.`,
		);
	}

	async get(userId: string, postId: string) {
		const post = await this.posts.findOne({ where: { id: postId, ownerUserId: userId } });
		if (!post) throw new NotFoundException('Post not found');
		return post;
	}

	async refresh(userId: string, postId: string) {
		const post = await this.get(userId, postId);
		const { account, token } = await this.connections.activeAccountToken(userId, post.accountId);
		const object = await this.fetchObject(account, post.externalId, 'post', token);
		if (!object) throw new BadRequestException('This post is no longer available on Facebook.');
		return this.saveSnapshot(userId, account, object);
	}

	private async saveSnapshot(userId: string, account: FbEngagementAccount, object: GraphObject) {
		const patch = { ...toPostPreview(object), accountId: account.id, fetchedAt: new Date() };
		const existing = await this.posts.findOne({ where: { ownerUserId: userId, externalId: object.id } });
		if (existing) {
			await this.posts.update({ id: existing.id }, patch);
			return { ...existing, ...patch };
		}
		return this.posts.save(this.posts.create({ ownerUserId: userId, ...patch }));
	}

	private async fetchObject(
		account: FbEngagementAccount,
		id: string,
		kind: FbObjectKind,
		token: string,
	): Promise<GraphObject | null> {
		const path = `/${encodeURIComponent(id)}`;
		try {
			return await this.graph.get<GraphObject>(path, token, { fields: FIELDS[kind] });
		} catch (error) {
			if (!(error instanceof FacebookGraphError) || error.code !== 100) return this.rethrow(account, error);
			if (!/nonexisting field/i.test(error.message)) return null;
		}
		try {
			return await this.graph.get<GraphObject>(path, token, { fields: FIELDS.minimal });
		} catch (error) {
			if (error instanceof FacebookGraphError && error.code === 100) return null;
			return this.rethrow(account, error);
		}
	}

	private async scanRecentPosts(
		account: FbEngagementAccount,
		token: string,
		objectId: string,
		normalizedUrl: string | null,
	) {
		const wantedPath = normalizedUrl ? normalizeFacebookPath(normalizedUrl) : null;
		const suffix = `/${objectId.toLowerCase()}`;
		let after: string | undefined;
		for (let page = 0; page < SCAN_PAGES; page += 1) {
			const result = await this.guard(account, () =>
				this.graph.get<GraphPaged<GraphObject>>(`/${account.externalId}/posts`, token, {
					fields: FIELDS.post,
					limit: 100,
					after,
				}),
			);
			const match = (result.data ?? []).find((item) => {
				if (item.id === objectId || item.id.endsWith(`_${objectId}`)) return true;
				const path = item.permalink_url ? normalizeFacebookPath(item.permalink_url) : null;
				return Boolean(path && (path === wantedPath || path.endsWith(suffix)));
			});
			if (match) return match;
			after = result.paging?.next ? result.paging?.cursors?.after : undefined;
			if (!after) break;
		}
		return null;
	}

	private async guard<T>(account: FbEngagementAccount, call: () => Promise<T>) {
		try {
			return await call();
		} catch (error) {
			return this.rethrow(account, error);
		}
	}

	private async rethrow(account: FbEngagementAccount, error: unknown): Promise<never> {
		const classification = classifyFacebookError(error);
		await this.connections.recordAccountFailure(account.id, classification);
		throw new BadRequestException(classification.userMessage, { cause: error });
	}
}
