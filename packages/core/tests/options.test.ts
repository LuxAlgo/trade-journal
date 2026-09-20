import { describe, expect, it } from "vitest";
import {
  formatOptionSymbol,
  parseExpiry,
  parseOptionSymbol,
  resolveContractMultiplier,
  resolveOptionInstrument,
} from "../src/options";

describe("option contract identity", () => {
  it("parses an OCC option ticker into strike, expiry and right", () => {
    const parsed = parseOptionSymbol("AAPL  250117C00150000");
    expect(parsed).toEqual({
      underlying: "AAPL",
      expiry: "2025-01-17",
      strike: 150,
      right: "C",
    });
    expect(formatOptionSymbol(parsed!)).toBe("AAPL 17JAN25 150 C");
    expect(formatOptionSymbol(parseOptionSymbol("SPXW  260410C06865000")!)).toBe(
      "SPXW 10APR26 6865 C",
    );
  });

  it("parses IBKR's readable option description", () => {
    expect(parseOptionSymbol("AAPL 17JAN25 150 C")).toMatchObject({
      underlying: "AAPL",
      expiry: "2025-01-17",
      strike: 150,
      right: "C",
    });
    expect(parseOptionSymbol("SPY 7JAN26 580.5 PUT")).toMatchObject({
      underlying: "SPY",
      expiry: "2026-01-07",
      strike: 580.5,
      right: "P",
    });
  });

  it("does not treat a stock or futures root as an option", () => {
    expect(parseOptionSymbol("AAPL")).toBeNull();
    expect(parseOptionSymbol("ES")).toBeNull();
    expect(parseOptionSymbol("ES 03-26")).toBeNull();
  });

  it("composes a contract from Flex Query columns when Symbol is only the underlying", () => {
    const resolved = resolveOptionInstrument({
      symbol: "AAPL",
      assetClass: "option",
      expiry: "20260117",
      strike: "150",
      right: "C",
    });
    expect(resolved).toMatchObject({
      symbol: "AAPL 17JAN26 150 C",
      assetClass: "option",
      composed: true,
      missingContract: false,
    });
  });

  it("flags an option that would otherwise net with the underlying ticker", () => {
    const resolved = resolveOptionInstrument({ symbol: "AAPL", assetClass: "option" });
    expect(resolved.symbol).toBe("AAPL");
    expect(resolved.missingContract).toBe(true);
  });

  it("leaves equities untouched", () => {
    expect(resolveOptionInstrument({ symbol: "AAPL", assetClass: "equity" })).toMatchObject({
      symbol: "AAPL",
      assetClass: "equity",
      missingContract: false,
    });
  });

  it("parses Flex expiry flavors", () => {
    expect(parseExpiry("20260117")).toBe("2026-01-17");
    expect(parseExpiry("20260117;093100")).toBe("2026-01-17");
    expect(parseExpiry("17JAN26")).toBe("2026-01-17");
  });
});

describe("option contract multiplier", () => {
  it("defaults equity options to 100 and keeps listed overrides", () => {
    expect(resolveContractMultiplier("AAPL 17JAN25 150 C", "option")).toBe(100);
    expect(
      resolveContractMultiplier("AAPL 17JAN25 150 C", "option", { "AAPL 17JAN25 150 C": 10 }),
    ).toBe(10);
    expect(resolveContractMultiplier("AAPL", "equity")).toBeUndefined();
    expect(resolveContractMultiplier("ES", "futures")).toBeUndefined();
  });
});
