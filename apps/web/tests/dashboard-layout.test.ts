import { describe, expect, it } from "vitest";
import {
  moveDashboardCard,
  normalizeArrangement,
  readDashboardPreferences,
  visibleCardIds,
} from "../src/lib/dashboard-layout";

describe("dashboard layout persistence", () => {
  const ids = ["net", "win", "edge", "calendar", "activity"];

  it("preserves a saved order and visibility while adding new cards", () => {
    const current = normalizeArrangement(
      { order: ["edge", "net", "old", "edge", "win"], hidden: ["win", "old", "win"] },
      ids,
    );
    expect(current).toEqual({
      order: ["edge", "net", "win", "calendar", "activity"],
      hidden: ["win"],
    });
    expect(visibleCardIds(current)).toEqual(["edge", "net", "calendar", "activity"]);
  });

  it("recovers incomplete preferences and skips invalid named layouts", () => {
    for (const raw of [null, "null", "[]", '{"current":null,"layouts":null}']) {
      expect(readDashboardPreferences(raw, ids)).toEqual({
        current: { order: ids, hidden: [] },
        layouts: {},
      });
    }
    const state = readDashboardPreferences(
      JSON.stringify({
        current: { order: 7, hidden: {} },
        layouts: { Broken: null, Review: { order: ["edge"], hidden: ["net"] } },
      }),
      ids,
    );
    expect(state.current).toEqual({ order: ids, hidden: [] });
    expect(Object.keys(state.layouts)).toEqual(["Review"]);
    expect(state.layouts.Review?.order).toHaveLength(ids.length);
    expect(() => readDashboardPreferences("invalid json", ids)).toThrow();
  });

  it("moves in both directions and preserves all cards across a saved round trip", () => {
    const start = { order: ids, hidden: [] };
    const moved = moveDashboardCard(start, "net", "edge");
    expect(moved.order).toEqual(["win", "edge", "net", "calendar", "activity"]);
    const loaded = readDashboardPreferences(
      JSON.stringify({ current: moved, layouts: { Review: moved } }),
      ids,
    );
    expect(loaded.current).toEqual(moved);
    expect(moveDashboardCard(loaded.current, "net", "win")).toEqual(start);
    expect(start.order).toEqual(ids);
  });

  it("reorders visible neighbours without getting stuck on a hidden card", () => {
    const start = { order: ids, hidden: ["win"] };
    const moved = moveDashboardCard(start, "net", "edge");
    expect(moved.order).toEqual(["edge", "win", "net", "calendar", "activity"]);
    expect(moved.hidden).toEqual(["win"]);
    expect(visibleCardIds(moved)).toEqual(["edge", "net", "calendar", "activity"]);
  });

  it("does not change the layout for a cancelled, hidden, or unknown drop target", () => {
    const current = { order: ids, hidden: ["win"] };
    for (const to of ["net", "win", "not-a-card"])
      expect(moveDashboardCard(current, "net", to)).toBe(current);
  });
});
