export const TROY_OUNCE_GRAMS = 31.1034768;

export const PURITY_FACTOR: Record<'k24' | 'k21' | 'k18' | 'k14', number> = {
  k24: 1,
  k21: 21 / 24,
  k18: 18 / 24,
  k14: 14 / 24,
};

export type OhlcBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  closeOnly?: boolean;
};

export function assertFinite(value: number, label = 'value'): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric ${label}`);
  }
  return value;
}

export function usdPerGramFromXauUsd(xauUsd: number): number {
  return assertFinite(xauUsd, 'xauUsd') / TROY_OUNCE_GRAMS;
}

export function theoreticalEgyptGram(
  xauUsd: number,
  usdEgp: number,
  purity: number,
): number {
  return (
    (assertFinite(xauUsd, 'xauUsd') * assertFinite(usdEgp, 'usdEgp')) /
    TROY_OUNCE_GRAMS *
    assertFinite(purity, 'purity')
  );
}

export function premiumPercent(actual: number, theoretical: number): number | null {
  if (!Number.isFinite(actual) || !Number.isFinite(theoretical) || theoretical === 0) {
    return null;
  }
  return ((actual - theoretical) / theoretical) * 100;
}

export function pctChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

export function mean(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

export function median(values: number[]): number | null {
  const clean = [...values.filter((v) => Number.isFinite(v))].sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

export function stdev(values: number[]): number | null {
  const avg = mean(values);
  if (avg === null || values.length < 2) return null;
  const variance =
    values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function rollingReturn(closes: number[], bars: number): number | null {
  if (closes.length <= bars) return null;
  return pctChange(closes[closes.length - 1 - bars], closes[closes.length - 1]);
}

export function sma(values: number[], period: number): number | null {
  if (period < 1 || values.length < period) return null;
  return mean(values.slice(-period));
}

export function smaSeries(values: number[], period: number): Array<number | null> {
  return values.map((_, i) => (i + 1 < period ? null : mean(values.slice(i + 1 - period, i + 1))));
}

export function ema(values: number[], period: number): number | null {
  if (period < 1 || values.length < period) return null;
  const k = 2 / (period + 1);
  let value = mean(values.slice(0, period));
  if (value === null) return null;
  for (let i = period; i < values.length; i += 1) {
    value = values[i] * k + value * (1 - k);
  }
  return value;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(values: number[]): { macd: number; signal: number; histogram: number } | null {
  if (values.length < 35) return null;
  const line = ema(values, 12);
  const slow = ema(values, 26);
  if (line === null || slow === null) return null;
  const macdLine = line - slow;
  const macdSeries: number[] = [];
  for (let i = 26; i <= values.length; i += 1) {
    const fast = ema(values.slice(0, i), 12);
    const s = ema(values.slice(0, i), 26);
    if (fast !== null && s !== null) macdSeries.push(fast - s);
  }
  const signal = ema(macdSeries, 9);
  if (signal === null) return null;
  return { macd: macdLine, signal, histogram: macdLine - signal };
}

export function bollinger(
  values: number[],
  period = 20,
  k = 2,
): { mid: number; upper: number; lower: number; percentB: number | null; width: number } | null {
  const mid = sma(values, period);
  const recent = values.slice(-period);
  const sd = stdev(recent);
  if (mid === null || sd === null) return null;
  const upper = mid + k * sd;
  const lower = mid - k * sd;
  const last = values[values.length - 1];
  const width = mid === 0 ? null : ((upper - lower) / mid) * 100;
  const percentB = upper === lower ? null : (last - lower) / (upper - lower);
  return { mid, upper, lower, percentB, width: width ?? 0 };
}

export function atr(bars: OhlcBar[], period = 14): number | null {
  if (bars.length <= period) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const prevClose = bars[i - 1].close;
    const range = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - prevClose),
      Math.abs(bars[i].low - prevClose),
    );
    trs.push(range);
  }
  return sma(trs, period);
}

export function stochastic(bars: OhlcBar[], period = 14): number | null {
  if (bars.length < period) return null;
  const window = bars.slice(-period);
  const high = Math.max(...window.map((b) => b.high));
  const low = Math.min(...window.map((b) => b.low));
  if (high === low) return 50;
  return ((bars[bars.length - 1].close - low) / (high - low)) * 100;
}

export function roc(values: number[], period = 10): number | null {
  return rollingReturn(values, period);
}

export function adx(bars: OhlcBar[], period = 14): number | null {
  if (bars.length < period * 2) return null;
  const dx: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
    if (tr === 0) continue;
    const plusDi = (plusDm / tr) * 100;
    const minusDi = (minusDm / tr) * 100;
    const diSum = plusDi + minusDi;
    dx.push(diSum === 0 ? 0 : (Math.abs(plusDi - minusDi) / diSum) * 100);
  }
  return sma(dx, period);
}

export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 5) return null;
  const ax = a.slice(-n);
  const bx = b.slice(-n);
  const ma = mean(ax);
  const mb = mean(bx);
  const sa = stdev(ax);
  const sb = stdev(bx);
  if (ma === null || mb === null || !sa || !sb) return null;
  let cov = 0;
  for (let i = 0; i < n; i += 1) cov += (ax[i] - ma) * (bx[i] - mb);
  return cov / ((n - 1) * sa * sb);
}

export function zscore(values: number[]): number[] {
  const avg = mean(values);
  const sd = stdev(values);
  if (avg === null || !sd) return values.map(() => 0);
  return values.map((v) => (v - avg) / sd);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function expectedValue(probabilityUp: number, upside: number, probabilityDown: number, downside: number): number {
  return probabilityUp * upside + probabilityDown * downside;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function logistic(z: number): number {
  return 1 / (1 + Math.exp(-clamp(z, -20, 20)));
}

/** Simple batch logistic regression; labels must be 0/1. No future rows allowed in X. */
export function fitLogistic(
  X: number[][],
  y: number[],
  iterations = 250,
  lr = 0.08,
): { weights: number[]; intercept: number } | null {
  if (X.length < 80 || X.length !== y.length) return null;
  const dim = X[0]?.length || 0;
  if (!dim) return null;
  const weights = new Array(dim).fill(0);
  let intercept = 0;
  for (let iter = 0; iter < iterations; iter += 1) {
    const gradW = new Array(dim).fill(0);
    let gradB = 0;
    for (let i = 0; i < X.length; i += 1) {
      let z = intercept;
      for (let j = 0; j < dim; j += 1) z += weights[j] * X[i][j];
      const p = logistic(z);
      const err = p - y[i];
      gradB += err;
      for (let j = 0; j < dim; j += 1) gradW[j] += err * X[i][j];
    }
    intercept -= (lr * gradB) / X.length;
    for (let j = 0; j < dim; j += 1) weights[j] -= (lr * gradW[j]) / X.length;
  }
  return { weights, intercept };
}

export function predictLogistic(
  model: { weights: number[]; intercept: number },
  features: number[],
): number {
  let z = model.intercept;
  for (let i = 0; i < model.weights.length; i += 1) z += model.weights[i] * (features[i] || 0);
  return logistic(z);
}

export function brierScore(probs: number[], outcomes: number[]): number | null {
  if (!probs.length || probs.length !== outcomes.length) return null;
  return mean(probs.map((p, i) => (p - outcomes[i]) ** 2));
}

export function detectStaleMinutes(timestamp: Date | string | null, now = new Date()): number | null {
  if (!timestamp) return null;
  const ts = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(ts.getTime())) return null;
  return Math.max(0, Math.round((now.getTime() - ts.getTime()) / 60000));
}

export function freshnessLabel(minutes: number | null, realtimeCapable: boolean): 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE' {
  if (minutes === null) return 'UNAVAILABLE';
  if (minutes > 24 * 60) return 'STALE';
  if (realtimeCapable && minutes <= 1) return 'LIVE';
  if (minutes <= 24 * 60) return 'DELAYED';
  return 'STALE';
}

export function impossibleJump(prev: number, next: number, thresholdPct = 8): boolean {
  const change = pctChange(prev, next);
  return change !== null && Math.abs(change) > thresholdPct;
}

export type DecisionCode =
  | 'STRONG_BUY'
  | 'BUY'
  | 'BUY_PARTIALLY'
  | 'WAIT'
  | 'AVOID'
  | 'REDUCE';

export function decideAction(input: {
  probabilityUp: number;
  expectedValue: number;
  confidence: number;
  eventRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  extended: boolean;
  conflict: boolean;
  shock: boolean;
  dataFreshnessOk: boolean;
  riskRewardOk: boolean;
}): { code: DecisionCode; reason: string; reasonAr: string } {
  if (!input.dataFreshnessOk) {
    return {
      code: 'WAIT',
      reason: 'Data freshness is not acceptable — last valid observation is too old.',
      reasonAr: 'حداثة البيانات غير مقبولة — آخر مشاهدة صالحة قديمة جداً.',
    };
  }
  if (input.shock) {
    return {
      code: 'WAIT',
      reason: 'Market shock mode is active. Confidence is reduced until conditions normalize.',
      reasonAr: 'وضع صدمة السوق مفعّل. تم خفض الثقة حتى تستقر الظروف.',
    };
  }
  if (input.conflict) {
    return {
      code: 'WAIT',
      reason: 'Models disagree materially across independent dimensions.',
      reasonAr: 'النماذج تختلف بشكل جوهري عبر الأبعاد المستقلة.',
    };
  }
  const bullish =
    input.probabilityUp >= 0.65 &&
    input.expectedValue > 0 &&
    input.confidence >= 65 &&
    input.riskRewardOk;
  if (bullish && input.probabilityUp >= 0.72 && input.confidence >= 75 && !input.extended && input.eventRisk === 'LOW') {
    return {
      code: 'STRONG_BUY',
      reason: 'Independent dimensions agree, expected value is positive, and price is not extended.',
      reasonAr: 'الأبعاد المستقلة متفقة، القيمة المتوقعة موجبة، والسعر غير ممتد.',
    };
  }
  if (bullish && !input.extended && input.eventRisk !== 'HIGH') {
    return {
      code: 'BUY',
      reason: 'Probability, expected value, and confidence clear the buy hurdle without a major nearby event.',
      reasonAr: 'الاحتمال والقيمة المتوقعة والثقة تتجاوز عتبة الشراء دون حدث سلبي وشيك.',
    };
  }
  if (bullish && (input.extended || input.eventRisk === 'HIGH')) {
    return {
      code: 'BUY_PARTIALLY',
      reason: 'Trend is constructive but price is extended or event risk is elevated — stage entries.',
      reasonAr: 'الاتجاه إيجابي لكن السعر ممتد أو مخاطر الأحداث مرتفعة — شراء مرحلي.',
    };
  }
  if (input.probabilityUp <= 0.4 || input.expectedValue < 0) {
    return {
      code: 'AVOID',
      reason: 'Expected value is not attractive enough, or downside probability dominates.',
      reasonAr: 'القيمة المتوقعة غير جذابة أو احتمال الهبوط هو المسيطر.',
    };
  }
  return {
    code: 'WAIT',
    reason: 'Setup is not clean enough for a full allocation.',
    reasonAr: 'الإعداد غير نظيف بما يكفي لتخصيص كامل.',
  };
}

export function stageDca(confidence: number): Array<{ tranche: number; trigger: string; triggerAr: string }> {
  const bullish = clamp(confidence, 0, 100);
  if (bullish < 55) {
    return [{ tranche: 0, trigger: 'Do not deploy until confidence recovers.', triggerAr: 'لا تُوظَّف حتى تتعافى الثقة.' }];
  }
  return [
    { tranche: 25, trigger: 'Now, only if decision is BUY or BUY_PARTIALLY', triggerAr: 'الآن، فقط إذا كان القرار شراء أو شراء جزئي' },
    { tranche: 25, trigger: 'Add at −1% from current', triggerAr: 'أضف عند −1% من السعر الحالي' },
    { tranche: 25, trigger: 'Add at −2% from current', triggerAr: 'أضف عند −2% من السعر الحالي' },
    { tranche: 25, trigger: 'Keep for breakout confirmation', triggerAr: 'احتفظ للتأكيد عند الاختراق' },
  ];
}

export function pivotPoints(bar: OhlcBar): { p: number; r1: number; s1: number; r2: number; s2: number } {
  const p = (bar.high + bar.low + bar.close) / 3;
  return {
    p,
    r1: 2 * p - bar.low,
    s1: 2 * p - bar.high,
    r2: p + (bar.high - bar.low),
    s2: p - (bar.high - bar.low),
  };
}

export function fibonacciLevels(swingLow: number, swingHigh: number): Record<string, number> {
  const range = swingHigh - swingLow;
  return {
    '0': swingHigh,
    '0.236': swingHigh - range * 0.236,
    '0.382': swingHigh - range * 0.382,
    '0.5': swingHigh - range * 0.5,
    '0.618': swingHigh - range * 0.618,
    '0.786': swingHigh - range * 0.786,
    '1': swingLow,
  };
}

export function supportResistance(bars: OhlcBar[], lookback = 120): Array<{
  price: number;
  kind: 'support' | 'resistance';
  touches: number;
  strength: number;
  recencyDays: number;
  timeframe: string;
  confidence: number;
}> {
  if (bars.length < 20) return [];
  const window = bars.slice(-lookback);
  const closes = window.map((b) => b.close);
  const last = closes[closes.length - 1];
  const candidates: number[] = [];
  for (let i = 2; i < window.length - 2; i += 1) {
    const h = window[i].high;
    const l = window[i].low;
    if (h >= window[i - 1].high && h >= window[i - 2].high && h >= window[i + 1].high && h >= window[i + 2].high) {
      candidates.push(h);
    }
    if (l <= window[i - 1].low && l <= window[i - 2].low && l <= window[i + 1].low && l <= window[i + 2].low) {
      candidates.push(l);
    }
  }
  const roundTo = last > 1000 ? 5 : 0.5;
  const buckets = new Map<number, { price: number; touches: number; lastIndex: number }>();
  for (let i = 0; i < candidates.length; i += 1) {
    const key = Math.round(candidates[i] / roundTo) * roundTo;
    const row = buckets.get(key) || { price: key, touches: 0, lastIndex: 0 };
    row.touches += 1;
    row.lastIndex = i;
    buckets.set(key, row);
  }
  const psych = [Math.round(last / 50) * 50, Math.round(last / 100) * 100];
  psych.forEach((p) => {
    const row = buckets.get(p) || { price: p, touches: 1, lastIndex: window.length };
    row.touches += 1;
    buckets.set(p, row);
  });
  return [...buckets.values()]
    .map((row) => {
      const kind: 'support' | 'resistance' = row.price <= last ? 'support' : 'resistance';
      const recencyDays = Math.max(0, window.length - row.lastIndex);
      const strength = clamp(row.touches * 18 + (recencyDays < 20 ? 15 : 0), 10, 96);
      return {
        price: row.price,
        kind,
        touches: row.touches,
        strength,
        recencyDays,
        timeframe: '1D',
        confidence: strength,
      };
    })
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 10);
}

export function regimeFromContext(input: {
  ret30: number | null;
  ret90: number | null;
  sma50: number | null;
  sma200: number | null;
  last: number;
  atrPct: number | null;
  realYieldChange: number | null;
  usdChange: number | null;
  inflationYoY: number | null;
}): string[] {
  const regimes: string[] = [];
  if (input.sma200 && input.last > input.sma200 * 1.08 && (input.ret90 || 0) > 8) regimes.push('STRONG_BULL');
  else if (input.sma50 && input.last > input.sma50 && (input.ret30 || 0) > 0) regimes.push('BULL');
  else if (input.sma50 && input.last < input.sma50 && (input.ret30 || 0) < 0) regimes.push('BEAR');
  else if (input.sma200 && input.last < input.sma200 * 0.92) regimes.push('STRONG_BEAR');
  else regimes.push('SIDEWAYS');
  if ((input.atrPct || 0) > 1.6) regimes.push('HIGH_VOLATILITY');
  else regimes.push('LOW_VOLATILITY');
  if ((input.realYieldChange || 0) < -0.1) regimes.push('FALLING_RATE');
  if ((input.realYieldChange || 0) > 0.1) regimes.push('RISING_RATE');
  if ((input.usdChange || 0) < -0.4) regimes.push('DOLLAR_WEAKNESS');
  if ((input.usdChange || 0) > 0.4) regimes.push('DOLLAR_STRENGTH');
  if ((input.inflationYoY || 0) >= 3.5) regimes.push('INFLATIONARY');
  if ((input.inflationYoY || 0) !== null && (input.inflationYoY || 0) < 1) regimes.push('DEFLATIONARY');
  return regimes;
}

export function technicalScore(input: {
  last: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  rsi: number | null;
  macdHist: number | null;
  percentB: number | null;
}): { score: number; bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; reasons: string[]; reasonsAr: string[] } {
  let points = 50;
  const reasons: string[] = [];
  const reasonsAr: string[] = [];
  if (input.sma20 && input.last > input.sma20) {
    points += 8;
    reasons.push('Price is above SMA20');
    reasonsAr.push('السعر فوق متوسط 20');
  } else if (input.sma20) {
    points -= 8;
    reasons.push('Price is below SMA20');
    reasonsAr.push('السعر تحت متوسط 20');
  }
  if (input.sma50 && input.last > input.sma50) points += 8;
  else if (input.sma50) points -= 8;
  if (input.sma200 && input.last > input.sma200) {
    points += 10;
    reasons.push('Price is above SMA200');
    reasonsAr.push('السعر فوق متوسط 200');
  } else if (input.sma200) {
    points -= 10;
  }
  if (input.rsi !== null) {
    if (input.rsi > 70) {
      points -= 10;
      reasons.push('RSI is overbought');
      reasonsAr.push('مؤشر القوة النسبية في منطقة تشبع شرائي');
    } else if (input.rsi < 30) {
      points += 8;
      reasons.push('RSI is oversold');
      reasonsAr.push('مؤشر القوة النسبية في منطقة تشبع بيعي');
    } else if (input.rsi > 55) points += 4;
    else if (input.rsi < 45) points -= 4;
  }
  if ((input.macdHist || 0) > 0) points += 6;
  else if ((input.macdHist || 0) < 0) points -= 6;
  if (input.percentB !== null && input.percentB > 1) {
    points -= 8;
    reasons.push('Price is extended above the upper Bollinger band');
    reasonsAr.push('السعر ممتد فوق الحد العلوي لبولينجر');
  }
  const score = clamp(Math.round(points), 0, 100);
  const bias = score >= 58 ? 'BULLISH' : score <= 42 ? 'BEARISH' : 'NEUTRAL';
  return { score, bias, reasons, reasonsAr };
}

export function returnsFromCloses(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const r = pctChange(closes[i - 1], closes[i]);
    if (r !== null) out.push(r);
  }
  return out;
}

export function scenarioPrices(
  last: number,
  expectedReturnPct: number,
  volatilityPct: number,
): { bear: number; base: number; bull: number } {
  const vol = Math.max(0.15, volatilityPct);
  return {
    bear: last * (1 + (expectedReturnPct - 1.4 * vol) / 100),
    base: last * (1 + expectedReturnPct / 100),
    bull: last * (1 + (expectedReturnPct + 1.4 * vol) / 100),
  };
}

export function walkForwardLabels(
  closes: number[],
  horizon: number,
  costPct = 0.08,
  threshold = 0.12,
): Array<{ index: number; label: 0 | 1 | null }> {
  const out: Array<{ index: number; label: 0 | 1 | null }> = [];
  for (let i = 0; i < closes.length - horizon; i += 1) {
    const future = pctChange(closes[i], closes[i + horizon]);
    if (future === null) {
      out.push({ index: i, label: null });
      continue;
    }
    if (future > costPct + threshold) out.push({ index: i, label: 1 });
    else if (future < -(costPct + threshold)) out.push({ index: i, label: 0 });
    else out.push({ index: i, label: null });
  }
  return out;
}
