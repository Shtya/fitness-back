import {
  PURITY_FACTOR,
  TROY_OUNCE_GRAMS,
  decideAction,
  expectedValue,
  freshnessLabel,
  impossibleJump,
  pctChange,
  rsi,
  sma,
  theoreticalEgyptGram,
  usdPerGramFromXauUsd,
  walkForwardLabels,
} from './gold-math';

describe('gold-math conversions', () => {
  it('converts troy ounce to gram', () => {
    expect(usdPerGramFromXauUsd(3110.34768)).toBeCloseTo(100, 6);
    expect(TROY_OUNCE_GRAMS).toBeCloseTo(31.1034768, 7);
  });

  it('computes Egypt 21K theoretical price', () => {
    const xau = 4000;
    const usdEgp = 50;
    const gram24 = theoreticalEgyptGram(xau, usdEgp, PURITY_FACTOR.k24);
    const gram21 = theoreticalEgyptGram(xau, usdEgp, PURITY_FACTOR.k21);
    expect(gram24).toBeCloseTo((4000 * 50) / TROY_OUNCE_GRAMS, 6);
    expect(gram21).toBeCloseTo(gram24 * (21 / 24), 6);
  });

  it('never uses future closes in walk-forward labels', () => {
    const closes = [100, 101, 102, 110, 109, 108];
    const labels = walkForwardLabels(closes, 2, 0, 0.1);
    expect(labels[labels.length - 1].index).toBeLessThan(closes.length - 2);
    expect(labels.every((row) => row.index + 2 < closes.length || row.label === null || row.index + 2 === closes.length - 0)).toBe(true);
    const lastUsable = labels.filter((row) => row.index + 2 < closes.length);
    lastUsable.forEach((row) => {
      expect(row.index + 2).toBeLessThan(closes.length);
    });
  });
});

describe('gold-math signals', () => {
  it('computes SMA and RSI', () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(sma(values, 10)).toBeCloseTo(124.5, 5);
    expect(rsi(values, 14)).toBeGreaterThan(70);
  });

  it('flags impossible jumps and stale labels', () => {
    expect(impossibleJump(4000, 4500)).toBe(true);
    expect(impossibleJump(4000, 4020)).toBe(false);
    expect(freshnessLabel(0, true)).toBe('LIVE');
    expect(freshnessLabel(12, false)).toBe('DELAYED');
    expect(freshnessLabel(60 * 30, false)).toBe('STALE');
    expect(freshnessLabel(null, false)).toBe('UNAVAILABLE');
  });

  it('computes expected value transparently', () => {
    expect(expectedValue(0.68, 1.4, 0.32, -0.9)).toBeCloseTo(0.68 * 1.4 + 0.32 * -0.9, 8);
  });

  it('waits on conflicts and stale data', () => {
    expect(
      decideAction({
        probabilityUp: 0.8,
        expectedValue: 1,
        confidence: 80,
        eventRisk: 'LOW',
        extended: false,
        conflict: true,
        shock: false,
        dataFreshnessOk: true,
        riskRewardOk: true,
      }).code,
    ).toBe('WAIT');
    expect(
      decideAction({
        probabilityUp: 0.8,
        expectedValue: 1,
        confidence: 80,
        eventRisk: 'LOW',
        extended: false,
        conflict: false,
        shock: false,
        dataFreshnessOk: false,
        riskRewardOk: true,
      }).code,
    ).toBe('WAIT');
  });

  it('computes percent change', () => {
    expect(pctChange(100, 108)).toBeCloseTo(8, 8);
    expect(pctChange(0, 10)).toBeNull();
  });
});
