import { expect, it } from "vitest";
import { netReturnOnEntry } from "../src";

const equity = { avgEntry: 100, quantity: 2, netPnl: 20, assetClass: "equity" };

it("measures futures and option returns against the full entry value including fees", () => {
  expect(
    netReturnOnEntry({
      avgEntry: 31157.25,
      quantity: 4,
      netPnl: 283,
      assetClass: "futures",
      contractMultiplier: 2,
    }),
  ).toBeCloseTo(283 / 249258, 12);
  expect(
    netReturnOnEntry({
      avgEntry: 2.47,
      quantity: 1,
      netPnl: -1.3,
      assetClass: "option",
      contractMultiplier: 100,
    }),
  ).toBeCloseTo(-1.3 / 247, 12);
});

it.each(["futures", "option", "forex", "cfd"])(
  "requires a known multiplier for %s",
  (assetClass) => {
    for (const contractMultiplier of [undefined, null])
      expect(netReturnOnEntry({ ...equity, assetClass, contractMultiplier })).toBeNull();
    expect(netReturnOnEntry({ ...equity, assetClass, contractMultiplier: 10 })).toBe(0.01);
  },
);

it.each(["equity", "crypto", "other", null, undefined])(
  "preserves unit pricing for %s",
  (assetClass) => {
    expect(netReturnOnEntry({ ...equity, assetClass })).toBe(0.1);
    expect(netReturnOnEntry({ ...equity, assetClass, contractMultiplier: 2 })).toBe(0.05);
  },
);

it("uses absolute entry value while preserving the sign of net P&L", () => {
  expect(netReturnOnEntry({ ...equity, avgEntry: -100 })).toBe(0.1);
  expect(netReturnOnEntry({ ...equity, avgEntry: -100, netPnl: -20 })).toBe(-0.1);
  expect(netReturnOnEntry({ ...equity, netPnl: 0 })).toBe(0);
  expect(netReturnOnEntry({ ...equity, quantity: 0.5 })).toBe(0.4);
});

it("leaves zero or invalid entry values unavailable instead of inventing a return", () => {
  for (const avgEntry of [0, NaN, Infinity, -Infinity])
    expect(netReturnOnEntry({ ...equity, avgEntry })).toBeNull();
  for (const quantity of [0, -1, NaN, Infinity])
    expect(netReturnOnEntry({ ...equity, quantity })).toBeNull();
  for (const contractMultiplier of [0, -1, NaN, Infinity])
    expect(netReturnOnEntry({ ...equity, contractMultiplier })).toBeNull();
  for (const netPnl of [NaN, Infinity, -Infinity])
    expect(netReturnOnEntry({ ...equity, netPnl })).toBeNull();
});

it("does not return infinity when arithmetic exceeds the supported range", () => {
  expect(netReturnOnEntry({ ...equity, avgEntry: Number.MAX_VALUE })).toBeNull();
  expect(netReturnOnEntry({ ...equity, avgEntry: Number.MIN_VALUE, quantity: 0.1 })).toBeNull();
  expect(netReturnOnEntry({ ...equity, avgEntry: Number.MIN_VALUE })).toBeNull();
});
