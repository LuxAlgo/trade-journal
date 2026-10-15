// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import TradesPage from "../src/app/trades/page";

const state = vi.hoisted(() => ({ trades: [] as Record<string, unknown>[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/filter-bar", () => ({
  FilterBar: () => null,
  useFilters: () => ({ query: "" }),
}));
vi.mock("@/lib/use-api", () => ({
  useApi: () => ({ data: { trades: state.trades, timeZone: "UTC" }, refresh: vi.fn() }),
  postJson: vi.fn(),
}));

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = async (overrides: Record<string, unknown>[]) => {
  state.trades = overrides.map((trade, index) => ({
    key: String(index),
    symbol: `TEST${index}`,
    direction: "long",
    status: "win",
    closedAt: "2026-10-01T12:00:00Z",
    quantity: 1,
    avgEntry: 100,
    avgExit: 110,
    netPnl: 10,
    assetClass: "equity",
    contractMultiplier: null,
    tags: [],
    mistakes: [],
    rating: null,
    ...trade,
  }));
  await act(async () => root.render(createElement(TradesPage)));
};
const roiValues = () => {
  const headers = [...container.querySelectorAll("thead th")];
  const index = headers.findIndex((header) => header.textContent === "Net ROI");
  return [...container.querySelectorAll("tbody tr")].map((row) => row.children[index]!.textContent);
};

it("shows the actual MNQ and option returns instead of inflating them by their multipliers", async () => {
  await render([
    { assetClass: "futures", avgEntry: 31157.25, quantity: 4, contractMultiplier: 2, netPnl: 283 },
    { assetClass: "option", avgEntry: 2.47, contractMultiplier: 100, netPnl: -1.3 },
  ]);
  expect(roiValues()).toEqual(["0.11%", "-0.53%"]);
});

it("distinguishes an unknown return from a true zero and supports negative entries", async () => {
  await render([
    { assetClass: "futures" },
    { avgEntry: 0 },
    { avgEntry: -100, netPnl: -10 },
    { netPnl: 0 },
  ]);
  expect(roiValues()).toEqual(["–", "–", "-10.00%", "0.00%"]);
});

it("sorts numerical returns in both directions with unavailable returns last", async () => {
  await render([
    { assetClass: "option" },
    { netPnl: 10 },
    { netPnl: -10 },
    { netPnl: 0 },
    { avgEntry: 0 },
  ]);
  const sort = [...container.querySelectorAll<HTMLButtonElement>("thead button")].find(
    (button) => button.textContent === "Net ROI",
  )!;
  await act(async () => sort.click());
  expect(roiValues()).toEqual(["10.00%", "0.00%", "-10.00%", "–", "–"]);
  await act(async () => sort.click());
  expect(roiValues()).toEqual(["-10.00%", "0.00%", "10.00%", "–", "–"]);
});
