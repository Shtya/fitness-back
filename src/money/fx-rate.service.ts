import { Injectable, Logger } from '@nestjs/common';

const FX_URL = 'https://open.er-api.com/v6/latest/USD';
const FRESH_MS = 15 * 60_000;
const RETRY_AFTER_FAILURE_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 6_000;

export type FxQuote = {
	usdToEgp: number;
	updatedAt: string;
	fetchedAt: string;
	stale: boolean;
	source: string;
};

/** USD → EGP from open.er-api.com (no key). Shared cache for the wallet + gold quote. */
@Injectable()
export class FxRateService {
	private readonly logger = new Logger(FxRateService.name);
	private quote: FxQuote | null = null;
	private fetchedAtMs = 0;
	private failedAtMs = 0;
	private inflight: Promise<FxQuote | null> | null = null;

	async getQuote(): Promise<FxQuote | null> {
		const now = Date.now();
		if (this.quote && now - this.fetchedAtMs < FRESH_MS) return this.quote;
		if (now - this.failedAtMs < RETRY_AFTER_FAILURE_MS) return this.quote;
		this.inflight ??= this.refresh().finally(() => {
			this.inflight = null;
		});
		return this.inflight;
	}

	async requireUsdToEgp(): Promise<number> {
		const quote = await this.getQuote();
		if (!quote?.usdToEgp) throw new Error('USD/EGP rate unavailable');
		return quote.usdToEgp;
	}

	private async refresh(): Promise<FxQuote | null> {
		try {
			const res = await fetch(FX_URL, {
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				headers: { accept: 'application/json' },
			});
			if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
			const body = await res.json();
			const usdToEgp = Number(body?.rates?.EGP);
			if (!(usdToEgp > 0)) throw new Error('Unexpected FX payload');
			this.quote = {
				usdToEgp,
				updatedAt: typeof body?.time_last_update_utc === 'string' ? new Date(body.time_last_update_utc).toISOString() : new Date().toISOString(),
				fetchedAt: new Date().toISOString(),
				stale: false,
				source: 'open.er-api.com',
			};
			this.fetchedAtMs = Date.now();
			return this.quote;
		} catch (error) {
			this.failedAtMs = Date.now();
			this.logger.warn(`FX rate unavailable: ${error instanceof Error ? error.message : error}`);
			if (this.quote) this.quote = { ...this.quote, stale: true };
			return this.quote;
		}
	}
}
