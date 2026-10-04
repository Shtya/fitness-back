import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
	FbAccountStatus,
	FbAccountType,
	FbCommentStatus,
	FbEngagementAccount,
	FbEngagementCampaign,
	FbEngagementComment,
	FbEngagementJob,
	FbEngagementPost,
	FbJobStatus,
} from '../entities/facebook-engagement.entity';
import { CommentPublisherRegistry } from '../publishers/comment-publisher.registry';
import { FacebookGraphError } from '../utils/fb-graph-errors';
import { FbEngagementActivityService } from './fb-engagement-activity.service';
import { FbEngagementConnectionsService } from './fb-engagement-connections.service';
import { FbEngagementJobsService } from './fb-engagement-jobs.service';
import { FbEngagementWorkerService } from './fb-engagement-worker.service';

type Options = {
	accountPatch?: Partial<FbEngagementAccount>;
	publish?: jest.Mock;
	publishedMessages?: string[];
	lastSucceededAt?: Date | null;
	minInterval?: string;
	attempts?: number;
};

function setup(options: Options = {}) {
	const claimed = {
		id: 'job-1',
		owner_user_id: 'user-1',
		campaign_id: 'camp-1',
		comment_id: 'comment-1',
		account_id: 'acc-1',
		attempts: options.attempts ?? 1,
		max_attempts: 3,
	};
	const rows = new Map<unknown, Array<Record<string, unknown>>>([
		[FbEngagementComment, [{ id: 'comment-1', campaignId: 'camp-1', message: 'Nice post!', status: FbCommentStatus.PENDING }]],
		[FbEngagementCampaign, [{ id: 'camp-1', postId: 'post-1' }]],
		[FbEngagementPost, [{ id: 'post-1', accountId: 'acc-1', externalId: '111_222' }]],
		[
			FbEngagementAccount,
			[
				{
					id: 'acc-1',
					name: 'So7baFit',
					type: FbAccountType.PAGE,
					status: FbAccountStatus.ACTIVE,
					canPublishComments: true,
					externalId: '111',
					...options.accountPatch,
				},
			],
		],
		[FbEngagementJob, []],
	]);
	const repos = new Map(
		[...rows.entries()].map(([entity, data]) => [
			entity,
			{
				findOne: jest.fn(async ({ where }) => data.find((row) => row.id === where.id) ?? null),
				update: jest.fn(),
			},
		]),
	);
	const query = jest.fn(async (sql: string) => {
		if (sql.includes('SKIP LOCKED')) return [[claimed], 1];
		if (sql.includes('INTERRUPTED')) return [[], 0];
		if (sql.includes("status = 'succeeded'")) return [{ last: options.lastSucceededAt ?? null }];
		if (sql.includes("c.status = 'published'")) return (options.publishedMessages ?? []).map((message) => ({ message }));
		return [[], 0];
	});
	const getRepository = (entity: unknown) => repos.get(entity);
	const dataSource = { query, getRepository, manager: { query, getRepository } } as unknown as DataSource;

	const publish = options.publish ?? jest.fn().mockResolvedValue({ externalCommentId: '111_222_999' });
	const registry = new CommentPublisherRegistry([{ id: 'test', supports: () => true, publish }]);
	const connections = {
		accountToken: jest.fn().mockResolvedValue('page-token'),
		recordAccountFailure: jest.fn(),
	} as unknown as FbEngagementConnectionsService;
	const jobs = { recomputeCampaign: jest.fn(), cancelQueued: jest.fn() } as unknown as FbEngagementJobsService;
	const activity = { log: jest.fn() } as unknown as FbEngagementActivityService;
	const config = { get: () => options.minInterval ?? '0' } as unknown as ConfigService;

	const worker = new FbEngagementWorkerService(config, registry, connections, jobs, activity, dataSource);
	return {
		worker,
		publish,
		query,
		jobs,
		commentUpdates: repos.get(FbEngagementComment)!.update,
		jobUpdates: repos.get(FbEngagementJob)!.update,
	};
}

describe('FbEngagementWorkerService', () => {
	it('publishes a pending comment and marks the job succeeded', async () => {
		const { worker, publish, commentUpdates, jobUpdates } = setup();
		await expect(worker.processDue()).resolves.toBe(1);

		expect(publish).toHaveBeenCalledWith({
			target: { accountType: FbAccountType.PAGE, accountExternalId: '111', postExternalId: '111_222' },
			message: 'Nice post!',
			accessToken: 'page-token',
		});
		expect(commentUpdates).toHaveBeenCalledWith(
			{ id: 'comment-1' },
			expect.objectContaining({ status: FbCommentStatus.PUBLISHED, externalCommentId: '111_222_999' }),
		);
		expect(jobUpdates).toHaveBeenCalledWith({ id: 'job-1' }, expect.objectContaining({ status: FbJobStatus.SUCCEEDED }));
	});

	it('reschedules retryable errors with backoff instead of failing', async () => {
		const publish = jest.fn().mockRejectedValue(new FacebookGraphError('temp', 500, 2, null, true));
		const { worker, query, commentUpdates } = setup({ publish });
		await worker.processDue();

		expect(query).toHaveBeenCalledWith(
			expect.stringContaining("SET status = 'queued', run_after = $2"),
			expect.arrayContaining(['job-1', 'TRANSIENT']),
		);
		expect(commentUpdates).toHaveBeenLastCalledWith(
			{ id: 'comment-1' },
			expect.objectContaining({ status: FbCommentStatus.PENDING, lastErrorCode: 'TRANSIENT' }),
		);
	});

	it('fails after the last attempt even for retryable errors', async () => {
		const publish = jest.fn().mockRejectedValue(new FacebookGraphError('temp', 500, 2, null, true));
		const { worker, commentUpdates } = setup({ publish, attempts: 3 });
		await worker.processDue();
		expect(commentUpdates).toHaveBeenLastCalledWith(
			{ id: 'comment-1' },
			expect.objectContaining({ status: FbCommentStatus.FAILED, lastErrorCode: 'TRANSIENT' }),
		);
	});

	it('pauses the rest of the campaign on a policy block', async () => {
		const publish = jest.fn().mockRejectedValue(new FacebookGraphError('blocked', 400, 368, null, false));
		const { worker, jobs, commentUpdates } = setup({ publish });
		await worker.processDue();

		expect(commentUpdates).toHaveBeenLastCalledWith(
			{ id: 'comment-1' },
			expect.objectContaining({ status: FbCommentStatus.FAILED, lastErrorCode: 'POLICY_BLOCKED' }),
		);
		expect(jobs.cancelQueued).toHaveBeenCalledWith(
			'user-1',
			{ campaignId: 'camp-1', accountIds: ['acc-1'] },
			expect.stringContaining('Paused'),
		);
	});

	it('never publishes the same message twice on a post', async () => {
		const { worker, publish, commentUpdates } = setup({ publishedMessages: ['  nice   POST! '] });
		await worker.processDue();
		expect(publish).not.toHaveBeenCalled();
		expect(commentUpdates).toHaveBeenLastCalledWith(
			{ id: 'comment-1' },
			expect.objectContaining({ status: FbCommentStatus.FAILED, lastErrorCode: 'DUPLICATE' }),
		);
	});

	it('defers the job when the Page published too recently', async () => {
		const { worker, publish, query } = setup({ minInterval: '60', lastSucceededAt: new Date() });
		await worker.processDue();
		expect(publish).not.toHaveBeenCalled();
		expect(query).toHaveBeenCalledWith(expect.stringContaining('attempts = attempts - 1'), expect.any(Array));
	});

	it('refuses to publish from a Page without the publish permission', async () => {
		const { worker, publish, commentUpdates } = setup({ accountPatch: { canPublishComments: false } });
		await worker.processDue();
		expect(publish).not.toHaveBeenCalled();
		expect(commentUpdates).toHaveBeenLastCalledWith(
			{ id: 'comment-1' },
			expect.objectContaining({ status: FbCommentStatus.FAILED, lastErrorCode: 'MISSING_PERMISSION' }),
		);
	});
});
