import { describe, expect, it } from "vitest";
import { buildRoundTrips, type Execution } from "@luxalgo/journal-core";
import { FORMATS, detectFormat, parseAuto } from "../src/detect";
import { parseHistory, pnlBasisFor } from "../src/formats/history";
import { importTradeHistory } from "../src/history/import";
import { parseImportTimestamp } from "../src/history/timestamps";
import { directionFromEvent } from "../src/history/adapters/generic";
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
/** The generic alias mapper is never an automatic route; it is only reachable by explicit choice. */
const parseGeneric = (text: string, options?: ImportOptions) => {
  expect(parseAuto(text, options)).toBeNull();
  const result = parseHistory(text, { ...options, adapterId: "generic-csv" });
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
const GENERIC = `Position,Symbol,Direction,Opened At,Closed At,Entry Price,Exit Price,Quantity,Net PnL,Fees
1,AAPL,long,2026-01-05 09:00,2026-01-05 09:00,100,101,1,1,0
2,AAPL,long,2026-01-05 09:00,2026-01-05 09:00,100,102,1,2,0`;

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
  it("a TradingView export whose size column reads Position size (qty) keeps its quantities", () => {
    const text = TV.replace("Size (qty)", "Position size (qty)");
    const result = parse(text, { symbol: "AAPL" });
    expect(result.format).toBe("history-tradingview");
    expect(result.executions.map((e) => e.quantity).sort()).toEqual([1, 1, 2, 2]);
    expect(
      trips(result)
        .map((t) => t.quantity)
        .sort(),
    ).toEqual([1, 2]);
  });
  it("keeps separately reported trades stable even when they open and close at the same timestamp", () => {
    const result = parseGeneric(GENERIC);
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
  it("a swap credit larger than the commission never produces a negative fee and net P&L is unchanged", () => {
    const statement = `${MT5.split("\n")[0]}
2026.01.05 09:00,1001,EURUSD,buy,0.1,1.1,1.09,1.13,2026.01.05 10:00,1.102,-2,5,20`;
    const result = parse(statement);
    expect(result.executions.every((e) => e.fee >= 0)).toBe(true);
    const [trade] = trips(result);
    expect(trade?.fees).toBe(0);
    expect(trade?.netPnl).toBe(23); // 20 profit - 2 commission + 5 swap credit
    // The same money through the generic mapper (Profit beside Commission and Swap).
    const generic =
      parseGeneric(`Open Time,Close Time,Symbol,Direction,Quantity,Entry Price,Exit Price,Profit,Commission,Swap
2026-01-05 09:00,2026-01-05 10:00,EURUSD,long,0.1,1.1,1.102,20,-2,5`);
    expect(generic.executions.every((e) => e.fee >= 0)).toBe(true);
    expect(trips(generic)[0]?.netPnl).toBe(23);
  });
  it("the totals row at the end of a MetaTrader report does not produce a warning", () => {
    const result = parse(`${MT5}\n,,,,,,,,,,-4,-0.5,0`);
    expect(result.warnings).toEqual([]);
    expect(trips(result)).toHaveLength(2);
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
      parseGeneric(`Export from platform\nTimestamp|Ticker|Buy/Sell|Fill Quantity|Execution Price|Fees|State
2026-01-05 09:00|AAPL|buy|10|100|1|Filled
2026-01-05 10:00|AAPL|sell|4|110|1|Filled
2026-01-05 11:00|AAPL|sell|6|120|1|Filled
2026-01-05 12:00|AAPL|buy|100|1|0|Cancelled`);
    expect(result.executions).toHaveLength(3);
    expect(trips(result)[0]?.netPnl).toBe(157);
  });
  it("reads generic quoted money without mistaking percentages or cumulative totals for P&L", () => {
    const result =
      parseGeneric(`Open Time,Close Time,Symbol,Direction,Quantity,Entry Price,Exit Price,Net PnL USD,Return %,Cumulative PnL USD,Commission
2026-01-05 09:00,2026-01-05 10:00,AAPL,long,100,100,112.5,"1,247.50",12.475,9000,2.5`);
    expect(trips(result)[0]?.netPnl).toBe(1247.5);
    expect(trips(result)[0]?.grossPnl).toBe(1250);
  });
  it("uses configured multipliers when the source carries prices but no reported P&L", () => {
    const result =
      parseGeneric(`Opened At,Closed At,Ticker,Direction,Quantity,Entry Price,Exit Price,Fees
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

describe("gross and net P&L are read from the header, never guessed", () => {
  it("a MetaTrader-style Commission column beside a bare Profit column means net = profit - commission", () => {
    const result =
      parseGeneric(`Open Time,Close Time,Symbol,Direction,Quantity,Entry Price,Exit Price,Profit,Commission
2026-01-05 09:00,2026-01-05 10:00,AAPL,long,1,100,110,10,2`);
    const [trade] = trips(result);
    expect(trade?.grossPnl).toBe(10);
    expect(trade?.fees).toBe(2);
    expect(trade?.netPnl).toBe(8);
    expect(result.warnings).toEqual([]);
  });
  it("a Net P&L column stays net and the commission is only added back to the gross figure", () => {
    const result =
      parseGeneric(`Opened At,Closed At,Symbol,Direction,Quantity,Entry Price,Exit Price,Net P&L,Commission
2026-01-05 09:00,2026-01-05 10:00,AAPL,long,1,100,110,8,2`);
    const [trade] = trips(result);
    expect(trade?.netPnl).toBe(8);
    expect(trade?.grossPnl).toBe(10);
    expect(result.warnings).toEqual([]);
  });
  it("a bare P&L column with no commission column is used as net and the user is told so", () => {
    const result =
      parseGeneric(`Open Time,Close Time,Symbol,Direction,Quantity,Entry Price,Exit Price,P&L
2026-01-05 09:00,2026-01-05 10:00,AAPL,long,1,100,110,8`);
    expect(trips(result)[0]?.netPnl).toBe(8);
    expect(result.warnings.join(" ")).toContain("net or gross");
    expect(pnlBasisFor("Gross P&L", true)).toEqual({ basis: "gross", explicit: true });
    expect(pnlBasisFor("Netto", true)).toEqual({ basis: "net", explicit: true });
    expect(pnlBasisFor("Net profit", false)).toEqual({ basis: "net", explicit: true });
    expect(pnlBasisFor("PnL", false)).toEqual({ basis: "net", explicit: false });
  });
});

describe("paired history quantities", () => {
  it("allocates one exit across multiple entries without losing quantity or reported P&L", () => {
    const result = parseGeneric(`Event,Symbol,Direction,Time,Price,Quantity,Net PnL,Fees
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
  it("two exports pasted together do not merge into one trade", () => {
    const secondExport = TV.split("\n")
      .slice(1)
      .map((line) => line.replace(/2026-01-05/g, "2026-02-05"))
      .join("\n");
    const result = parse(`${TV}\n${secondExport}`, { symbol: "AAPL" });
    expect(result.executions).toHaveLength(8);
    const roundTrips = trips(result);
    expect(roundTrips).toHaveLength(4);
    expect(roundTrips.map((t) => t.netPnl).sort((a, b) => a - b)).toEqual([-11, -11, 19, 19]);
    expect(result.warnings.join(" ")).toContain("separate trade");
    // The same export pasted twice is still a duplicate, not two trades.
    const twice = parse(`${TV}\n${TV.split("\n").slice(1).join("\n")}`, { symbol: "AAPL" });
    expect(trips(twice)).toHaveLength(2);
    expect(twice.warnings.join(" ")).toContain("duplicate");
  });
  it("SellToClose closes a long and BuyToClose closes a short", () => {
    expect(directionFromEvent("SellToClose", true)).toBe("long");
    expect(directionFromEvent("BuyToClose", true)).toBe("short");
    expect(directionFromEvent("BuyToOpen", false)).toBe("long");
    expect(directionFromEvent("SellToOpen", false)).toBe("short");
    expect(directionFromEvent("Exit short", true)).toBe("short");
    const result = parseGeneric(`Trade,Event,Symbol,Time,Price,Quantity
1,BuyToOpen,AAPL,2026-01-05 09:00,100,1
1,SellToClose,AAPL,2026-01-05 10:00,110,1
2,SellToOpen,MSFT,2026-01-05 09:00,100,1
2,BuyToClose,MSFT,2026-01-05 10:00,90,1`);
    const roundTrips = trips(result);
    expect(roundTrips.map((t) => [t.symbol, t.direction, t.netPnl])).toEqual([
      ["AAPL", "long", 10],
      ["MSFT", "short", 10],
    ]);
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
    const result =
      parseGeneric(`Open Time,Close Time,Ticker,Direction,Quantity,Entry Price,Exit Price
04/03/2026 09:00,04/03/2026 10:00,AAPL,long,1,100,101
14/03/2026 09:00,14/03/2026 10:00,MSFT,long,1,100,101`);
    expect(result.executions[0]?.executedAt).toBe("2026-03-04T09:00:00.000Z");
    expect(parseImportTimestamp("2026-02-30 09:00")).toBeNaN();
    expect(parseImportTimestamp("2026-01-05 24:30")).toBeNaN();
    const ambiguous = importTradeHistory(
      `Open Time,Close Time,Ticker,Direction,Quantity,Entry Price,Exit Price
04/03/2026 09:00,04/03/2026 10:00,AAPL,long,1,100,101`,
      { adapterId: "generic-csv" },
    );
    expect(ambiguous.issues.map((i) => i.code)).toContain("date-order-assumed-mdy");
  });
  it("history timestamps accept EST suffixes and long-form dates exactly like the legacy importers", () => {
    expect(parseImportTimestamp("2026-01-05 09:31:00 EST", "MDY", "America/New_York")).toBe(
      Date.parse("2026-01-05T14:31:00Z"),
    );
    expect(parseImportTimestamp("Jan 5, 2026 09:31", "MDY", "UTC")).toBe(
      Date.parse("2026-01-05T09:31:00Z"),
    );
    expect(parseImportTimestamp("1/5/26 09:31")).toBe(Date.parse("2026-01-05T09:31:00Z"));
    expect(parseImportTimestamp("1/5/99 09:31")).toBe(Date.parse("2099-01-05T09:31:00Z"));
    const result = parseGeneric(
      `Opened At,Closed At,Symbol,Direction,Quantity,Entry Price,Exit Price,Net PnL
"Jan 5, 2026 09:31:00 EST","Jan 5, 2026 10:15:00 EST",AAPL,long,1,100,110,10`,
      { timeZone: "America/New_York" },
    );
    expect(result.executions.map((e) => e.executedAt)).toEqual([
      "2026-01-05T14:31:00.000Z",
      "2026-01-05T15:15:00.000Z",
    ]);
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
  it("the detected format is the format that actually parses the file", () => {
    const das = "Symb,B/S,Price,Time,Date,Qty\nAAPL,B,100,09:00,2026-01-05,1";
    for (const content of [TV, MT5, DEALS, das]) {
      const detected = detectFormat(content);
      const parsed = parseAuto(content);
      expect(detected).not.toBeNull();
      expect(parsed).not.toBeNull();
      expect(parsed!.format).toBe(detected!.id === "trade-history" ? parsed!.format : detected!.id);
      if (detected!.id === "trade-history")
        expect(parsed!.format.startsWith("history-")).toBe(true);
      else expect(parsed).toEqual(detected!.parse(content, {}));
    }
    // MT5 statements are recognized by the broad legacy MetaTrader signature but
    // parsed by the history adapter; detection must name the history format.
    expect(detectFormat(MT5)?.id).toBe("trade-history");
    expect(parseAuto(MT5)?.format).toBe("history-metatrader");
  });
  it("a CSV with generic headers is not imported silently and goes to the column mapper", () => {
    expect(detectFormat(GENERIC)).toBeNull();
    expect(parseAuto(GENERIC)).toBeNull();
    const fills = `Timestamp,Ticker,Buy/Sell,Fill Quantity,Execution Price,Fees
2026-01-05 09:00,AAPL,buy,10,100,1`;
    expect(detectFormat(fills)).toBeNull();
    expect(parseAuto(fills)).toBeNull();
    const direct = importTradeHistory(GENERIC);
    expect(direct.ok).toBe(false);
    expect(direct.format.kind).toBe("unknown");
    expect(direct.issues.map((i) => i.code)).toContain("unsupported-format");
    // The adapter still works when a caller asks for it by name.
    expect(importTradeHistory(GENERIC, { adapterId: "generic-csv" }).trades).toHaveLength(2);
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
