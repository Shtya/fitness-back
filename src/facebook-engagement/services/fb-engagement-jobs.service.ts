import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
	FbCampaignStatus,
	FbCommentStatus,
	FbEngagementCampaign,
	FbEngagementJob,
	FbJobStatus,
} from '../entities/facebook-engagement.entity';
import { deriveCampaignStatus, emptyStatusCounts, isActiveCampaignStatus } from '../utils/fb-campaign-rules';

export type EnqueueJobInput = {
	ownerUserId: string;
	campaignId: string;
	commentId: string;
	accountId: string;
	runAfter: Date;
};

export type CancelFilter = {
	campaignId?: string;
	accountIds?: string[];
	commentIds?: string[];
};

/** Postgres UPDATE ... RETURNING through EntityManager.query resolves to [rows, rowCount]. */
export function updatedRows<T>(result: unknown): T[] {
	return Array.isArray(result) && Array.isArray(result[0]) ? (result[0] as T[]) : [];
}

@Injectable()
export class FbEngagementJobsService {
	constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

	async enqueue(manager: EntityManager, jobs: EnqueueJobInput[]) {
		if (!jobs.length) return;
		await manager.getRepository(FbEngagementJob).insert(
			jobs.map((job) => ({ ...job, status: FbJobStatus.QUEUED })),
		);
		await manager.query(
			`UPDATE fb_engagement_comments
			 SET status = $1, last_error = NULL, last_error_code = NULL, updated_at = now()
			 WHERE id = ANY($2::uuid[])`,
			[FbCommentStatus.PENDING, jobs.map((job) => job.commentId)],
		);
	}

	async nextFreeSlot(manager: EntityManager, accountId: string, pacingSeconds: number) {
		const [row] = await manager.query(
			`SELECT max(run_after) AS last FROM fb_engagement_jobs
			 WHERE account_id = $1 AND status IN ('queued', 'running')`,
			[accountId],
		);
		const now = Date.now();
		const last = row?.last ? new Date(row.last).getTime() + pacingSeconds * 1000 : 0;
		return new Date(Math.max(now, last));
	}

	async cancelQueued(ownerUserId: string, filter: CancelFilter, reason: string, manager?: EntityManager) {
		const run = async (em: EntityManager) => {
			const conditions = [`owner_user_id = $1`, `status = 'queued'`];
			const params: unknown[] = [ownerUserId, reason];
			if (filter.campaignId) {
				params.push(filter.campaignId);
				conditions.push(`campaign_id = $${params.length}`);
			}
			if (filter.accountIds?.length) {
				params.push(filter.accountIds);
				conditions.push(`account_id = ANY($${params.length}::uuid[])`);
			}
			if (filter.commentIds?.length) {
				params.push(filter.commentIds);
				conditions.push(`comment_id = ANY($${params.length}::uuid[])`);
			}
			const rows = updatedRows<{ comment_id: string; campaign_id: string }>(
				await em.query(
					`UPDATE fb_engagement_jobs
					 SET status = 'cancelled', finished_at = now(), last_error = $2, updated_at = now()
					 WHERE ${conditions.join(' AND ')}
					 RETURNING comment_id, campaign_id`,
					params,
				),
			);
			if (rows.length) {
				await em.query(
					`UPDATE fb_engagement_comments
					 SET status = 'cancelled', last_error = $2, last_error_code = 'CANCELLED', updated_at = now()
					 WHERE id = ANY($1::uuid[]) AND status = 'pending'`,
					[rows.map((row) => row.comment_id), reason],
				);
			}
			const campaignIds = [...new Set(rows.map((row) => row.campaign_id))];
			for (const campaignId of campaignIds) await this.recomputeCampaign(campaignId, em);
			return { cancelled: rows.length, campaignIds };
		};
		return manager ? run(manager) : this.dataSource.transaction(run);
	}

	async recomputeCampaign(campaignId: string, manager?: EntityManager) {
		const em = manager ?? this.dataSource.manager;
		const repo = em.getRepository(FbEngagementCampaign);
		const campaign = await repo.findOne({ where: { id: campaignId }, withDeleted: true });
		if (!campaign) return null;

		const rows: Array<{ status: FbCommentStatus; count: string }> = await em.query(
			`SELECT status, count(*)::int AS count FROM fb_engagement_comments WHERE campaign_id = $1 GROUP BY status`,
			[campaignId],
		);
		const counts = emptyStatusCounts();
		for (const row of rows) {
			if (row.status in counts) counts[row.status] = Number(row.count);
		}

		const nextStatus = deriveCampaignStatus(counts, campaign.status);
		const wasActive = isActiveCampaignStatus(campaign.status);
		const isActive = isActiveCampaignStatus(nextStatus);
		const patch: Partial<FbEngagementCampaign> = {
			status: nextStatus,
			totalCount: Object.values(counts).reduce((sum, value) => sum + value, 0),
			publishedCount: counts.published,
			failedCount: counts.failed,
			pendingCount: counts.pending + counts.processing,
		};
		if (isActive && !wasActive) {
			patch.startedAt = campaign.startedAt ?? new Date();
			patch.finishedAt = null;
		}
		if (!isActive && wasActive && nextStatus !== FbCampaignStatus.DRAFT) patch.finishedAt = new Date();
		await repo.update({ id: campaignId }, patch);
		return { ...campaign, ...patch } as FbEngagementCampaign;
	}
}
