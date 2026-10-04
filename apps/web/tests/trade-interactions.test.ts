// @vitest-environment jsdom
// Same interactions as before the i18n migration (T23): the components now read
// copy from the `trade-detail` messages, so rendering goes through the i18n test
// helper with the real "en" resources — the accessible names below stay the
// exact English strings the widgets expose in the default language.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { renderWithLocale } from "./helpers/i18n";
import { TradeRating } from "../src/components/trade-rating";
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
const { HistoricalReplay } = await import("../src/components/trade-market-data");
const cleanups: Array<() => void> = [];
beforeEach(() => {
  chart.setMarket.mockReset().mockResolvedValue(undefined);
  chart.destroy.mockReset();
});
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.innerHTML = "";
});
const mount = async (ui: ReactElement) => {
  const rendered = renderWithLocale(
    createElement(TooltipProvider, { delayDuration: 0, children: ui }),
    { locale: "en" },
  );
  cleanups.push(rendered.unmount);
  // Flush the async chart bootstrap (dynamic import + ready()) inside act,
  // mirroring the original act(async) render before the i18n migration.
  await act(async () => {});
  return rendered;
};
const button = (label: string) =>
  document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const filled = () => document.body.querySelectorAll('[data-filled="true"]').length;

it("previews all stars up to the hovered or focused rating without saving", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  await mount(createElement(TradeRating, { value: 2, onChange: save }));
  await act(async () =>
    button("Rate 4 stars").dispatchEvent(new MouseEvent("pointerover", { bubbles: true })),
  );
  expect(filled()).toBe(4);
  expect(save).not.toHaveBeenCalled();
  await act(async () =>
    button("Rate 4 stars").dispatchEvent(
      new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
    ),
  );
  expect(filled()).toBe(2);
  await act(async () => button("Rate 5 stars").focus());
  expect(filled()).toBe(5);
  await act(async () => button("Rate 5 stars").blur());
  expect(filled()).toBe(2);
});

it("animates the selection immediately and restores the saved value if saving fails", async () => {
  let reject!: (error: Error) => void;
  const save = vi.fn(
    () =>
      new Promise<void>((_, no) => {
        reject = no;
      }),
  );
  await mount(createElement(TradeRating, { value: 2, onChange: save }));
  await act(async () => button("Rate 4 stars").click());
  expect(save).toHaveBeenCalledWith(4);
  expect(filled()).toBe(4);
  expect(document.body.querySelectorAll(".journal-rating-selected")).toHaveLength(4);
  await act(async () => reject(new Error("offline")));
  expect(filled()).toBe(2);
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("not saved");
});

it("saves a rating and allows selecting it again to clear it", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  await mount(createElement(TradeRating, { value: null, onChange: save }));
  await act(async () => button("Rate 3 stars").click());
  expect(button("Rate 3 stars").getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("Rate 3 stars").click());
  expect(save.mock.calls.map(([value]) => value)).toEqual([3, null]);
  expect(filled()).toBe(0);
});

const history: TradeMarketResult = {
  provider: "Test provider",
  symbol: "TEST",
  resolution: "1m",
  fetchedAt: "2026-09-01T12:00:00Z",
  truncated: false,
  warnings: [],
  bars: [0, 1, 2].map((index) => ({
    time: Date.parse("2026-09-01T10:00:00Z") + index * 60000,
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 10,
  })),
  estimate: { mae: -1, mfe: 2, sampledBars: 3, excludedBars: 0, warnings: [] },
};
const renderReplay = async (privacy = false) => {
  await mount(
    createElement(HistoricalReplay, {
      history,
      privacy,
      executions: [],
      trade: {
        key: "test",
        symbol: "TEST",
        currency: "USD",
        netPnl: 1,
        avgEntry: 100,
        direction: "long",
        openedAt: "2026-09-01T10:00:00Z",
        closedAt: "2026-09-01T10:03:00Z",
      },
    }),
  );
};
const count = () =>
  document.body.querySelector<HTMLInputElement>('[aria-label="Replay position"]')!.value;
it("reveals Vela after readiness and steps backwards and forwards without future candles", async () => {
  await renderReplay();
  expect(document.body.querySelector(".journal-replay-reveal")).toBeTruthy();
  expect(count()).toBe("3");
  expect(button("Next candle").disabled).toBe(true);
  await act(async () => button("Previous candle").click());
  expect(count()).toBe("2");
  expect(chart.setMarket.mock.calls.at(-1)?.[0].data).toEqual(history.bars.slice(0, 2));
  await act(async () => button("Previous candle").click());
  expect(count()).toBe("1");
  expect(button("Previous candle").disabled).toBe(true);
  await act(async () => button("Next candle").click());
  expect(count()).toBe("2");
  await act(async () => button("Show all candles").click());
  expect(count()).toBe("3");
  await act(async () => button("Restart replay").click());
  expect(count()).toBe("1");
});
it("hides the historical chart and controls in privacy mode", async () => {
  await renderReplay(true);
  expect(document.body.querySelector('[aria-label="Replay position"]')).toBeNull();
  expect(document.body.textContent).toContain("hidden in privacy mode");
});
