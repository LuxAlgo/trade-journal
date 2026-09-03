import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImportedExecution } from "@luxalgo/journal-importers";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-storage-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, executions, trades } = await import("../src/db");
const { insertExecutions } = await import("../src/server/executions");
const rows: ImportedExecution[] = [
  {
    symbol: "TEST",
    side: "buy",
    quantity: 10,
    price: 100,
    fee: 0,
    executedAt: "2026-09-01T10:00:00Z",
  },
  {
    symbol: "TEST",
    side: "sell",
    quantity: 10,
    price: 102,
    fee: 0,
    executedAt: "2026-09-01T11:00:00Z",
  },
];

beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.insert(accounts)
    .values({ id: "test", name: "Test", kind: "manual", createdAt: "2026-01-01" })
    .run();
});
afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("execution storage preserves a coherent journal", () => {
  it("rejects missing accounts and invalid fills before inserting data", () => {
    expect(() => insertExecutions("missing", rows, "manual")).toThrow("Account not found");
    for (const invalid of [
      { quantity: Infinity },
      { quantity: 0 },
      { fee: NaN },
      { executedAt: "invalid" },
      { side: "hold" },
      { symbol: " " },
    ]) {
      expect(() =>
        insertExecutions(
          "test",
          [rows[0]!, { ...rows[1]!, ...invalid } as ImportedExecution],
          "manual",
        ),
      ).toThrow();
    }
    expect(db.select().from(executions).all()).toHaveLength(0);
  });

  it("rolls back the fills if calculating their trades fails", () => {
    db.$client.exec(
      "CREATE TRIGGER fail_trade BEFORE INSERT ON trades BEGIN SELECT RAISE(FAIL, 'test storage failure'); END",
    );
    try {
      expect(() => insertExecutions("test", rows, "manual")).toThrow();
      expect(db.select().from(executions).all()).toHaveLength(0);
      expect(db.select().from(trades).all()).toHaveLength(0);
    } finally {
      db.$client.exec("DROP TRIGGER fail_trade");
    }
  });

  it("deduplicates repeated imports while keeping the calculated total", () => {
    expect(insertExecutions("test", rows, "manual")).toMatchObject({ inserted: 2, duplicates: 0 });
    expect(insertExecutions("test", rows, "manual")).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(db.select().from(executions).all()).toHaveLength(2);
    expect(db.select().from(trades).all()[0]?.netPnl).toBe(20);
  });
});
