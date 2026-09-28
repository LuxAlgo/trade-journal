import { describe, expect, it } from "vitest";
import { PineTS } from "pinets";
import { INDICATOR_LIBRARY } from "../src/lib/indicator-library";

/**
 * Built-in indicators against plain reference formulas, candle by candle: the values, where
 * they start, and what a flat or volumeless market reads.
 */

type Candle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openTime: number;
};

const series = (closes: number[], volume = 1000): Candle[] =>
  closes.map((close, i) => ({
    open: closes[i - 1] ?? close,
    high: Math.max(close, closes[i - 1] ?? close) + 0.5,
    low: Math.min(close, closes[i - 1] ?? close) - 0.5,
    close,
    volume,
    openTime: Date.UTC(2026, 0, 1) + i * 3_600_000,
  }));

const source = (key: string) => INDICATOR_LIBRARY.find((i) => i.key === key)!.source;

async function plots(key: string, candles: Candle[]) {
  const { plots } = await new PineTS(candles).run(source(key));
  return Object.fromEntries(
    Object.entries(plots as Record<string, { data?: { value: unknown }[] }>).map(([name, p]) => [
      name,
      (p.data ?? []).map((d) => (typeof d.value === "number" ? d.value : NaN)),
    ]),
  ) as Record<string, number[]>;
}

/** Least-squares fit of the last `len` closes ending at `end`: line value at `end` and RMS residual. */
function regression(closes: number[], end: number, len: number) {
  const ys = closes.slice(end - len + 1, end + 1);
  const xs = ys.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / len;
  const my = ys.reduce((a, b) => a + b, 0) / len;
  const slope =
    xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0) /
    xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const at = (x: number) => my + slope * (x - mx);
  const rms = Math.sqrt(ys.reduce((a, y, i) => a + (y - at(i)) ** 2, 0) / len);
  return { line: at(len - 1), rms };
}

describe("the linear regression channel", () => {
  // A steady trend with a small wiggle: the closes hug the line.
  const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.5 + Math.sin(i) * 0.3);

  it("puts its bands two deviations of the closes from the fitted line away", async () => {
    const out = await plots("linreg", series(closes));
    for (const end of [99, 150, 259]) {
      const { line, rms } = regression(closes, end, 100);
      expect(out.Regression![end]).toBeCloseTo(line, 6);
      expect(out.Upper![end]! - out.Regression![end]!).toBeCloseTo(2 * rms, 6);
      expect(out.Regression![end]! - out.Lower![end]!).toBeCloseTo(2 * rms, 6);
    }
    // On a trend, the bands stay near the line (they used the spread around the mean).
    expect(out.Upper![259]! - out.Regression![259]!).toBeLessThan(1);
  });

  it("starts once a full window of closes exists", async () => {
    const out = await plots("linreg", series(closes));
    expect(Number.isNaN(out.Upper![98]!)).toBe(true);
    expect(Number.isFinite(out.Upper![99]!)).toBe(true);
  });
});

describe("oscillators without a reading", () => {
  const flat = series(Array.from({ length: 60 }, () => 100)).map((c) => ({
    ...c,
    high: 100,
    low: 100,
  }));
  const moving = series(Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 4));

  it("Williams %R and CCI show nothing on a flat market instead of an extreme", async () => {
    expect((await plots("williams-r", flat))["%R"]!.at(-1)).toBeNaN();
    expect((await plots("cci", flat)).CCI!.at(-1)).toBeNaN();
  });

  it("MFI shows nothing without volume instead of 100", async () => {
    const volumeless = moving.map((c) => ({ ...c, volume: 0 }));
    expect((await plots("mfi", volumeless)).MFI!.at(-1)).toBeNaN();
  });

  it("they read normally on a moving market with volume", async () => {
    const wpr = (await plots("williams-r", moving))["%R"]!.at(-1)!;
    const cci = (await plots("cci", moving)).CCI!.at(-1)!;
    const mfi = (await plots("mfi", moving)).MFI!.at(-1)!;
    expect(wpr).toBeGreaterThanOrEqual(-100);
    expect(wpr).toBeLessThanOrEqual(0);
    expect(Number.isFinite(cci)).toBe(true);
    expect(mfi).toBeGreaterThanOrEqual(0);
    expect(mfi).toBeLessThanOrEqual(100);
  });
});
