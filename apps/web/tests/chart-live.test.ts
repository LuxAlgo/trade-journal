import { describe, expect, it } from "vitest";
import {
  addFolder,
  addLayer,
  assignDrawing,
  defaultLayers,
  drawingStates,
  drawingsIn,
  effectiveLayer,
  layersProblem,
  moveLayer,
  removeFolder,
  removeLayer,
  setActiveLayer,
  syncAssignments,
  updateFolder,
  updateLayer,
} from "../src/lib/chart-layers";
import { lineCrossings, linePriceAt } from "../src/lib/price-alerts";
import { historyWindow, resolutionForTimeframe, velaProviderName } from "../src/lib/live-market";
import { mergeRecent, parseRecent } from "../src/lib/recent-symbols";
import { drawingLabel } from "../src/lib/chart-analysis";

const drawing = (id: string, visible = true, locked = false) => ({ id, visible, locked });

describe("drawing layers group drawings into folders", () => {
  it("files new layers where the next drawings go", () => {
    const doc = addLayer(defaultLayers(), "Levels");
    expect(doc.layers).toHaveLength(2);
    expect(doc.activeLayerId).toBe(doc.layers[1]!.id);
    expect(layersProblem(doc)).toBeNull();
  });

  it("hides every drawing in a hidden folder and restores them when shown", () => {
    let doc = addFolder(defaultLayers(), "Weekly");
    const folder = doc.folders[0]!.id;
    doc = addLayer(doc, "Supply", folder);
    const layer = doc.activeLayerId;
    doc = assignDrawing(doc, "dw-1", layer);
    const hidden = updateFolder(doc, folder, { visible: false });
    expect(drawingStates(hidden, [drawing("dw-1")], doc)).toEqual([
      { id: "dw-1", visible: false, locked: false },
    ]);
    const shown = updateFolder(hidden, folder, { visible: true });
    expect(drawingStates(shown, [drawing("dw-1", false)], hidden)).toEqual([
      { id: "dw-1", visible: true, locked: false },
    ]);
  });

  it("keeps a drawing's own lock unless its layer forces one", () => {
    const doc = assignDrawing(defaultLayers(), "dw-1", "layer-main");
    expect(drawingStates(doc, [drawing("dw-1", true, true)])).toEqual([]);
    const locked = updateLayer(doc, "layer-main", { locked: true });
    expect(drawingStates(locked, [drawing("dw-1")], doc)).toEqual([
      { id: "dw-1", visible: true, locked: true },
    ]);
    expect(drawingStates(doc, [drawing("dw-1", true, true)], locked)).toEqual([
      { id: "dw-1", visible: true, locked: false },
    ]);
  });

  it("re-applies layer state after an undo restored an older snapshot", () => {
    const hidden = updateLayer(assignDrawing(defaultLayers(), "dw-1", "layer-main"), "layer-main", {
      visible: false,
    });
    expect(drawingStates(hidden, [drawing("dw-1", true)])).toEqual([
      { id: "dw-1", visible: false, locked: false },
    ]);
  });

  it("reveals and unlocks a layer chosen for drawing, with its folder", () => {
    let doc = addFolder(defaultLayers(), "Ideas");
    doc = addLayer(doc, "Draft", doc.folders[0]!.id);
    const layer = doc.activeLayerId;
    doc = updateFolder(
      updateLayer(doc, layer, { visible: false, locked: true }),
      doc.folders[0]!.id,
      {
        visible: false,
      },
    );
    const active = setActiveLayer(setActiveLayer(doc, "layer-main"), layer);
    expect(
      effectiveLayer(
        active,
        active.layers.find((l) => l.id === layer)!,
      ),
    ).toEqual({
      visible: true,
      locked: false,
    });
  });

  it("moves or deletes a removed layer's drawings, and never removes the last layer", () => {
    let doc = addLayer(defaultLayers(), "Temp");
    const temp = doc.activeLayerId;
    doc = assignDrawing(assignDrawing(doc, "dw-1", temp), "dw-2", "layer-main");
    const moved = removeLayer(doc, temp, "layer-main");
    expect(moved.deleteDrawings).toEqual([]);
    expect(drawingsIn(moved.doc, "layer-main", ["dw-1", "dw-2"])).toEqual(["dw-1", "dw-2"]);
    expect(moved.doc.activeLayerId).toBe("layer-main");
    const deleted = removeLayer(doc, temp, null);
    expect(deleted.deleteDrawings).toEqual(["dw-1"]);
    expect(removeLayer(defaultLayers(), "layer-main", null).doc.layers).toHaveLength(1);
  });

  it("keeps a deleted folder's layers at the top level", () => {
    let doc = addFolder(defaultLayers(), "Old");
    const folder = doc.folders[0]!.id;
    doc = addLayer(doc, "Kept", folder);
    const next = removeFolder(doc, folder);
    expect(next.folders).toEqual([]);
    expect(next.layers.find((l) => l.name === "Kept")!.folderId).toBeNull();
    expect(layersProblem(next)).toBeNull();
  });

  it("reorders layers within their own group", () => {
    let doc = addLayer(defaultLayers(), "B");
    doc = addLayer(doc, "C");
    expect(moveLayer(doc, doc.layers[2]!.id, -1).layers.map((l) => l.name)).toEqual([
      "Main",
      "C",
      "B",
    ]);
    expect(moveLayer(doc, doc.layers[0]!.id, -1)).toBe(doc);
  });

  it("gives older or Vela-created drawings the active layer and forgets deleted ones", () => {
    const doc = assignDrawing(defaultLayers(), "gone", "layer-main");
    const synced = syncAssignments(doc, ["dw-7"]);
    expect(synced.assignments).toEqual({ "dw-7": "layer-main" });
    expect(syncAssignments(synced, ["dw-7"])).toBe(synced);
  });

  it("rejects stored layers that point nowhere", () => {
    expect(layersProblem({ ...defaultLayers(), activeLayerId: "missing" })).not.toBeNull();
    expect(
      layersProblem({ ...defaultLayers(), assignments: { "dw-1": "missing" } }),
    ).not.toBeNull();
    expect(
      layersProblem({
        ...defaultLayers(),
        layers: [{ ...defaultLayers().layers[0]!, folderId: "nowhere" }],
      }),
    ).not.toBeNull();
    expect(layersProblem({ ...defaultLayers(), layers: [] })).not.toBeNull();
  });
});

describe("line alerts fire when a live close crosses a drawn line", () => {
  const hline = { id: "h", type: "hline", anchors: [{ time: 0, price: 100 }] };
  const trend = {
    id: "t",
    type: "trendline",
    anchors: [
      { time: 1000, price: 100 },
      { time: 2000, price: 110 },
    ],
  };

  it("detects upward and downward crossings of horizontal lines", () => {
    expect(lineCrossings([hline], { time: 1, close: 99 }, { time: 2, close: 101 })).toEqual([
      { drawingId: "h", type: "hline", price: 100, direction: "up", time: 2 },
    ]);
    expect(
      lineCrossings([hline], { time: 1, close: 101 }, { time: 2, close: 100 })[0]!.direction,
    ).toBe("down");
    expect(lineCrossings([hline], { time: 1, close: 100 }, { time: 2, close: 100 })).toEqual([]);
    expect(lineCrossings([hline], { time: 1, close: 101 }, { time: 2, close: 102 })).toEqual([]);
  });

  it("prices trend lines along their slope and only within their span", () => {
    expect(linePriceAt(trend, 1500)).toBe(105);
    expect(linePriceAt(trend, 2500)).toBeNull();
    expect(linePriceAt({ ...trend, type: "extendedline" }, 2500)).toBe(115);
    expect(linePriceAt({ ...trend, type: "ray" }, 500)).toBeNull();
    expect(
      lineCrossings([trend], { time: 1400, close: 103 }, { time: 1600, close: 107 }),
    ).toHaveLength(1);
  });

  it("ignores hidden lines and shapes that are not lines", () => {
    expect(
      lineCrossings(
        [{ ...hline, visible: false }],
        { time: 1, close: 99 },
        { time: 2, close: 101 },
      ),
    ).toEqual([]);
    expect(
      lineCrossings([{ ...hline, type: "box" }], { time: 1, close: 99 }, { time: 2, close: 101 }),
    ).toEqual([]);
  });
});

describe("live charts ask for the latest candles without dates", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");

  it("asks for the latest candles when Vela names no start", () => {
    expect(historyWindow({ limit: 500 }, now)).toEqual({ to: now, limit: 500 });
    expect(historyWindow({ to: now - 1000, limit: 50_000 }, now)).toEqual({
      to: now - 1000,
      limit: 5000,
    });
  });

  it("passes an explicit window through, never past now", () => {
    expect(historyWindow({ from: now - 60_000, to: now + 60_000 }, now)).toEqual({
      from: now - 60_000,
      to: now,
    });
  });

  it("maps Vela timeframes and provider names", () => {
    expect(resolutionForTimeframe("1D")).toBe("1d");
    expect(resolutionForTimeframe("60")).toBe("1h");
    expect(resolutionForTimeframe("240")).toBeNull();
    expect(velaProviderName("london-strategic-edge")).toBe("london_strategic_edge");
  });
});

describe("recent symbols", () => {
  it("keeps the newest first without duplicates", () => {
    const a = { provider: "binance", dataset: null, symbol: "BTCUSDT" };
    const b = { provider: "alpaca", dataset: "iex", symbol: "AAPL" };
    expect(mergeRecent(mergeRecent([a], b), a)).toEqual([a, b]);
    expect(parseRecent(JSON.stringify([a, { provider: 1 }, b]))).toEqual([a, b]);
    expect(parseRecent("nope")).toEqual([]);
  });
});

describe("drawing labels", () => {
  it("names drawings for the layers panel and alerts", () => {
    expect(drawingLabel("hline")).toBe("Horizontal line");
    expect(drawingLabel("text", "  Buy\\nzone ")).toBe("Text: Buy\\nzone");
    expect(drawingLabel("gannfan")).toBe("Gannfan");
  });
});
