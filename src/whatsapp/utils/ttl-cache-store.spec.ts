import { TtlCacheStore } from './ttl-cache-store';

describe('TtlCacheStore', () => {
	it('expires entries after the TTL', () => {
		let now = 1_000;
		const cache = new TtlCacheStore(100, 10, () => now);
		cache.set('a', 1);
		expect(cache.get('a')).toBe(1);
		now += 100;
		expect(cache.get('a')).toBeUndefined();
		expect(cache.size).toBe(0);
	});

	it('evicts the least recently set entry past the cap', () => {
		const cache = new TtlCacheStore(60_000, 2);
		cache.set('a', 1);
		cache.set('b', 2);
		cache.set('a', 3);
		cache.set('c', 4);
		expect(cache.get('b')).toBeUndefined();
		expect(cache.get('a')).toBe(3);
		expect(cache.get('c')).toBe(4);
	});

	it('supports del and flushAll', () => {
		const cache = new TtlCacheStore(60_000, 10);
		cache.set('a', 1);
		cache.set('b', 2);
		cache.del('a');
		expect(cache.get('a')).toBeUndefined();
		cache.flushAll();
		expect(cache.size).toBe(0);
	});
});
