import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
	AddCommentDto,
	BulkAddCommentsDto,
	BulkUpdateCommentsDto,
	FB_MAX_COMMENT_LENGTH,
	ListCommentsQueryDto,
	UpdateCommentDto,
} from '../dto/facebook-engagement.dto';
import {
	FbCommentStatus,
	FbEngagementAccount,
	FbEngagementCampaign,
	FbEngagementComment,
	FbEngagementPost,
} from '../entities/facebook-engagement.entity';
import { applyFindReplace, EDITABLE_COMMENT_STATUSES, normalizeCommentMessage } from '../utils/fb-campaign-rules';
import { FbEngagementActivityService } from './fb-engagement-activity.service';
import { FbEngagementCampaignsService } from './fb-engagement-campaigns.service';
import { FbEngagementJobsService } from './fb-engagement-jobs.service';

@Injectable()
export class FbEngagementCommentsService {
	constructor(
		private readonly campaigns: FbEngagementCampaignsService,
		private readonly jobs: FbEngagementJobsService,
		private readonly activity: FbEngagementActivityService,
		@InjectDataSource() private readonly dataSource: DataSource,
		@InjectRepository(FbEngagementComment)
		private readonly comments: Repository<FbEngagementComment>,
		@InjectRepository(FbEngagementPost)
		private readonly posts: Repository<FbEngagementPost>,
		@InjectRepository(FbEngagementAccount)
		private readonly accounts: Repository<FbEngagementAccount>,
	) {}

	async list(userId: string, query: ListCommentsQueryDto) {
		const page = query.page ?? 1;
		const limit = query.limit ?? 25;
		const qb = this.comments
			.createQueryBuilder('comment')
			.where('comment.ownerUserId = :userId', { userId })
			.andWhere(
				`comment.campaignId IN (SELECT id FROM fb_engagement_campaigns WHERE owner_user_id = :userId AND deleted_at IS NULL)`,
			)
			.skip((page - 1) * limit)
			.take(limit);
		if (query.campaignId) {
			qb.andWhere('comment.campaignId = :campaignId', { campaignId: query.campaignId }).orderBy(
				'comment.position',
				'ASC',
			);
		} else {
			qb.orderBy('comment.updatedAt', 'DESC');
		}
		if (query.status) qb.andWhere('comment.status = :status', { status: query.status });
		if (query.accountId) qb.andWhere('comment.accountId = :accountId', { accountId: query.accountId });
		if (query.search) qb.andWhere('comment.message ILIKE :search', { search: `%${query.search}%` });

		const [rows, total] = await qb.getManyAndCount();
		return { items: await this.decorate(rows, Boolean(query.campaignId)), total, page, limit };
	}

	async add(userId: string, campaignId: string, dto: AddCommentDto) {
		const campaign = await this.campaigns.getOwned(userId, campaignId);
		await this.assertAccount(userId, campaign, dto.accountId);
		const existing = await this.comments.count({ where: { campaignId } });
		this.campaigns.assertCapacity(existing, 1);
		const comment = await this.comments.save(
			this.comments.create({
				ownerUserId: userId,
				campaignId,
				position: await this.nextPosition(campaignId),
				message: dto.message,
				accountId: dto.accountId ?? null,
			}),
		);
		await this.jobs.recomputeCampaign(campaignId);
		return comment;
	}

	async bulkAdd(userId: string, campaignId: string, dto: BulkAddCommentsDto) {
		const campaign = await this.campaigns.getOwned(userId, campaignId);
		await this.assertAccount(userId, campaign, dto.accountId);

		const existingRows = await this.comments.find({ where: { campaignId }, select: ['id', 'message'] });
		const seen = new Set(existingRows.map((row) => normalizeCommentMessage(row.message)));
		const messages: string[] = [];
		let skippedDuplicates = 0;
		for (const raw of dto.messages) {
			const message = String(raw ?? '').trim();
			if (!message) continue;
			const normalized = normalizeCommentMessage(message);
			if (seen.has(normalized)) {
				skippedDuplicates += 1;
				continue;
			}
			seen.add(normalized);
			messages.push(message);
		}
		if (!messages.length) throw new BadRequestException('No new comments to add.');
		this.campaigns.assertCapacity(existingRows.length, messages.length);

		const start = await this.nextPosition(campaignId);
		await this.comments.insert(
			messages.map((message, index) => ({
				ownerUserId: userId,
				campaignId,
				position: start + index,
				message,
				accountId: dto.accountId ?? null,
			})),
		);
		await this.jobs.recomputeCampaign(campaignId);
		await this.activity.log(userId, {
			actorUserId: userId,
			campaignId,
			action: 'comments.bulk_added',
			message: `Added ${messages.length} comment(s)${skippedDuplicates ? `, skipped ${skippedDuplicates} duplicate(s)` : ''}.`,
		});
		return { added: messages.length, skippedDuplicates };
	}

	async update(userId: string, commentId: string, dto: UpdateCommentDto) {
		const comment = await this.getOwned(userId, commentId);
		this.assertEditable(comment);
		const campaign = await this.campaigns.getOwned(userId, comment.campaignId);
		await this.assertAccount(userId, campaign, dto.accountId);
		await this.comments.update(
			{ id: comment.id },
			{
				...(dto.message !== undefined ? { message: dto.message } : {}),
				...(dto.accountId !== undefined ? { accountId: dto.accountId } : {}),
				status: FbCommentStatus.DRAFT,
				lastError: null,
				lastErrorCode: null,
			},
		);
		await this.jobs.recomputeCampaign(comment.campaignId);
		return this.getOwned(userId, commentId);
	}

	async duplicate(userId: string, commentId: string) {
		const source = await this.getOwned(userId, commentId);
		const existing = await this.comments.count({ where: { campaignId: source.campaignId } });
		this.campaigns.assertCapacity(existing, 1);
		const copy = await this.dataSource.transaction(async (manager) => {
			await manager.query(
				`UPDATE fb_engagement_comments SET position = position + 1 WHERE campaign_id = $1 AND position > $2`,
				[source.campaignId, source.position],
			);
			const repo = manager.getRepository(FbEngagementComment);
			return repo.save(
				repo.create({
					ownerUserId: userId,
					campaignId: source.campaignId,
					position: source.position + 1,
					message: source.message,
					accountId: source.accountId,
				}),
			);
		});
		await this.jobs.recomputeCampaign(source.campaignId);
		return copy;
	}

	async remove(userId: string, commentId: string) {
		const comment = await this.getOwned(userId, commentId);
		this.assertEditable(comment);
		await this.comments.delete({ id: comment.id });
		await this.jobs.recomputeCampaign(comment.campaignId);
		return { ok: true };
	}

	async bulkRemove(userId: string, ids: string[]) {
		const rows = await this.comments.find({ where: { ownerUserId: userId, id: In(ids) } });
		const deletable = rows.filter((row) => EDITABLE_COMMENT_STATUSES.includes(row.status));
		if (deletable.length) await this.comments.delete({ id: In(deletable.map((row) => row.id)) });
		const campaignIds = [...new Set(deletable.map((row) => row.campaignId))];
		for (const campaignId of campaignIds) {
			await this.jobs.recomputeCampaign(campaignId);
			await this.activity.log(userId, {
				actorUserId: userId,
				campaignId,
				action: 'comments.bulk_deleted',
				level: 'warning',
				message: `Deleted ${deletable.filter((row) => row.campaignId === campaignId).length} comment(s).`,
			});
		}
		return { deleted: deletable.length, skipped: ids.length - deletable.length };
	}

	async bulkUpdate(userId: string, dto: BulkUpdateCommentsDto) {
		if (!dto.accountId && !dto.find) throw new BadRequestException('Choose a Page or a text to replace.');
		const rows = await this.comments.find({ where: { ownerUserId: userId, id: In(dto.ids) } });
		const editable = rows.filter((row) => EDITABLE_COMMENT_STATUSES.includes(row.status));
		const campaignIds = [...new Set(editable.map((row) => row.campaignId))];
		for (const campaignId of campaignIds) {
			const campaign = await this.campaigns.getOwned(userId, campaignId);
			await this.assertAccount(userId, campaign, dto.accountId);
		}

		let updated = 0;
		for (const row of editable) {
			const message = dto.find ? applyFindReplace(row.message, dto.find, dto.replace ?? '').trim() : row.message;
			if (!message || message.length > FB_MAX_COMMENT_LENGTH) continue;
			const changed = message !== row.message || (dto.accountId && dto.accountId !== row.accountId);
			if (!changed) continue;
			await this.comments.update(
				{ id: row.id },
				{
					message,
					...(dto.accountId ? { accountId: dto.accountId } : {}),
					status: FbCommentStatus.DRAFT,
					lastError: null,
					lastErrorCode: null,
				},
			);
			updated += 1;
		}
		for (const campaignId of campaignIds) await this.jobs.recomputeCampaign(campaignId);
		return { updated, skipped: dto.ids.length - updated };
	}

	async reorder(userId: string, campaignId: string, ids: string[]) {
		await this.campaigns.getOwned(userId, campaignId);
		await this.dataSource.query(
			`UPDATE fb_engagement_comments c SET position = v.pos - 1
			 FROM unnest($1::uuid[]) WITH ORDINALITY AS v(id, pos)
			 WHERE c.id = v.id AND c.campaign_id = $2 AND c.owner_user_id = $3`,
			[ids, campaignId, userId],
		);
		return { ok: true };
	}

	async bulkRetry(userId: string, ids: string[]) {
		const rows = await this.comments.find({
			where: { ownerUserId: userId, id: In(ids), status: FbCommentStatus.FAILED },
		});
		const byCampaign = new Map<string, string[]>();
		for (const row of rows) byCampaign.set(row.campaignId, [...(byCampaign.get(row.campaignId) ?? []), row.id]);

		let queued = 0;
		const skipped: Array<{ id: string; reason: string }> = [];
		for (const [campaignId, commentIds] of byCampaign) {
			const result = await this.campaigns.publish(userId, campaignId, commentIds, 'retry');
			queued += result.queued;
			skipped.push(...result.skipped);
		}
		return { queued, skipped, ignored: ids.length - rows.length };
	}

	private async getOwned(userId: string, commentId: string) {
		const comment = await this.comments.findOne({ where: { id: commentId, ownerUserId: userId } });
		if (!comment) throw new NotFoundException('Comment not found');
		return comment;
	}

	private assertEditable(comment: FbEngagementComment) {
		if (!EDITABLE_COMMENT_STATUSES.includes(comment.status)) {
			throw new BadRequestException('Published, queued or processing comments cannot be changed.');
		}
	}

	private async assertAccount(userId: string, campaign: FbEngagementCampaign, accountId?: string | null) {
		if (!accountId) return;
		const post = campaign.postId ? await this.posts.findOne({ where: { id: campaign.postId } }) : null;
		if (!post) throw new BadRequestException('This campaign has no target post.');
		await this.campaigns.assertCommentAccounts(userId, [accountId], post);
	}

	private async nextPosition(campaignId: string) {
		const [row] = await this.dataSource.query(
			`SELECT COALESCE(max(position), -1) + 1 AS next FROM fb_engagement_comments WHERE campaign_id = $1`,
			[campaignId],
		);
		return Number(row?.next ?? 0);
	}

	private async decorate(rows: FbEngagementComment[], markDuplicates: boolean) {
		const campaignIds = [...new Set(rows.map((row) => row.campaignId))];
		const accountIds = [...new Set(rows.map((row) => row.accountId).filter(Boolean))] as string[];
		const [campaignRows, accountRows] = await Promise.all([
			campaignIds.length
				? this.dataSource.getRepository(FbEngagementCampaign).find({
						where: { id: In(campaignIds) },
						select: ['id', 'name'],
					})
				: Promise.resolve<FbEngagementCampaign[]>([]),
			accountIds.length
				? this.accounts.find({ where: { id: In(accountIds) } })
				: Promise.resolve<FbEngagementAccount[]>([]),
		]);
		const campaignMap = new Map(campaignRows.map((row) => [row.id, row]));
		const accountMap = new Map(accountRows.map((row) => [row.id, row]));

		const counts = new Map<string, number>();
		if (markDuplicates && campaignIds.length === 1) {
			const all = await this.comments.find({ where: { campaignId: campaignIds[0] }, select: ['id', 'message'] });
			for (const row of all) {
				const key = normalizeCommentMessage(row.message);
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
		}

		return rows.map((row) => {
			const account = row.accountId ? accountMap.get(row.accountId) : null;
			const campaign = campaignMap.get(row.campaignId);
			return {
				...row,
				campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
				account: account ? { id: account.id, name: account.name, pictureUrl: account.pictureUrl } : null,
				isDuplicate: (counts.get(normalizeCommentMessage(row.message)) ?? 0) > 1,
			};
		});
	}
}
