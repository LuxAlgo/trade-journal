import { describe, expect, it } from "vitest";
import { describeChanges } from "../src/lib/analysis-diff";
import { EMPTY_PLAN } from "../src/lib/analysis-plan";
import { defaultLayers, renameDrawing, syncAssignments } from "../src/lib/chart-layers";
import type { StoredDrawing } from "../src/lib/chart-analysis";

const T = Date.UTC(2026, 8, 1, 12, 0);
const line = (id: string, price: number, props?: object): StoredDrawing => ({
  id,
  type: "hline",
  paneId: "price",
  anchors: [{ time: T, price }],
  style: {},
  ...(props ? { props } : {}),
});
const version = (drawings: StoredDrawing[], patch: object = {}) => ({
  drawings: { version: 1 as const, drawings },
  layers: syncAssignments(
    defaultLayers(),
    drawings.map((d) => d.id),
  ),
  zones: [],
  plan: EMPTY_PLAN,
  notes: "",
  ...patch,
});

describe("a thesis is followed from one day's version to the next", () => {
  it("lists drawings added, removed, moved and renamed, with their prices", () => {
    const monday = version([line("a", 100), line("b", 90)]);
    const tuesday = version([line("a", 101), line("c", 120)]);
    tuesday.layers = renameDrawing(tuesday.layers, "c", "Weekly high");
    expect(describeChanges(monday, tuesday)).toEqual([
      "Moved Horizontal line: now at 101",
      'Added Horizontal line "Weekly high": at 120',
      "Removed Horizontal line: at 90",
    ]);
  });

  it("zones, the plan and the notes are followed too", () => {
    const zone = {
      id: "z",
      low: 95,
      high: 97,
      kind: "auto" as const,
      label: "",
      start: 0,
      visible: true,
    };
    const scenario = {
      id: "s",
      name: "Retest",
      direction: "long" as const,
      trigger: 100,
      target: 110,
      invalidation: 95,
      note: "",
    };
    const before = version([], {
      zones: [zone],
      plan: { ...EMPTY_PLAN, scenarios: [scenario] },
      notes: "a",
    });
    const after = version([], {
      zones: [{ ...zone, high: 98 }],
      plan: { bias: "long", playbookId: null, scenarios: [{ ...scenario, target: 115 }] },
      notes: "b",
    });
    expect(describeChanges(before, after)).toEqual([
      "Changed zone 95 to 97 to zone 95 to 98",
      "Bias changed from none to long",
      'Scenario "Retest" (long at 100, target 110, invalid at 95) is now "Retest" (long at 100, target 115, invalid at 95)',
      "Notes rewritten",
    ]);
    expect(describeChanges(before, before)).toEqual([]);
  });
});
