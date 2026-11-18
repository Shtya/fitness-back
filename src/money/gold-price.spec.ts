import { goldValue, gramPrices, isGoldKarat, localGramPrices } from './gold-price';

/** Trimmed from the real getdaleelak.com feed of 18 Nov 2026. */
const asset = (id: string, sellers: Array<[number, number]>, global: number) => ({
	id,
	observedAt: '2026-11-18T16:00:00.000Z',
	freshness: { state: 'fresh', stale: false },
	global: { value: global },
	sellers: sellers.map(([buy, sell], index) => ({ seller: `s${index}`, buy, sell })),
});
const FEED = {
	generatedAt: '2026-11-18T16:01:15.839Z',
	assets: [
		{ id: 'USD-EGP', benchmark: { buy: 53.75, sell: 53.89 }, global: { value: 53.72 } },
		asset('GOLD24K-EGP', [[6578.66, 6648.63], [6599.77, 6649.47], [6583, 6606], [6577.96, 6643.91]], 6488.93),
		asset('GOLD21K-EGP', [[5757, 5818.2], [5760, 5780], [5755.72, 5813.42], [5750, 5800]], 5677.81),
		asset('GOLD18K-EGP', [[4937, 4954], [4928.5, 4971.5]], 4866.69),
	],
};

describe('Egyptian market gold prices (Daleelak feed)', () => {
	it('uses the median dealer price per karat, and the buy-back price apart', () => {
		const local = localGramPrices(FEED)!;
		expect(local.perGram[21]).toBe(5806.71);
		expect(local.perGram[24]).toBe(6646.27);
		expect(local.perGram[18]).toBe(4962.75);
		expect(local.perGram[22]).toBe(6083.22); // 21K by purity: not quoted in Egypt
		expect(local.buyBackPerGram[21]).toBe(5756.36);
		expect(local.updatedAt).toBe('2026-11-18T16:00:00.000Z');
		expect(local.usdToEgp).toBe(53.89);
	});

	it('is above the world price × dollar rate the wallet used before', () => {
		expect(localGramPrices(FEED)!.perGram[21]).toBeGreaterThan(5677.81);
	});

	it('rejects a broken, stale or incomplete feed (the world price is used then)', () => {
		expect(localGramPrices(null)).toBeNull();
		expect(localGramPrices({ assets: FEED.assets.filter(item => item.id !== 'GOLD18K-EGP') })).toBeNull();
		const stale = { assets: FEED.assets.map(item => (item.id === 'GOLD21K-EGP' ? { ...item, freshness: { stale: true } } : item)) };
		expect(localGramPrices(stale)).toBeNull();
		const swapped = {
			assets: FEED.assets.map(item =>
				item.id === 'GOLD21K-EGP' ? asset('GOLD21K-EGP', [[100, 120]], 100) : item,
			),
		};
		expect(localGramPrices(swapped)).toBeNull();
	});
});

describe('gold price', () => {
	it('converts USD per troy ounce to EGP per gram for each karat', () => {
		// 3110.34768 USD/oz = 100 USD/g pure; at 50 EGP/USD = 5000 EGP/g for 24K.
		const prices = gramPrices(3110.34768, 50);
		expect(prices[24]).toBe(5000);
		expect(prices[22]).toBe(4583.33);
		expect(prices[21]).toBe(4375);
		expect(prices[18]).toBe(3750);
	});

	it('values grams at the karat price', () => {
		const prices = gramPrices(3110.34768, 50);
		expect(goldValue(12.5, 21, prices)).toBe(54687.5);
		expect(goldValue(1.234, 18, prices)).toBe(4627.5);
	});

	it('has no value without a quote or with an unknown karat', () => {
		expect(goldValue(10, 21, null)).toBeNull();
		expect(goldValue(10, 14, gramPrices(3000, 50))).toBeNull();
		expect(isGoldKarat(21)).toBe(true);
		expect(isGoldKarat('18')).toBe(true);
		expect(isGoldKarat(9)).toBe(false);
	});
});
