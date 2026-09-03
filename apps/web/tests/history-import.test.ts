import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { parseHistory } from "@luxalgo/journal-importers";
import { BOOTSTRAP_SQL } from "../src/db/bootstrap";
import { decodeImportFile } from "../src/lib/decode-import";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-history-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
// Exercise upgrading an existing database, not only creation of a fresh schema.
const oldDb = new Database(join(scratch, "journal.db"));
oldDb.exec(BOOTSTRAP_SQL.replace("  import_metadata_json TEXT,\n", ""));
oldDb.exec(
  "INSERT INTO accounts(id,name,kind,created_at) VALUES ('legacy','Existing','manual','2026-01-01')",
);
oldDb.close();
const { db, accounts, executions, trades, settings } = await import("../src/db");
const { insertExecutions } = await import("../src/server/executions");
const { rebuildAccount } = await import("../src/server/rebuild");
const { POST: importRoute } = await import("../src/app/api/import/route");
const post = async (body: object) =>
  importRoute(
    new Request("http://localhost/api/import", { method: "POST", body: JSON.stringify(body) }),
  );
// A TradingView strategy export: auto-detected, trade-level, two identical positions.
const csv = `Symbol;FX:EURUSD
Trade #;Type;Date/Time;Price;Contracts;Profit;Profit %
1;Entry long;2026-01-05 09:00;1.1;0.1;18.5;1
1;Exit long;2026-01-05 10:00;1.102;0.1;18.5;1
2;Entry long;2026-01-05 09:00;1.1;0.1;18.5;1
2;Exit long;2026-01-05 10:00;1.102;0.1;18.5;1`;
beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(settings).run();
  db.delete(accounts).where(eq(accounts.id, "test")).run();
  db.insert(accounts)
    .values({ id: "test", name: "Test", kind: "import", createdAt: "2026-01-01" })
    .run();
});
afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("history imports use the existing preview, commit and rebuild pipeline", () => {
  it("adds storage metadata to an existing database without removing its account", () => {
    expect(db.select().from(accounts).where(eq(accounts.id, "legacy")).get()?.name).toBe(
      "Existing",
    );
    expect(
      (db.$client.pragma("table_info(executions)") as { name: string }[]).some(
        (c) => c.name === "import_metadata_json",
      ),
    ).toBe(true);
  });
  it("previews without writes, commits once, and preserves separate positions and annotations on rebuild", async () => {
    const preview = await post({ mode: "preview", content: csv });
    expect(preview.status).toBe(200);
    expect((await preview.json()).totals.executions).toBe(4);
    expect(db.select().from(executions).all()).toHaveLength(0);
    const first = await post({ mode: "commit", content: csv, accountId: "test" });
    expect((await first.json()).inserted).toBe(4);
    expect(db.select().from(trades).all()).toHaveLength(2);
    const saved = db.select().from(trades).all()[0]!;
    db.update(trades)
      .set({ notes: "User-owned note", rating: 5 })
      .where(eq(trades.key, saved.key))
      .run();
    const second = await post({ mode: "commit", content: csv, accountId: "test" });
    expect(await second.json()).toMatchObject({ inserted: 0, duplicates: 4 });
    rebuildAccount("test");
    expect(db.select().from(trades).where(eq(trades.key, saved.key)).get()).toMatchObject({
      netPnl: 18.5,
      notes: "User-owned note",
      rating: 5,
    });
  });
  it("retains legitimately identical generic fills and deduplicates reimports", () => {
    const content = `Timestamp,Ticker,Buy/Sell,Fill Quantity,Execution Price
2026-01-05 09:00,AAPL,buy,1,100
2026-01-05 09:00,AAPL,buy,1,100
2026-01-05 10:00,AAPL,sell,2,101`;
    const parsed = parseHistory(content, { adapterId: "generic-csv" })!;
    expect(insertExecutions("test", parsed.executions, "import")).toMatchObject({
      inserted: 3,
      duplicates: 0,
    });
    expect(insertExecutions("test", parsed.executions, "import")).toMatchObject({
      inserted: 0,
      duplicates: 3,
    });
    expect(db.select().from(trades).all()[0]).toMatchObject({ quantity: 2, netPnl: 2 });
  });
  it("blocks missing-symbol commits and uses the same supplied symbol in preview and commit", async () => {
    const content = `Trade #,Type,Date/Time,Price,Contracts,Profit
1,Entry long,2026-01-05 09:00,100,1,1
1,Exit long,2026-01-05 10:00,101,1,1`;
    expect((await (await post({ mode: "preview", content })).json()).needsSymbol).toBe(true);
    expect((await post({ mode: "commit", content, accountId: "test" })).status).toBe(400);
    expect(db.select().from(executions).all()).toHaveLength(0);
    const preview = await (await post({ mode: "preview", content, symbol: "AAPL" })).json();
    expect(preview.executions.every((e: { symbol: string }) => e.symbol === "AAPL")).toBe(true);
    expect(
      (await post({ mode: "commit", content, symbol: "AAPL", accountId: "test" })).status,
    ).toBe(200);
    expect(db.select().from(trades).all()[0]?.symbol).toBe("AAPL");
  });
  it("does not replace reported zero fees or P&L with account defaults or multiplier recalculations", () => {
    db.insert(settings)
      .values({
        key: "journalDefaults",
        value: JSON.stringify({
          feeRules: [{ id: "fee", accountId: "test", symbol: "", amount: 5, mode: "execution" }],
        }),
      })
      .run();
    db.insert(settings)
      .values({ key: "multipliers", value: JSON.stringify({ AAPL: 100 }) })
      .run();
    const parsed = parseHistory(
      `Position,Symbol,Direction,Open Time,Close Time,Entry Price,Exit Price,Quantity,PnL,Fees
1,AAPL,long,2026-01-05 09:00,2026-01-05 10:00,100,101,1,1,0`,
      { adapterId: "generic-csv" },
    )!;
    insertExecutions("test", parsed.executions, "import");
    rebuildAccount("test");
    expect(db.select().from(trades).all()[0]).toMatchObject({ netPnl: 1, fees: 0, grossPnl: 1 });
  });

  it("retains the mapped import through both preview and commit", async () => {
    const content = "When,Ticker,Way,Amount,Cost\n2026-01-05 09:00,AAPL,bought,2,100";
    const mapping = {
      timestamp: "When",
      symbol: "Ticker",
      side: "Way",
      quantity: "Amount",
      price: "Cost",
    };
    expect(
      (await (await post({ mode: "preview", content, mapping })).json()).totals.executions,
    ).toBe(1);
    expect(
      await (await post({ mode: "commit", content, mapping, accountId: "test" })).json(),
    ).toMatchObject({ inserted: 1 });
  });
});

describe("file decoding", () => {
  it("reads UTF-8, UTF-16LE and UTF-16BE without damaging non-ASCII text", () => {
    const value = "<html>EURUSD 日本語</html>";
    const utf8 = new TextEncoder().encode(value);
    const le = Buffer.from("\ufeff" + value, "utf16le");
    const be = Buffer.from(le).swap16();
    for (const bytes of [utf8, le, be]) {
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      expect(decodeImportFile(buffer)).toBe(value);
    }
  });
});
