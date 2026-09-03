import { describe, expect, it } from "vitest";
import { buildRoundTrips, type Execution } from "@luxalgo/journal-core";
import { FORMATS, detectFormat, parseAuto } from "../src/detect";
import { parseImportTimestamp } from "../src/history/timestamps";
import { parseWithMapping } from "../src/formats/generic";
import type { ImportOptions, ParsedImport } from "../src/types";

const trips = (parsed: ParsedImport) =>
  buildRoundTrips(
    parsed.executions.map((fill, i): Execution => ({
      ...fill,
      id: `z${10000 - i}`,
      accountId: "fixture",
      source: "import",
    })),
  );
const parse = (text: string, options?: ImportOptions) => {
  const result = parseAuto(text, options);
  expect(result).not.toBeNull();
  expect(result?.errors).toBeUndefined();
  return result!;
};
const TV = `Trade number,Type,Date and time,Signal,Price USD,Size (qty),Net PnL USD,Return %,Commission USD
1,Exit long,2026-01-05 10:00,close,110,2,19,9.5,1
1,Entry long,2026-01-05 09:00,open,100,2,19,9.5,1
2,Entry short,2026-01-05 09:00,open,100,1,-11,-11,1
2,Exit short,2026-01-05 10:00,close,110,1,-11,-11,1`;
const MT5 = `Time,Position,Symbol,Type,Volume,Price,S / L,T / P,Time,Price,Commission,Swap,Profit
2026.01.05 09:00,1001,EURUSD,buy,0.1,1.1,1.09,1.13,2026.01.05 10:00,1.102,-2,0.5,20
2026.01.06 09:00,1002,EURUSD,sell,0.2,1.102,1.12,1.08,2026.01.06 10:00,1.103,-2,-1,-20`;
const DEALS = `Time,Deal,Symbol,Type,Direction,Volume,Price,Order,Commission,Fee,Swap,Profit
2026.01.05 08:00,0,,balance,,0,0,0,0,0,0,10000
2026.01.05 09:00,1,TEST,buy,in,2,100,101,-2,0,0,0
2026.01.05 10:00,2,TEST,sell,out,1,110,102,-1,0,0,20
2026.01.05 11:00,3,TEST,sell,in/out,3,90,103,-3,0,0,-20
2026.01.05 12:00,4,TEST,buy,out,2,80,104,-2,0,0,40`;

// Synthetic exports shaped after the simulator's adapters; no account data.
describe("simulator history formats extend the journal import path", () => {
  it("pairs TradingView strategy rows by trade ID and keeps overlapping positions separate", () => {
    const result = parse(TV, { symbol: "AAPL" });
    expect(result.format).toBe("history-tradingview");
    expect(result.executions).toHaveLength(4);
    const resultTrips = trips(result);
    expect(resultTrips).toHaveLength(2);
    expect(resultTrips.map((t) => t.netPnl).sort((a, b) => a - b)).toEqual([-11, 19]);
    expect(resultTrips.map((t) => t.fees)).toEqual([1, 1]);
  });
  it("requires a missing symbol without inventing one, and accepts source columns or an explicit filename", () => {
    expect(parseAuto(TV)?.needsSymbol).toBe(true);
    expect(parseAuto(TV)?.executions).toEqual([]);
    expect(parseAuto(TV)?.errors?.length).toBeGreaterThan(0);
    const named = parse(TV, { fileName: "My_Strategy_NASDAQ_AAPL_2026-09-02.csv" });
    expect(named.executions.every((e) => e.symbol === "AAPL")).toBe(true);
    expect(parseAuto(TV, { fileName: "My_strategy.csv" })?.needsSymbol).toBe(true);
    const withColumn = TV.split("\n")
      .map((line, i) => line + (i ? ",MSFT" : ",Symbol"))
      .join("\n");
    expect(parse(withColumn).executions.every((e) => e.symbol === "MSFT")).toBe(true);
  });
  it("accepts older TradingView headers, semicolons and an explicit symbol preamble", () => {
    const text = `Symbol;NASDAQ:AAPL\nTrade #;Type;Date/Time;Price;Contracts;Profit;Profit %\n1;Exit long;2026-01-05 10:00;101;2;2;1\n1;Entry long;2026-01-05 09:00;100;2;2;1`;
    const result = parse(text);
    expect(result.format).toBe("history-tradingview");
    expect(trips(result)[0]?.netPnl).toBe(2);
  });
  it("keeps separately reported trades stable even when they open and close at the same timestamp", () => {
    const result =
      parse(`Position,Symbol,Direction,Open Time,Close Time,Entry Price,Exit Price,Quantity,PnL,Fees
1,AAPL,long,2026-01-05 09:00,2026-01-05 09:00,100,101,1,1,0
2,AAPL,long,2026-01-05 09:00,2026-01-05 09:00,100,102,1,2,0`);
    const roundTrips = trips(result);
    expect(roundTrips).toHaveLength(2);
    expect(roundTrips.every((t) => t.direction === "long" && t.status === "win")).toBe(true);
    expect(new Set(roundTrips.map((t) => t.key)).size).toBe(2);
    expect(
      buildRoundTrips(
        result.executions.toReversed().map((e, i) => ({
          ...e,
          id: String(i),
          accountId: "fixture",
          source: "import" as const,
        })),
      ).map((t) => t.key),
    ).toEqual(roundTrips.map((t) => t.key));
  });
  it("preserves MetaTrader statement P&L, signed swap and duplicated Time/Price columns", () => {
    const result = parse(MT5);
    expect(result.format).toBe("history-metatrader");
    const roundTrips = trips(result);
    expect(roundTrips[0]?.avgEntry).toBe(1.1);
    expect(roundTrips[0]?.avgExit).toBe(1.102);
    expect(roundTrips[0]?.netPnl).toBeCloseTo(18.5, 8);
    expect(roundTrips[0]?.fees).toBe(1.5);
    expect(roundTrips[1]?.direction).toBe("short");
    expect(roundTrips[1]?.netPnl).toBe(-23);
  });
  it("recognizes MT5 HTML sections without importing balance, orders or hidden comment cells", () => {
    const header = MT5.split("\n")[0]!.split(",");
    const rows = MT5.split("\n")
      .slice(1)
      .map((line) => line.split(","));
    const html = `<html><body>MetaTrader 5<table><tr><td>Account</td><td>Test</td></tr></table><table><tr><th colspan="13">Positions</th></tr><tr>${header.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((row) => `<tr>${row.map((v, i) => `<td>${v}</td>${i === 4 ? '<td class="hidden" colspan="8">comment</td>' : ""}`).join("")}</tr>`).join("")}<tr><td colspan="13">Orders</td></tr><tr><td>Should not import</td></tr></table></body></html>`;
    const result = parse(html);
    expect(result.format).toBe("history-metatrader");
    expect(trips(result).map((t) => t.netPnl)).toEqual([18.5, -23]);
  });
  it("keeps MT5 deals intact through partial closes, reversals and reported contract P&L", () => {
    const result = parse(DEALS);
    expect(result.format).toBe("history-mt5-deals");
    expect(result.executions).toHaveLength(4);
    const roundTrips = trips(result);
    expect(roundTrips).toHaveLength(2);
    expect(roundTrips.map((t) => [t.direction, t.quantity, t.netPnl])).toEqual([
      ["long", 2, -4],
      ["short", 2, 36],
    ]);
    expect(roundTrips[0]?.exits.map((e) => e.grossPnl)).toEqual([20, -20]);
  });
  it("does not turn an unmatched MT5 exit into an invented opposite position", () => {
    const lines = DEALS.split("\n");
    const result = parseAuto([lines[0], lines[3]].join("\n"))!;
    expect(result.executions).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("no matching position");
  });
  it("handles generic pipe-separated fills and preserves original partial-exit quantities", () => {
    const result =
      parse(`Export from platform\nTimestamp|Ticker|Buy/Sell|Fill Quantity|Execution Price|Fees|State
2026-01-05 09:00|AAPL|buy|10|100|1|Filled
2026-01-05 10:00|AAPL|sell|4|110|1|Filled
2026-01-05 11:00|AAPL|sell|6|120|1|Filled
2026-01-05 12:00|AAPL|buy|100|1|0|Cancelled`);
    expect(result.executions).toHaveLength(3);
    expect(trips(result)[0]?.netPnl).toBe(157);
  });
  it("reads generic quoted money without mistaking percentages or cumulative totals for P&L", () => {
    const result =
      parse(`Open Time,Close Time,Symbol,Direction,Quantity,Entry Price,Exit Price,Net PnL USD,Return %,Cumulative PnL USD,Commission
2026-01-05 09:00,2026-01-05 10:00,AAPL,long,100,100,112.5,"1,247.50",12.475,9000,2.5`);
    expect(trips(result)[0]?.netPnl).toBe(1247.5);
    expect(trips(result)[0]?.grossPnl).toBe(1250);
  });
  it("uses configured multipliers when the source carries prices but no reported P&L", () => {
    const result = parse(`Opened At,Closed At,Ticker,Direction,Quantity,Entry Price,Exit Price,Fees
2026-01-05 09:00,2026-01-05 10:00,ES,long,2,5000,5001,4`);
    const roundTrips = buildRoundTrips(
      result.executions.map((e, i) => ({
        ...e,
        id: String(i),
        accountId: "a",
        source: "import" as const,
      })),
      { multipliers: { ES: 50 } },
    );
    expect(roundTrips[0]?.netPnl).toBe(96);
    expect(result.executions[1]?.importMetadata?.reportedGrossPnl).toBeUndefined();
  });
  it("leaves incomplete strategy positions out until both actual legs are available", () => {
    const result = parse(
      `${TV}\n3,Entry long,2026-01-06 09:00,open,100,1,0,0,0\n3,Exit long,Open,close,—,1,0,0,0`,
      { symbol: "AAPL" },
    );
    expect(result.executions).toHaveLength(4);
    expect(result.warnings.join(" ")).toContain("incomplete position");
  });
  it("blocks malformed history rather than committing a silently truncated file", () => {
    const result = parseAuto(`${TV}\n3,Entry long,"never closed`, { symbol: "AAPL" });
    expect(result?.executions).toEqual([]);
    expect(result?.errors?.join(" ")).toContain("never closed");
  });
  it("never fabricates prices, size or account money from simulator-only R series", () => {
    expect(
      parseAuto("open time,close time,direction,r\n2026-01-05 09:00,2026-01-05 10:00,long,2"),
    ).toBeNull();
    expect(parseAuto("1R,-1R,2R")).toBeNull();
  });
});

describe("paired history quantities", () => {
  it("allocates one exit across multiple entries without losing quantity or reported P&L", () => {
    const result = parse(`Event,Symbol,Direction,Time,Price,Quantity,PnL,Fees
entry,AAPL,long,2026-01-05 09:00,100,1,,1
entry,AAPL,long,2026-01-05 09:10,100,2,,2
exit,AAPL,long,2026-01-05 10:00,110,3,27,0`);
    const roundTrips = trips(result);
    expect(roundTrips.reduce((sum, t) => sum + t.quantity, 0)).toBe(3);
    expect(roundTrips.reduce((sum, t) => sum + t.netPnl, 0)).toBe(27);
    expect(roundTrips.reduce((sum, t) => sum + t.fees, 0)).toBe(3);
  });
  it("blocks a trade whose exits exceed its recorded entries", () => {
    const result = parseAuto(
      `Trade number,Type,Date and time,Price USD,Size (qty),Net PnL USD
1,Entry long,2026-01-05 09:00,100,1,20
1,Exit long,2026-01-05 10:00,110,2,20`,
      { symbol: "AAPL" },
    );
    expect(result?.executions).toEqual([]);
    expect(result?.errors?.join(" ")).toContain("exit quantity exceeds");
  });
});

describe("history timestamps preserve journal timezone semantics", () => {
  it("supports epoch, fractional seconds, explicit offsets and IANA local time", () => {
    expect(parseImportTimestamp("1767603600")).toBe(1767603600000);
    expect(parseImportTimestamp("2026.01.05 09:00:00.123", "MDY", "America/New_York")).toBe(
      Date.parse("2026-01-05T14:00:00.123Z"),
    );
    expect(parseImportTimestamp("2026-01-05T09:00:00.123-05:00", "MDY", "Asia/Tokyo")).toBe(
      Date.parse("2026-01-05T14:00:00.123Z"),
    );
    expect(parseImportTimestamp("20260105;090000", "MDY", "America/New_York")).toBe(
      Date.parse("2026-01-05T14:00:00Z"),
    );
    expect(
      parse(TV, { symbol: "AAPL", timeZone: "America/New_York" }).executions[0]?.executedAt,
    ).toBe("2026-01-05T14:00:00.000Z");
  });
  it("selects one slash-date order for the whole file and rejects invalid dates", () => {
    const result = parse(`Open Time,Close Time,Ticker,Direction,Quantity,Entry Price,Exit Price
04/03/2026 09:00,04/03/2026 10:00,AAPL,long,1,100,101
14/03/2026 09:00,14/03/2026 10:00,MSFT,long,1,100,101`);
    expect(result.executions[0]?.executedAt).toBe("2026-03-04T09:00:00.000Z");
    expect(parseImportTimestamp("2026-02-30 09:00")).toBeNaN();
    expect(parseImportTimestamp("2026-01-05 24:30")).toBeNaN();
  });
});

describe("new detection preserves existing import routes", () => {
  it("retains the original registry priority and exact DAS/ThinkorSwim parsing results", () => {
    expect(FORMATS.slice(0, 12).map((f) => f.id)).toEqual([
      "metatrader",
      "ibkr",
      "ibkr-flex",
      "thinkorswim",
      "tradezella",
      "tradervue",
      "topstepx",
      "tradingview",
      "ninjatrader",
      "tradovate",
      "webull",
      "das-trader",
    ]);
    for (const [id, content] of [
      ["das-trader", "Symb,B/S,Price,Time,Date,Qty\nAAPL,B,100,09:00,2026-01-05,1"],
      [
        "thinkorswim",
        "Account Trade History\nExec Time,Symbol,Side,Qty,Price\n2026-01-05 09:00,AAPL,BUY,1,100\n\nAccount Summary",
      ],
    ]) {
      const format = FORMATS.find((f) => f.id === id)!;
      expect(parseAuto(content!)).toEqual(format.parse(content!, {}));
      expect(detectFormat(content!)?.id).toBe(id);
    }
  });
  it("keeps the explicit column mapper available and unchanged", () => {
    const content = "When,Ticker,Way,Amount,Cost\n2026-01-05 09:00,AAPL,bought,2,100";
    expect(detectFormat(content)).toBeNull();
    expect(
      parseWithMapping(content, {
        timestamp: "When",
        symbol: "Ticker",
        side: "Way",
        quantity: "Amount",
        price: "Cost",
      }).executions,
    ).toHaveLength(1);
  });
});
