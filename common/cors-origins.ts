/**
 * Resolve allowed browser origins for HTTP CORS and Socket.IO.
 * FRONTEND_URL may be a single URL or a comma-separated list.
 */
export function resolveCorsOrigins(): string[] {
	const fromEnv = String(process.env.FRONTEND_URL || '')
		.split(',')
		.map(value => value.trim().replace(/^["']|["']$/g, ''))
		.filter(Boolean);

	const defaults = ['http://localhost:3000', 'http://127.0.0.1:3000'];
	const isProd = process.env.NODE_ENV === 'production';

	const merged = new Set<string>([
		...fromEnv,
		// Local dashboard origins while developing against a remote FRONTEND_URL.
		...(isProd ? [] : defaults),
	]);

	if (merged.size === 0) {
		defaults.forEach(origin => merged.add(origin));
	}

	return [...merged];
}
