import { describe, expect, it, vi } from "vitest";
import { createChartSync } from "../src/lib/chart-sync";
import { multiviewLayout } from "../src/components/multiview";
import {
  DEFAULT_MULTIVIEW,
  paneStart,
  parseMultiview,
  type MultiviewState,
} from "../src/lib/multiview";

describe("multiview is an option you turn on", () => {
  it("starts as a single chart", () => {
    expect(DEFAULT_MULTIVIEW.enabled).toBe(false);
    expect(parseMultiview(null)).toEqual(DEFAULT_MULTIVIEW);
    expect(parseMultiview("not json")).toEqual(DEFAULT_MULTIVIEW);
  });

  it("restores what each extra chart showed and drops anything unknown", () => {
    const saved = parseMultiview(
      JSON.stringify({
        enabled: true,
        arrangement: "stack",
        count: 9,
        panes: [
          {
            id: "pane-1",
            provider: "binance",
            dataset: null,
            symbol: "ETHUSDT",
            resolution: "4h",
            analysisId: "a1",
          },
          { id: "pane-2", symbol: "", resolution: "made-up", analysisId: 3 },
        ],
        sync: { crosshair: false, time: true },
      }),
    );
    expect(saved).toMatchObject({
      enabled: true,
      arrangement: "stack",
      count: 3,
      sync: { crosshair: false, time: true },
    });
    expect(saved.panes[0]).toEqual({
      id: "pane-1",
      provider: "binance",
      dataset: null,
      symbol: "ETHUSDT",
      resolution: "4h",
      analysisId: "a1",
    });
    // An empty symbol follows the first chart; a bad candle size keeps the default.
    expect(saved.panes[1]).toMatchObject({ symbol: null, resolution: "15m", analysisId: null });
    expect(saved.panes).toHaveLength(3);
  });

  it("a closed chart keeps its place at the end", () => {
    const saved = parseMultiview(
      JSON.stringify({
        enabled: true,
        panes: [{ id: "pane-2" }, { id: "pane-3" }, { id: "pane-1" }],
      }),
    );
    expect(saved.panes.map((p) => p.id)).toEqual(["pane-2", "pane-3", "pane-1"]);
  });

  it("earlier layouts still open", () => {
    const old = (arrangement: string) =>
      parseMultiview(JSON.stringify({ enabled: true, arrangement, mirrorDrawings: true }));
    expect(old("column").arrangement).toBe("grid");
    expect(old("row").arrangement).toBe("focus");
    // Earlier panes without ids keep their order.
    const panes = parseMultiview(
      JSON.stringify({ panes: [{ symbol: "SOLUSDT", resolution: null, indicators: ["rsi"] }] }),
    ).panes;
    expect(panes[0]).toMatchObject({ id: "pane-1", symbol: "SOLUSDT", resolution: null });
  });

  it("an extra chart follows the first chart's symbol until it has its own", () => {
    const main = { provider: "binance", dataset: null, symbol: "BTCUSDT" };
    const pane = DEFAULT_MULTIVIEW.panes[0]!;
    expect(paneStart(pane, main, "5m")).toEqual({ ...main, resolution: "4h", analysisId: null });
    expect(paneStart({ ...pane, resolution: null }, main, "5m")?.resolution).toBe("5m");
    // Nothing to follow yet.
    expect(paneStart(pane, null, "5m")).toBeNull();
    const own = { ...pane, provider: "csv", dataset: "file-1", symbol: "ES", analysisId: "a2" };
    expect(paneStart(own, main, "5m")).toEqual({
      provider: "csv",
      dataset: "file-1",
      symbol: "ES",
      resolution: "4h",
      analysisId: "a2",
    });
    // A symbol without a source uses the first chart's source.
    expect(paneStart({ ...pane, symbol: "ETHUSDT" }, main, "5m")).toMatchObject({
      provider: "binance",
      symbol: "ETHUSDT",
    });
  });
});

describe("multiview layouts", () => {
  const state = (count: number, arrangement: MultiviewState["arrangement"]) => ({
    ...DEFAULT_MULTIVIEW,
    enabled: true,
    count,
    arrangement,
  });

  it("a single chart keeps its full size", () => {
    const layout = multiviewLayout(DEFAULT_MULTIVIEW);
    expect(layout.total).toBe(1);
    expect(layout.cell(0).size).toBe("full");
  });

  it("the first chart stays large when the others sit below it", () => {
    const layout = multiviewLayout(state(3, "focus"));
    expect(layout.total).toBe(4);
    expect(layout.cell(0).size).toBe("full");
    expect(layout.cell(1).size).toBe("pane");
  });

  it("in a grid, an odd chart out takes the whole last row", () => {
    const layout = multiviewLayout(state(2, "grid"));
    expect(layout.cell(2).cell).toContain("col-span-2");
    expect(layout.cell(1).cell).not.toContain("col-span-2");
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
