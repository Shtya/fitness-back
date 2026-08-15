import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { SOURCE_REGISTRY } from '../constants/sources.registry';
import {
  GoldAlertEntity,
  GoldCftcEntity,
  GoldDataSourceEntity,
  GoldMacroObservationEntity,
  GoldNewsEntity,
  GoldOhlcvEntity,
  GoldPredictionEntity,
  GoldPriceTickEntity,
  GoldSnapshotEntity,
  GoldUserSettingsEntity,
} from '../entities/gold-intelligence.entity';
import {
  PURITY_FACTOR,
  adx,
  atr,
  bollinger,
  cosineSimilarity,
  decideAction,
  detectStaleMinutes,
  ema,
  expectedValue,
  fibonacciLevels,
  fitLogistic,
  freshnessLabel,
  macd,
  mean,
  median,
  pctChange,
  pearson,
  pivotPoints,
  predictLogistic,
  premiumPercent,
  regimeFromContext,
  returnsFromCloses,
  roc,
  rollingReturn,
  rsi,
  scenarioPrices,
  sma,
  stageDca,
  stdev,
  stochastic,
  supportResistance,
  technicalScore,
  theoreticalEgyptGram,
  usdPerGramFromXauUsd,
  walkForwardLabels,
  zscore,
} from '../utils/gold-math';
import { GoldIngestionService } from './ingestion.service';

const MODEL_VERSION = 'gold-heuristic-v1.0';
const DEFAULT_WEIGHTS = {
  technical: 0.2,
  macro: 0.2,
  rates: 0.15,
  usd: 0.1,
  etf: 0.1,
  centralBanks: 0.1,
  positioning: 0.05,
  news: 0.05,
  historical: 0.05,
};

@Injectable()
export class GoldIntelligenceService {
  private readonly logger = new Logger(GoldIntelligenceService.name);
  private cache: { at: number; payload: any } | null = null;

  constructor(
    private readonly ingestion: GoldIngestionService,
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
    @InjectRepository(GoldPredictionEntity)
    private readonly predictions: Repository<GoldPredictionEntity>,
    @InjectRepository(GoldDataSourceEntity)
    private readonly sources: Repository<GoldDataSourceEntity>,
    @InjectRepository(GoldSnapshotEntity)
    private readonly snapshots: Repository<GoldSnapshotEntity>,
    @InjectRepository(GoldAlertEntity)
    private readonly alerts: Repository<GoldAlertEntity>,
    @InjectRepository(GoldUserSettingsEntity)
    private readonly settings: Repository<GoldUserSettingsEntity>,
  ) {}

  async intelligence(forceRefresh = false, userId?: string): Promise<any> {
    if (!forceRefresh && this.cache && Date.now() - this.cache.at < 45_000) {
      return this.cache.payload;
    }
    if (forceRefresh) {
      await this.ingestion.ingestAll({ historyDays: 12 });
    }
    const payload = await this.build(userId);
    this.cache = { at: Date.now(), payload };
    await this.snapshots.save(this.snapshots.create({ payloadJson: payload }));
    await this.storePredictions(payload);
    return payload;
  }

  private async series(id: string, limit = 400): Promise<Array<{ date: string; value: number; source: string }>> {
    const rows = await this.macro.find({
      where: { seriesId: id },
      order: { obsDate: 'DESC' },
      take: limit,
    });
    return rows
      .map((r) => ({ date: String(r.obsDate).slice(0, 10), value: r.value, source: r.source }))
      .reverse();
  }

  private lastOf(rows: Array<{ value: number; date: string; source: string }>) {
    return rows.length ? rows[rows.length - 1] : null;
  }

  private change(rows: Array<{ value: number }>, n: number): number | null {
    if (rows.length <= n) return null;
    return rows[rows.length - 1].value - rows[rows.length - 1 - n].value;
  }

  private async build(userId?: string): Promise<any> {
    const demo = this.ingestion.demoMode();
    const tick = (
      await this.ticks.find({ where: { symbol: 'XAUUSD' }, order: { observedAt: 'DESC' }, take: 1 })
    )[0];
    const bars = (
      await this.ohlcv.find({
        where: { symbol: 'XAUUSD', timeframe: '1D' },
        order: { barTime: 'ASC' },
        take: 900,
      })
    ).sort((a, b) => +a.barTime - +b.barTime);
    const closes = bars.map((b) => b.close);
    const lastClose = closes[closes.length - 1] || tick?.mid || null;
    const last = tick?.mid || lastClose;
    const minutes = detectStaleMinutes(tick?.observedAt || null);
    const freshness = tick
      ? freshnessLabel(minutes, false)
      : last
        ? 'DELAYED'
        : 'UNAVAILABLE';

    const dgs10 = await this.series('DGS10');
    const dgs2 = await this.series('DGS2');
    const dfii10 = await this.series('DFII10');
    const usdIdx = await this.series('DTWEXBGS');
    const usdEgpRows = await this.series('USD_EGP_FX');
    const dexegus = await this.series('DEXEGUS');
    const cpi = await this.series('CPIAUCSL');
    const unrate = await this.series('UNRATE');
    const dff = await this.series('DFF');
    const payems = await this.series('PAYEMS');

    const usdEgp = this.lastOf(usdEgpRows)?.value || this.lastOf(dexegus)?.value || null;
    const ohlc = bars.map((b) => ({
      time: b.barTime.toISOString(),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      closeOnly: b.closeOnly,
    }));
    const tech = last
      ? technicalScore({
          last,
          sma20: sma(closes, 20),
          sma50: sma(closes, 50),
          sma200: sma(closes, 200),
          ema20: ema(closes, 20),
          rsi: rsi(closes, 14),
          macdHist: macd(closes)?.histogram ?? null,
          percentB: bollinger(closes)?.percentB ?? null,
        })
      : { score: 50, bias: 'NEUTRAL' as const, reasons: [], reasonsAr: [] };

    const macdRes = macd(closes);
    const bb = bollinger(closes);
    const rsiValue = rsi(closes, 14);
    const atrAbs = atr(ohlc, 14);
    const atrPct = last && atrAbs ? (atrAbs / last) * 100 : null;
    const ret1 = rollingReturn(closes, 1);
    const ret5 = rollingReturn(closes, 5);
    const ret21 = rollingReturn(closes, 21);
    const ret63 = rollingReturn(closes, 63);
    const ret252 = rollingReturn(closes, 252);
    const levels = supportResistance(ohlc);
    const nearestRes = levels.find((l) => l.kind === 'resistance');
    const nearestSup = levels.find((l) => l.kind === 'support');
    const lastBar = ohlc[ohlc.length - 1];
    const pivots = lastBar ? pivotPoints(lastBar) : null;
    const swingLow = ohlc.length ? Math.min(...ohlc.slice(-60).map((b) => b.low)) : null;
    const swingHigh = ohlc.length ? Math.max(...ohlc.slice(-60).map((b) => b.high)) : null;
    const fib = swingLow && swingHigh ? fibonacciLevels(swingLow, swingHigh) : null;

    const realYield = this.lastOf(dfii10);
    const realYieldChg = this.change(dfii10, 21);
    const usdChg = this.pctSeries(usdIdx, 21);
    const tenChg = this.change(dgs10, 21);
    const spread2s10 = this.lastOf(dgs10) && this.lastOf(dgs2) ? this.lastOf(dgs10)!.value - this.lastOf(dgs2)!.value : null;
    const inflationYoY = this.yoy(cpi);
    const regimes = last
      ? regimeFromContext({
          ret30: ret21,
          ret90: ret63,
          sma50: sma(closes, 50),
          sma200: sma(closes, 200),
          last,
          atrPct,
          realYieldChange: realYieldChg,
          usdChange: usdChg,
          inflationYoY,
        })
      : ['UNKNOWN'];

    const usdScore = this.dimScore(usdChg !== null ? -usdChg * 18 : 0, 'USD weakness is typically a tailwind for gold but the relationship is regime-dependent.');
    const ratesScore = this.dimScore(realYieldChg !== null ? -realYieldChg * 40 : 0, 'Falling real yields historically support gold; rising real yields historically pressure gold.');
    const cftcRow = (await this.cftc.find({ order: { reportDate: 'DESC' }, take: 24 }))[0] || null;
    const cftcHist = await this.cftc.find({ order: { reportDate: 'DESC' }, take: 60 });
    const nets = cftcHist.map((r) => r.noncommNet).filter((v): v is number => v !== null);
    const percentile = this.percentile(cftcRow?.noncommNet ?? null, nets);
    let positioningScore = 50;
    let positioningBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let positioningNote = 'CFTC gold row not ingested yet.';
    if (percentile !== null) {
      if (percentile >= 90) {
        positioningScore = 42;
        positioningBias = 'BEARISH';
        positioningNote = `Managed/non-commercial net positioning is at the ${percentile}th percentile — crowded-trade warning, not automatically bullish.`;
      } else if (percentile <= 15) {
        positioningScore = 62;
        positioningBias = 'BULLISH';
        positioningNote = `Net speculative positioning is washed out (${percentile}th percentile).`;
      } else {
        positioningScore = 50;
        positioningNote = `Net speculative positioning is around the ${percentile}th percentile of stored history.`;
      }
    }

    const newsItems = await this.news.find({ order: { publishedAt: 'DESC' }, take: 40 });
    const newsScoreRaw = newsItems.slice(0, 12).reduce((s, n) => s + n.impactScore * n.noveltyScore, 0) / Math.max(1, newsItems.slice(0, 12).length);
    const newsScore = Math.max(5, Math.min(95, 50 + newsScoreRaw * 0.4));
    const newsBias = newsScore >= 58 ? 'BULLISH' : newsScore <= 42 ? 'BEARISH' : 'NEUTRAL';

    const etfUnavailable = {
      score: null,
      bias: 'UNAVAILABLE',
      note: 'World Gold Council / ETF holdings feeds are licensed. Not scraped. Configure an authorized provider later.',
    };
    const cbUnavailable = {
      score: null,
      bias: 'UNAVAILABLE',
      note: 'Official central-bank reserve tables are monthly/IMF/WGC. Not fabricated.',
    };

    const macroScore = this.blend([
      { w: 0.45, v: ratesScore.score },
      { w: 0.35, v: usdScore.score },
      { w: 0.2, v: inflationYoY !== null ? (inflationYoY > 3 ? 62 : inflationYoY < 2 ? 44 : 52) : 50 },
    ]);

    const similar = this.similarPeriods(closes, usdIdx, dfii10, rsiValue);
    const histScore = similar.probabilityUp * 100;
    const ml = this.walkForwardModel(closes);

    const weights = { ...DEFAULT_WEIGHTS };
    const components = [
      { key: 'technical', label: 'Technical', score: tech.score, weight: weights.technical, available: true },
      { key: 'macro', label: 'Macro', score: macroScore, weight: weights.macro, available: true },
      { key: 'rates', label: 'Real yields / rates', score: ratesScore.score, weight: weights.rates, available: Boolean(realYield) },
      { key: 'usd', label: 'USD', score: usdScore.score, weight: weights.usd, available: usdChg !== null },
      { key: 'etf', label: 'ETF flows', score: 50, weight: weights.etf, available: false },
      { key: 'centralBanks', label: 'Central banks', score: 50, weight: weights.centralBanks, available: false },
      { key: 'positioning', label: 'CFTC positioning', score: positioningScore, weight: weights.positioning, available: Boolean(cftcRow) },
      { key: 'news', label: 'News (heuristic)', score: newsScore, weight: weights.news, available: newsItems.length > 0 },
      { key: 'historical', label: 'Historical similarity', score: histScore, weight: weights.historical, available: similar.sampleSize >= 20 },
    ];
    const availableWeight = components.reduce((s, c) => s + (c.available ? c.weight : 0), 0) || 1;
    const blended = components.reduce((s, c) => s + (c.available ? (c.weight / availableWeight) * c.score : 0), 0);
    const mlBlend = ml.probabilityUp !== null ? 0.55 * (blended / 100) + 0.45 * ml.probabilityUp : blended / 100;
    const probabilityUp = this.clamp01(mlBlend);
    const probabilityDown = this.clamp01(1 - probabilityUp - 0.08);
    const probabilityNeutral = this.clamp01(1 - probabilityUp - probabilityDown);
    const dailyVol = stdev(returnsFromCloses(closes.slice(-60))) || 0.7;
    const expected24h = (probabilityUp - 0.5) * dailyVol * 3.2;
    const ev = expectedValue(probabilityUp, Math.max(0.15, expected24h + dailyVol), probabilityDown, -Math.max(0.15, dailyVol));
    const biases = [tech.bias, ratesScore.bias, usdScore.bias, positioningBias, newsBias];
    const conflict = biases.includes('BULLISH') && biases.includes('BEARISH');
    const percentB = bb?.percentB ?? null;
    const extended = (percentB !== null && percentB > 0.95) || (rsiValue !== null && rsiValue > 72);
    const shock = Boolean(ret1 !== null && Math.abs(ret1) > 2.2 * (dailyVol || 1));
    const eventRisk = this.eventRisk();
    const freshnessOk = Boolean(last) && freshness !== 'UNAVAILABLE' && freshness !== 'STALE';
    const confidence = Math.round(
      this.clamp(
        38 +
          (freshnessOk ? 12 : 0) +
          (closes.length > 60 ? 10 : closes.length > 20 ? 5 : 0) +
          (ml.sampleSize >= 80 ? 8 : 0) +
          (conflict ? -14 : 8) +
          (shock ? -12 : 0) +
          (cftcRow ? 4 : 0) -
          (etfUnavailable.score === null ? 4 : 0),
        12,
        86,
      ),
    );
    const decision = decideAction({
      probabilityUp,
      expectedValue: ev,
      confidence,
      eventRisk: eventRisk.level,
      extended,
      conflict,
      shock,
      dataFreshnessOk: freshnessOk,
      riskRewardOk: ev > 0 && last && nearestSup ? last - nearestSup.price < last * 0.04 || true : ev > 0,
    });

    const forecasts = [1, 4, 24, 7 * 24, 30 * 24].map((hours, idx) => {
      const scale = Math.sqrt(Math.max(hours / 24, hours === 1 ? 0.2 : hours / 24));
      const er = expected24h * scale * (hours >= 24 ? 1 : 0.45);
      const rng = dailyVol * scale;
      const pUp = this.clamp01(probabilityUp + (idx >= 3 ? -0.03 : 0));
      return {
        timeHorizon: ['1H', '4H', '24H', '7D', '30D'][idx],
        available: hours >= 24,
        limitation:
          hours < 24
            ? 'Intraday horizons need a licensed streaming feed. Daily/FX data cannot honestly support 1H/4H probability.'
            : null,
        direction: pUp > 0.55 ? 'BULLISH' : pUp < 0.45 ? 'BEARISH' : 'NEUTRAL',
        probabilityUp: hours < 24 ? null : Math.round(pUp * 1000) / 10,
        probabilityDown: hours < 24 ? null : Math.round(this.clamp01(1 - pUp - 0.08) * 1000) / 10,
        probabilityNeutral: hours < 24 ? null : Math.round(0.08 * 1000) / 10,
        expectedReturn: hours < 24 ? null : Math.round(er * 100) / 100,
        expectedRange: hours < 24 ? null : { from: Math.round((er - rng) * 100) / 100, to: Math.round((er + rng) * 100) / 100 },
        confidence: hours < 24 ? 0 : Math.max(20, confidence - idx * 4),
        modelVersion: MODEL_VERSION,
      };
    });

    const scenarios = last
      ? {
          current: last,
          h24: { ...this.withProb(scenarioPrices(last, expected24h, dailyVol), probabilityUp) },
          d7: { ...this.withProb(scenarioPrices(last, expected24h * 2.1, dailyVol * 2), probabilityUp - 0.03) },
        }
      : null;

    const settings = userId ? await this.getSettings(userId) : null;
    const egypt = last && usdEgp
      ? {
          xauUsd: last,
          usdEgp,
          timestamp: tick?.observedAt || bars[bars.length - 1]?.barTime,
          sourceGold: tick?.source || bars[bars.length - 1]?.source,
          sourceFx: this.lastOf(usdEgpRows)?.source || this.lastOf(dexegus)?.source,
          formula: 'XAUUSD × USD/EGP ÷ 31.1034768 × purity',
          k24: theoreticalEgyptGram(last, usdEgp, PURITY_FACTOR.k24),
          k21: theoreticalEgyptGram(last, usdEgp, PURITY_FACTOR.k21),
          k18: theoreticalEgyptGram(last, usdEgp, PURITY_FACTOR.k18),
          k14: theoreticalEgyptGram(last, usdEgp, PURITY_FACTOR.k14),
          usdPerGram: usdPerGramFromXauUsd(last),
          local: {
            k24: settings?.local24kEgp ?? null,
            k21: settings?.local21kEgp ?? null,
            k18: settings?.local18kEgp ?? null,
          },
          premium: {
            k24: premiumPercent(settings?.local24kEgp ?? NaN, theoreticalEgyptGram(last, usdEgp, PURITY_FACTOR.k24)),
            k21: premiumPercent(settings?.local21kEgp ?? NaN, theoreticalEgyptGram(last, usdEgp, PURITY_FACTOR.k21)),
            k18: premiumPercent(settings?.local18kEgp ?? NaN, theoreticalEgyptGram(last, usdEgp, PURITY_FACTOR.k18)),
          },
        }
      : null;

    const sources = await this.sourceStatus();
    const performance = await this.modelPerformance();
    const preferredEntry =
      last && nearestSup && nearestRes
        ? {
            current: last,
            preferred: [nearestSup.price, last * 0.992],
            breakout: nearestRes.price,
            invalidation: nearestSup.price * 0.985,
          }
        : null;

    const bullDrivers = [
      usdChg !== null && usdChg < 0 ? `USD trade-weighted index down ${usdChg.toFixed(2)}% over ~21 sessions` : null,
      realYieldChg !== null && realYieldChg < 0 ? `10Y real yield change ${realYieldChg.toFixed(2)} pp` : null,
      tech.bias === 'BULLISH' ? 'Daily technical score is bullish vs SMA/RSI/MACD stack' : null,
    ].filter(Boolean);
    const bearDrivers = [
      extended ? 'Price is extended versus short-term volatility bands / RSI' : null,
      usdChg !== null && usdChg > 0 ? `USD has strengthened ${usdChg.toFixed(2)}%` : null,
      realYieldChg !== null && realYieldChg > 0 ? `Real yields have risen ${realYieldChg.toFixed(2)} pp` : null,
      percentile !== null && percentile >= 90 ? 'Speculative positioning looks crowded' : null,
    ].filter(Boolean);

    const why = this.whyText({ last, ret1, bullDrivers, bearDrivers, decision: decision.code, freshness });
    const payload = {
      disclaimer: {
        en: 'MODEL OUTPUT, not financial advice. Nothing here is a guarantee. Live exchange feeds are not claimed.',
        ar: 'مخرجات نموذج وليست نصيحة استثمارية. لا يوجد ضمان. لا ندّعي تغذية بورصة لحظية.',
      },
      demo,
      generatedAt: new Date().toISOString(),
      modelVersion: MODEL_VERSION,
      phase: {
        implemented: [
          'source registry',
          'spot + FX-implied history',
          'Treasury + FRED macro',
          'CFTC COT',
          'official RSS news',
          'technical engine (daily)',
          'support/resistance',
          'similar periods',
          'walk-forward logistic baseline',
          'decision layer',
          'Egypt theoretical pricing',
          'prediction history',
        ],
        blockedWithoutLicense: [
          'CME GC/MGC realtime',
          'intraday 1m/5m/15m/1h candles',
          'WGC ETF flows / demand / supply',
          'licensed Reuters/Bloomberg news bodies',
        ],
      },
      price: last
        ? {
            xauUsd: last,
            currency: 'USD',
            unit: 'troy_ounce',
            bid: tick?.bid ?? null,
            ask: tick?.ask ?? null,
            spread: tick?.spread ?? null,
            timestamp: tick?.observedAt || bars.at(-1)?.barTime,
            source: tick?.source || bars.at(-1)?.source,
            freshness,
            minutesStale: minutes,
            qualityScore: tick?.qualityScore ?? 55,
            validationStatus: tick?.validationStatus || 'ok',
            change: {
              d1: ret1,
              d5: ret5,
              d21: ret21,
              d63: ret63,
              d252: ret252,
            },
            high24: tick?.mid ?? last,
            low24: tick?.mid ?? last,
            message:
              freshness === 'UNAVAILABLE'
                ? 'Realtime market data unavailable.'
                : freshness === 'STALE'
                  ? `Realtime market data unavailable — last valid observation: ${minutes} minutes ago.`
                  : freshness === 'LIVE'
                    ? 'LIVE quote (provider timestamp < 60s).'
                    : `DELAYED / third-party spot — last valid observation: ${minutes ?? '?'} minutes ago. Not an exchange feed.`,
          }
        : {
            xauUsd: null,
            freshness: 'UNAVAILABLE',
            message: 'Realtime market data unavailable — no valid observation stored yet. Press Generate to ingest.',
          },
      market: {
        regimes,
        shock,
        extended,
        conflict,
        eventRisk,
        dailyVolatilityPct: dailyVol,
        correlationUsd: this.rollingCorr(closes, usdIdx, 30),
      },
      technical: {
        timeframe: '1D',
        closeOnly: ohlc.some((b) => b.closeOnly),
        sma10: sma(closes, 10),
        sma20: sma(closes, 20),
        sma50: sma(closes, 50),
        sma100: sma(closes, 100),
        sma200: sma(closes, 200),
        ema9: ema(closes, 9),
        ema20: ema(closes, 20),
        ema50: ema(closes, 50),
        ema200: ema(closes, 200),
        rsi: rsiValue,
        macd: macdRes,
        bollinger: bb,
        atr: atrAbs,
        atrPct,
        adx: adx(ohlc, 14),
        stochastic: stochastic(ohlc, 14),
        roc: roc(closes, 10),
        score: tech.score,
        bias: tech.bias,
        reasons: tech.reasons,
        reasonsAr: tech.reasonsAr,
        levels,
        nearestResistance: nearestRes || null,
        nearestSupport: nearestSup || null,
        pivots,
        fibonacci: fib,
        bars: ohlc.slice(-400).map((b) => ({ t: b.time, c: b.close, o: b.open, h: b.high, l: b.low })),
      },
      macro: {
        dgs2: this.lastOf(dgs2),
        dgs10: this.lastOf(dgs10),
        dgs30: this.lastOf(await this.series('DGS30')),
        realYield10: realYield,
        realYieldChange21: realYieldChg,
        yieldSpread2s10: spread2s10,
        usdTradeWeighted: this.lastOf(usdIdx),
        usdChange21: usdChg,
        usdEgp: this.lastOf(usdEgpRows) || this.lastOf(dexegus),
        fedFunds: this.lastOf(dff) || this.lastOf(await this.series('FEDFUNDS')),
        cpi: this.lastOf(cpi),
        inflationYoY,
        unemployment: this.lastOf(unrate),
        nfp: this.lastOf(payems),
        score: macroScore,
        bias: macroScore >= 58 ? 'BULLISH' : macroScore <= 42 ? 'BEARISH' : 'NEUTRAL',
      },
      fundamental: {
        etf: etfUnavailable,
        centralBanks: cbUnavailable,
        supplyDemand: {
          available: false,
          note: 'Mine production, jewelry and recycling require WGC/licensed datasets.',
        },
      },
      positioning: {
        available: Boolean(cftcRow),
        reportDate: cftcRow?.reportDate || null,
        marketName: cftcRow?.marketName || null,
        openInterest: cftcRow?.openInterest ?? null,
        noncommLong: cftcRow?.noncommLong ?? null,
        noncommShort: cftcRow?.noncommShort ?? null,
        noncommNet: cftcRow?.noncommNet ?? null,
        percentile,
        score: positioningScore,
        bias: positioningBias,
        note: positioningNote,
        source: 'cftc-cot',
      },
      news: {
        items: newsItems.map((n) => ({
          headline: n.headline,
          source: n.source,
          url: n.url,
          publishedAt: n.publishedAt,
          impact: n.impact,
          impactScore: n.impactScore,
          confidence: n.confidence,
          novelty: n.noveltyScore,
          reason: n.reason,
        })),
        score: newsScore,
        bias: newsBias,
        note: 'LLM sentiment is a feature, never the decision. Scoring is keyword-heuristic unless a research run is requested.',
      },
      forecast: {
        ensembleProbabilityUp: Math.round(probabilityUp * 1000) / 10,
        ensembleProbabilityDown: Math.round(probabilityDown * 1000) / 10,
        ensembleProbabilityNeutral: Math.round(probabilityNeutral * 1000) / 10,
        expected24h,
        expectedValue: ev,
        expectedValueMath: `EV = ${probabilityUp.toFixed(2)} × ${(Math.max(0.15, expected24h + dailyVol)).toFixed(2)}% + ${probabilityDown.toFixed(2)} × ${(-Math.max(0.15, dailyVol)).toFixed(2)}%`,
        confidence,
        horizons: forecasts,
        ml,
        similar,
      },
      scenarios,
      decision: {
        code: decision.code,
        reason: decision.reason,
        reasonAr: decision.reasonAr,
        confidence,
        conflict,
        extended,
        shock,
        components,
        contributors: this.contributors(components, last, rsiValue, nearestRes, nearestSup),
        entry: preferredEntry,
        dca: stageDca(confidence),
        notAdvice: true,
      },
      risks: {
        bearishCatalysts: [
          'USD reversal',
          'Rising real yields',
          'Hawkish Fed communication',
          'ETF outflows (data not connected)',
          nearestRes ? `Technical rejection near ${nearestRes.price.toFixed(0)}` : 'Technical rejection at resistance',
        ],
        invalidation: preferredEntry?.invalidation || null,
      },
      events: eventRisk.events,
      egypt,
      history: ohlc.slice(-800).map((b) => ({ t: b.time, c: b.close })),
      data_quality: {
        freshness,
        minutesStale: minutes,
        historyBars: closes.length,
        closeOnlyBars: ohlc.filter((b) => b.closeOnly).length,
        tickValidation: tick?.validationStatus || 'missing',
        sources,
        limitations: [
          'FRED daily LBMA gold was delisted in 2022 — gold history is FX-implied plus third-party spot.',
          'Intraday engine waits for a licensed provider.',
          'ETF/CBs/supply-demand are registered but not filled with unofficial scrapes.',
        ],
      },
      performance,
      why,
      watchNext: [
        eventRisk.events[0] || null,
        nearestRes ? { label: 'Resistance', value: nearestRes.price } : null,
        nearestSup ? { label: 'Support', value: nearestSup.price } : null,
      ].filter(Boolean),
      personal: settings
        ? this.personalPanel(settings, last, ev, decision.code, preferredEntry)
        : null,
    };
    return payload;
  }

  private pctSeries(rows: Array<{ value: number }>, n: number): number | null {
    if (rows.length <= n) return null;
    return pctChange(rows[rows.length - 1 - n].value, rows[rows.length - 1].value);
  }

  private yoy(rows: Array<{ value: number }>): number | null {
    if (rows.length < 13) return null;
    return pctChange(rows[rows.length - 13].value, rows[rows.length - 1].value);
  }

  private dimScore(impulse: number, note: string) {
    const score = Math.max(8, Math.min(92, 50 + impulse));
    const bias = score >= 58 ? 'BULLISH' : score <= 42 ? 'BEARISH' : 'NEUTRAL';
    return { score, bias, note };
  }

  private blend(parts: Array<{ w: number; v: number }>): number {
    const w = parts.reduce((s, p) => s + p.w, 0) || 1;
    return parts.reduce((s, p) => s + (p.w / w) * p.v, 0);
  }

  private clamp(v: number, a: number, b: number) {
    return Math.min(b, Math.max(a, v));
  }

  private clamp01(v: number) {
    return Math.min(0.92, Math.max(0.08, v));
  }

  private percentile(value: number | null, hist: number[]): number | null {
    if (value === null || hist.length < 8) return null;
    const below = hist.filter((v) => v <= value).length;
    return Math.round((below / hist.length) * 100);
  }

  private rollingCorr(
    goldCloses: number[],
    usd: Array<{ date: string; value: number }>,
    window: number,
  ) {
    if (goldCloses.length < window + 5 || usd.length < window + 5) return null;
    const ga = returnsFromCloses(goldCloses.slice(-(window + 1)));
    const ua = returnsFromCloses(usd.map((r) => r.value).slice(-(window + 1)));
    const n = Math.min(ga.length, ua.length);
    if (n < 8) return null;
    return pearson(ga.slice(-n), ua.slice(-n));
  }

  private similarPeriods(
    gold: number[],
    usd: Array<{ value: number }>,
    real: Array<{ value: number }>,
    currentRsi: number | null,
  ) {
    const empty = {
      sampleSize: 0,
      probabilityUp: 0.5,
      probabilityDown: 0.5,
      averageReturn: null,
      medianReturn: null,
      worst: null,
      best: null,
      note: 'Need more aligned daily history before pattern matching is meaningful.',
    };
    if (gold.length < 80) return empty;
    const features: number[][] = [];
    const future: number[] = [];
    for (let i = 30; i < gold.length - 6; i += 1) {
      const r5 = pctChange(gold[i - 5], gold[i]);
      const r21 = pctChange(gold[i - 21], gold[i]);
      if (r5 === null || r21 === null) continue;
      features.push([r5, r21, currentRsi || 50, gold[i] > (sma(gold.slice(0, i + 1), 50) || gold[i]) ? 1 : 0]);
      future.push(pctChange(gold[i], gold[i + 5]) || 0);
    }
    if (features.length < 20) return empty;
    const current = features[features.length - 1];
    const scored = features.slice(0, -1).map((f, idx) => ({
      sim: cosineSimilarity(zscore(current), zscore(f)),
      fut: future[idx],
    }));
    const hits = scored.filter((s) => s.sim > 0.72).slice(-160);
    if (hits.length < 8) return { ...empty, sampleSize: hits.length, note: 'Few similar regimes in stored sample.' };
    const ups = hits.filter((h) => h.fut > 0).length;
    return {
      sampleSize: hits.length,
      probabilityUp: ups / hits.length,
      probabilityDown: 1 - ups / hits.length,
      averageReturn: mean(hits.map((h) => h.fut)),
      medianReturn: median(hits.map((h) => h.fut)),
      worst: Math.min(...hits.map((h) => h.fut)),
      best: Math.max(...hits.map((h) => h.fut)),
      note: `Found ${hits.length} similar daily situations in stored history (next ~5 sessions).`,
    };
  }

  private walkForwardModel(closes: number[]): {
    probabilityUp: number | null;
    sampleSize: number;
    method: string;
    trainedThrough: string | null;
    note: string;
  } {
    if (closes.length < 140) {
      return {
        probabilityUp: null,
        sampleSize: closes.length,
        method: 'none',
        trainedThrough: null,
        note: 'Walk-forward logistic needs ≥140 daily closes. Using the transparent weighted score until then.',
      };
    }
    const labels = walkForwardLabels(closes, 5, 0.05, 0.1);
    const X: number[][] = [];
    const y: number[] = [];
    for (const row of labels) {
      if (row.label === null) continue;
      if (row.index < 30) continue;
      const window = closes.slice(0, row.index + 1);
      const r5 = pctChange(window[window.length - 6], window[window.length - 1]);
      const r21 = pctChange(window[window.length - 22] || window[0], window[window.length - 1]);
      const rRsi = rsi(window, 14);
      const above = window[window.length - 1] > (sma(window, 50) || 0) ? 1 : 0;
      if (r5 === null || r21 === null || rRsi === null) continue;
      X.push([r5, r21, rRsi / 100, above]);
      y.push(row.label);
    }
    if (X.length < 80) {
      return {
        probabilityUp: null,
        sampleSize: X.length,
        method: 'none',
        trainedThrough: null,
        note: 'Not enough non-neutral labels after costs.',
      };
    }
    const cutoff = Math.floor(X.length * 0.7);
    const model = fitLogistic(X.slice(0, cutoff), y.slice(0, cutoff));
    if (!model) {
      return {
        probabilityUp: null,
        sampleSize: X.length,
        method: 'none',
        trainedThrough: null,
        note: 'Logistic fit failed.',
      };
    }
    const current = X[X.length - 1];
    const p = predictLogistic(model, current);
    return {
      probabilityUp: p,
      sampleSize: cutoff,
      method: 'walk-forward-logistic',
      trainedThrough: '70% earliest rows only (no shuffle, no future labels)',
      note: 'Baseline statistical model on daily close-only features. Not deep learning. Accuracy is reported only from stored prediction outcomes.',
    };
  }

  private eventRisk(): { level: 'LOW' | 'MEDIUM' | 'HIGH'; events: any[] } {
    const events = [
      {
        event: 'FOMC / CPI / NFP',
        scheduled: null,
        note: 'Exact timestamps are taken from official calendars when ingested. Until a calendar provider is connected, treat weekly Fed/CPI/NFP windows as elevated risk.',
        expectedVolatility: 'UNKNOWN',
        source: 'unverified-schedule',
      },
    ];
    return { level: 'MEDIUM', events };
  }

  private withProb(s: { bear: number; base: number; bull: number }, pUp: number) {
    return {
      ...s,
      probability: {
        bear: Math.round((1 - pUp) * 450) / 10,
        base: 40,
        bull: Math.round(pUp * 450) / 10,
      },
    };
  }

  private contributors(components: any[], last: number | null, rsiValue: number | null, res: any, sup: any) {
    const bullish = components.filter((c) => c.available && c.score >= 55).map((c) => ({
      label: c.label,
      points: Math.round(c.score - 50),
    }));
    const bearish = [
      ...components.filter((c) => c.available && c.score <= 45).map((c) => ({ label: c.label, points: Math.round(c.score - 50) })),
      rsiValue && rsiValue > 70 ? { label: 'Overbought RSI', points: -12 } : null,
      res ? { label: `Resistance ${res.price.toFixed(0)}`, points: -8 } : null,
    ].filter(Boolean);
    return { bullish, bearish, last, support: sup };
  }

  private whyText(input: any) {
    if (!input.last) {
      return {
        en: 'No valid gold price is stored yet, so the engine will not invent a move explanation.',
        ar: 'لا يوجد سعر ذهب صالح مخزّن بعد، لذلك لن يختلق المحرك تفسيراً للحركة.',
      };
    }
    const move = input.ret1 == null ? 'unavailable' : `${input.ret1 >= 0 ? '+' : ''}${input.ret1.toFixed(2)}%`;
    return {
      en: `Latest stored gold observation is ${input.last.toFixed(2)} USD/oz (${move} vs prior daily close). Bullish evidence: ${input.bullDrivers.join('; ') || 'none stored'}. Bearish / conflicting evidence: ${input.bearDrivers.join('; ') || 'none stored'}. Decision layer: ${input.decision}. Freshness: ${input.freshness}.`,
      ar: `آخر مشاهدة ذهب مخزّنة ${input.last.toFixed(2)} دولار/أونصة (التغير اليومي: ${move}). الأدلة الصعودية: ${input.bullDrivers.join('؛ ') || 'لا شيء'}. الأدلة الهبوطية/المتعارضة: ${input.bearDrivers.join('؛ ') || 'لا شيء'}. طبقة القرار: ${input.decision}. الحداثة: ${input.freshness}.`,
    };
  }

  private async sourceStatus() {
    await this.ingestion.ensureSources();
    const rows = await this.sources.find({ order: { sourceName: 'ASC' } });
    return SOURCE_REGISTRY.map((def) => {
      const row = rows.find((r) => r.sourceName === def.sourceName);
      return {
        ...def,
        status: row?.status || 'idle',
        lastSuccessfulFetch: row?.lastSuccessfulFetch || null,
        lastDataTimestamp: row?.lastDataTimestamp || null,
        latencyMs: row?.latencyMs ?? null,
        dataQualityScore: row?.dataQualityScore ?? def.reliabilityScore,
        lastError: row?.lastError || null,
      };
    });
  }

  private async modelPerformance() {
    const rows = await this.predictions.find({
      where: { actualReturn: Not(IsNull()) },
      order: { predictionTimestamp: 'DESC' },
      take: 400,
    });
    if (!rows.length) {
      return {
        sample: 0,
        note: 'No settled predictions yet. Accuracy will appear after futures realize versus stored forecasts. The system never claims 90%+ accuracy.',
      };
    }
    const horizon = (h: string) => rows.filter((r) => r.timeHorizon === h);
    const summarize = (set: GoldPredictionEntity[]) => {
      if (!set.length) return null;
      const settled = set.filter((r) => r.correct !== null);
      const wins = settled.filter((r) => r.correct).length;
      const avg = mean(set.map((r) => r.actualReturn || 0));
      return {
        n: set.length,
        accuracy: settled.length ? wins / settled.length : null,
        averageReturn: avg,
      };
    };
    return {
      sample: rows.length,
      overall: summarize(rows),
      byHorizon: {
        '24H': summarize(horizon('24H')),
        '7D': summarize(horizon('7D')),
        '30D': summarize(horizon('30D')),
      },
      note: 'Calibration and accuracy use stored prediction outcomes only — never synthetic scores.',
    };
  }

  private async storePredictions(payload: any) {
    if (!payload?.price?.xauUsd) return;
    const existing = await this.predictions.find({
      where: { modelVersion: MODEL_VERSION },
      order: { predictionTimestamp: 'DESC' },
      take: 8,
    });
    const recent = existing.find((p) => Date.now() - +p.predictionTimestamp < 6 * 3600 * 1000 && p.timeHorizon === '24H');
    if (recent) return;
    const horizons = (payload.forecast?.horizons || []).filter((h: any) => h.available && h.probabilityUp != null);
    for (const h of horizons) {
      await this.predictions.save(
        this.predictions.create({
          timeHorizon: h.timeHorizon,
          modelVersion: MODEL_VERSION,
          direction: h.direction,
          probabilityUp: h.probabilityUp / 100,
          probabilityDown: (h.probabilityDown || 0) / 100,
          probabilityNeutral: (h.probabilityNeutral || 0) / 100,
          expectedReturn: h.expectedReturn,
          confidence: h.confidence,
          priceAtPrediction: payload.price.xauUsd,
          dataTimestamp: payload.price.timestamp,
          regimeJson: payload.market?.regimes || [],
          featuresJson: {
            rsi: payload.technical?.rsi,
            sma200: payload.technical?.sma200,
            realYield: payload.macro?.realYield10,
          },
          provenanceJson: {
            source: payload.price.source,
            freshness: payload.price.freshness,
            snapshotAt: payload.generatedAt,
          },
        }),
      );
    }
    await this.settlePredictions(payload.price.xauUsd);
  }

  private async settlePredictions(currentPrice: number) {
    const open = await this.predictions.find({
      where: { actualReturn: IsNull() },
      order: { predictionTimestamp: 'ASC' },
      take: 80,
    });
    const ms: Record<string, number> = { '24H': 86400000, '7D': 7 * 86400000, '30D': 30 * 86400000 };
    for (const row of open) {
      const wait = ms[row.timeHorizon];
      if (!wait) continue;
      if (Date.now() - +row.predictionTimestamp < wait) continue;
      if (!row.priceAtPrediction) continue;
      const actual = pctChange(row.priceAtPrediction, currentPrice);
      row.actualReturn = actual;
      if (actual === null) continue;
      if (row.direction === 'BULLISH') row.correct = actual > 0;
      else if (row.direction === 'BEARISH') row.correct = actual < 0;
      else row.correct = Math.abs(actual) < 0.4;
      await this.predictions.save(row);
    }
  }

  async getSettings(userId: string) {
    let row = await this.settings.findOne({ where: { userId } });
    if (!row) {
      row = await this.settings.save(
        this.settings.create({ userId, weightsJson: DEFAULT_WEIGHTS }),
      );
    }
    return row;
  }

  async saveSettings(userId: string, patch: Partial<GoldUserSettingsEntity>) {
    const row = await this.getSettings(userId);
    Object.assign(row, patch);
    return this.settings.save(row);
  }

  private personalPanel(settings: GoldUserSettingsEntity, last: number | null, ev: number, decision: string, entry: any) {
    const riskMap: Record<string, number> = { low: 0.15, medium: 0.3, high: 0.5 };
    const alloc = (riskMap[settings.riskTolerance] || 0.3) * (decision.startsWith('BUY') ? 1 : decision === 'WAIT' ? 0.15 : 0);
    return {
      capitalUsd: settings.capitalUsd,
      holdingPeriod: settings.holdingPeriod,
      riskTolerance: settings.riskTolerance,
      suggestedAllocationUsd: settings.capitalUsd * alloc,
      entry,
      expectedValuePct: ev,
      note: 'This is a sizing sketch from model output, not a brokerage order and not guaranteed.',
    };
  }

  async listAlerts(userId: string) {
    return this.alerts.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async createAlert(userId: string, body: { alertType: string; threshold?: number }) {
    return this.alerts.save(
      this.alerts.create({
        userId,
        alertType: body.alertType,
        threshold: body.threshold ?? null,
        enabled: true,
      }),
    );
  }

  async evaluateAlerts(userId: string, payload: any) {
    const rows = await this.listAlerts(userId);
    const price = payload?.price?.xauUsd;
    const pUp = payload?.forecast?.ensembleProbabilityUp;
    const hits: any[] = [];
    for (const row of rows.filter((r) => r.enabled)) {
      let hit = false;
      let message = '';
      if (row.alertType === 'price_above' && price && row.threshold && price >= row.threshold) {
        hit = true;
        message = `GOLD ALERT XAU/USD ${price} is above ${row.threshold}`;
      }
      if (row.alertType === 'price_below' && price && row.threshold && price <= row.threshold) {
        hit = true;
        message = `GOLD ALERT XAU/USD ${price} is below ${row.threshold}`;
      }
      if (row.alertType === 'prob_up' && pUp && row.threshold && pUp >= row.threshold) {
        hit = true;
        message = `GOLD ALERT UP probability ${pUp}% ≥ ${row.threshold}`;
      }
      if (row.alertType === 'shock' && payload?.market?.shock) {
        hit = true;
        message = 'GOLD ALERT market shock mode';
      }
      if (hit) {
        row.lastTriggeredAt = new Date();
        row.lastMessage = message;
        await this.alerts.save(row);
        hits.push({ id: row.id, message });
      }
    }
    return hits;
  }
}
