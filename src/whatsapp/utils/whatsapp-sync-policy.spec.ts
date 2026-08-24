import { shouldSkipFreshProviderSync } from './whatsapp-sync-policy';

describe('shouldSkipFreshProviderSync', () => {
	const now = 1_700_000_000_000;

	it('skips latest sync when local rows exist, even if watermark is old', () => {
		const result = shouldSkipFreshProviderSync({
			mode: 'latest',
			localCount: 12,
			lastProviderSyncAt: new Date(now - 60 * 60_000),
			now,
		});
		expect(result).toEqual({ skip: true, reason: 'local_replica' });
	});

	it('skips latest sync when local rows exist and never hydrated', () => {
		const result = shouldSkipFreshProviderSync({
			mode: 'latest',
			localCount: 8,
			now,
		});
		expect(result).toEqual({ skip: true, reason: 'local_replica' });
	});

	it('skips empty threads that already have a hydration watermark', () => {
		const result = shouldSkipFreshProviderSync({
			mode: 'latest',
			localCount: 0,
			lastProviderSyncAt: new Date(now - 1_000),
			now,
		});
		expect(result).toEqual({ skip: true, reason: 'hydrated_empty' });
	});

	it('does not skip empty threads that were never hydrated', () => {
		const result = shouldSkipFreshProviderSync({
			mode: 'latest',
			localCount: 0,
			now,
		});
		expect(result.skip).toBe(false);
		expect(result.reason).toBe('empty_thread');
	});

	it('does not skip when force is set', () => {
		const result = shouldSkipFreshProviderSync({
			mode: 'latest',
			force: true,
			localCount: 50,
			lastProviderSyncAt: new Date(now - 1_000),
			now,
		});
		expect(result).toEqual({ skip: false, reason: 'forced' });
	});

	it('does not skip older pagination mode', () => {
		const result = shouldSkipFreshProviderSync({
			mode: 'older',
			localCount: 50,
			lastProviderSyncAt: new Date(now - 1_000),
			now,
		});
		expect(result.skip).toBe(false);
		expect(result.reason).toBe('older_mode');
	});
});
