// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
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
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  chart.setMarket.mockReset().mockResolvedValue(undefined);
  chart.destroy.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const filled = () => container.querySelectorAll('[data-filled="true"]').length;

it("previews all stars up to the hovered or focused rating without saving", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  await act(async () => root.render(createElement(TradeRating, { value: 2, onChange: save })));
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
  await act(async () => root.render(createElement(TradeRating, { value: 2, onChange: save })));
  await act(async () => button("Rate 4 stars").click());
  expect(save).toHaveBeenCalledWith(4);
  expect(filled()).toBe(4);
  expect(container.querySelectorAll(".journal-rating-selected")).toHaveLength(4);
  await act(async () => reject(new Error("offline")));
  expect(filled()).toBe(2);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("not saved");
});

it("saves a rating and allows selecting it again to clear it", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  await act(async () => root.render(createElement(TradeRating, { value: null, onChange: save })));
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
const renderReplay = async (privacy = false) =>
  act(async () =>
    root.render(
      createElement(
        TooltipProvider,
        null,
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
      ),
    ),
  );
const count = () =>
  container.querySelector<HTMLInputElement>('[aria-label="Replay position"]')!.value;
it("reveals Vela after readiness and steps backwards and forwards without future candles", async () => {
  await renderReplay();
  expect(container.querySelector(".journal-replay-reveal")).toBeTruthy();
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
  expect(container.querySelector('[aria-label="Replay position"]')).toBeNull();
  expect(container.textContent).toContain("hidden in privacy mode");
});
