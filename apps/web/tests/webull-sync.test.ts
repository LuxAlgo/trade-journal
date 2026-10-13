import { describe, expect, it } from "vitest";
import { expiredOptionCloses, orphanFills, type HistoryFill } from "@/server/sync-history";

const fill = (
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  executedAt: string,
  extra: Partial<HistoryFill> = {},
): HistoryFill => ({ symbol, side, quantity, executedAt, assetClass: "equity", ...extra });

const flat = () => 0;

describe("broker history with a floor", () => {
  it("selling shares bought before the history floor does not invent a short", () => {
    const incoming = [
      fill("ABC", "sell", 7, "2026-01-05T15:00:00Z"),
      fill("ABC", "buy", 5, "2026-02-01T15:00:00Z"),
      fill("ABC", "sell", 5, "2026-02-03T15:00:00Z"),
    ];
    expect([...orphanFills([], incoming, flat)]).toEqual([0]);
  });

  it("a real short the broker still reports is kept", () => {
    const incoming = [fill("ABC", "sell", 7, "2026-01-05T15:00:00Z")];
    expect(orphanFills([], incoming, () => -7).size).toBe(0);
  });

  it("a short that was opened and covered inside the history is kept", () => {
    const incoming = [
      fill("ABC", "sell", 7, "2026-01-05T15:00:00Z"),
      fill("ABC", "buy", 7, "2026-01-06T15:00:00Z"),
    ];
    expect(orphanFills([], incoming, flat).size).toBe(0);
  });

  it("a position held since before the floor, and never traded since, adds nothing", () => {
    expect(orphanFills([], [], () => 600).size).toBe(0);
  });

  it("an option close with nothing open is dropped; one closing a known open is kept", () => {
    const option = { assetClass: "option" };
    const known = [
      fill("XYZ 260925P50", "buy", 1, "2026-09-20T15:00:00Z", {
        ...option,
        positionEffect: "open",
      }),
    ];
    const incoming = [
      fill("XYZ 260925P50", "sell", 1, "2026-09-22T15:00:00Z", {
        ...option,
        positionEffect: "close",
      }),
      fill("EEE 260116C20", "sell", 2, "2026-01-02T15:00:00Z", {
        ...option,
        positionEffect: "close",
      }),
    ];
    expect([...orphanFills(known, incoming, () => undefined)]).toEqual([1]);
  });

  it("brokers without a position list keep every unlabeled fill", () => {
    const incoming = [fill("ABC", "sell", 7, "2026-01-05T15:00:00Z")];
    expect(orphanFills([], incoming, () => undefined).size).toBe(0);
  });
});

describe("expired options", () => {
  const now = "2026-09-29T00:00:00.000Z";

  it("an expired option still held closes at the 4pm New York expiry, in summer and winter", () => {
    const closes = expiredOptionCloses(
      [
        fill("AAA 260731C60", "buy", 2, "2026-07-01T15:00:00Z", { assetClass: "option" }),
        fill("BBB 251226C29", "buy", 1, "2025-12-20T15:00:00Z", { assetClass: "option" }),
        fill("CCC 261120C85", "buy", 1, "2026-09-01T15:00:00Z", { assetClass: "option" }),
      ],
      now,
    );
    expect(closes).toEqual([
      {
        symbol: "AAA 260731C60",
        side: "sell",
        quantity: 2,
        executedAt: "2026-07-31T20:00:00.000Z",
        assetClass: "option",
      },
      {
        symbol: "BBB 251226C29",
        side: "sell",
        quantity: 1,
        executedAt: "2025-12-26T21:00:00.000Z",
        assetClass: "option",
      },
    ]);
  });

  it("an option closed before expiry gets no extra fill", () => {
    const closes = expiredOptionCloses(
      [
        fill("DDD 260904C100", "buy", 1, "2026-09-01T15:00:00Z", { assetClass: "option" }),
        fill("DDD 260904C100", "sell", 1, "2026-09-02T15:00:00Z", { assetClass: "option" }),
      ],
      now,
    );
    expect(closes).toEqual([]);
  });
});
