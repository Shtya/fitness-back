import {
	backgroundJobsEnabled,
	sharedDatabaseWarnings,
	whatsappSessionsEnabled,
} from './runtime-isolation';

describe('runtime isolation flags', () => {
	it('default to enabled so an unconfigured production server keeps working', () => {
		expect(whatsappSessionsEnabled({})).toBe(true);
		expect(backgroundJobsEnabled({})).toBe(true);
	});

	it('turn off only on an explicit false', () => {
		expect(whatsappSessionsEnabled({ WHATSAPP_SESSIONS_ENABLED: 'false' })).toBe(false);
		expect(backgroundJobsEnabled({ BACKGROUND_JOBS_ENABLED: 'FALSE' })).toBe(false);
		expect(whatsappSessionsEnabled({ WHATSAPP_SESSIONS_ENABLED: 'true' })).toBe(true);
	});

	it('warns when a non-production process shares a remote database', () => {
		const warnings = sharedDatabaseWarnings({ DATABASE_HOST: 'aws-0-eu-central-1.pooler.supabase.com' });
		expect(warnings).toHaveLength(2);
		expect(
			sharedDatabaseWarnings({
				DATABASE_HOST: 'aws-0-eu-central-1.pooler.supabase.com',
				WHATSAPP_SESSIONS_ENABLED: 'false',
				BACKGROUND_JOBS_ENABLED: 'false',
			}),
		).toEqual([]);
		expect(sharedDatabaseWarnings({ DATABASE_HOST: 'localhost' })).toEqual([]);
		expect(
			sharedDatabaseWarnings({ DATABASE_HOST: 'db.example.com', NODE_ENV: 'production' }),
		).toEqual([]);
	});
});
