/**
 * Bounded in-memory TTL cache implementing Baileys' `CacheStore` contract
 * (`get` / `set` / `del` / `flushAll`). Oldest entries are evicted first.
 */
export class TtlCacheStore {
	private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

	constructor(
		private readonly ttlMs: number,
		private readonly maxEntries: number,
		private readonly now: () => number = Date.now,
	) {}

	get<T>(key: string): T | undefined {
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt <= this.now()) {
			this.entries.delete(key);
			return undefined;
		}
		return entry.value as T;
	}

	set<T>(key: string, value: T): boolean {
		this.entries.delete(key);
		this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
		while (this.entries.size > this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
		return true;
	}

	del(key: string): boolean {
		return this.entries.delete(key);
	}

	flushAll(): void {
		this.entries.clear();
	}

	get size() {
		return this.entries.size;
	}
}
