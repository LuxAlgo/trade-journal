import { describe, expect, it } from "vitest";
import * as vela from "@luxalgo/vela";
import { applyPatternFixes } from "../src/components/vela-pattern-fixes";
import { LEGACY_PROP, markLegacyPatterns } from "../src/lib/pattern-fixes";
import type { DrawingsDocument, StoredDrawing } from "../src/lib/chart-analysis";

applyPatternFixes(vela);

type Pattern = vela.Drawing & {
  vertexLabels(): string[];
  anchorSchema(): { min: number; max: number };
};
const points = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ time: i * 60_000, price: 100 + (i % 2 ? 5 : -5) }));
const make = (type: vela.DrawingTypeKey, anchors = 0, props?: Record<string, unknown>) =>
  vela.createDrawing(type, { paneId: "price", anchors: points(anchors), props }) as Pattern;
const legs = (d: Pattern) => d.anchorSchema().max - 1;

describe("Elliott wave tools place one point more than their waves", () => {
  it("draws the impulse as five waves on six points, 0 to 5", () => {
    const impulse = make("elliottimpulse");
    expect(impulse.vertexLabels()).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(impulse.anchorSchema()).toMatchObject({ min: 6, max: 6 });
    expect(legs(impulse)).toBe(5);
  });

  it("draws the correction as three waves on four points, 0 A B C", () => {
    const correction = make("elliottcorrection");
    expect(correction.vertexLabels()).toEqual(["0", "A", "B", "C"]);
    expect(correction.anchorSchema()).toMatchObject({ min: 4, max: 4 });
    expect(legs(correction)).toBe(3);
  });

  it("is complete only once every wave has its end point", () => {
    expect(make("elliottimpulse", 5).isComplete()).toBe(false);
    expect(make("elliottimpulse", 6).isComplete()).toBe(true);
    expect(make("elliottcorrection", 3).isComplete()).toBe(false);
    expect(make("elliottcorrection", 4).isComplete()).toBe(true);
  });

  it("labels the Shark harmonic 0 X A B C without changing its ratios", () => {
    const shark = make("shark", 5) as Pattern & { valid(): boolean | null };
    expect(shark.vertexLabels()).toEqual(["0", "X", "A", "B", "C"]);
    expect(shark.anchorSchema()).toMatchObject({ min: 5, max: 5 });
  });

  it("draws the toolbar icons with one vertex per point", () => {
    const vertices = (type: string) =>
      (vela.getDrawingType(type)!.icon.match(/d="M([^"]+)"/)?.[1] ?? "").trim().split(/\s+/)
        .length / 2;
    expect(vertices("elliottimpulse")).toBe(6);
    expect(vertices("elliottcorrection")).toBe(4);
  });

  it("applies once, however many charts are created", () => {
    const before = vela.getDrawingType("elliottimpulse");
    applyPatternFixes(vela);
    expect(vela.getDrawingType("elliottimpulse")).toBe(before);
  });
});

describe("drawings saved with the old wave tools keep their shape", () => {
  const stored = (type: string, n: number, props?: Record<string, unknown>): StoredDrawing => ({
    id: `dw-${type}-${n}`,
    type,
    paneId: "price",
    anchors: points(n),
    style: { lineColor: "#2962ff", lineWidth: 1, lineStyle: "solid" },
    ...(props ? { props } : {}),
  });

  it("marks only old-count Elliott drawings", () => {
    const doc: DrawingsDocument = {
      version: 1,
      drawings: [
        stored("elliottimpulse", 5),
        stored("elliottimpulse", 6),
        stored("elliottcorrection", 3),
        stored("elliottcorrection", 4),
        stored("shark", 5),
      ],
    };
    const marked = markLegacyPatterns(doc);
    expect(marked.drawings.map((d) => (d.props as Record<string, unknown>)?.[LEGACY_PROP])).toEqual(
      [true, undefined, true, undefined, undefined],
    );
    expect(markLegacyPatterns(marked)).toBe(marked);
    expect(
      markLegacyPatterns({ version: 1, drawings: [stored("hline", 1)] }).drawings[0],
    ).not.toHaveProperty("props");
  });

  it("keeps an old impulse on its five points with its original labels, through save and load", () => {
    const old = vela.deserializeDrawing(
      markLegacyPatterns({ version: 1, drawings: [stored("elliottimpulse", 5)] })
        .drawings[0] as unknown as vela.SerializedDrawing,
    ) as Pattern;
    expect(old.vertexLabels()).toEqual(["1", "2", "3", "4", "5"]);
    expect(old.isComplete()).toBe(true);
    const saved = old.serialize();
    expect(saved.props).toMatchObject({ [LEGACY_PROP]: true });
    const reloaded = vela.deserializeDrawing(saved) as Pattern;
    expect(reloaded.vertexLabels()).toEqual(["1", "2", "3", "4", "5"]);
    expect(reloaded.anchors).toHaveLength(5);
  });

  it("saves new wave drawings without the legacy marker", () => {
    expect(make("elliottimpulse", 6).serialize().props).toBeUndefined();
  });
});
