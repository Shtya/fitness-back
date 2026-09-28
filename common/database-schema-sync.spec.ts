import { shouldSynchronizeSchema } from './database-schema-sync';

describe('shouldSynchronizeSchema', () => {
	it('is off by default, including when NODE_ENV is unset', () => {
		expect(shouldSynchronizeSchema({ DATABASE_HOST: 'aws-0-eu-central-1.pooler.supabase.com' })).toBe(false);
		expect(shouldSynchronizeSchema({ DATABASE_HOST: 'localhost' })).toBe(false);
		expect(shouldSynchronizeSchema({ DATABASE_SYNCHRONIZE: 'false', DATABASE_HOST: 'localhost' })).toBe(false);
	});

	it('allows explicit opt-in against a local database', () => {
		expect(shouldSynchronizeSchema({ DATABASE_SYNCHRONIZE: 'true', DATABASE_HOST: 'localhost' })).toBe(true);
		expect(shouldSynchronizeSchema({ DATABASE_SYNCHRONIZE: 'TRUE', DATABASE_HOST: '127.0.0.1' })).toBe(true);
	});

	it('refuses opt-in against a remote database', () => {
		expect(() =>
			shouldSynchronizeSchema({
				DATABASE_SYNCHRONIZE: 'true',
				DATABASE_HOST: 'aws-0-eu-central-1.pooler.supabase.com',
			}),
		).toThrow(/local database/);
	});

	it('refuses opt-in in production', () => {
		expect(() =>
			shouldSynchronizeSchema({
				DATABASE_SYNCHRONIZE: 'true',
				DATABASE_HOST: 'localhost',
				NODE_ENV: 'production',
			}),
		).toThrow(/production/);
	});
});
