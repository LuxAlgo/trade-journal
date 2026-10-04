import { describe, expect, it } from "vitest";
import { netReturnOnNotional } from "../src/analysis";

describe("net return on entry notional", () => {
  it("applies the futures contract multiplier", () => {
    // 4 MNQ at 31,157.25 ($2/point): notional $249,258; net $283
    const r = netReturnOnNotional({
      netPnl: 283,
      avgEntry: 31157.25,
      quantity: 4,
      contractMultiplier: 2,
      assetClass: "futures",
    });
    expect(r).toBeCloseTo(283 / 249258, 10);
  });

  it("applies the option contract size", () => {
    // 6 spreads sold at a 2.01 credit (100 shares each): notional $1,206; net $296.40
    const r = netReturnOnNotional({
      netPnl: 296.4,
      avgEntry: 2.01,
      quantity: 6,
      contractMultiplier: 100,
      assetClass: "option",
    });
    expect(r).toBeCloseTo(296.4 / 1206, 10);
  });

  it("is unknown, not a wrong number, when a multiplier-priced trade has no multiplier", () => {
    for (const assetClass of ["futures", "option", "forex", "cfd"]) {
      expect(
        netReturnOnNotional({ netPnl: 100, avgEntry: 50, quantity: 1, assetClass }),
      ).toBeNull();
    }
  });

  it("treats equities and crypto as one unit per share or coin", () => {
    expect(
      netReturnOnNotional({ netPnl: 50, avgEntry: 100, quantity: 10, assetClass: "equity" }),
    ).toBeCloseTo(0.05, 10);
    expect(netReturnOnNotional({ netPnl: 50, avgEntry: 100, quantity: 10 })).toBeCloseTo(0.05, 10);
  });

  it("uses the absolute entry price (negative-priced spreads and calendars)", () => {
    expect(
      netReturnOnNotional({
        netPnl: 25,
        avgEntry: -0.5,
        quantity: 1,
        contractMultiplier: 100,
        assetClass: "option",
      }),
    ).toBeCloseTo(0.5, 10);
  });

  it("is unknown for a zero notional instead of showing 0%", () => {
    expect(
      netReturnOnNotional({ netPnl: 10, avgEntry: 0, quantity: 3, assetClass: "equity" }),
    ).toBeNull();
  });
});
