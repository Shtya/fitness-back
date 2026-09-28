const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'db']);

export function isLocalDatabaseHost(host: string | undefined) {
	return LOCAL_DB_HOSTS.has(String(host || '').trim().toLowerCase());
}

/**
 * TypeORM `synchronize` rewrites tables from entity metadata (it can DROP columns).
 * It is opt-in only, and only against a database on this machine — never the
 * shared Supabase instance — so schema changes always ship as reviewed SQL
 * migrations in `migrations/`.
 */
export function shouldSynchronizeSchema(env: NodeJS.ProcessEnv = process.env) {
	if (String(env.DATABASE_SYNCHRONIZE || '').trim().toLowerCase() !== 'true') return false;
	if (env.NODE_ENV === 'production') {
		throw new Error('DATABASE_SYNCHRONIZE=true is not allowed when NODE_ENV=production');
	}
	if (!isLocalDatabaseHost(env.DATABASE_HOST)) {
		throw new Error(
			`DATABASE_SYNCHRONIZE=true is only allowed against a local database (got host "${env.DATABASE_HOST}")`,
		);
	}
	return true;
}
