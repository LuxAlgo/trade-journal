import { describe, expect, it } from "vitest";
import { buildRoundTrips } from "../src/round-trips";
import { isOccOptionSymbol, resolveMultiplier } from "../src/multipliers";
import { fill } from "./helpers";

describe("an equity option is a 100-share contract unless the table says otherwise", () => {
  it("recognises OCC symbols, padded or not, and nothing else", () => {
    expect(isOccOptionSymbol("CRDO  261030P00170000")).toBe(true);
    expect(isOccOptionSymbol("SPY261219C00600000")).toBe(true);
    expect(isOccOptionSymbol("BRK.B 270115C00500000")).toBe(true);
    // Negative controls: a detector matching everything passes every positive case.
    for (const s of ["CRDO", "ES DEC26", "MNQ", "CRDO  261030X00170000", "CRDO  2610P00170000"])
      expect(isOccOptionSymbol(s)).toBe(false);
  });

  it("the configured table wins; an unknown non-option symbol stays unresolved", () => {
    expect(resolveMultiplier("CRDO  261030P00170000")).toBe(100);
    expect(resolveMultiplier("CRDO  261030P00170000", { "CRDO  261030P00170000": 10 })).toBe(10);
    expect(resolveMultiplier("NQ", { NQ: 20 })).toBe(20);
    expect(resolveMultiplier("AAPL", { NQ: 20 })).toBeUndefined();
  });

  it("a short put bought back for less books per-contract dollars, not per-share", () => {
    const sym = "CRDO  261030P00170000";
    const trips = buildRoundTrips([
      fill(sym, "sell", 2, 7.8, "2026-09-30T15:44:51Z", { assetClass: "option" }),
      fill(sym, "buy", 2, 3.8, "2026-10-10T15:00:00Z", { assetClass: "option" }),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]!.grossPnl).toBeCloseTo(800, 6);
    expect(trips[0]!.contractMultiplier).toBe(100);
  });
});
