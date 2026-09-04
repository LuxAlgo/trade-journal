import { describe, expect, it } from "vitest";
import { matchesFilters, type AnnotatedTrade } from "@luxalgo/journal-core";
import { clockLabel, plotTradePoints, tradeExplorerPoints } from "../src/lib/trade-explorer";

const trade = (patch: Partial<AnnotatedTrade> = {}): AnnotatedTrade => ({
  key: "a|AAPL|long|2026-09-01T00:30:00Z",
  accountId: "a",
  symbol: "AAPL",
  direction: "long",
  status: "win",
  openedAt: "2026-09-01T00:30:00Z",
  closedAt: "2026-09-01T01:00:30Z",
  quantity: 10,
  openQuantity: 0,
  avgEntry: 100,
  avgExit: 110,
  netPnl: 96,
  grossPnl: 100,
  fees: 4,
  executionCount: 2,
  executionIds: [],
  exits: [],
  annotations: { stopLoss: 98, tags: ["setup"] },
  ...patch,
});

describe("trade explorer", () => {
  it("plots one net-of-fees observation per closed trade with exact elapsed minutes", () => {
    const rows = tradeExplorerPoints(
      [trade(), trade({ key: "open", status: "open", closedAt: undefined })],
      "UTC",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      durationMinutes: 30.5,
      entryMinute: 30,
      netPnl: 96,
      realizedR: 4.8,
    });
    expect(plotTradePoints(rows, "durationMinutes", "netPnl")[0]).toMatchObject({ x: 30.5, y: 96 });
  });
  it("uses local entry time while elapsed duration remains timezone independent", () => {
    expect(tradeExplorerPoints([trade()], "America/New_York")[0]).toMatchObject({
      durationMinutes: 30.5,
      entryMinute: 20 * 60 + 30,
    });
    const dst = trade({ openedAt: "2026-11-01T05:30:00Z", closedAt: "2026-11-01T06:30:00Z" });
    expect(tradeExplorerPoints([dst], "America/New_York")[0]).toMatchObject({
      durationMinutes: 60,
      entryMinute: 90,
    });
    expect(clockLabel(1230)).toBe("20:30");
    expect(clockLabel(0)).toBe("00:00");
    expect(clockLabel(1440)).toBe("24:00");
  });
  it("preserves zero outcomes and excludes missing risk only from R views", () => {
    const rows = tradeExplorerPoints(
      [
        trade({ key: "no-risk", annotations: {} }),
        trade({ key: "zero", netPnl: 0, status: "breakeven" }),
      ],
      "UTC",
    );
    expect(plotTradePoints(rows, "durationMinutes", "netPnl")).toHaveLength(2);
    expect(plotTradePoints(rows, "entryMinute", "realizedR")).toMatchObject([
      { key: "zero", y: 0 },
    ]);
    expect(tradeExplorerPoints([trade({ assetClass: "futures" })], "UTC")[0]!.realizedR).toBeNull();
    expect(
      tradeExplorerPoints([trade({ assetClass: "futures", contractMultiplier: 2 })], "UTC")[0]!
        .realizedR,
    ).toBe(2.4);
  });
  it("excludes invalid axis inputs without fabricating zeroes", () => {
    const rows = tradeExplorerPoints(
      [
        trade({ key: "reverse", closedAt: "2026-08-31T00:00:00Z" }),
        trade({ key: "bad-open", openedAt: "invalid" }),
        trade({ key: "bad-close", closedAt: "invalid" }),
        trade({ key: "infinite", netPnl: Infinity }),
        trade({ key: "zero-duration", closedAt: "2026-09-01T00:30:00Z" }),
      ],
      "UTC",
    );
    expect(plotTradePoints(rows, "durationMinutes", "netPnl").map((p) => p.key)).toEqual([
      "zero-duration",
    ]);
    expect(plotTradePoints(rows, "entryMinute", "netPnl").map((p) => p.key)).toEqual([
      "zero-duration",
      "reverse",
    ]);
  });
  it("preserves account/date/tag filtering and does not mutate source trades", () => {
    const input = [
      trade(),
      trade({ key: "other", accountId: "b" }),
      trade({ key: "untagged", annotations: {} }),
    ];
    const before = structuredClone(input);
    const filters = { accounts: "a", tag: "setup", from: "2026-08-31", to: "2026-08-31" };
    const rows = tradeExplorerPoints(
      input.filter((t) => matchesFilters(t, filters, "America/New_York")),
      "America/New_York",
    );
    expect(rows).toHaveLength(1);
    expect(input).toEqual(before);
    expect(
      tradeExplorerPoints(
        input.filter((t) => matchesFilters(t, filters, "UTC")),
        "UTC",
      ),
    ).toEqual([]);
    expect(plotTradePoints([], "durationMinutes", "netPnl")).toEqual([]);
  });
});
