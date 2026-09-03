import { describe, expect, it } from "vitest";
import { buildRoundTrips } from "../src/round-trips";
import { fill } from "./helpers";

describe("round trips: a trade is one position cycle, flat to flat", () => {
  it("a buy followed by a full sell is one closed long trade with the correct profit", () => {
    const trips = buildRoundTrips([
      fill("AAPL", "buy", 100, 10, "2026-01-05T14:30:00Z", { fee: 1 }),
      fill("AAPL", "sell", 100, 12, "2026-01-05T15:30:00Z", { fee: 1 }),
    ]);
    expect(trips).toHaveLength(1);
    const trade = trips[0]!;
    expect(trade.direction).toBe("long");
    expect(trade.status).toBe("win");
    expect(trade.grossPnl).toBe(200);
    expect(trade.fees).toBe(2);
    expect(trade.netPnl).toBe(198);
    expect(trade.avgEntry).toBe(10);
    expect(trade.avgExit).toBe(12);
    expect(trade.durationMs).toBe(3_600_000);
  });

  it("selling first opens a short, and profit is made when price falls", () => {
    const trips = buildRoundTrips([
      fill("EURUSD", "sell", 10_000, 1.1, "2026-02-02T08:00:00Z"),
      fill("EURUSD", "buy", 10_000, 1.09, "2026-02-02T09:00:00Z"),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]!.direction).toBe("short");
    expect(trips[0]!.netPnl).toBeCloseTo(100, 6);
    expect(trips[0]!.status).toBe("win");
  });

  it("a position that never returns to flat stays an open trade with no exit stats", () => {
    const trips = buildRoundTrips([
      fill("BTC", "buy", 0.5, 60_000, "2026-03-01T00:00:00Z"),
      fill("BTC", "buy", 0.5, 62_000, "2026-03-02T00:00:00Z"),
    ]);
    expect(trips).toHaveLength(1);
    const trade = trips[0]!;
    expect(trade.status).toBe("open");
    expect(trade.openQuantity).toBeCloseTo(1, 9);
    expect(trade.avgEntry).toBe(61_000);
    expect(trade.avgExit).toBeUndefined();
    expect(trade.closedAt).toBeUndefined();
  });

  it("a fill that crosses through flat splits into two trades and splits its fee pro-rata", () => {
    const trips = buildRoundTrips([
      fill("ES", "buy", 2, 5000, "2026-04-01T14:00:00Z"),
      // Sell 6: 2 close the long, 4 open a short. Fee 3 → 1 to the close, 2 to the open.
      fill("ES", "sell", 6, 5010, "2026-04-01T15:00:00Z", { fee: 3 }),
      fill("ES", "buy", 4, 5005, "2026-04-01T16:00:00Z"),
    ]);
    expect(trips).toHaveLength(2);
    const [longTrade, shortTrade] = trips;
    expect(longTrade!.direction).toBe("long");
    expect(longTrade!.grossPnl).toBe(20);
    expect(longTrade!.fees).toBeCloseTo(1, 9);
    expect(shortTrade!.direction).toBe("short");
    expect(shortTrade!.grossPnl).toBe(20);
    expect(shortTrade!.fees).toBeCloseTo(2, 9);
  });

  it("total P&L of a completed cycle is identical under FIFO, LIFO, and weighted average", () => {
    const executions = [
      fill("TSLA", "buy", 100, 200, "2026-05-01T14:00:00Z"),
      fill("TSLA", "buy", 100, 210, "2026-05-01T14:30:00Z"),
      fill("TSLA", "sell", 50, 215, "2026-05-01T15:00:00Z"),
      fill("TSLA", "sell", 150, 220, "2026-05-01T16:00:00Z"),
    ];
    const results = (["fifo", "lifo", "wavg"] as const).map(
      (method) => buildRoundTrips(executions, { method })[0]!.netPnl,
    );
    expect(results[0]).toBeCloseTo(results[1]!, 6);
    expect(results[1]).toBeCloseTo(results[2]!, 6);
    // (215-200)*50 + first exit remainder... total = 50*215 + 150*220 - (100*200 + 100*210) = 2750
    expect(results[0]).toBeCloseTo(2750, 6);
  });

  it("FIFO and LIFO attribute a partial exit to different entry lots", () => {
    const executions = [
      fill("NQ", "buy", 1, 100, "2026-06-01T14:00:00Z"),
      fill("NQ", "buy", 1, 110, "2026-06-01T14:10:00Z"),
      fill("NQ", "sell", 1, 120, "2026-06-01T14:20:00Z"),
    ];
    const fifo = buildRoundTrips(executions, { method: "fifo" })[0]!;
    const lifo = buildRoundTrips(executions, { method: "lifo" })[0]!;
    expect(fifo.exits[0]!.grossPnl).toBe(20); // matched the 100 lot
    expect(lifo.exits[0]!.grossPnl).toBe(10); // matched the 110 lot
  });

  it("results are deterministic regardless of the order executions arrive in", () => {
    const executions = [
      fill("SPY", "buy", 10, 500, "2026-07-01T14:00:00Z"),
      fill("SPY", "sell", 10, 505, "2026-07-01T15:00:00Z"),
      fill("SPY", "buy", 5, 501, "2026-07-02T14:00:00Z"),
      fill("SPY", "sell", 5, 499, "2026-07-02T15:00:00Z"),
    ];
    const forward = buildRoundTrips(executions);
    const shuffled = buildRoundTrips([
      executions[3]!,
      executions[0]!,
      executions[2]!,
      executions[1]!,
    ]);
    expect(shuffled).toEqual(forward);
  });

  it("trade matching does not depend on the input order of fills", () => {
    // Three fills share one timestamp: two carry an import order, one has no
    // metadata at all. Only a total order over (time, import order, id) keeps
    // the matching identical no matter how the fills arrive.
    const at = "2026-08-03T14:00:00Z";
    const ordered0 = fill("CL", "buy", 10, 100, at, {
      id: "z",
      source: "import",
      importMetadata: { id: "z", order: 0 },
    });
    const ordered1 = fill("CL", "sell", 10, 110, at, {
      id: "a",
      source: "import",
      importMetadata: { id: "a", order: 1 },
    });
    const unordered = fill("CL", "buy", 10, 105, at, { id: "m" });
    const later = fill("CL", "sell", 10, 120, "2026-08-03T15:00:00Z", { id: "w" });

    const arrangements = [
      [ordered0, ordered1, unordered, later],
      [unordered, ordered0, ordered1, later],
      [later, ordered1, unordered, ordered0],
    ];
    const [first, second, third] = arrangements.map((fills) => buildRoundTrips(fills));
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // Ordered fills come first, so the 100 -> 110 cycle closes before the 105 entry.
    expect(first!.map((t) => t.netPnl)).toEqual([100, 150]);
  });

  it("two separately reported positions in one account and symbol do not net against each other", () => {
    const trips = buildRoundTrips([
      fill("EURUSD", "buy", 1, 1.1, "2026-02-02T08:00:00Z", {
        source: "import",
        importMetadata: { id: "p1-entry", group: "position-1", order: 0 },
      }),
      fill("EURUSD", "sell", 1, 1.2, "2026-02-02T09:00:00Z", {
        source: "import",
        importMetadata: { id: "p2-entry", group: "position-2", order: 0 },
      }),
    ]);
    expect(trips).toHaveLength(2);
    expect(trips.map((t) => t.status)).toEqual(["open", "open"]);
    expect(trips.map((t) => t.direction)).toEqual(["long", "short"]);
    expect(trips.map((t) => t.key)).toEqual([
      "acct-1|EURUSD|long|2026-02-02T08:00:00Z|import:position-1",
      "acct-1|EURUSD|short|2026-02-02T09:00:00Z|import:position-2",
    ]);
  });

  it("a futures contract multiplier scales P&L without touching prices", () => {
    const trips = buildRoundTrips(
      [
        fill("ES", "buy", 2, 5000, "2026-04-01T14:00:00Z"),
        fill("ES", "sell", 2, 5010, "2026-04-01T15:00:00Z"),
      ],
      { multipliers: { ES: 50 } },
    );
    expect(trips[0]!.grossPnl).toBe(2 * 10 * 50);
    expect(trips[0]!.avgEntry).toBe(5000);
    expect(trips[0]!.contractMultiplier).toBe(50);
  });

  it("a symbol without a configured multiplier leaves the trade's contract multiplier unset", () => {
    const trips = buildRoundTrips(
      [
        fill("AAPL", "buy", 1, 100, "2026-04-01T14:00:00Z"),
        fill("AAPL", "sell", 1, 101, "2026-04-01T15:00:00Z"),
      ],
      { multipliers: { ES: 50 } },
    );
    expect(trips[0]!.contractMultiplier).toBeUndefined();
  });

  it("trades in different accounts never match against each other", () => {
    const trips = buildRoundTrips([
      fill("AAPL", "buy", 10, 100, "2026-01-05T14:30:00Z", { accountId: "a" }),
      fill("AAPL", "sell", 10, 110, "2026-01-05T15:30:00Z", { accountId: "b" }),
    ]);
    expect(trips).toHaveLength(2);
    expect(trips.every((t) => t.status === "open")).toBe(true);
  });

  it("a trade closed at exactly zero net P&L counts as breakeven, not a win or loss", () => {
    const trips = buildRoundTrips([
      fill("AMD", "buy", 10, 100, "2026-01-05T14:30:00Z"),
      fill("AMD", "sell", 10, 100, "2026-01-05T15:30:00Z"),
    ]);
    expect(trips[0]!.status).toBe("breakeven");
  });

  it("annotation keys stay stable when the same executions are rebuilt", () => {
    const executions = [
      fill("AAPL", "buy", 100, 10, "2026-01-05T14:30:00Z"),
      fill("AAPL", "sell", 100, 12, "2026-01-05T15:30:00Z"),
    ];
    const first = buildRoundTrips(executions)[0]!.key;
    const second = buildRoundTrips([...executions].reverse())[0]!.key;
    expect(first).toBe(second);
    expect(first).toBe("acct-1|AAPL|long|2026-01-05T14:30:00Z");
  });
});
