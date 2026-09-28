type Env = Record<string, string | undefined>;
type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;

function normalizeOrigin(value: string) {
	return value.trim().replace(/\/+$/, '').toLowerCase();
}

/** `CORS_ORIGIN` (comma-separated) is the allowlist; null means none is configured. */
export function configuredCorsOrigins(env: Env = process.env, overrideKey?: string): string[] | null {
	const raw = String(
		(overrideKey && env[overrideKey]) || env.CORS_ORIGIN || env.FRONTEND_URL || '',
	).trim();
	if (!raw || raw === '*') return null;
	const origins = raw.split(',').map(normalizeOrigin).filter(Boolean);
	return origins.length ? origins : null;
}

export function isCorsOriginAllowed(
	origin: string | undefined,
	env: Env = process.env,
	overrideKey?: string,
): boolean {
	// No Origin header: same-origin navigation, server-to-server, or curl — CORS does not apply.
	if (!origin) return true;
	const allowlist = configuredCorsOrigins(env, overrideKey);
	if (allowlist) return allowlist.includes(normalizeOrigin(origin));
	if (env.NODE_ENV === 'production') {
		return normalizeOrigin(origin) === normalizeOrigin(env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000');
	}
	return true;
}

/**
 * Resolved per request: decorator arguments are evaluated at import time,
 * before ConfigModule has loaded `.env`.
 */
export function corsOriginDelegate(overrideKey?: string) {
	return (origin: string | undefined, callback: CorsOriginCallback) =>
		callback(null, isCorsOriginAllowed(origin, process.env, overrideKey));
}

export function corsAllowlistWarning(env: Env = process.env): string | null {
	if (configuredCorsOrigins(env) || env.NODE_ENV === 'production') return null;
	return 'CORS_ORIGIN is not set: every browser origin is accepted with credentials. Set CORS_ORIGIN to the dashboard origin(s), comma-separated.';
}
