import { hostname } from 'os';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
	FbCommentStatus,
	FbEngagementAccount,
	FbEngagementCampaign,
	FbEngagementComment,
	FbEngagementJob,
	FbEngagementPost,
	FbJobStatus,
} from '../entities/facebook-engagement.entity';
import { publisherIneligibility } from '../publishers/comment-publisher';
import { CommentPublisherRegistry } from '../publishers/comment-publisher.registry';
import { normalizeCommentMessage } from '../utils/fb-campaign-rules';
import { classifyFacebookError, FbErrorClassification, retryDelayMs } from '../utils/fb-graph-errors';
import { FbEngagementActivityService } from './fb-engagement-activity.service';
import { FbEngagementConnectionsService } from './fb-engagement-connections.service';
import { FbEngagementJobsService, updatedRows } from './fb-engagement-jobs.service';

type ClaimedJob = {
	id: string;
	owner_user_id: string;
	campaign_id: string;
	comment_id: string;
	account_id: string | null;
	attempts: number;
	max_attempts: number;
};

type Failure = { code: string; message: string; classification?: FbErrorClassification };

const CLAIM_BATCH = 5;
const STALE_AFTER_MINUTES = 5;

@Injectable()
export class FbEngagementWorkerService {
	private readonly logger = new Logger(FbEngagementWorkerService.name);
	private readonly workerId = `${hostname()}:${process.pid}`.slice(0, 64);

	constructor(
		private readonly config: ConfigService,
		private readonly registry: CommentPublisherRegistry,
		private readonly connections: FbEngagementConnectionsService,
		private readonly jobs: FbEngagementJobsService,
		private readonly activity: FbEngagementActivityService,
		@InjectDataSource() private readonly dataSource: DataSource,
	) {}

	private minIntervalSeconds() {
		const value = Number(this.config.get<string>('FB_ENGAGEMENT_MIN_INTERVAL_SECONDS'));
		return Number.isFinite(value) && value >= 0 ? value : 10;
	}

	async processDue() {
		await this.recoverStale();
		const claimed = await this.claim();
		for (const job of claimed) {
			try {
				await this.run(job);
			} catch (error) {
				this.logger.error(`Job ${job.id} crashed: ${error instanceof Error ? error.message : error}`);
				await this.fail(job, { code: 'INTERNAL_ERROR', message: 'Unexpected error while publishing.' });
			}
		}
		return claimed.length;
	}

	private async claim() {
		return updatedRows<ClaimedJob>(
			await this.dataSource.query(
				`UPDATE fb_engagement_jobs
				 SET status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1, updated_at = now()
				 WHERE id IN (
				   SELECT id FROM fb_engagement_jobs
				   WHERE status = 'queued' AND run_after <= now()
				   ORDER BY run_after
				   LIMIT $2
				   FOR UPDATE SKIP LOCKED
				 )
				 RETURNING id, owner_user_id, campaign_id, comment_id, account_id, attempts, max_attempts`,
				[this.workerId, CLAIM_BATCH],
			),
		);
	}

	/** A job left running means the process died mid-request; Facebook may have published it, so never auto-retry. */
	private async recoverStale() {
		const rows = updatedRows<{ owner_user_id: string; campaign_id: string; comment_id: string }>(
			await this.dataSource.query(
				`UPDATE fb_engagement_jobs
				 SET status = 'failed', finished_at = now(), last_error_code = 'INTERRUPTED',
				     last_error = 'Publishing was interrupted', updated_at = now()
				 WHERE status = 'running' AND locked_at < now() - ($1 || ' minutes')::interval
				 RETURNING owner_user_id, campaign_id, comment_id`,
				[String(STALE_AFTER_MINUTES)],
			),
		);
		for (const row of rows) {
			await this.dataSource.getRepository(FbEngagementComment).update(
				{ id: row.comment_id, status: FbCommentStatus.PROCESSING },
				{
					status: FbCommentStatus.FAILED,
					lastErrorCode: 'UNKNOWN_OUTCOME',
					lastError: 'Publishing was interrupted. Check the post before retrying to avoid a duplicate comment.',
				},
			);
			await this.jobs.recomputeCampaign(row.campaign_id);
			await this.activity.log(row.owner_user_id, {
				campaignId: row.campaign_id,
				commentId: row.comment_id,
				action: 'comment.interrupted',
				level: 'warning',
				message: 'Publishing was interrupted; the comment was marked failed to avoid duplicates.',
			});
		}
	}

	private async run(job: ClaimedJob) {
		const manager = this.dataSource.manager;
		const comment = await manager.getRepository(FbEngagementComment).findOne({ where: { id: job.comment_id } });
		const campaign = await manager.getRepository(FbEngagementCampaign).findOne({ where: { id: job.campaign_id } });
		if (!comment || !campaign || comment.status !== FbCommentStatus.PENDING) {
			await this.finishJob(job.id, FbJobStatus.CANCELLED, { code: 'STALE_JOB', message: 'Comment is no longer pending' });
			if (campaign) await this.jobs.recomputeCampaign(campaign.id);
			return;
		}

		const [post, account] = await Promise.all([
			campaign.postId ? manager.getRepository(FbEngagementPost).findOne({ where: { id: campaign.postId } }) : null,
			job.account_id
				? manager.getRepository(FbEngagementAccount).findOne({ where: { id: job.account_id } })
				: null,
		]);
		if (!post) return this.fail(job, { code: 'POST_MISSING', message: 'The target post is no longer available.' });

		const problem = publisherIneligibility(account, post);
		if (problem) return this.fail(job, { code: problem.reason, message: problem.message });

		const waitUntil = await this.accountCooldownUntil(account.id);
		if (waitUntil) {
			await manager.query(
				`UPDATE fb_engagement_jobs
				 SET status = 'queued', run_after = $2, attempts = attempts - 1, locked_at = NULL, locked_by = NULL, updated_at = now()
				 WHERE id = $1`,
				[job.id, waitUntil],
			);
			return;
		}

		if (await this.alreadyPublishedOnPost(post.id, comment)) {
			return this.fail(job, {
				code: 'DUPLICATE',
				message: 'The same comment is already published on this post.',
			});
		}

		const target = {
			accountType: account.type,
			accountExternalId: account.externalId,
			postExternalId: post.externalId,
		};
		const publisher = this.registry.resolve(target);
		if (!publisher) {
			return this.fail(job, {
				code: 'NOT_SUPPORTED',
				message: 'Publishing comments with this account type is not supported by the official API.',
			});
		}
		const token = await this.connections.accountToken(account.id);
		if (!token) return this.fail(job, { code: 'TOKEN_MISSING', message: 'No access token stored for this Page.' });

		await manager.getRepository(FbEngagementComment).update(
			{ id: comment.id },
			{ status: FbCommentStatus.PROCESSING, attempts: job.attempts },
		);
		await this.jobs.recomputeCampaign(campaign.id);

		try {
			const result = await publisher.publish({ target, message: comment.message, accessToken: token });
			await manager.getRepository(FbEngagementComment).update(
				{ id: comment.id },
				{
					status: FbCommentStatus.PUBLISHED,
					externalCommentId: result.externalCommentId,
					publishedAt: new Date(),
					lastError: null,
					lastErrorCode: null,
				},
			);
			await this.finishJob(job.id, FbJobStatus.SUCCEEDED);
			await this.jobs.recomputeCampaign(campaign.id);
			await this.activity.log(job.owner_user_id, {
				campaignId: campaign.id,
				commentId: comment.id,
				action: 'comment.published',
				level: 'success',
				message: `Published a comment as ${account.name}.`,
				details: { externalCommentId: result.externalCommentId },
			});
		} catch (error) {
			const classification = classifyFacebookError(error);
			await this.connections.recordAccountFailure(account.id, classification);
			if (classification.retryable && job.attempts < job.max_attempts) {
				return this.scheduleRetry(job, classification);
			}
			await this.fail(job, { code: classification.kind, message: classification.userMessage, classification });
			if (classification.pausesCampaign) {
				await this.jobs.cancelQueued(
					job.owner_user_id,
					{ campaignId: campaign.id, accountIds: [account.id] },
					`Paused: ${classification.userMessage}`,
				);
			}
		}
	}

	private async scheduleRetry(job: ClaimedJob, classification: FbErrorClassification) {
		const runAfter = new Date(Date.now() + retryDelayMs(classification.kind, job.attempts));
		await this.dataSource.query(
			`UPDATE fb_engagement_jobs
			 SET status = 'queued', run_after = $2, locked_at = NULL, locked_by = NULL,
			     last_error = $3, last_error_code = $4, updated_at = now()
			 WHERE id = $1`,
			[job.id, runAfter, classification.userMessage, classification.kind],
		);
		await this.dataSource.getRepository(FbEngagementComment).update(
			{ id: job.comment_id },
			{ status: FbCommentStatus.PENDING, lastError: classification.userMessage, lastErrorCode: classification.kind },
		);
		await this.jobs.recomputeCampaign(job.campaign_id);
		await this.activity.log(job.owner_user_id, {
			campaignId: job.campaign_id,
			commentId: job.comment_id,
			action: 'comment.retry_scheduled',
			level: 'warning',
			message: `${classification.userMessage} Next attempt at ${runAfter.toISOString()}.`,
			details: { attempt: job.attempts, maxAttempts: job.max_attempts },
		});
	}

	private async fail(job: ClaimedJob, failure: Failure) {
		await this.finishJob(job.id, FbJobStatus.FAILED, failure);
		await this.dataSource.getRepository(FbEngagementComment).update(
			{ id: job.comment_id },
			{ status: FbCommentStatus.FAILED, lastError: failure.message, lastErrorCode: failure.code },
		);
		await this.jobs.recomputeCampaign(job.campaign_id);
		await this.activity.log(job.owner_user_id, {
			campaignId: job.campaign_id,
			commentId: job.comment_id,
			action: 'comment.failed',
			level: 'error',
			message: failure.message,
			details: { code: failure.code, attempt: job.attempts },
		});
	}

	private finishJob(jobId: string, status: FbJobStatus, failure?: Pick<Failure, 'code' | 'message'>) {
		return this.dataSource.getRepository(FbEngagementJob).update(
			{ id: jobId },
			{
				status,
				finishedAt: new Date(),
				lockedAt: null,
				lockedBy: null,
				lastError: failure?.message ?? null,
				lastErrorCode: failure?.code ?? null,
			},
		);
	}

	private async accountCooldownUntil(accountId: string) {
		const minInterval = this.minIntervalSeconds();
		if (!minInterval) return null;
		const [row] = await this.dataSource.query(
			`SELECT max(finished_at) AS last FROM fb_engagement_jobs WHERE account_id = $1 AND status = 'succeeded'`,
			[accountId],
		);
		if (!row?.last) return null;
		const next = new Date(row.last).getTime() + minInterval * 1000;
		return next > Date.now() ? new Date(next) : null;
	}

	private async alreadyPublishedOnPost(postId: string, comment: FbEngagementComment) {
		const rows: Array<{ message: string }> = await this.dataSource.query(
			`SELECT c.message FROM fb_engagement_comments c
			 JOIN fb_engagement_campaigns k ON k.id = c.campaign_id
			 WHERE k.post_id = $1 AND c.status = 'published' AND c.id <> $2`,
			[postId, comment.id],
		);
		const wanted = normalizeCommentMessage(comment.message);
		return rows.some((row) => normalizeCommentMessage(row.message) === wanted);
	}
}
