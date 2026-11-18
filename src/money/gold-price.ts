export const TROY_OUNCE_GRAMS = 31.1034768;
export const GOLD_KARATS = [24, 22, 21, 18] as const;
export type GoldKarat = (typeof GOLD_KARATS)[number];

export type GoldQuote = {
	/** EGP per gram for each karat: the Egyptian shop price (what you pay to buy). */
	perGram: Record<GoldKarat, number>;
	/** EGP per gram a shop pays when you sell (local market only). */
	buyBackPerGram?: Partial<Record<GoldKarat, number>>;
	usdPerOunce: number;
	usdToEgp: number;
	/** When the gold source last priced the metal. */
	updatedAt: string;
	fetchedAt: string;
	/** True when the live sources failed and this is the last good quote. */
	stale: boolean;
	source: string;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export function isGoldKarat(value: unknown): value is GoldKarat {
	return GOLD_KARATS.includes(Number(value) as GoldKarat);
}

/** International spot converted to EGP; purity scales linearly with karat (21k = 21/24 of pure gold). */
export function gramPrices(usdPerOunce: number, usdToEgp: number): Record<GoldKarat, number> {
	const pure = (usdPerOunce / TROY_OUNCE_GRAMS) * usdToEgp;
	return Object.fromEntries(GOLD_KARATS.map((k) => [k, round2((pure * k) / 24)])) as Record<GoldKarat, number>;
}

const median = (values: number[]) => {
	const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
	if (!sorted.length) return NaN;
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Egyptian market prices from the Daleelak feed (eDahab, iSagha, BTC, Goldady…): the median
 * across dealers per karat. A dealer's `sell` is what you pay; their `buy` is what you get.
 * 22K is not quoted in Egypt, so it follows 21K by purity. Null when the feed is unusable.
 */
export function localGramPrices(feed: any): {
	perGram: Record<GoldKarat, number>;
	buyBackPerGram: Partial<Record<GoldKarat, number>>;
	updatedAt: string;
	usdToEgp: number | null;
	globalPerGram24: number | null;
} | null {
	const assets: any[] = Array.isArray(feed?.assets) ? feed.assets : [];
	const read = (id: string) => {
		const asset = assets.find((item) => item?.id === id);
		if (!asset || asset?.freshness?.stale === true) return null;
		const sellers: any[] = Array.isArray(asset.sellers) ? asset.sellers : [];
		const sell = median(sellers.map((row) => Number(row?.sell)));
		const buy = median(sellers.map((row) => Number(row?.buy)));
		// No dealer table: the best quotes. directions.buy = you buy (dealer sell), .sell = you sell.
		const fallbackSell = Number(asset?.directions?.buy?.best?.value);
		const fallbackBuy = Number(asset?.directions?.sell?.best?.value);
		return {
			sell: Number.isFinite(sell) ? sell : fallbackSell > 0 ? fallbackSell : NaN,
			buy: Number.isFinite(buy) ? buy : fallbackBuy > 0 ? fallbackBuy : NaN,
			observedAt: typeof asset.observedAt === 'string' ? asset.observedAt : null,
			global: Number(asset?.global?.value) || null,
		};
	};
	const k24 = read('GOLD24K-EGP');
	const k21 = read('GOLD21K-EGP');
	const k18 = read('GOLD18K-EGP');
	if (!k24 || !k21 || !k18 || ![k24.sell, k21.sell, k18.sell].every((value) => value > 0)) return null;
	// Sanity: the karats must line up with their purity (rejects a broken or swapped feed).
	const ratio = k21.sell / k24.sell;
	if (ratio < 0.8 || ratio > 0.95) return null;
	const perGram = {
		24: round2(k24.sell),
		22: round2((k21.sell * 22) / 21),
		21: round2(k21.sell),
		18: round2(k18.sell),
	} as Record<GoldKarat, number>;
	const buyBackPerGram: Partial<Record<GoldKarat, number>> = {};
	for (const [karat, row] of [[24, k24], [21, k21], [18, k18]] as const) {
		if (row.buy > 0) buyBackPerGram[karat] = round2(row.buy);
	}
	const usd = assets.find((item) => item?.id === 'USD-EGP');
	const usdToEgp = Number(usd?.benchmark?.sell) || Number(usd?.global?.value) || null;
	const updatedAt =
		[k24.observedAt, k21.observedAt, k18.observedAt].filter(Boolean).sort().pop() ||
		(typeof feed?.generatedAt === 'string' ? feed.generatedAt : new Date().toISOString());
	return { perGram, buyBackPerGram, updatedAt, usdToEgp, globalPerGram24: k24.global };
}

export function goldValue(grams: number, karat: number, perGram: Record<GoldKarat, number> | null | undefined): number | null {
	if (!perGram || !isGoldKarat(karat)) return null;
	return round2(grams * perGram[karat]);
}
