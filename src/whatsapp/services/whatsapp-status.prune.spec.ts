import { WhatsAppStatusService } from './whatsapp-status.service';

const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const HOUR = 60 * 60 * 1000;

function storyRow(n: number) {
	return {
		id: `row-${n}`,
		accountId: ACCOUNT,
		providerStatusId: `false_status@broadcast_3EB0STORY${n}_2010000000${n}@s.whatsapp.net`,
		senderWaId: `2010000000${n}@s.whatsapp.net`,
		type: 'image',
		caption: null,
		isOwn: false,
		publishedAt: new Date(Date.now() - n * HOUR),
		expiresAt: new Date(Date.now() + (24 - n) * HOUR),
		mediaPath: `/m/${n}.jpg`,
	};
}

function providerItem(n: number) {
	return {
		id: { _serialized: `false_status@broadcast_3EB0STORY${n}_2010000000${n}@s.whatsapp.net` },
		author: { _serialized: `2010000000${n}@s.whatsapp.net` },
		timestamp: Math.floor((Date.now() - n * HOUR) / 1000),
		type: 'image',
	};
}

function createService(cacheAgeMs: number) {
	const rows = [1, 2, 3, 4, 5].map(storyRow);
	const repo = {
		find: jest.fn(async () => rows.map(row => ({ ...row }))),
		save: jest.fn(async (row: any) => row),
		create: jest.fn((row: any) => row),
		delete: jest.fn(async () => undefined),
		manager: { query: jest.fn(async () => [{ phone_number: '201099999999' }]) },
	};
	const historyRepo = { upsert: jest.fn(async () => undefined) };
	const provider = {
		getState: () => 'connected',
		getOwnJids: () => ['201099999999@s.whatsapp.net'],
		statusCacheAgeMs: () => cacheAgeMs,
	};
	const service = new WhatsAppStatusService(
		repo as any,
		historyRepo as any,
		{ findOne: jest.fn(async () => null), upsert: jest.fn() } as any,
		{} as any,
		{} as any,
		{ getProvider: jest.fn(() => provider) } as any,
		{} as any,
		{ emitAccountEvent: jest.fn() } as any,
	);
	return { service, repo };
}

describe('story prune after a restart', () => {
	// The provider cache holds 4 of the 5 live stories: story 5 arrived before the restart.
	const fromCache = [1, 2, 3, 4].map(providerItem);

	it('keeps live stories the cache has not seen while it is younger than a story lifetime', async () => {
		const { service, repo } = createService(10 * 60_000);
		await (service as any).upsertProviderStatuses(ACCOUNT, fromCache, new Map());
		expect(repo.delete).not.toHaveBeenCalled();
	});

	it('removes a story missing from a cache that has been filling for 24 hours', async () => {
		const { service, repo } = createService(25 * HOUR);
		await (service as any).upsertProviderStatuses(ACCOUNT, fromCache, new Map());
		expect(repo.delete).toHaveBeenCalledWith(['row-5']);
	});

	it('does not count a story as missing just because its stored id has another prefix', async () => {
		const { service, repo } = createService(25 * HOUR);
		const sameStoryOtherPrefix = [1, 2, 3, 4, 5].map(providerItem);
		sameStoryOtherPrefix[4].id._serialized = sameStoryOtherPrefix[4].id._serialized.replace('false_', 'true_');
		await (service as any).upsertProviderStatuses(ACCOUNT, sameStoryOtherPrefix, new Map());
		const deleted = repo.delete.mock.calls.flat(2);
		expect(deleted).not.toContain('row-5');
	});
});
