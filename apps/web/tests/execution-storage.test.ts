import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-storage-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, executions, trades } = await import("../src/db");
const { insertExecutions, normalizeStoredOptionExecutions } =
  await import("../src/server/executions");
const { rebuildAccount } = await import("../src/server/rebuild");
const { POST } = await import("../src/app/api/executions/route");
const { GET: getTrade } = await import("../src/app/api/trades/[key]/route");
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
  vi.stubEnv("JOURNAL_PASSWORD", "");
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.insert(accounts)
    .values({ id: "test", name: "Test", kind: "manual", createdAt: "2026-01-01" })
    .run();
});
afterAll(() => {
  vi.unstubAllEnvs();
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

  it("merges legacy OCC and canonical option fills from repeated broker syncs", () => {
    const common = {
      side: "buy" as const,
      quantity: 1,
      price: 0.62,
      fee: 1.55,
      executedAt: "2026-04-10T14:30:00Z",
    };
    insertExecutions(
      "test",
      [
        { ...common, symbol: "SPXW  260410C06865000" },
        { ...common, symbol: "SPXW 10APR26 6865 C", assetClass: "option" },
      ],
      "sync",
    );
    expect(db.select().from(executions).all()).toHaveLength(2);
    expect(db.select().from(trades).all()).toHaveLength(2);
    const legacyTrade = db
      .select()
      .from(trades)
      .all()
      .find((trade) => trade.symbol.includes("260410C"))!;
    db.update(trades)
      .set({ notes: "Keep the pre-migration review", tagsJson: '["spread"]' })
      .where(eq(trades.key, legacyTrade.key))
      .run();

    expect(normalizeStoredOptionExecutions("test")).toEqual({
      normalized: 0,
      duplicatesRemoved: 1,
    });
    expect(db.select().from(executions).all()).toEqual([
      expect.objectContaining({
        symbol: "SPXW 10APR26 6865 C",
        assetClass: "option",
      }),
    ]);
    expect(db.select().from(trades).all()).toEqual([
      expect.objectContaining({
        symbol: "SPXW 10APR26 6865 C",
        assetClass: "option",
        notes: "Keep the pre-migration review",
        tagsJson: '["spread"]',
      }),
    ]);
    expect(normalizeStoredOptionExecutions("test")).toEqual({
      normalized: 0,
      duplicatesRemoved: 0,
    });
  });

  it("drops a pre-id option twin once the canonical broker fill is stored", () => {
    const common = {
      side: "buy" as const,
      quantity: 1,
      price: 0.62,
      fee: 1.55,
      executedAt: "2026-04-10T14:30:00Z",
    };
    const metadata = {
      id: "ibkr-trade:U1:transaction-1",
      group: "ibkr-account:U1",
      order: 0,
      broker: {
        provider: "ibkr-flex" as const,
        kind: "trade" as const,
        transactionId: "transaction-1",
      },
    };
    insertExecutions("test", [{ ...common, symbol: "SPXW  260410C06865000" }], "sync");
    insertExecutions(
      "test",
      [
        {
          ...common,
          symbol: "SPXW 10APR26 6865 C",
          assetClass: "option",
          importMetadata: metadata,
        },
      ],
      "sync",
    );
    expect(db.select().from(executions).all()).toHaveLength(2);

    expect(normalizeStoredOptionExecutions("test")).toEqual({
      normalized: 0,
      duplicatesRemoved: 1,
    });
    const saved = db.select().from(executions).all();
    expect(saved).toEqual([
      expect.objectContaining({
        symbol: "SPXW 10APR26 6865 C",
        assetClass: "option",
      }),
    ]);
    expect(JSON.parse(saved[0]!.importMetadataJson!)).toMatchObject({
      id: "ibkr-trade:U1:transaction-1",
    });
  });

  it("keeps same-price option partials that have different broker ids", () => {
    const row = (id: string) => ({
      symbol: "SPXW 10APR26 6865 C",
      assetClass: "option" as const,
      side: "sell" as const,
      quantity: 1,
      price: 0.62,
      fee: 1.55,
      executedAt: "2026-04-10T14:30:00Z",
      importMetadata: {
        id: `ibkr-trade:U1:${id}`,
        group: "ibkr-account:U1",
        order: 0,
        broker: { provider: "ibkr-flex" as const, kind: "trade" as const, transactionId: id },
      },
    });
    expect(insertExecutions("test", [row("a"), row("b")], "sync")).toMatchObject({
      inserted: 2,
      duplicates: 0,
    });
    expect(normalizeStoredOptionExecutions("test")).toEqual({
      normalized: 0,
      duplicatesRemoved: 0,
    });
    expect(db.select().from(executions).all()).toHaveLength(2);
  });

  it("saves Markdown notes with manual trades and preserves them through a rebuild and retry", async () => {
    const notes = "## Setup\n\nWaited for **confirmation**.\n- Followed the plan.";
    const response = await POST(
      new Request("http://localhost/api/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: "test", executions: rows, notes }),
      }),
    );
    expect(response.status).toBe(200);
    const trade = db.select().from(trades).get()!;
    const detail = await getTrade(new Request("http://localhost/api/trades/fixture"), {
      params: Promise.resolve({ key: trade.key }),
    });
    expect((await detail.json()).trade.notes).toBe(notes);
    rebuildAccount("test");
    expect(insertExecutions("test", rows, "manual", notes)).toMatchObject({
      inserted: 0,
      duplicates: 2,
    });
    expect(db.select().from(trades).get()?.notes).toBe(notes);
  });

  it("appends exit notes to the correct position without changing unrelated trade notes", () => {
    insertExecutions("test", [rows[0]!], "manual", "Entry plan");
    insertExecutions(
      "test",
      rows.map((row) => ({ ...row, symbol: "OTHER" })),
      "manual",
      "Unrelated note",
    );
    insertExecutions("test", [rows[1]!], "manual", "Exit review");
    const saved = db.select().from(trades).all();
    expect(saved.find((row) => row.symbol === "TEST")).toMatchObject({
      notes: "Entry plan\n\nExit review",
      netPnl: 20,
    });
    expect(saved.find((row) => row.symbol === "OTHER")?.notes).toBe("Unrelated note");
  });

  it("keeps existing notes when a manual exit has no notes", () => {
    insertExecutions("test", [rows[0]!], "manual", "Keep this plan");
    insertExecutions("test", [rows[1]!], "manual", "   ");
    expect(db.select().from(trades).get()?.notes).toBe("Keep this plan");
  });

  it("saves notes for an already-recorded trade without duplicating fills or repeated notes", () => {
    insertExecutions("test", rows, "manual", "Entry plan");
    expect(insertExecutions("test", rows, "manual", "Later review")).toMatchObject({
      inserted: 0,
      duplicates: 2,
    });
    insertExecutions("test", rows, "manual", "Later review");
    expect(db.select().from(executions).all()).toHaveLength(2);
    expect(db.select().from(trades).get()?.notes).toBe("Entry plan\n\nLater review");
  });

  it("attaches a batch note to each trade formed by its new executions", () => {
    insertExecutions(
      "test",
      [
        ...rows,
        ...rows.map((row) => ({ ...row, executedAt: row.executedAt.replace("09-01", "09-02") })),
      ],
      "manual",
      "Session review",
    );
    const saved = db.select().from(trades).all();
    expect(saved).toHaveLength(2);
    expect(saved.every((row) => row.notes === "Session review")).toBe(true);
  });

  it("rejects invalid notes before inserting executions", async () => {
    for (const notes of [null, 42, {}, ["note"], "a".repeat(100001)]) {
      const response = await POST(
        new Request("http://localhost/api/executions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: "test", executions: rows, notes }),
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(db.select().from(executions).all()).toHaveLength(0);
    expect(db.select().from(trades).all()).toHaveLength(0);
  });

  it("rolls back new executions if appending notes exceeds the existing notes limit", () => {
    const existing = "a".repeat(100000);
    insertExecutions("test", [rows[0]!], "manual", existing);
    expect(() => insertExecutions("test", [rows[1]!], "manual", "Exit review")).toThrow(
      "Combined trade notes",
    );
    expect(db.select().from(executions).all()).toHaveLength(1);
    expect(db.select().from(trades).get()).toMatchObject({ notes: existing, status: "open" });
  });
});
