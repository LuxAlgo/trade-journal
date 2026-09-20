import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

const previousDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-format-regression-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, executions, trades } = await import("../src/db");
const { POST } = await import("../src/app/api/import/route");
const post = (body: object) =>
  POST(new Request("http://localhost/api/import", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.insert(accounts)
    .values({ id: "test", name: "Regression", kind: "import", createdAt: "2026-01-01" })
    .run();
});
afterAll(() => {
  vi.unstubAllEnvs();
  db.$client.close();
  if (previousDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = previousDir;
  rmSync(scratch, { recursive: true, force: true });
});

// Synthetic, independently calculable round trips. This checks API/storage
// compatibility, not certification of every live broker export variant.
const cases = [
  {
    format: "tradervue",
    pnl: 7,
    content: `Date,Time,Symbol,Quantity,Price,Side,Commission,TransFee,ECNFee
2026-01-05,09:30:00,AAPL,1,100,Buy,1,0.25,0.25
2026-01-05,10:00:00,AAPL,1,110,Sell,1,0.25,0.25`,
  },
  {
    format: "tradingview",
    pnl: 10,
    content: `Symbol,Side,Type,Qty,Fill Price,Status,Commission,Closing Time
NASDAQ:AAPL,Buy,Market,1,100,Filled,0,2026-01-05 09:30:00
NASDAQ:AAPL,Sell,Market,1,110,Filled,0,2026-01-05 10:00:00
NASDAQ:AAPL,Buy,Limit,1,99,Cancelled,0,2026-01-05 11:00:00`,
  },
  {
    format: "tradovate",
    pnl: 10,
    content: `orderId,Account,Date,Fill Time,B/S,Contract,Product,Filled Qty,Avg Fill Price,Status
1001,APEX123,08/20/2026,08/20/2026 09:31:05,Buy,ESU6,ES,1,5000,Filled
1002,APEX123,08/20/2026,08/20/2026 09:45:10,Sell,ESU6,ES,1,5010,Filled`,
  },
  {
    format: "topstepx",
    pnl: 10,
    content: `AccountName,ContractName,ExecutePrice,FilledAt,PositionDisposition,Side,Size,Status,Sub Type
TSX-1,/ESU6,5000,2026-08-20 09:31:05,Opening,Bid,1,Filled,Market
TSX-1,/ESU6,5010,2026-08-20 09:45:10,Closing,Ask,1,Filled,Market`,
  },
  {
    format: "ibkr-flex",
    pnl: 8,
    content: `ClientAccountID,Symbol,Date/Time,Buy/Sell,Quantity,Price,Commission,AssetClass,Code
U1234567,AAPL,20260105;093000,BUY,1,100,-1,STK,O
U1234567,AAPL,20260105;100000,SELL,-1,110,-1,STK,C`,
  },
  {
    format: "ibkr",
    pnl: 8,
    content: `Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,USD,AAPL,"2026-01-05, 09:30:00",1,100,100,-100,-1,101,0,0,O
Trades,Data,Order,Stocks,USD,AAPL,"2026-01-05, 10:00:00",-1,110,110,110,-1,-101,8,0,C`,
  },
  {
    format: "webull",
    pnl: 10,
    content: `Symbol,Side,Status,Filled/Total Qty,Price/Avg Price,Filled Time
AAPL,Buy,Filled,1/1,100/100,2026-01-05 09:30:00
AAPL,Sell,Filled,1/1,110/110,2026-01-05 10:00:00`,
  },
  {
    format: "das-trader",
    pnl: 10,
    content: `Symb,B/S,Qty,Price,Date,Time
AAPL,Buy,1,100,2026-01-05,09:30:00
AAPL,Sell,1,110,2026-01-05,10:00:00`,
  },
  {
    format: "thinkorswim",
    pnl: 10,
    content: `Account Trade History
Exec Time,Symbol,Side,Qty,Price
2026-01-05 09:30:00,AAPL,BUY,1,100
2026-01-05 10:00:00,AAPL,SELL,1,110

`,
  },
  {
    format: "tradezella",
    pnl: 8,
    content: `Open Date,Close Date,Symbol,Side,Volume,Entry Price,Exit Price,Net P&L,Commissions
2026-01-05 09:30:00,2026-01-05 10:00:00,AAPL,LONG,1,100,110,8,2`,
  },
  {
    format: "metatrader",
    pnl: 10,
    content: `<html>MetaTrader 4 Closed Transactions<table><tr><td>12345</td><td>2026.01.05 09:30</td><td>buy</td><td>1</td><td>eurusd</td><td>100</td><td>0</td><td>0</td><td>2026.01.05 10:00</td><td>110</td><td>0</td><td>0</td><td>0</td><td>10</td></tr></table></html>`,
  },
];
it.each(cases)(
  "$format previews, saves and reimports without changing trades or reviews",
  async ({ format, content, pnl }) => {
    const preview = await post({ mode: "preview", content, timeZone: "UTC", accountId: "test" });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ detected: format, totals: { executions: 2 } });
    expect(db.select().from(executions).all()).toHaveLength(0);
    const first = await post({ mode: "commit", content, timeZone: "UTC", accountId: "test" });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ inserted: 2, duplicates: 0 });
    const saved = db.select().from(trades).all();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      direction: "long",
      quantity: 1,
      openQuantity: 0,
      netPnl: pnl,
    });
    db.update(trades)
      .set({ notes: "Keep review", rating: 5 })
      .where(eq(trades.key, saved[0]!.key))
      .run();
    const repeat = await post({ mode: "commit", content, timeZone: "UTC", accountId: "test" });
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(db.select().from(executions).all()).toHaveLength(2);
    expect(db.select().from(trades).all()[0]).toMatchObject({
      key: saved[0]!.key,
      netPnl: pnl,
      notes: "Keep review",
      rating: 5,
    });
  },
);

it.each(["UTC", "America/New_York"])(
  "blocks unsafe IBKR reimports over old midnight timestamps (%s)",
  async (timeZone) => {
    const { parseAuto } = await import("@luxalgo/journal-importers");
    const { insertExecutions } = await import("../src/server/executions");
    const content = cases.find((test) => test.format === "ibkr")!.content;
    const parsed = parseAuto(content, { timeZone })!;
    const legacy = parsed.executions.map(({ legacyExecutedAt, ...row }) => ({
      ...row,
      executedAt: legacyExecutedAt!,
    }));
    insertExecutions("test", legacy, "import");
    const before = db.select().from(executions).all();
    db.update(trades).set({ notes: "Legacy review" }).run();
    const response = await post({ mode: "commit", content, accountId: "test", timeZone });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("older parser");
    expect(db.select().from(executions).all()).toEqual(before);
    expect(db.select().from(trades).all()[0]?.notes).toBe("Legacy review");
  },
);

it("blocks reimports over rounded fractional timestamps without affecting manual entries", async () => {
  const { insertExecutions } = await import("../src/server/executions");
  const content = cases
    .find((test) => test.format === "tradingview")!
    .content.replace("09:30:00", "09:30:00.123")
    .replace("10:00:00", "10:00:00.456");
  const { parseAuto } = await import("@luxalgo/journal-importers");
  const parsed = parseAuto(content, { timeZone: "UTC" })!;
  insertExecutions(
    "test",
    parsed.executions.map((row) => ({
      ...row,
      executedAt: row.executedAt.replace(/\.\d{3}Z$/, ".000Z"),
    })),
    "import",
  );
  const before = db.select().from(executions).all();
  const response = await post({ mode: "commit", content, accountId: "test", timeZone: "UTC" });
  expect(response.status).toBe(400);
  expect(db.select().from(executions).all()).toEqual(before);
  expect(insertExecutions("test", parsed.executions, "manual").inserted).toBe(2);
});
