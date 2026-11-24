/** Tiny in-process sliding-window limiter (per key). Enough to blunt abuse of expensive endpoints on one node. */
export class RateLimiter {
	private readonly hits = new Map<string, number[]>();

	/** Returns true if the call is allowed and records it. */
	take(key: string, max: number, windowMs: number, now = Date.now()): boolean {
		const recent = (this.hits.get(key) || []).filter((t) => now - t < windowMs);
		if (recent.length >= max) {
			this.hits.set(key, recent);
			return false;
		}
		recent.push(now);
		this.hits.set(key, recent);
		if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < windowMs)) this.hits.delete(k);
		return true;
	}
}
