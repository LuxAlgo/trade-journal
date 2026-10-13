import { describe, expect, it } from "vitest";
import { parseCollapsed, setCollapsed } from "../src/lib/collapsed-sections";

describe("folded page sections are remembered", () => {
  it("everything starts expanded", () => {
    expect(parseCollapsed(null)).toEqual([]);
    expect(parseCollapsed("not json")).toEqual([]);
    expect(parseCollapsed('{"chart-zones":true}')).toEqual([]);
  });

  it("keeps only well-formed section names, once each", () => {
    expect(parseCollapsed(JSON.stringify(["chart-zones", "chart-zones", 3, "Bad Name!"]))).toEqual([
      "chart-zones",
    ]);
  });

  it("folding one section leaves the others as they were", () => {
    const folded = setCollapsed(["chart-alerts"], "chart-zones", true);
    expect(folded).toEqual(["chart-alerts", "chart-zones"]);
    expect(setCollapsed(folded, "chart-zones", true)).toEqual(["chart-alerts", "chart-zones"]);
    expect(setCollapsed(folded, "chart-alerts", false)).toEqual(["chart-zones"]);
  });
});
