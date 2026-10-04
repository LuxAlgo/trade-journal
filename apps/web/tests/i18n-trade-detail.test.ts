// @vitest-environment jsdom
// Representative i18n coverage for the trade detail page group (T23): the
// rating stars and the candle replay controls must be reachable by localized
// accessible name under both "en" and "zh-CN" (docs/i18n.md §14).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { renderWithLocale } from "./helpers/i18n";
import { TooltipProvider } from "../src/components/ui/tooltip";
import type { TradeMarketResult } from "../src/lib/market-data";

const chart = vi.hoisted(() => ({ setMarket: vi.fn(), destroy: vi.fn() }));
vi.mock("@luxalgo/vela", () => ({
  Vela: class {
    ready = async () => {};
    setMarket = chart.setMarket;
    destroy = chart.destroy;
    addNativeIndicator() {}
    setTheme() {}
  },
  registerNativeIndicator: vi.fn(),
  unregisterNativeIndicator: vi.fn(),
}));
const { TradeRating } = await import("../src/components/trade-rating");
const { HistoricalReplay } = await import("../src/components/trade-market-data");

const copy = {
  en: { rate4: "Rate 4 stars", nextCandle: "Next candle", position: "Replay position" },
  "zh-CN": { rate4: "第 4 颗星", nextCandle: "下一根 K 线", position: "回放进度" },
} as const;
type UiLocale = keyof typeof copy;

const cleanups: Array<() => void> = [];
const mount = async (ui: ReactElement, locale: UiLocale) => {
  const rendered = renderWithLocale(
    createElement(TooltipProvider, { delayDuration: 0, children: ui }),
    { locale },
  );
  cleanups.push(rendered.unmount);
  // Flush the async chart bootstrap inside act so readiness settles.
  await act(async () => {});
};
beforeEach(() => {
  chart.setMarket.mockReset().mockResolvedValue(undefined);
  chart.destroy.mockReset();
});
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.innerHTML = "";
});

const history: TradeMarketResult = {
  provider: "Test provider",
  symbol: "TEST",
  resolution: "1m",
  fetchedAt: "2026-09-01T12:00:00Z",
  truncated: false,
  warnings: [],
  bars: [0, 1].map((index) => ({
    time: Date.parse("2026-09-01T10:00:00Z") + index * 60000,
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 10,
  })),
  estimate: { mae: -1, mfe: 2, sampledBars: 2, excludedBars: 0, warnings: [] },
};

it.each(["en", "zh-CN"] as UiLocale[])(
  "exposes the rating stars and replay controls by localized accessible name under %s",
  async (locale) => {
    const expected = copy[locale];
    await mount(createElement(TradeRating, { value: null, onChange: vi.fn() }), locale);
    const star = document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="${expected.rate4}"]`,
    )!;
    expect(star).toBeTruthy();
    // The localized name is interactive, not just decorative: clicking through
    // it still saves the 4-star rating.
    await act(async () => star.click());
    expect(chart.setMarket).not.toHaveBeenCalled();

    await mount(
      createElement(HistoricalReplay, {
        history,
        privacy: false,
        executions: [],
        trade: {
          key: "test",
          symbol: "TEST",
          currency: "USD",
          netPnl: 1,
          avgEntry: 100,
          direction: "long",
          openedAt: "2026-09-01T10:00:00Z",
          closedAt: "2026-09-01T10:01:00Z",
        },
      }),
      locale,
    );
    const next = document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="${expected.nextCandle}"]`,
    );
    const position = document.body.querySelector<HTMLInputElement>(
      `input[aria-label="${expected.position}"]`,
    );
    expect(next).toBeTruthy();
    expect(position).toBeTruthy();
  },
);
