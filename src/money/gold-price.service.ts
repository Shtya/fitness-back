import { Injectable, Logger } from '@nestjs/common';
import { GoldQuote, TROY_OUNCE_GRAMS, gramPrices, localGramPrices } from './gold-price';

/** Egyptian dealer prices (free, no key, ~hourly). Attribution: getdaleelak.com. */
const LOCAL_URL = 'https://getdaleelak.com/api/v1/feed.json';
const GOLD_URL = 'https://api.gold-api.com/price/XAU';
const FX_URL = 'https://open.er-api.com/v6/latest/USD';
const FRESH_MS = 15 * 60_000;
const RETRY_AFTER_FAILURE_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 6_000;

/**
 * Free, key-less sources; one shared quote per process, refreshed at most every 15 minutes.
 * The Egyptian shop price comes first: the world price × the dollar rate (the old source) runs
 * a few percent under what gold shops in Egypt charge, so it is only the fallback.
 */
@Injectable()
export class GoldPriceService {
	private readonly logger = new Logger(GoldPriceService.name);
	private quote: GoldQuote | null = null;
	private fetchedAtMs = 0;
	private failedAtMs = 0;
	private inflight: Promise<GoldQuote | null> | null = null;

	async getQuote(): Promise<GoldQuote | null> {
		const now = Date.now();
		if (this.quote && now - this.fetchedAtMs < FRESH_MS) return this.quote;
		if (now - this.failedAtMs < RETRY_AFTER_FAILURE_MS) return this.quote;
		this.inflight ??= this.refresh().finally(() => {
			this.inflight = null;
		});
		return this.inflight;
	}

	private async refresh(): Promise<GoldQuote | null> {
		try {
			const local = localGramPrices(await this.getJson(LOCAL_URL));
			if (!local) throw new Error('Unexpected local price payload');
			const usdToEgp = local.usdToEgp || this.quote?.usdToEgp || 0;
			this.quote = {
				perGram: local.perGram,
				buyBackPerGram: local.buyBackPerGram,
				usdPerOunce:
					local.globalPerGram24 && usdToEgp ? Math.round((local.globalPerGram24 / usdToEgp) * TROY_OUNCE_GRAMS * 100) / 100 : 0,
				usdToEgp,
				updatedAt: local.updatedAt,
				fetchedAt: new Date().toISOString(),
				stale: false,
				source: 'getdaleelak.com (Egyptian dealers)',
			};
			this.fetchedAtMs = Date.now();
			return this.quote;
		} catch (error) {
			this.logger.warn(
				`Egyptian gold prices unavailable, using the world price: ${error instanceof Error ? error.message : error}`,
			);
		}
		try {
			const [gold, fx] = await Promise.all([this.getJson(GOLD_URL), this.getJson(FX_URL)]);
			const usdPerOunce = Number(gold?.price);
			const usdToEgp = Number(fx?.rates?.EGP);
			if (!(usdPerOunce > 0) || !(usdToEgp > 0)) throw new Error('Unexpected price payload');
			this.quote = {
				perGram: gramPrices(usdPerOunce, usdToEgp),
				usdPerOunce,
				usdToEgp,
				updatedAt: typeof gold?.updatedAt === 'string' ? gold.updatedAt : new Date().toISOString(),
				fetchedAt: new Date().toISOString(),
				stale: false,
				source: 'gold-api.com · open.er-api.com',
			};
			this.fetchedAtMs = Date.now();
			return this.quote;
		} catch (error) {
			this.failedAtMs = Date.now();
			this.logger.warn(`Gold price unavailable: ${error instanceof Error ? error.message : error}`);
			if (this.quote) this.quote = { ...this.quote, stale: true };
			return this.quote;
		}
	}

	private async getJson(url: string): Promise<any> {
		const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
		return res.json();
	}
}
