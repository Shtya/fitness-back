import type { NextFunction, Request, Response } from 'express';

/**
 * Minimal helmet-equivalent headers that are safe for this API.
 * No X-Frame-Options / CORP here: guarded media and public uploads are embedded cross-origin by the web app.
 */
export function securityHeaders() {
	return (req: Request, res: Response, next: NextFunction) => {
		res.setHeader('X-Content-Type-Options', 'nosniff');
		res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
		res.setHeader('X-DNS-Prefetch-Control', 'off');
		res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
		if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
		next();
	};
}

type Bucket = { count: number; resetAt: number };

export type FixedWindowLimiterOptions = {
	windowMs: number;
	max: number;
	maxKeys?: number;
	now?: () => number;
};

/**
 * In-memory fixed-window limiter for brute-force targets (login, OTP reset).
 * Keyed by route + client IP + submitted email so a missing X-Forwarded-For
 * (every client seen as 127.0.0.1) degrades to per-account limits instead of a global lockout.
 */
export function authAttemptLimiter(options: FixedWindowLimiterOptions) {
	const { windowMs, max, maxKeys = 20_000, now = Date.now } = options;
	const buckets = new Map<string, Bucket>();

	const sweep = (at: number) => {
		for (const [key, bucket] of buckets) {
			if (bucket.resetAt <= at) buckets.delete(key);
		}
		while (buckets.size >= maxKeys) {
			const oldest = buckets.keys().next().value;
			if (oldest === undefined) break;
			buckets.delete(oldest);
		}
	};

	const handler = (req: Request, res: Response, next: NextFunction) => {
		if (req.method !== 'POST') return next();
		const at = now();
		const email = String((req.body as any)?.email ?? '').trim().toLowerCase();
		const key = `${req.baseUrl ?? ''}${req.path}|${req.ip ?? ''}|${email}`;
		let bucket = buckets.get(key);
		if (!bucket || bucket.resetAt <= at) {
			if (!bucket && buckets.size >= maxKeys) sweep(at);
			bucket = { count: 0, resetAt: at + windowMs };
			buckets.set(key, bucket);
		}
		bucket.count += 1;
		if (bucket.count > max) {
			res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - at) / 1000))));
			res.status(429).json({ statusCode: 429, message: 'Too many attempts. Please try again later.' });
			return;
		}
		next();
	};
	return Object.assign(handler, { size: () => buckets.size });
}
