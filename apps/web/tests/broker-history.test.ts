import { describe, expect, it } from "vitest";
import { expiredOptionCloses, keepWithinHistory, type SyncedFill } from "@/server/broker-history";

const stock = (side: "buy" | "sell", quantity: number, day: number): SyncedFill => ({
  symbol: "ABC",
  side,
  quantity,
  executedAt: `2026-10-${String(day).padStart(2, "0")}T15:00:00.000Z`,
  assetClass: "equity",
});
const option = (
  side: "buy" | "sell",
  quantity: number,
  day: number,
  positionEffect: "open" | "close",
): SyncedFill => ({
  ...stock(side, quantity, day),
  symbol: "XYZ 261218C50",
  assetClass: "option",
  positionEffect,
});
const flat = () => 0;
const kept = (map: Map<number, number>) => Object.fromEntries(map);

describe("fills that reach back before the broker's history", () => {
  it("a sale of shares bought before the history is dropped rather than booked as a short", () => {
    expect(kept(keepWithinHistory([], [stock("sell", 7, 1)], flat))).toEqual({ 0: 0 });
  });

  it("a short the broker still reports is kept", () => {
    expect(keepWithinHistory([], [stock("sell", 7, 1)], () => -7).size).toBe(0);
  });

  it("a position opened and closed inside the history is kept", () => {
    expect(keepWithinHistory([], [stock("sell", 7, 1), stock("buy", 7, 2)], flat).size).toBe(0);
  });

  it("selling more than the history bought keeps the part the history covers", () => {
    const fresh = [
      stock("buy", 1, 1),
      stock("sell", 3, 2),
      stock("buy", 1, 5),
      stock("sell", 1, 6),
    ];
    expect(kept(keepWithinHistory([], fresh, flat))).toEqual({ 1: 1 });
  });

  it("the same holds when the buy was journaled by an earlier sync", () => {
    expect(kept(keepWithinHistory([stock("buy", 1, 1)], [stock("sell", 3, 2)], flat))).toEqual({
      0: 1,
    });
  });

  it("a flip the broker still shows is kept whole", () => {
    expect(keepWithinHistory([], [stock("buy", 1, 1), stock("sell", 2, 2)], () => -1).size).toBe(0);
  });

  it("a labeled close with nothing open is dropped, and one closing more than was opened is cut back", () => {
    const fresh = [
      option("sell", 2, 1, "close"),
      option("buy", 1, 2, "open"),
      option("sell", 3, 3, "close"),
    ];
    expect(kept(keepWithinHistory([], fresh, () => undefined))).toEqual({ 0: 0, 2: 1 });
  });

  it("a labeled close against an open journaled earlier is kept", () => {
    const stored = [option("buy", 1, 1, "open")];
    expect(keepWithinHistory(stored, [option("sell", 1, 2, "close")], () => undefined).size).toBe(
      0,
    );
  });

  it("a broker without a complete position list keeps every unlabeled fill", () => {
    expect(keepWithinHistory([], [stock("sell", 7, 1)], () => undefined).size).toBe(0);
  });

  it("separately held positions on one symbol replay apart", () => {
    const long = (
      side: "buy" | "sell",
      quantity: number,
      day: number,
      effect: "open" | "close",
    ) => ({
      ...stock(side, quantity, day),
      group: "long",
      positionEffect: effect,
    });
    const short = (
      side: "buy" | "sell",
      quantity: number,
      day: number,
      effect: "open" | "close",
    ) => ({
      ...stock(side, quantity, day),
      group: "short",
      positionEffect: effect,
    });
    // Covering the short must not read as closing the long, or the other way round.
    const fresh = [
      long("buy", 1, 1, "open"),
      short("sell", 2, 2, "open"),
      long("sell", 1, 3, "close"),
    ];
    expect(keepWithinHistory([], fresh, flat).size).toBe(0);
  });
});

describe("options that expire while held", () => {
  const now = "2026-10-26T12:00:00.000Z";
  const held = (symbol: string, side: "buy" | "sell", day: string): SyncedFill => ({
    symbol,
    side,
    quantity: 2,
    executedAt: `${day}T15:00:00.000Z`,
    assetClass: "option",
  });

  it("close at 0 at the 4pm New York expiry, in summer and in winter", () => {
    expect(
      expiredOptionCloses(
        [held("AAA 260717C60", "buy", "2026-07-01"), held("BBB 251219P20", "sell", "2025-12-01")],
        now,
      ),
    ).toEqual([
      {
        symbol: "AAA 260717C60",
        side: "sell",
        quantity: 2,
        executedAt: "2026-07-17T20:00:00.000Z",
        assetClass: "option",
      },
      {
        symbol: "BBB 251219P20",
        side: "buy",
        quantity: 2,
        executedAt: "2025-12-19T21:00:00.000Z",
        assetClass: "option",
      },
    ]);
  });

  it("leave alone contracts already closed or not yet expired", () => {
    const closed = [
      held("CCC 260918C10", "buy", "2026-09-01"),
      held("CCC 260918C10", "sell", "2026-09-02"),
    ];
    expect(
      expiredOptionCloses([...closed, held("DDD 261218C10", "buy", "2026-10-01")], now),
    ).toEqual([]);
  });
});
