export const TROY_OUNCE_GRAMS = 31.1034768;
export const GOLD_KARATS = [24, 22, 21, 18] as const;
export type GoldKarat = (typeof GOLD_KARATS)[number];

export type GoldQuote = {
	/** EGP per gram for each karat. */
	perGram: Record<GoldKarat, number>;
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

export function goldValue(grams: number, karat: number, perGram: Record<GoldKarat, number> | null | undefined): number | null {
	if (!perGram || !isGoldKarat(karat)) return null;
	return round2(grams * perGram[karat]);
}
