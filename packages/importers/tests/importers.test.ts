import { describe, expect, it } from "vitest";
import { buildRoundTrips } from "@luxalgo/journal-core";
import { detectFormat, parseAuto } from "../src/detect";
import { parseWithMapping, readHeaders } from "../src/formats/generic";
import { parseMoney } from "../src/numbers";
import { parseTimestamp } from "../src/dates";

// NOTE: fixtures are synthetic, shaped after each platform's documented export.
// Validating against real exports is a launch-checklist item; every parser is
// alias-driven so a header fix is a one-line change.

const TRADEZELLA_CSV = `Open Date,Close Date,Symbol,Side,Volume,Entry Price,Exit Price,Net P&L,Commissions
2026-01-05 09:31:00,2026-01-05 10:15:00,AAPL,LONG,100,185.50,187.25,171.00,4.00
2026-01-06 09:45:00,2026-01-06 09:52:00,TSLA,SHORT,50,240.00,242.00,-102.50,2.50`;

const TRADERVUE_CSV = `Date,Time,Symbol,Quantity,Price,Side,Commission,TransFee,ECNFee
2026-01-05,09:31:00,AAPL,100,185.50,Buy,1.00,0.10,0.25
2026-01-05,10:15:00,AAPL,100,187.25,Sell,1.00,0.10,0.25`;

const TRADINGVIEW_CSV = `Symbol,Side,Type,Qty,Fill Price,Status,Commission,Closing Time
NASDAQ:AAPL,Buy,Market,10,185.50,Filled,0,2026-01-05 09:31:00
NASDAQ:AAPL,Sell,Market,10,187.25,Filled,0,2026-01-05 10:15:00
NASDAQ:MSFT,Buy,Limit,5,400.00,Cancelled,0,2026-01-05 11:00:00`;

const IBKR_CSV = `Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,USD,AAPL,"2026-01-05, 09:31:00",100,185.50,187.0,-18550,-1.00,18551,0,150,O
Trades,Data,Order,Stocks,USD,AAPL,"2026-01-05, 10:15:00",-100,187.25,187.0,18725,-1.00,-18551,173,-25,C
Trades,SubTotal,,Stocks,USD,AAPL,,0,,,175,-2,0,173,125,`;

const NINJA_CSV = `Instrument,Action,Quantity,Price,Time,Commission
ES 03-26,Buy,2,5000.25,2026-01-05 09:31:05,4.10
ES 03-26,Sell,2,5010.50,2026-01-05 09:45:10,4.10`;

const MT4_HTML = `<html><head><title>Statement</title></head><body>
<div>MetaTrader 4 - Closed Transactions:</div>
<table>
<tr><td>Ticket</td><td>Open Time</td><td>Type</td><td>Size</td><td>Item</td><td>Price</td><td>S / L</td><td>T / P</td><td>Close Time</td><td>Price</td><td>Commission</td><td>Taxes</td><td>Swap</td><td>Profit</td></tr>
<tr><td>12345</td><td>2026.01.05 09:31</td><td>buy</td><td>1.00</td><td>eurusd</td><td>1.09500</td><td>0.00000</td><td>0.00000</td><td>2026.01.05 14:20</td><td>1.09850</td><td>-7.00</td><td>0.00</td><td>-0.50</td><td>350.00</td></tr>
</table></body></html>`;

describe("importers turn any platform's export into normalized executions", () => {
  it("a TradeZella export migrates with net P&L preserved to the cent", () => {
    const result = parseAuto(TRADEZELLA_CSV)!;
    expect(result.format).toBe("tradezella");
    expect(result.executions).toHaveLength(4);

    const trades = buildRoundTrips(
      result.executions.map((e, i) => ({
        ...e,
        id: `e${i}`,
        accountId: "a",
        source: "import" as const,
      })),
    );
    expect(trades).toHaveLength(2);
    const aapl = trades.find((t) => t.symbol === "AAPL")!;
    const tsla = trades.find((t) => t.symbol === "TSLA")!;
    expect(aapl.netPnl).toBeCloseTo(171, 2);
    expect(tsla.netPnl).toBeCloseTo(-102.5, 2);
    expect(tsla.direction).toBe("short");
  });

  it("a Tradervue executions export imports fills with all three fee columns summed", () => {
    const result = parseAuto(TRADERVUE_CSV)!;
    expect(result.format).toBe("tradervue");
    expect(result.executions).toHaveLength(2);
    expect(result.executions[0]!.fee).toBeCloseTo(1.35, 6);
    expect(result.executions[0]!.side).toBe("buy");
  });

  it("a TradingView history import keeps filled orders and drops cancelled ones", () => {
    const result = parseAuto(TRADINGVIEW_CSV)!;
    expect(result.format).toBe("tradingview");
    expect(result.executions).toHaveLength(2);
    expect(result.executions[0]!.symbol).toBe("AAPL"); // exchange prefix stripped
    expect(result.skippedRows).toBe(1);
  });

  it("an IBKR activity statement imports only fill rows, with signed quantity as the side", () => {
    const result = parseAuto(IBKR_CSV)!;
    expect(result.format).toBe("ibkr");
    expect(result.executions).toHaveLength(2);
    expect(result.executions[0]!.side).toBe("buy");
    expect(result.executions[1]!.side).toBe("sell");
    expect(result.executions[0]!.assetClass).toBe("equity");
    expect(result.executions[0]!.fee).toBe(1);
  });

  it("a NinjaTrader export strips the contract month from the instrument", () => {
    const result = parseAuto(NINJA_CSV)!;
    expect(result.format).toBe("ninjatrader");
    expect(result.executions[0]!.symbol).toBe("ES");
  });

  it("a MetaTrader HTML statement reconstructs each closed trade with swap folded into fees", () => {
    const result = parseAuto(MT4_HTML)!;
    expect(result.format).toBe("metatrader");
    expect(result.executions).toHaveLength(2);
    const trades = buildRoundTrips(
      result.executions.map((e, i) => ({
        ...e,
        id: `e${i}`,
        accountId: "a",
        source: "import" as const,
      })),
    );
    expect(trades[0]!.symbol).toBe("EURUSD");
    expect(trades[0]!.fees).toBeCloseTo(7.5, 6);
  });

  it("an unknown file is not guessed at — it goes to the column mapper instead", () => {
    const weird = `When,Ticker,Way,Amount,Cost
2026-01-05 09:31:00,AAPL,bought,100,185.50`;
    expect(detectFormat(weird)).toBeNull();
    expect(readHeaders(weird)).toEqual(["When", "Ticker", "Way", "Amount", "Cost"]);
    const mapped = parseWithMapping(weird, {
      symbol: "Ticker",
      side: "Way",
      quantity: "Amount",
      price: "Cost",
      timestamp: "When",
    });
    expect(mapped.executions).toHaveLength(1);
    expect(mapped.executions[0]!.side).toBe("buy");
  });
});

describe("parsing primitives survive the mess real exports contain", () => {
  it("money values with symbols, parens, and thousands separators parse correctly", () => {
    expect(parseMoney("$1,234.56")).toBe(1234.56);
    expect(parseMoney("(45.20)")).toBe(-45.2);
    expect(parseMoney("1.234,56")).toBe(1234.56);
    expect(parseMoney("-12.5")).toBe(-12.5);
  });

  it("naive timestamps are interpreted in the trader's timezone, not the server's", () => {
    // 09:31 New York in January is 14:31 UTC.
    expect(parseTimestamp("2026-01-05 09:31:00", "America/New_York")).toBe(
      "2026-01-05T14:31:00.000Z",
    );
    // US-style with meridiem.
    expect(parseTimestamp("01/05/2026 2:30:00 PM", "UTC")).toBe("2026-01-05T14:30:00.000Z");
    // Offsets are honored as-is.
    expect(parseTimestamp("2026-01-05T09:31:00-05:00")).toBe("2026-01-05T14:31:00.000Z");
  });
});

// Fixtures below are shaped from FIELD SOURCES: TradeNote's community broker
// parsers (github.com/Eleven-Trading/TradeNote) and a real-user TradeZella
// converter (github.com/drasticstatic/TradeZella_STB). See docs/importers.md.
describe("formats cross-checked against real-world parsers import correctly", () => {
  it("a Tradovate orders export keeps only Filled rows and reads Product as the symbol", () => {
    const csv = `orderId,Account,Date,Fill Time,B/S,Contract,Product,Filled Qty,Avg Fill Price,Status
1001,APEX123,08/20/2026,08/20/2026 09:31:05,Buy,ESU6,ES,2,5000.25,Filled
1002,APEX123,08/20/2026,,Buy,ESU6,ES,0,,Cancelled
1003,APEX123,08/20/2026,08/20/2026 09:45:10,Sell,ESU6,ES,2,5010.50,Filled`;
    const result = parseAuto(csv)!;
    expect(result.format).toBe("tradovate");
    expect(result.executions).toHaveLength(2);
    expect(result.executions[0]!.symbol).toBe("ES");
    expect(result.skippedRows).toBe(1);
  });

  it("a TopstepX export maps Bid/Ask to buy/sell", () => {
    const csv = `AccountName,ContractName,ExecutePrice,FilledAt,PositionDisposition,Side,Size,Status,Sub Type
TSX-1,/ESU6,5000.25,2026-08-20 09:31:05,Opening,Bid,2,Filled,Market
TSX-1,/ESU6,5010.50,2026-08-20 09:45:10,Closing,Ask,2,Filled,Market`;
    const result = parseAuto(csv)!;
    expect(result.format).toBe("topstepx");
    expect(result.executions).toHaveLength(2);
    expect(result.executions[0]!.side).toBe("buy");
    expect(result.executions[1]!.side).toBe("sell");
  });

  it("an IBKR Flex Query export parses its YYYYMMDD;HHmmss timestamps", () => {
    const csv = `ClientAccountID,Symbol,Date/Time,Buy/Sell,Quantity,Price,Commission,AssetClass,Code
U1234567,AAPL,20260105;093100,BUY,100,185.50,-1.00,STK,O
U1234567,AAPL,20260105;101500,SELL,-100,187.25,-1.00,STK,C`;
    const result = parseAuto(csv)!;
    expect(result.format).toBe("ibkr-flex");
    expect(result.executions).toHaveLength(2);
    expect(result.executions[0]!.executedAt).toBe("2026-01-05T09:31:00.000Z");
    expect(result.executions[0]!.fee).toBe(1);
  });

  it("TradeZella time fields with a timezone abbreviation still parse", () => {
    expect(parseTimestamp("08/18/2026 09:31:00 EST", "America/New_York")).toBe(
      "2026-08-18T13:31:00.000Z",
    );
  });

  it("Webull's combined Filled/Total and Price/Avg Price columns split correctly", () => {
    const csv = `Symbol,Side,Status,Filled/Total Qty,Price/Avg Price,Filled Time
AAPL,Buy,Filled,5/10,185.00/185.50,08/20/2026 09:31:05
AAPL,Sell,Cancelled,0/10,0/0,`;
    const result = parseAuto(csv)!;
    expect(result.format).toBe("webull");
    expect(result.executions).toHaveLength(1);
    expect(result.executions[0]!.quantity).toBe(5); // filled, not total
    expect(result.executions[0]!.price).toBe(185.5); // avg fill price
  });
});
