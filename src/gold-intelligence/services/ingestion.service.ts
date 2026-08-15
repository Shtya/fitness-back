import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FRED_SERIES, SOURCE_REGISTRY } from '../constants/sources.registry';
import {
  GoldCftcEntity,
  GoldDataSourceEntity,
  GoldMacroObservationEntity,
  GoldNewsEntity,
  GoldOhlcvEntity,
  GoldPriceTickEntity,
} from '../entities/gold-intelligence.entity';
import { asNumber, goldHttpGet } from '../utils/gold-http';
import {
  detectStaleMinutes,
  freshnessLabel,
  impossibleJump,
} from '../utils/gold-math';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

@Injectable()
export class GoldIngestionService {
  private readonly logger = new Logger(GoldIngestionService.name);
  private ingesting = false;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(GoldDataSourceEntity)
    private readonly sources: Repository<GoldDataSourceEntity>,
    @InjectRepository(GoldPriceTickEntity)
    private readonly ticks: Repository<GoldPriceTickEntity>,
    @InjectRepository(GoldOhlcvEntity)
    private readonly ohlcv: Repository<GoldOhlcvEntity>,
    @InjectRepository(GoldMacroObservationEntity)
    private readonly macro: Repository<GoldMacroObservationEntity>,
    @InjectRepository(GoldNewsEntity)
    private readonly news: Repository<GoldNewsEntity>,
    @InjectRepository(GoldCftcEntity)
    private readonly cftc: Repository<GoldCftcEntity>,
  ) {}

  demoMode(): boolean {
    return String(this.config.get('GOLD_INTELLIGENCE_DEMO') || '').toLowerCase() === 'true';
  }

  async ensureSources(): Promise<void> {
    for (const def of SOURCE_REGISTRY) {
      const existing = await this.sources.findOne({ where: { sourceName: def.sourceName } });
      if (!existing) {
        await this.sources.save(
          this.sources.create({
            sourceName: def.sourceName,
            sourceType: def.sourceType,
            status: 'idle',
            metaJson: def as any,
          }),
        );
      }
    }
  }

  async markSource(
    name: string,
    patch: Partial<GoldDataSourceEntity>,
  ): Promise<void> {
    await this.ensureSources();
    await this.sources.update({ sourceName: name }, patch);
  }

  async ingestAll(opts: { historyDays?: number } = {}): Promise<{ ran: string[]; errors: string[] }> {
    if (this.ingesting) return { ran: [], errors: ['ingest already running'] };
    this.ingesting = true;
    const ran: string[] = [];
    const errors: string[] = [];
    try {
      await this.ensureSources();
      const steps: Array<[string, () => Promise<void>]> = [
        ['spot', () => this.ingestSpot()],
        ['fx-history', () => this.ingestGoldHistory(opts.historyDays ?? 18)],
        ['treasury', () => this.ingestTreasury()],
        ['fred', () => this.ingestFred()],
        ['cftc', () => this.ingestCftc()],
        ['news', () => this.ingestNews()],
      ];
      for (const [name, fn] of steps) {
        try {
          await fn();
          ran.push(name);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${name}: ${message}`);
          this.logger.warn(`Ingest ${name} failed: ${message}`);
        }
      }
    } finally {
      this.ingesting = false;
    }
    return { ran, errors };
  }

  async ingestSpot(): Promise<void> {
    const primary = await this.fetchGoldApiCom();
    const fallback = primary?.mid ? null : await this.fetchGoldApiIo();
    const fx = await this.fetchImpliedXau('latest');
    const quote = primary || fallback;
    if (!quote && !fx) {
      await this.markSource('gold-api.com', {
        status: 'error',
        lastError: 'No spot provider returned a price',
      });
      return;
    }
    if (quote && fx?.mid && impossibleJump(fx.mid, quote.mid, 6)) {
      quote.validationStatus = 'PRICE_DISCREPANCY';
      quote.qualityScore = Math.max(20, quote.qualityScore - 25);
    }
    if (quote) {
      const last = await this.ticks.find({
        where: { symbol: 'XAUUSD' },
        order: { observedAt: 'DESC' },
        take: 1,
      });
      if (last[0] && impossibleJump(last[0].mid, quote.mid, 8)) {
        quote.validationStatus = 'IMPOSSIBLE_JUMP';
        quote.qualityScore = 15;
      }
      await this.ticks.save(this.ticks.create(quote));
      await this.upsertDailyBar(quote.mid, quote.observedAt, quote.source, false);
    }
    if (fx?.mid) {
      await this.upsertDailyBar(fx.mid, fx.observedAt, fx.source, true);
      if (!quote) {
        await this.ticks.save(
          this.ticks.create({
            ...fx,
            freshness: 'DELAYED',
            validationStatus: 'ok',
          }),
        );
      }
    }
  }

  private async fetchGoldApiCom(): Promise<Partial<GoldPriceTickEntity> | null> {
    const started = Date.now();
    const { data, status, latencyMs } = await goldHttpGet<any>('https://api.gold-api.com/price/XAU');
    if (status >= 400 || !data) {
      await this.markSource('gold-api.com', {
        status: 'error',
        lastError: `HTTP ${status}`,
        latencyMs,
      });
      return null;
    }
    const mid = asNumber(data.price);
    const observedAt = data.updatedAt ? new Date(data.updatedAt) : new Date();
    if (!mid) {
      await this.markSource('gold-api.com', {
        status: 'error',
        lastError: 'Missing price field',
        latencyMs,
      });
      return null;
    }
    const minutes = detectStaleMinutes(observedAt);
    await this.markSource('gold-api.com', {
      status: 'ok',
      lastError: null,
      lastSuccessfulFetch: new Date(),
      lastDataTimestamp: observedAt,
      latencyMs,
      dataQualityScore: minutes !== null && minutes < 15 ? 72 : 58,
    });
    return {
      symbol: 'XAUUSD',
      mid,
      bid: null,
      ask: null,
      spread: null,
      currency: 'USD',
      unit: 'troy_ounce',
      source: 'gold-api.com',
      observedAt,
      receivedAt: new Date(),
      latencyMs: latencyMs || Date.now() - started,
      freshness: freshnessLabel(minutes, false),
      qualityScore: 62,
      validationStatus: 'ok',
    };
  }

  private async fetchGoldApiIo(): Promise<Partial<GoldPriceTickEntity> | null> {
    const key = String(this.config.get('GOLDAPI_API_KEY') || '').trim();
    if (!key) {
      await this.markSource('goldapi.io', { status: 'disabled', lastError: 'GOLDAPI_API_KEY missing' });
      return null;
    }
    const { data, status, latencyMs } = await goldHttpGet<any>('https://www.goldapi.io/api/XAU/USD', {
      headers: { 'x-access-token': key },
    });
    if (status >= 400) {
      await this.markSource('goldapi.io', { status: 'error', lastError: `HTTP ${status}`, latencyMs });
      return null;
    }
    const mid = asNumber(data?.price);
    if (!mid) {
      await this.markSource('goldapi.io', { status: 'error', lastError: 'Missing price', latencyMs });
      return null;
    }
    const ts = data?.timestamp ? new Date(Number(data.timestamp) * 1000) : new Date();
    await this.markSource('goldapi.io', {
      status: 'ok',
      lastError: null,
      lastSuccessfulFetch: new Date(),
      lastDataTimestamp: ts,
      latencyMs,
      dataQualityScore: 68,
    });
    return {
      symbol: 'XAUUSD',
      mid,
      bid: asNumber(data.bid),
      ask: asNumber(data.ask),
      spread: asNumber(data.ask) !== null && asNumber(data.bid) !== null ? Number(data.ask) - Number(data.bid) : null,
      currency: 'USD',
      unit: 'troy_ounce',
      source: 'goldapi.io',
      observedAt: ts,
      receivedAt: new Date(),
      latencyMs,
      freshness: freshnessLabel(detectStaleMinutes(ts), false),
      qualityScore: 68,
      validationStatus: 'ok',
    };
  }

  async fetchImpliedXau(date: 'latest' | string): Promise<{ mid: number; observedAt: Date; source: string; usdEgp: number | null } | null> {
    const urls =
      date === 'latest'
        ? [
            'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
            'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json',
          ]
        : [
            `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.min.json`,
            `https://${date}.currency-api.pages.dev/v1/currencies/usd.min.json`,
          ];
    for (let i = 0; i < urls.length; i += 1) {
      const sourceName = i === 0 ? 'currency-api-xau' : 'currency-api-pages';
      try {
        const { data, status, latencyMs } = await goldHttpGet<any>(urls[i]);
        if (status >= 400 || !data?.usd) {
          await this.markSource(sourceName, { status: 'error', lastError: `HTTP ${status}`, latencyMs });
          continue;
        }
        const xauPerUsd = asNumber(data.usd.xau);
        const usdEgp = asNumber(data.usd.egp);
        if (!xauPerUsd) {
          await this.markSource(sourceName, { status: 'error', lastError: 'usd.xau missing', latencyMs });
          continue;
        }
        const mid = 1 / xauPerUsd;
        const observedAt = data.date ? new Date(`${data.date}T00:00:00Z`) : new Date();
        await this.markSource(sourceName, {
          status: 'ok',
          lastError: null,
          lastSuccessfulFetch: new Date(),
          lastDataTimestamp: observedAt,
          latencyMs,
          dataQualityScore: 70,
        });
        if (usdEgp) {
          await this.upsertMacro('USD_EGP_FX', isoDate(observedAt), usdEgp, sourceName);
        }
        return { mid, observedAt, source: sourceName, usdEgp };
      } catch (error) {
        await this.markSource(sourceName, {
          status: 'error',
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return null;
  }

  async ingestGoldHistory(days: number): Promise<void> {
    const existing = await this.ohlcv.count({ where: { symbol: 'XAUUSD', timeframe: '1D' } });
    const target = Math.min(Math.max(days, 5), 40);
    const missing: string[] = [];
    for (let i = 1; i <= target; i += 1) {
      const date = isoDate(daysAgo(i));
      const found = await this.ohlcv.findOne({
        where: { symbol: 'XAUUSD', timeframe: '1D', barTime: new Date(`${date}T00:00:00Z`) },
      });
      if (!found) missing.push(date);
    }
    const slice = existing < 30 ? missing.slice(0, 24) : missing.slice(0, 8);
    for (const date of slice) {
      const row = await this.fetchImpliedXau(date);
      if (row?.mid) await this.upsertDailyBar(row.mid, row.observedAt, row.source, true);
    }
  }

  private async upsertDailyBar(close: number, at: Date, source: string, closeOnly: boolean): Promise<void> {
    const day = new Date(`${isoDate(at)}T00:00:00Z`);
    const existing = await this.ohlcv.findOne({
      where: { symbol: 'XAUUSD', timeframe: '1D', barTime: day, source },
    });
    if (existing) {
      existing.close = close;
      existing.high = Math.max(existing.high, close);
      existing.low = Math.min(existing.low, close);
      await this.ohlcv.save(existing);
      return;
    }
    await this.ohlcv.save(
      this.ohlcv.create({
        symbol: 'XAUUSD',
        timeframe: '1D',
        barTime: day,
        open: close,
        high: close,
        low: close,
        close,
        volume: null,
        source,
        closeOnly,
      }),
    );
  }

  async ingestTreasury(): Promise<void> {
    const year = new Date().getUTCFullYear();
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
    const { data, status, latencyMs } = await goldHttpGet<string>(url, {
      responseType: 'text',
      headers: { Accept: 'application/xml,text/xml' },
    });
    if (status >= 400 || typeof data !== 'string') {
      await this.markSource('us-treasury', { status: 'error', lastError: `HTTP ${status}`, latencyMs });
      return;
    }
    const entries = data.split(/<entry[\s>]/i).slice(1);
    let saved = 0;
    for (const entry of entries.slice(-40)) {
      const date = this.xmlProp(entry, 'NEW_DATE') || this.xmlProp(entry, 'd:NEW_DATE');
      if (!date) continue;
      const map: Array<[string, string]> = [
        ['DGS2', 'BC_2YEAR'],
        ['DGS5', 'BC_5YEAR'],
        ['DGS10', 'BC_10YEAR'],
        ['DGS30', 'BC_30YEAR'],
      ];
      for (const [series, tag] of map) {
        const value = asNumber(this.xmlProp(entry, tag) || this.xmlProp(entry, `d:${tag}`));
        if (value === null) continue;
        await this.upsertMacro(series, date.slice(0, 10), value, 'us-treasury');
        saved += 1;
      }
    }
    const realUrl = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_real_yield_curve&field_tdr_date_value=${year}`;
    const real = await goldHttpGet<string>(realUrl, { responseType: 'text' });
    if (real.status < 400 && typeof real.data === 'string') {
      const realEntries = real.data.split(/<entry[\s>]/i).slice(1);
      for (const entry of realEntries.slice(-20)) {
        const date = this.xmlProp(entry, 'NEW_DATE') || this.xmlProp(entry, 'd:NEW_DATE');
        const value = asNumber(this.xmlProp(entry, 'TC_10YEAR') || this.xmlProp(entry, 'd:TC_10YEAR') || this.xmlProp(entry, 'BC_10YEAR'));
        if (date && value !== null) await this.upsertMacro('DFII10', date.slice(0, 10), value, 'us-treasury');
      }
    }
    await this.markSource('us-treasury', {
      status: saved ? 'ok' : 'error',
      lastError: saved ? null : 'No yield rows parsed',
      lastSuccessfulFetch: saved ? new Date() : undefined,
      lastDataTimestamp: saved ? new Date() : undefined,
      latencyMs,
      dataQualityScore: saved ? 92 : 20,
    });
  }

  private xmlProp(xml: string, tag: string): string | null {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i'));
    return match?.[1]?.trim() || null;
  }

  async ingestFred(): Promise<void> {
    const key = String(this.config.get('FRED_API_KEY') || '').trim();
    const ids = FRED_SERIES.map((s) => s.id);
    for (const id of ids) {
      try {
        if (key) await this.ingestFredApi(id, key);
        else await this.ingestFredCsv(id);
      } catch (error) {
        this.logger.warn(`FRED ${id} failed: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  private async ingestFredApi(id: string, key: string): Promise<void> {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(id)}&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=40`;
    const { data, status, latencyMs } = await goldHttpGet<any>(url);
    if (status >= 400) {
      await this.markSource('fred', { status: 'error', lastError: `${id} HTTP ${status}`, latencyMs });
      return;
    }
    const rows = Array.isArray(data?.observations) ? data.observations : [];
    let n = 0;
    for (const row of rows) {
      const value = asNumber(row.value);
      if (value === null) continue;
      await this.upsertMacro(id, String(row.date).slice(0, 10), value, 'fred');
      n += 1;
    }
    await this.markSource('fred', {
      status: n ? 'ok' : 'error',
      lastError: n ? null : `${id} empty`,
      lastSuccessfulFetch: new Date(),
      lastDataTimestamp: rows[0]?.date ? new Date(rows[0].date) : new Date(),
      latencyMs,
      dataQualityScore: 94,
    });
  }

  private async ingestFredCsv(id: string): Promise<void> {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;
    const { data, status, latencyMs } = await goldHttpGet<string>(url, { responseType: 'text' });
    if (status >= 400 || typeof data !== 'string') {
      await this.markSource('fred-csv', { status: 'error', lastError: `${id} HTTP ${status}`, latencyMs });
      return;
    }
    const lines = data.trim().split(/\r?\n/).slice(-45);
    let n = 0;
    let lastDate: string | null = null;
    for (const line of lines) {
      if (/date/i.test(line)) continue;
      const [date, valueRaw] = line.split(',');
      const value = asNumber(valueRaw);
      if (!date || value === null) continue;
      await this.upsertMacro(id, date.slice(0, 10), value, 'fred-csv');
      n += 1;
      lastDate = date;
    }
    await this.markSource('fred-csv', {
      status: n ? 'ok' : 'error',
      lastError: n ? null : `${id} empty`,
      lastSuccessfulFetch: n ? new Date() : undefined,
      lastDataTimestamp: lastDate ? new Date(lastDate) : undefined,
      latencyMs,
      dataQualityScore: n ? 90 : 20,
    });
  }

  private async upsertMacro(seriesId: string, obsDate: string, value: number, source: string): Promise<void> {
    const existing = await this.macro.findOne({ where: { seriesId, obsDate, source } });
    if (existing) {
      existing.value = value;
      await this.macro.save(existing);
      return;
    }
    await this.macro.save(this.macro.create({ seriesId, obsDate, value, source }));
  }

  async ingestCftc(): Promise<void> {
    const { data, status, latencyMs } = await goldHttpGet<string>('https://www.cftc.gov/dea/newcot/deacot.txt', {
      responseType: 'text',
    });
    if (status >= 400 || typeof data !== 'string') {
      await this.markSource('cftc-cot', { status: 'error', lastError: `HTTP ${status}`, latencyMs });
      return;
    }
    const lines = data.split(/\r?\n/).filter(Boolean);
    const header = this.splitCsv(lines[0] || '');
    const goldLine = lines.find((line) => /GOLD\s*-\s*COMMODITY EXCHANGE/i.test(line));
    if (!goldLine) {
      await this.markSource('cftc-cot', { status: 'error', lastError: 'Gold row not found', latencyMs });
      return;
    }
    const cols = this.splitCsv(goldLine);
    const pick = (name: string) => {
      const idx = header.findIndex((h) => h.toLowerCase().includes(name.toLowerCase()));
      return idx >= 0 ? asNumber(cols[idx]) : null;
    };
    const reportDate = (cols[2] || cols[1] || '').replace(/(\d{2})\/(\d{2})\/(\d{2,4})/, (_, m, d, y) => {
      const year = String(y).length === 2 ? `20${y}` : y;
      return `${year}-${m}-${d}`;
    });
    const noncommLong = pick('Noncommercial Positions-Long') || pick('NonComm_Positions_Long_All');
    const noncommShort = pick('Noncommercial Positions-Short') || pick('NonComm_Positions_Short_All');
    const commLong = pick('Commercial Positions-Long') || pick('Comm_Positions_Long_All');
    const commShort = pick('Commercial Positions-Short') || pick('Comm_Positions_Short_All');
    const openInterest = pick('Open Interest') || pick('Open_Interest_All');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(reportDate) ? reportDate : isoDate(new Date());
    const existing = await this.cftc.findOne({ where: { reportDate: date } });
    const payload = {
      reportDate: date,
      marketName: cols[0] || 'GOLD - COMMODITY EXCHANGE INC.',
      openInterest,
      noncommLong,
      noncommShort,
      noncommNet: noncommLong !== null && noncommShort !== null ? noncommLong - noncommShort : null,
      commLong,
      commShort,
      raw: { header, cols: cols.slice(0, 40) },
    };
    if (existing) await this.cftc.save({ ...existing, ...payload });
    else await this.cftc.save(this.cftc.create(payload));
    await this.markSource('cftc-cot', {
      status: 'ok',
      lastError: null,
      lastSuccessfulFetch: new Date(),
      lastDataTimestamp: new Date(date),
      latencyMs,
      dataQualityScore: 88,
    });
  }

  private splitCsv(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  async ingestNews(): Promise<void> {
    await this.ingestRss(
      'federal-reserve-rss',
      'https://www.federalreserve.gov/feeds/press_all.xml',
      'Federal Reserve',
    );
    await this.ingestRss('world-gold-council-rss', 'https://www.gold.org/news/rss', 'World Gold Council');
  }

  private async ingestRss(sourceName: string, url: string, label: string): Promise<void> {
    const { data, status, latencyMs } = await goldHttpGet<string>(url, { responseType: 'text' });
    if (status >= 400 || typeof data !== 'string') {
      await this.markSource(sourceName, { status: 'error', lastError: `HTTP ${status}`, latencyMs });
      return;
    }
    const items = [...data.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 20);
    let saved = 0;
    for (const match of items) {
      const block = match[1];
      const title = this.stripXml(this.xmlProp(block, 'title') || '');
      const link = this.stripXml(this.xmlProp(block, 'link') || this.xmlProp(block, 'guid') || '');
      const pub = this.xmlProp(block, 'pubDate') || this.xmlProp(block, 'dc:date');
      if (!title || !link) continue;
      const existing = await this.news.findOne({ where: { url: link } });
      if (existing) continue;
      const scored = this.scoreHeadline(title);
      await this.news.save(
        this.news.create({
          headline: title.slice(0, 400),
          source: label,
          url: link.slice(0, 500),
          publishedAt: pub ? new Date(pub) : new Date(),
          impact: scored.impact,
          impactScore: scored.score,
          confidence: 45,
          timeHorizon: scored.horizon,
          noveltyScore: 1,
          reason: scored.reason,
          alreadyKnown: false,
        }),
      );
      saved += 1;
    }
    await this.markSource(sourceName, {
      status: 'ok',
      lastError: null,
      lastSuccessfulFetch: new Date(),
      lastDataTimestamp: new Date(),
      latencyMs,
      dataQualityScore: 80,
      metaJson: { ingested: saved },
    });
  }

  private stripXml(value: string): string {
    return value.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();
  }

  scoreHeadline(headline: string): {
    impact: string;
    score: number;
    horizon: string;
    reason: string;
  } {
    const text = headline.toLowerCase();
    const bull =
      /(rate cut|dovish|weaker dollar|inflation cool|ceasefire|central bank buy|etf inflow)/i;
    const bear = /(rate hike|hawkish|stronger dollar|hot inflation|payrolls beat|etf outflow|yields jump)/i;
    if (bull.test(text) && !bear.test(text)) {
      return {
        impact: 'Bullish',
        score: 42,
        horizon: '1W',
        reason: 'Headline lexicon is consistent with lower real rates or weaker USD — heuristic only.',
      };
    }
    if (bear.test(text) && !bull.test(text)) {
      return {
        impact: 'Bearish',
        score: -38,
        horizon: '1W',
        reason: 'Headline lexicon is consistent with higher real rates or stronger USD — heuristic only.',
      };
    }
    return {
      impact: 'Neutral',
      score: 0,
      horizon: '1D',
      reason: 'No high-confidence gold directional keywords. Sentiment does not drive the decision.',
    };
  }
}
