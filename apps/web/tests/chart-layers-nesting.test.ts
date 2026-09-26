import { describe, expect, it } from "vitest";
import {
  addLayer,
  assignDrawings,
  copyNesting,
  defaultLayers,
  descendantsOf,
  drawingStates,
  drawingTree,
  effectiveDrawing,
  layersProblem,
  nestDrawings,
  placeNewDrawing,
  setDrawInto,
  setFocus,
  showEverything,
  syncAssignments,
  unnestDrawings,
  type LayersDocument,
} from "../src/lib/chart-layers";

/** A wave with sub-waves: wave → [a, b], a → [a1]; plus a separate level line. */
const waves = (): LayersDocument => {
  let doc = syncAssignments(defaultLayers(), ["wave", "a", "b", "a1", "level"]);
  doc = nestDrawings(doc, ["a", "b"], "wave");
  return nestDrawings(doc, ["a1"], "a");
};
const all = ["wave", "a", "b", "a1", "level"];

describe("drawings can sit inside other drawings", () => {
  it("sub-waves are listed under their wave with outline numbers", () => {
    const tree = drawingTree(waves(), "layer-main", all);
    expect(tree.map((n) => [n.id, n.index])).toEqual([
      ["wave", "1"],
      ["level", "2"],
    ]);
    expect(tree[0]!.children.map((n) => [n.id, n.index])).toEqual([
      ["a", "1.1"],
      ["b", "1.2"],
    ]);
    expect(tree[0]!.children[0]!.children.map((n) => n.index)).toEqual(["1.1.1"]);
    expect(descendantsOf(waves(), "wave")).toEqual(["a", "a1", "b"]);
  });

  it("a drawing can never go inside itself or something it contains", () => {
    const doc = waves();
    expect(nestDrawings(doc, ["wave"], "a1")).toBe(doc);
    expect(nestDrawings(doc, ["a"], "a")).toBe(doc);
    expect(layersProblem({ ...doc, parents: { x: "y", y: "x" } })).toMatch(/loop/);
    expect(layersProblem(doc)).toBeNull();
  });

  it("a drawing and what is inside it share a layer and move together", () => {
    let doc = addLayer(waves(), "Counts");
    doc = assignDrawings(doc, ["wave"], doc.activeLayerId);
    for (const id of ["wave", "a", "b", "a1"]) expect(doc.assignments[id]).toBe(doc.activeLayerId);
    expect(doc.assignments.level).toBe("layer-main");
    // Moving a sub-wave alone to another layer takes it out of its wave.
    doc = assignDrawings(doc, ["b"], "layer-main");
    expect(doc.parents?.b).toBeUndefined();
    // Nesting into a drawing on another layer brings the drawing to that layer.
    doc = nestDrawings(doc, ["level"], "wave");
    expect(doc.assignments.level).toBe(doc.assignments.wave);
  });

  it("taking a sub-wave out moves it one level up", () => {
    const doc = unnestDrawings(waves(), ["a1"]);
    expect(doc.parents?.a1).toBe("wave");
    expect(unnestDrawings(doc, ["a1"]).parents?.a1).toBeUndefined();
  });

  it("deleting a wave keeps its sub-waves, one level up", () => {
    const doc = syncAssignments(waves(), ["wave", "a1", "b", "level"]);
    expect(doc.parents).toEqual({ a1: "wave", b: "wave" });
    const top = syncAssignments(waves(), ["a", "a1", "level"]);
    expect(top.parents).toEqual({ a1: "a" });
  });

  it("a duplicated wave keeps its duplicated sub-waves inside it", () => {
    let doc = syncAssignments(waves(), [...all, "wave2", "a2", "b2", "a12"]);
    doc = copyNesting(doc, ["wave", "a", "b", "a1"], ["wave2", "a2", "b2", "a12"]);
    expect(doc.parents).toMatchObject({ a2: "wave2", b2: "wave2", a12: "a2" });
  });
});

describe("drawing inside a wave and focusing on it", () => {
  it("new drawings go inside the chosen wave", () => {
    let doc = setDrawInto(waves(), "b");
    doc = placeNewDrawing(doc, "b1");
    expect(doc.parents?.b1).toBe("b");
    expect(placeNewDrawing(setDrawInto(doc, null), "x").parents?.x).toBeUndefined();
  });

  it("focusing shows only the wave and what is inside it", () => {
    const drawings = all.map((id) => ({ id, visible: true, locked: false }));
    const doc = setFocus(waves(), "a", drawings);
    expect(effectiveDrawing(doc, "a").visible).toBe(true);
    expect(effectiveDrawing(doc, "a1").visible).toBe(true);
    expect(effectiveDrawing(doc, "wave").visible).toBe(false);
    expect(effectiveDrawing(doc, "level").visible).toBe(false);
    const patches = drawingStates(doc, drawings, waves());
    expect(patches.map((p) => p.id).sort()).toEqual(["b", "level", "wave"]);
    // While focused, new drawings stay inside the focus instead of vanishing.
    expect(placeNewDrawing(doc, "new").parents?.new).toBe("a");
  });

  it("ending a focus brings back what it hid, but not what you had hidden yourself", () => {
    const before = all.map((id) => ({ id, visible: id !== "level", locked: false }));
    const focused = setFocus(waves(), "a", before);
    const onChart = before.map((d) => ({ ...d, visible: ["a", "a1"].includes(d.id) }));
    const patches = drawingStates(setFocus(focused, null, onChart), onChart, focused);
    expect(
      patches
        .filter((p) => p.visible)
        .map((p) => p.id)
        .sort(),
    ).toEqual(["b", "wave"]);
    expect(showEverything(focused).focusId).toBeUndefined();
  });
});
