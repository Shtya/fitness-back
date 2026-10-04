import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
	CreateCampaignDto,
	FB_MAX_COMMENTS_PER_CAMPAIGN,
	ListCampaignsQueryDto,
	UpdateCampaignDto,
} from '../dto/facebook-engagement.dto';
import {
	FbAccountStatus,
	FbCampaignStatus,
	FbCommentStatus,
	FbEngagementAccount,
	FbEngagementCampaign,
	FbEngagementComment,
	FbEngagementPost,
} from '../entities/facebook-engagement.entity';
import { publisherIneligibility } from '../publishers/comment-publisher';
import {
	emptyStatusCounts,
	isActiveCampaignStatus,
	normalizeCommentMessage,
	planRunTimes,
	PUBLISHABLE_COMMENT_STATUSES,
} from '../utils/fb-campaign-rules';
import { FbEngagementActivityService } from './fb-engagement-activity.service';
import { FbEngagementConnectionsService } from './fb-engagement-connections.service';
import { EnqueueJobInput, FbEngagementJobsService } from './fb-engagement-jobs.service';
import { FbEngagementPostsService } from './fb-engagement-posts.service';

export type PublishMode = 'publish' | 'retry';

export type SkippedComment = { id: string; reason: string };

@Injectable()
export class FbEngagementCampaignsService {
	constructor(
		private readonly connections: FbEngagementConnectionsService,
		private readonly posts: FbEngagementPostsService,
		private readonly jobs: FbEngagementJobsService,
		private readonly activity: FbEngagementActivityService,
		@InjectDataSource() private readonly dataSource: DataSource,
		@InjectRepository(FbEngagementCampaign)
		private readonly campaigns: Repository<FbEngagementCampaign>,
		@InjectRepository(FbEngagementPost)
		private readonly postRepo: Repository<FbEngagementPost>,
		@InjectRepository(FbEngagementAccount)
		private readonly accountRepo: Repository<FbEngagementAccount>,
	) {}

	async list(userId: string, query: ListCampaignsQueryDto) {
		const page = query.page ?? 1;
		const limit = query.limit ?? 12;
		const qb = this.campaigns
			.createQueryBuilder('campaign')
			.where('campaign.ownerUserId = :userId', { userId })
			.orderBy('campaign.updatedAt', 'DESC')
			.skip((page - 1) * limit)
			.take(limit);
		if (query.status) qb.andWhere('campaign.status = :status', { status: query.status });
		if (query.search) qb.andWhere('campaign.name ILIKE :search', { search: `%${query.search}%` });
		const [rows, total] = await qb.getManyAndCount();
		return { items: await this.attachRelations(rows), total, page, limit };
	}

	async attachRelations(rows: FbEngagementCampaign[]) {
		const postIds = [...new Set(rows.map((row) => row.postId).filter(Boolean))] as string[];
		const accountIds = [...new Set(rows.map((row) => row.accountId).filter(Boolean))] as string[];
		const [posts, accounts] = await Promise.all([
			postIds.length ? this.postRepo.find({ where: { id: In(postIds) } }) : Promise.resolve<FbEngagementPost[]>([]),
			accountIds.length
				? this.accountRepo.find({ where: { id: In(accountIds) } })
				: Promise.resolve<FbEngagementAccount[]>([]),
		]);
		const postMap = new Map(posts.map((post) => [post.id, post]));
		const accountMap = new Map(accounts.map((account) => [account.id, account]));
		return rows.map((row) => ({
			...row,
			post: row.postId ? (postMap.get(row.postId) ?? null) : null,
			account: row.accountId ? (accountMap.get(row.accountId) ?? null) : null,
		}));
	}

	async getOwned(userId: string, campaignId: string, manager?: EntityManager) {
		const repo = manager ? manager.getRepository(FbEngagementCampaign) : this.campaigns;
		const campaign = await repo.findOne({ where: { id: campaignId, ownerUserId: userId } });
		if (!campaign) throw new NotFoundException('Campaign not found');
		return campaign;
	}

	async get(userId: string, campaignId: string) {
		const campaign = await this.getOwned(userId, campaignId);
		const [[withRelations], statusRows] = await Promise.all([
			this.attachRelations([campaign]),
			this.dataSource.query(
				`SELECT status, count(*)::int AS count FROM fb_engagement_comments WHERE campaign_id = $1 GROUP BY status`,
				[campaign.id],
			) as Promise<Array<{ status: FbCommentStatus; count: number }>>,
		]);
		const statusCounts = emptyStatusCounts();
		for (const row of statusRows) {
			if (row.status in statusCounts) statusCounts[row.status] = Number(row.count);
		}
		const publishers = withRelations.post ? await this.eligiblePublishers(userId, withRelations.post) : [];
		return { ...withRelations, statusCounts, eligiblePublishers: publishers };
	}

	async eligiblePublishers(userId: string, post: Pick<FbEngagementPost, 'accountId'>) {
		const accounts = await this.accountRepo.find({
			where: { ownerUserId: userId, status: FbAccountStatus.ACTIVE },
			order: { name: 'ASC' },
		});
		return accounts.filter((account) => !publisherIneligibility(account, post));
	}

	async create(userId: string, dto: CreateCampaignDto) {
		const post = await this.posts.get(userId, dto.postId);
		const account = await this.connections.getAccount(userId, dto.accountId);
		const problem = publisherIneligibility(account, post);
		if (problem) throw new BadRequestException(problem.message);

		const comments = dto.comments ?? [];
		await this.assertCommentAccounts(userId, comments.map((comment) => comment.accountId), post);

		const campaignId = await this.dataSource.transaction(async (manager) => {
			const campaign = await manager.getRepository(FbEngagementCampaign).save(
				manager.getRepository(FbEngagementCampaign).create({
					ownerUserId: userId,
					name: dto.name,
					postId: post.id,
					accountId: account.id,
					pacingSeconds: dto.pacingSeconds ?? 30,
				}),
			);
			if (comments.length) {
				await manager.getRepository(FbEngagementComment).insert(
					comments.map((comment, index) => ({
						ownerUserId: userId,
						campaignId: campaign.id,
						position: index,
						message: comment.message,
						accountId: comment.accountId ?? null,
					})),
				);
			}
			await this.jobs.recomputeCampaign(campaign.id, manager);
			return campaign.id;
		});

		await this.activity.log(userId, {
			actorUserId: userId,
			campaignId,
			action: 'campaign.created',
			level: 'success',
			message: `Created campaign "${dto.name}" with ${comments.length} comment(s).`,
		});
		return this.get(userId, campaignId);
	}

	async update(userId: string, campaignId: string, dto: UpdateCampaignDto) {
		const campaign = await this.getOwned(userId, campaignId);
		await this.campaigns.update(
			{ id: campaign.id },
			{
				...(dto.name !== undefined ? { name: dto.name } : {}),
				...(dto.pacingSeconds !== undefined ? { pacingSeconds: dto.pacingSeconds } : {}),
			},
		);
		await this.activity.log(userId, {
			actorUserId: userId,
			campaignId,
			action: 'campaign.updated',
			message: `Updated campaign "${dto.name ?? campaign.name}".`,
			details: { ...dto },
		});
		return this.get(userId, campaignId);
	}

	async remove(userId: string, campaignId: string) {
		const campaign = await this.getOwned(userId, campaignId);
		if (isActiveCampaignStatus(campaign.status)) {
			throw new BadRequestException('Cancel the campaign before deleting it.');
		}
		await this.campaigns.softDelete({ id: campaign.id });
		await this.activity.log(userId, {
			actorUserId: userId,
			campaignId,
			action: 'campaign.deleted',
			level: 'warning',
			message: `Deleted campaign "${campaign.name}".`,
		});
		return { ok: true };
	}

	async duplicate(userId: string, campaignId: string) {
		const source = await this.getOwned(userId, campaignId);
		const newId = await this.dataSource.transaction(async (manager) => {
			const sourceComments = await manager.getRepository(FbEngagementComment).find({
				where: { campaignId: source.id },
				order: { position: 'ASC' },
			});
			const copy = await manager.getRepository(FbEngagementCampaign).save(
				manager.getRepository(FbEngagementCampaign).create({
					ownerUserId: userId,
					name: `${source.name} (copy)`.slice(0, 160),
					postId: source.postId,
					accountId: source.accountId,
					pacingSeconds: source.pacingSeconds,
				}),
			);
			if (sourceComments.length) {
				await manager.getRepository(FbEngagementComment).insert(
					sourceComments.map((comment, index) => ({
						ownerUserId: userId,
						campaignId: copy.id,
						position: index,
						message: comment.message,
						accountId: comment.accountId,
					})),
				);
			}
			await this.jobs.recomputeCampaign(copy.id, manager);
			return copy.id;
		});
		await this.activity.log(userId, {
			actorUserId: userId,
			campaignId: newId,
			action: 'campaign.duplicated',
			message: `Duplicated campaign "${source.name}".`,
			details: { sourceCampaignId: source.id },
		});
		return this.get(userId, newId);
	}

	async publish(userId: string, campaignId: string, commentIds: string[] | undefined, mode: PublishMode) {
		const result = await this.dataSource.transaction(async (manager) => {
			const campaign = await manager.getRepository(FbEngagementCampaign).findOne({
				where: { id: campaignId, ownerUserId: userId },
				lock: { mode: 'pessimistic_write' },
			});
			if (!campaign) throw new NotFoundException('Campaign not found');
			const post = campaign.postId
				? await manager.getRepository(FbEngagementPost).findOne({ where: { id: campaign.postId } })
				: null;
			if (!post) throw new BadRequestException('This campaign has no target post.');

			const statuses =
				mode === 'retry'
					? [FbCommentStatus.FAILED]
					: commentIds?.length
						? [...PUBLISHABLE_COMMENT_STATUSES]
						: [FbCommentStatus.DRAFT];
			const comments = await manager.getRepository(FbEngagementComment).find({
				where: {
					campaignId: campaign.id,
					status: In(statuses),
					...(commentIds?.length ? { id: In(commentIds) } : {}),
				},
				order: { position: 'ASC' },
			});
			if (!comments.length) {
				throw new BadRequestException(
					mode === 'retry' ? 'There are no failed comments to retry.' : 'There are no comments ready to publish.',
				);
			}

			const accountIds = [...new Set(comments.map((comment) => comment.accountId ?? campaign.accountId))].filter(
				Boolean,
			) as string[];
			const accounts = accountIds.length
				? await manager
						.getRepository(FbEngagementAccount)
						.find({ where: { ownerUserId: userId, id: In(accountIds) } })
				: [];
			const accountMap = new Map(accounts.map((account) => [account.id, account]));
			const seenMessages = await this.activeMessagesForPost(manager, post.id, comments.map((c) => c.id));

			const skipped: SkippedComment[] = [];
			const groups = new Map<string, FbEngagementComment[]>();
			for (const comment of comments) {
				const accountId = comment.accountId ?? campaign.accountId;
				const problem = publisherIneligibility(accountId ? accountMap.get(accountId) : null, post);
				if (problem) {
					skipped.push({ id: comment.id, reason: problem.message });
					continue;
				}
				const normalized = normalizeCommentMessage(comment.message);
				if (seenMessages.has(normalized)) {
					skipped.push({ id: comment.id, reason: 'The same comment is already published or queued on this post.' });
					continue;
				}
				seenMessages.add(normalized);
				groups.set(accountId, [...(groups.get(accountId) ?? []), comment]);
			}

			const jobs: EnqueueJobInput[] = [];
			for (const [accountId, group] of groups) {
				const start = await this.jobs.nextFreeSlot(manager, accountId, campaign.pacingSeconds);
				const runTimes = planRunTimes(group.length, campaign.pacingSeconds, start);
				group.forEach((comment, index) =>
					jobs.push({
						ownerUserId: userId,
						campaignId: campaign.id,
						commentId: comment.id,
						accountId,
						runAfter: runTimes[index],
					}),
				);
				await manager.query(
					`UPDATE fb_engagement_comments SET account_id = $1 WHERE id = ANY($2::uuid[]) AND account_id IS NULL`,
					[accountId, group.map((comment) => comment.id)],
				);
			}

			await this.jobs.enqueue(manager, jobs);
			await this.jobs.recomputeCampaign(campaign.id, manager);
			return { queued: jobs.length, skipped };
		});

		await this.activity.log(userId, {
			actorUserId: userId,
			campaignId,
			action: mode === 'retry' ? 'campaign.retry' : 'campaign.publish',
			level: result.queued ? 'info' : 'warning',
			message: `${mode === 'retry' ? 'Retry queued' : 'Queued'} ${result.queued} comment(s) for publishing${
				result.skipped.length ? `, ${result.skipped.length} skipped` : ''
			}.`,
			details: { skipped: result.skipped },
		});
		return { queued: result.queued, skipped: result.skipped, campaign: await this.get(userId, campaignId) };
	}

	async cancel(userId: string, campaignId: string) {
		const campaign = await this.getOwned(userId, campaignId);
		if (!isActiveCampaignStatus(campaign.status)) {
			throw new BadRequestException('Only queued or processing campaigns can be cancelled.');
		}
		const result = await this.dataSource.transaction(async (manager) => {
			await manager.getRepository(FbEngagementCampaign).update({ id: campaign.id }, { status: FbCampaignStatus.CANCELLED });
			const cancelled = await this.jobs.cancelQueued(userId, { campaignId }, 'Cancelled by user', manager);
			await this.jobs.recomputeCampaign(campaign.id, manager);
			return cancelled;
		});
		await this.activity.log(userId, {
			actorUserId: userId,
			campaignId,
			action: 'campaign.cancelled',
			level: 'warning',
			message: `Cancelled campaign "${campaign.name}" (${result.cancelled} queued comment(s) stopped).`,
		});
		return this.get(userId, campaignId);
	}

	async assertCommentAccounts(
		userId: string,
		accountIds: Array<string | null | undefined>,
		post: Pick<FbEngagementPost, 'accountId'>,
	) {
		const ids = [...new Set(accountIds.filter(Boolean))] as string[];
		if (!ids.length) return;
		const accounts = await this.connections.findAccounts(userId, ids);
		const map = new Map(accounts.map((account) => [account.id, account]));
		for (const id of ids) {
			const problem = publisherIneligibility(map.get(id), post);
			if (problem) throw new BadRequestException(problem.message);
		}
	}

	assertCapacity(existing: number, adding: number) {
		if (existing + adding > FB_MAX_COMMENTS_PER_CAMPAIGN) {
			throw new BadRequestException(`A campaign can hold up to ${FB_MAX_COMMENTS_PER_CAMPAIGN} comments.`);
		}
	}

	private async activeMessagesForPost(manager: EntityManager, postId: string, excludeIds: string[]) {
		const rows: Array<{ message: string }> = await manager.query(
			`SELECT c.message FROM fb_engagement_comments c
			 JOIN fb_engagement_campaigns k ON k.id = c.campaign_id
			 WHERE k.post_id = $1 AND c.status IN ('published', 'pending', 'processing')
			   AND NOT (c.id = ANY($2::uuid[]))`,
			[postId, excludeIds],
		);
		return new Set(rows.map((row) => normalizeCommentMessage(row.message)));
	}
}
