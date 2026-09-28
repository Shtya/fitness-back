const MIN_POOL = 2;
const SESSION_MODE = { fallback: 4, cap: 8 };
const TRANSACTION_MODE = { fallback: 12, cap: 20 };
const SUPAVISOR_TRANSACTION_PORT = 6543;

export function isTransactionPooler(env: NodeJS.ProcessEnv = process.env): boolean {
	const mode = String(env.DATABASE_POOLER_MODE || '').trim().toLowerCase();
	if (mode) return mode === 'transaction';
	return Number(env.DATABASE_PORT) === SUPAVISOR_TRANSACTION_PORT;
}

/**
 * Session-mode poolers (Supabase :5432) hold one upstream slot per client connection,
 * and that slot budget is shared by every process using the same DB user, so the pool
 * stays small. Transaction-mode poolers (:6543) multiplex, so a larger pool is safe.
 */
export function resolveDatabasePoolSize(env: NodeJS.ProcessEnv = process.env): number {
	const limits = isTransactionPooler(env) ? TRANSACTION_MODE : SESSION_MODE;
	const requested = Math.floor(Number(env.DATABASE_POOL_SIZE)) || limits.fallback;
	return Math.min(Math.max(requested, MIN_POOL), limits.cap);
}
