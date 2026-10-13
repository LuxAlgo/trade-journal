import { describe, expect, it } from "vitest";
import { buildRoundTrips } from "@luxalgo/journal-core";
import { detectFormat, parseAuto } from "../src/detect";
import { xtbWorkbookToStatement } from "../src/formats/xtb";
import { readXlsx } from "../src/xlsx";
import { workbook, xtbWorkbook, type OpenLot } from "./xtb-fixture";

// Fixtures are synthetic workbooks in the layout of real xStation exports.
const ACCOUNT = 10000001;
const at = (iso: string) => new Date(iso);

const closedEtf = xtbWorkbook(ACCOUNT, {
  closed: [
    {
      instrument: "Synthetic ETF",
      ticker: "SYN.DE",
      category: "ETF",
      type: "BUY",
      volume: 0.25,
      openPrice: 700,
      openTime: at("2026-09-30T13:38:21.147Z"),
      closePrice: 699.5,
      closeTime: at("2026-09-30T13:47:46.059Z"),
      // Account-currency result: 0.25 × −0.50 EUR × 5.0 RON/EUR.
      net: -0.63,
      gross: -0.63,
      openRate: 5,
      closeRate: 5,
      positionId: 3000000001,
    },
  ],
  cash: [
    {
      type: "Deposit",
      time: at("2026-09-30T13:31:07.967Z"),
      amount: 1000,
      id: 1,
      comment: "Deposit",
    },
    {
      type: "Stock purchase",
      time: at("2026-09-30T13:38:21.157Z"),
      amount: -875,
      id: 2,
      comment: "OPEN BUY SYN.DE 0.25 @ 700.00",
      ticker: "SYN.DE",
      positionId: 3000000001,
    },
    {
      type: "Stock sell",
      time: at("2026-09-30T13:47:46.070Z"),
      amount: 874.37,
      id: 3,
      comment: "CLOSE BUY SYN.DE 0.25 @ 699.50",
      ticker: "SYN.DE",
      positionId: 3000000001,
    },
  ],
});

const lots: OpenLot[] = [
  {
    instrument: "Synthetic ETF",
    ticker: "SYN.DE",
    category: "ETF",
    type: "BUY",
    volume: 4.5,
    openPrice: 750.25,
    openTime: at("2026-10-07T17:57:32.940Z"),
    positionId: 3000000002,
  },
  {
    instrument: "Synthetic ETF",
    ticker: "SYN.DE",
    category: "ETF",
    type: "BUY",
    volume: 0.3,
    openPrice: 731.1,
    openTime: at("2026-09-30T15:07:43.479Z"),
    positionId: 3000000003,
  },
  {
    instrument: "Synthetic ETF",
    ticker: "SYN.DE",
    category: "ETF",
    type: "BUY",
    volume: 0.15,
    openPrice: 738.6,
    openTime: at("2026-10-02T17:37:36.856Z"),
    positionId: 3000000004,
  },
];
const purchases = lots.map((lot, index) => ({
  type: "Stock purchase",
  time: lot.openTime,
  amount: -lot.volume * lot.openPrice,
  id: 10 + index,
  comment: `OPEN BUY SYN.DE ${lot.volume} @ ${lot.openPrice}`,
  ticker: "SYN.DE",
  positionId: lot.positionId,
}));
const holdings = xtbWorkbook(ACCOUNT, {
  open: lots,
  cash: [
    {
      type: "Deposit",
      time: at("2026-09-30T13:50:50.915Z"),
      amount: 5000,
      id: 9,
      comment: "Deposit",
    },
    ...purchases,
  ],
});
// A later export of the same account: the first lot has been closed.
const laterClose = xtbWorkbook(ACCOUNT, {
  closed: [
    {
      instrument: "Synthetic ETF",
      ticker: "SYN.DE",
      category: "ETF",
      type: "BUY",
      volume: 4.5,
      openPrice: 750.25,
      openTime: at("2026-10-07T17:57:32.940Z"),
      closePrice: 760.25,
      closeTime: at("2026-10-12T09:00:00.000Z"),
      net: 45,
      gross: 45,
      positionId: 3000000002,
    },
  ],
  open: lots.slice(1),
});

const asExecutions = (content: string) =>
  parseAuto(content)!.executions.map((execution, index) => ({
    ...execution,
    id: `e${index}`,
    accountId: "a",
    source: "import" as const,
  }));
const tripsOf = (content: string) => {
  const parsed = parseAuto(content)!;
  return { parsed, trips: buildRoundTrips(asExecutions(content)) };
};

describe("XTB account workbooks", () => {
  it("keeps a closed position and its account-currency result", async () => {
    const statement = await xtbWorkbookToStatement(closedEtf);
    expect(detectFormat(statement)?.id).toBe("xtb");
    const { parsed, trips } = tripsOf(statement);
    expect(parsed.format).toBe("xtb");
    expect(parsed.errors).toBeUndefined();
    // Totals, rollups and the reducer's note are layout, not skipped trades.
    expect(parsed.skippedRows).toBe(0);
    expect(parsed.executions).toEqual([
      expect.objectContaining({
        symbol: "SYN.DE",
        side: "buy",
        quantity: 0.25,
        price: 700,
        fee: 0,
        executedAt: "2026-09-30T13:38:21.147Z",
        assetClass: "equity",
        importMetadata: expect.objectContaining({ id: "entry", group: "xtb:10000001:3000000001" }),
      }),
      expect.objectContaining({
        symbol: "SYN.DE",
        side: "sell",
        quantity: 0.25,
        price: 699.5,
        fee: 0,
        executedAt: "2026-09-30T13:47:46.059Z",
        importMetadata: expect.objectContaining({
          id: "exit",
          reportedGrossPnl: -0.63,
          preserveFee: true,
          group: "xtb:10000001:3000000001",
        }),
      }),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({
      direction: "long",
      status: "loss",
      grossPnl: -0.63,
      fees: 0,
      netPnl: -0.63,
    });
    expect(parsed.warnings.join(" ")).toMatch(
      /Imported 0 open holding\(s\) as entry fills\. Skipped 3 cash operation/,
    );
  });

  it("imports open lots as holdings keyed by XTB position id, skipping the rollup row", async () => {
    const { parsed, trips } = tripsOf(await xtbWorkbookToStatement(holdings));
    expect(parsed.errors).toBeUndefined();
    expect(parsed.skippedRows).toBe(0);
    expect(
      parsed.executions.map((execution) => [
        execution.symbol,
        execution.side,
        execution.quantity,
        execution.price,
        execution.executedAt,
        execution.importMetadata?.group,
      ]),
    ).toEqual(
      lots.map((lot) => [
        "SYN.DE",
        "buy",
        lot.volume,
        lot.openPrice,
        lot.openTime.toISOString(),
        `xtb:10000001:${lot.positionId}`,
      ]),
    );
    // Lot rows leave Category blank; the rollup row's category still applies.
    expect(parsed.executions.map((execution) => execution.assetClass)).toEqual([
      "equity",
      "equity",
      "equity",
    ]);
    expect(trips.map((trip) => trip.status)).toEqual(["open", "open", "open"]);
    expect(parsed.warnings.join(" ")).toMatch(/Imported 3 open holding\(s\).*Skipped 4 cash/);
  });

  it("a later workbook's closed row repeats the holding's entry exactly and adds the exit", async () => {
    const [holding] = parseAuto(await xtbWorkbookToStatement(holdings))!.executions;
    const later = parseAuto(await xtbWorkbookToStatement(laterClose))!.executions;
    expect(later.map((fill) => [fill.importMetadata?.id, fill.importMetadata?.group])).toEqual([
      ["entry", "xtb:10000001:3000000002"],
      ["exit", "xtb:10000001:3000000002"],
      ["entry", "xtb:10000001:3000000003"],
      ["entry", "xtb:10000001:3000000004"],
    ]);
    // Same fields, so the journal's content hash deduplicates the entry.
    expect(later[0]).toEqual(holding);
    const trips = buildRoundTrips(
      [holding!, later[1]!].map((execution, index) => ({
        ...execution,
        id: `e${index}`,
        accountId: "a",
        source: "import" as const,
      })),
    );
    expect(trips).toEqual([
      expect.objectContaining({ status: "win", netPnl: 45, openQuantity: 0 }),
    ]);
  });

  it("keeps overlapping long and short positions apart and preserves a fee", () => {
    const csv = `Closed Positions
Instrument,Ticker,Category,Type,Volume,Open Price,Open Time (UTC),Close Price,Close Time (UTC),Profit/Loss,Gross Profit,Position ID
EURUSD,EURUSD,Forex,BUY,1,1.1,2026-01-05 09:00:00,1.2,2026-01-05 12:00:00,90,100,1
EURUSD,EURUSD,Forex,SELL,1,1.1,2026-01-05 10:00:00,1.0,2026-01-05 11:00:00,90,100,2`;
    const { parsed, trips } = tripsOf(csv);
    expect(parsed.format).toBe("xtb");
    expect(trips.map((trip) => [trip.direction, trip.netPnl, trip.fees])).toEqual([
      ["long", 90, 10],
      ["short", 90, 10],
    ]);
    expect(parsed.executions[1]?.importMetadata?.reportedGrossPnl).toBe(100);
    expect(parsed.executions[1]?.fee).toBe(10);
  });

  it("counts a trade type it does not understand as skipped", () => {
    const csv = `Closed Positions
Instrument,Ticker,Category,Type,Volume,Open Price,Open Time (UTC),Close Price,Close Time (UTC),Profit/Loss,Gross Profit,Position ID
AAA,AAA,ETF,BUY,1,10,2026-01-01 00:00:00,11,2026-01-02 00:00:00,1,1,10
AAA,AAA,ETF,EXPIRY,1,10,2026-01-01 00:00:00,0,2026-01-03 00:00:00,-10,-10,11
Profit/loss,,,,,,,,,-9,-9`;
    const parsed = parseAuto(csv)!;
    expect(parsed.executions).toHaveLength(2);
    expect(parsed.skippedRows).toBe(1);
  });

  it("rejects a statement that mixes two XTB accounts", () => {
    const csv = `Account number,1
Closed Positions
Instrument,Ticker,Category,Type,Volume,Open Price,Open Time (UTC),Close Price,Close Time (UTC),Profit/Loss,Gross Profit,Position ID,Account
A,AAA,ETF,BUY,1,10,2026-01-01 00:00:00,11,2026-01-02 00:00:00,1,1,10,1
A,AAA,ETF,BUY,1,10,2026-01-01 00:00:00,11,2026-01-02 00:00:00,1,1,11,2`;
    expect(parseAuto(csv)!.errors?.[0]).toMatch(/more than one XTB account/);
  });

  it("refuses a workbook that is not an XTB account statement", async () => {
    const other = workbook([
      {
        name: "Sheet1",
        rows: [
          ["Date", "Symbol"],
          ["2026-01-01", "AAA"],
        ],
      },
    ]);
    await expect(xtbWorkbookToStatement(other)).rejects.toThrow(/no Closed Positions sheet/);
  });
});

/** Overwrite a central-directory field of one archive member. */
const patchCentral = (
  bytes: Uint8Array,
  member: string,
  write: (view: DataView, at: number) => void,
) => {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  const text = new TextDecoder();
  for (let at = 0; at < copy.length - 46; at++) {
    if (view.getUint32(at, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(at + 28, true);
    if (text.decode(copy.subarray(at + 46, at + 46 + nameLength)) === member) {
      write(view, at);
      return copy;
    }
  }
  throw new Error(`${member} not found`);
};

describe(".xlsx reader limits", () => {
  it("reads stored and deflated workbooks identically", async () => {
    const stored = xtbWorkbook(ACCOUNT, { open: lots }, { stored: true });
    const deflated = xtbWorkbook(ACCOUNT, { open: lots });
    expect(await readXlsx(stored)).toEqual(await readXlsx(deflated));
  });

  it("names a legacy .xls or password-protected file", async () => {
    const ole = new Uint8Array([
      0xd0,
      0xcf,
      0x11,
      0xe0,
      0xa1,
      0xb1,
      0x1a,
      0xe1,
      ...new Array(64).fill(0),
    ]);
    await expect(readXlsx(ole)).rejects.toThrow(/legacy \.xls or password-protected/);
  });

  it("rejects truncated and non-zip input", async () => {
    await expect(readXlsx(closedEtf.subarray(0, closedEtf.length - 30))).rejects.toThrow(
      /not an \.xlsx workbook/,
    );
    await expect(readXlsx(new TextEncoder().encode("Closed Positions,,,"))).rejects.toThrow(
      /not an \.xlsx workbook/,
    );
  });

  it("stops inflating a part that grows past its declared size", async () => {
    const lying = patchCentral(closedEtf, "xl/worksheets/sheet1.xml", (view, at) =>
      view.setUint32(at + 24, 64, true),
    );
    await expect(readXlsx(lying)).rejects.toThrow(/larger than the archive declares/);
  });

  it("refuses parts declared too large for an account statement", async () => {
    const huge = patchCentral(closedEtf, "xl/worksheets/sheet1.xml", (view, at) =>
      view.setUint32(at + 24, 512 * 1024 * 1024, true),
    );
    await expect(readXlsx(huge)).rejects.toThrow(/too large to be an account statement/);
  });

  it("refuses encrypted archive members", async () => {
    const locked = patchCentral(closedEtf, "xl/workbook.xml", (view, at) =>
      view.setUint16(at + 8, 1, true),
    );
    await expect(readXlsx(locked)).rejects.toThrow(/Password-protected/);
  });
});
