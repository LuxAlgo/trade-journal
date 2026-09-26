import { describe, expect, it, vi } from "vitest";
import { createChartSync } from "../src/lib/chart-sync";
import { DEFAULT_MULTIVIEW, paneMarket, parseMultiview } from "../src/lib/multiview";

describe("multiview is an option you turn on", () => {
  it("starts as a single chart", () => {
    expect(DEFAULT_MULTIVIEW.enabled).toBe(false);
    expect(parseMultiview(null)).toEqual(DEFAULT_MULTIVIEW);
    expect(parseMultiview("not json")).toEqual(DEFAULT_MULTIVIEW);
  });

  it("restores a saved layout and drops anything unknown", () => {
    const saved = parseMultiview(
      JSON.stringify({
        enabled: true,
        arrangement: "row",
        count: 9,
        panes: [
          { symbol: "ETHUSDT", resolution: "4h", indicators: ["rsi", "made-up", 3] },
          { symbol: "", resolution: null, indicators: "rsi" },
        ],
        sync: { crosshair: false, time: true },
        mirrorDrawings: false,
      }),
    );
    expect(saved).toMatchObject({
      enabled: true,
      arrangement: "row",
      count: 3,
      sync: { crosshair: false, time: true },
      mirrorDrawings: false,
    });
    expect(saved.panes[0]).toMatchObject({
      symbol: "ETHUSDT",
      resolution: "4h",
      indicators: ["rsi"],
    });
    // An empty symbol follows the main chart; a missing list keeps the default indicators.
    expect(saved.panes[1]).toMatchObject({ symbol: null, resolution: null, indicators: ["macd"] });
    expect(saved.panes).toHaveLength(3);
  });

  it("extra charts follow the main chart's symbol and candle size unless set", () => {
    const main = { symbol: "BTCUSDT", resolution: "1h" as const };
    expect(paneMarket({ id: "p", symbol: null, resolution: null, indicators: [] }, main)).toEqual(
      main,
    );
    expect(
      paneMarket({ id: "p", symbol: " ETHUSDT ", resolution: "4h", indicators: [] }, main),
    ).toEqual({
      symbol: "ETHUSDT",
      resolution: "4h",
    });
  });
});

describe("charts in a multiview stay in step", () => {
  const setup = () => {
    const sync = createChartSync({ crosshair: true, time: false });
    const main = { crosshair: vi.fn(), range: vi.fn() };
    const other = { crosshair: vi.fn(), range: vi.fn() };
    sync.subscribe("main", main);
    sync.subscribe("pane-1", other);
    return { sync, main, other };
  };

  it("a crosshair shows on the other charts, never echoed back", () => {
    const { sync, main, other } = setup();
    sync.crosshair("main", 1000);
    expect(other.crosshair).toHaveBeenCalledWith(1000);
    expect(main.crosshair).not.toHaveBeenCalled();
  });

  it("the time window follows only when time sync is on", () => {
    const { sync, other } = setup();
    sync.range("main", { from: 1, to: 2 });
    expect(other.range).not.toHaveBeenCalled();
    sync.setOptions({ crosshair: true, time: true });
    sync.range("main", { from: 1, to: 2 });
    expect(other.range).toHaveBeenCalledWith({ from: 1, to: 2 });
  });

  it("turning crosshair sync off clears the crosshairs it was showing", () => {
    const { sync, main, other } = setup();
    sync.setOptions({ crosshair: false, time: false });
    expect(other.crosshair).toHaveBeenLastCalledWith(null);
    expect(main.crosshair).toHaveBeenLastCalledWith(null);
    other.crosshair.mockClear();
    sync.crosshair("main", 5);
    expect(other.crosshair).not.toHaveBeenCalled();
  });

  it("a closed chart stops receiving", () => {
    const sync = createChartSync({ crosshair: true, time: true });
    const handler = { crosshair: vi.fn() };
    const off = sync.subscribe("pane-1", handler);
    off();
    sync.crosshair("main", 1);
    expect(handler.crosshair).not.toHaveBeenCalled();
  });
});
