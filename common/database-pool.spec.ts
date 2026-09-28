import { isTransactionPooler, resolveDatabasePoolSize } from './database-pool';

describe('resolveDatabasePoolSize', () => {
	it('keeps the current session-mode behaviour (default 4, cap 8)', () => {
		expect(resolveDatabasePoolSize({ DATABASE_PORT: '5432' })).toBe(4);
		expect(resolveDatabasePoolSize({ DATABASE_PORT: '5432', DATABASE_POOL_SIZE: '4' })).toBe(4);
		expect(resolveDatabasePoolSize({ DATABASE_PORT: '5432', DATABASE_POOL_SIZE: '15' })).toBe(8);
	});

	it('allows a larger pool behind the Supavisor transaction port', () => {
		expect(resolveDatabasePoolSize({ DATABASE_PORT: '6543' })).toBe(12);
		expect(resolveDatabasePoolSize({ DATABASE_PORT: '6543', DATABASE_POOL_SIZE: '15' })).toBe(15);
		expect(resolveDatabasePoolSize({ DATABASE_PORT: '6543', DATABASE_POOL_SIZE: '99' })).toBe(20);
	});

	it('honours an explicit pooler mode over the port', () => {
		expect(isTransactionPooler({ DATABASE_PORT: '6432', DATABASE_POOLER_MODE: 'transaction' })).toBe(true);
		expect(isTransactionPooler({ DATABASE_PORT: '6543', DATABASE_POOLER_MODE: 'session' })).toBe(false);
	});

	it('clamps invalid or tiny values', () => {
		expect(resolveDatabasePoolSize({ DATABASE_POOL_SIZE: 'abc' })).toBe(4);
		expect(resolveDatabasePoolSize({ DATABASE_POOL_SIZE: '1' })).toBe(2);
		expect(resolveDatabasePoolSize({ DATABASE_POOL_SIZE: '0' })).toBe(4);
	});
});
