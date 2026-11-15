import { SPARSE_RETRY_MS, shouldSkipFreshProviderSync } from './whatsapp-sync-policy';

describe('shouldSkipFreshProviderSync retries', () => {
	const now = Date.now();
	it('keeps skipping a just-pulled empty chat', () => {
		const result = shouldSkipFreshProviderSync({ mode: 'latest', localCount: 0, lastProviderSyncAt: new Date(now - 60_000), now });
		expect(result).toEqual({ skip: true, reason: 'hydrated_empty' });
	});
	it('asks the phone again for a chat still empty after the retry window', () => {
		const result = shouldSkipFreshProviderSync({ mode: 'latest', localCount: 0, lastProviderSyncAt: new Date(now - SPARSE_RETRY_MS - 1), now });
		expect(result).toEqual({ skip: false, reason: 'empty_retry' });
	});
	it('retries a sparse chat after the window, not before', () => {
		expect(shouldSkipFreshProviderSync({ mode: 'latest', localCount: 2, lastProviderSyncAt: new Date(now - 1_000), now }).skip).toBe(true);
		expect(shouldSkipFreshProviderSync({ mode: 'latest', localCount: 2, lastProviderSyncAt: new Date(now - SPARSE_RETRY_MS - 1), now })).toEqual({ skip: false, reason: 'sparse_retry' });
	});
	it('never retries a chat with a full local thread', () => {
		expect(shouldSkipFreshProviderSync({ mode: 'latest', localCount: 40, lastProviderSyncAt: new Date(0), now }).skip).toBe(true);
	});
});
