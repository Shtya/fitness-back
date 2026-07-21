/**
 * Resolve allowed browser origins for HTTP CORS and Socket.IO.
 * FRONTEND_URL may be a single URL or a comma-separated list.
 *
 * Production frontends (so7bafit.com / www) are always included so a missing
 * or incomplete FRONTEND_URL on the VPS does not break the Vercel dashboard.
 */
export function resolveCorsOrigins(): string[] {
	const fromEnv = String(process.env.FRONTEND_URL || '')
		.split(',')
		.map((value) => value.trim().replace(/^["']|["']$/g, ''))
		.filter(Boolean)
		.map((value) => value.replace(/\/$/, ''));

	const defaults = [
		'http://localhost:3000',
		'http://127.0.0.1:3000',
		'https://so7bafit.com',
		'https://www.so7bafit.com',
	];

	const preview = String(process.env.CORS_EXTRA_ORIGINS || '')
		.split(',')
		.map((value) => value.trim().replace(/^["']|["']$/g, ''))
		.filter(Boolean)
		.map((value) => value.replace(/\/$/, ''));

	return [...new Set([...fromEnv, ...defaults, ...preview])];
}

export function isCorsOriginAllowed(
	origin: string | undefined,
	allowed: string[] = resolveCorsOrigins(),
): boolean {
	if (!origin) return true; // same-origin / curl / server-to-server
	const normalized = origin.replace(/\/$/, '');
	if (allowed.includes(normalized)) return true;

	// Allow Vercel preview deployments of this project when enabled.
	if (
		process.env.CORS_ALLOW_VERCEL_PREVIEWS === 'true' &&
		/^https:\/\/[\w-]+-[\w.-]+\.vercel\.app$/i.test(normalized)
	) {
		return true;
	}

	return false;
}

export function createCorsOriginDelegate(allowed: string[] = resolveCorsOrigins()) {
	return (
		origin: string | undefined,
		callback: (err: Error | null, allow?: boolean) => void,
	) => {
		if (isCorsOriginAllowed(origin, allowed)) {
			callback(null, true);
			return;
		}
		callback(null, false);
	};
}
