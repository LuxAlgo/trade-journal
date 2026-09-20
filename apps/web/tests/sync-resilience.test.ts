import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImportedExecution } from "@luxalgo/journal-importers";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-sync-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, executions, trades } = await import("../src/db");
const { insertExecutions, partitionExecutions } = await import("../src/server/executions");

const good: ImportedExecution = {
  symbol: "ES",
  side: "buy",
  quantity: 1,
  price: 5000,
  fee: 1.2,
  executedAt: "2026-09-01T10:00:00Z",
};
const mixed = [
  good,
  { ...good, side: "sell", price: NaN, executedAt: "2026-09-01T11:00:00Z" },
  { ...good, quantity: 0, executedAt: "2026-09-01T12:00:00Z" },
  { ...good, fee: Infinity, executedAt: "2026-09-01T13:00:00Z" },
  { ...good, side: "sell", price: 5010, executedAt: "2026-09-01T14:00:00Z" },
] as ImportedExecution[];

beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.insert(accounts)
    .values({ id: "broker", name: "Broker", kind: "sync", createdAt: "2026-01-01" })
    .run();
});
afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("one odd broker record does not fail the whole sync", () => {
  it("keeps the valid fills from a mixed broker batch and reports how many were skipped", () => {
    const result = insertExecutions("broker", mixed, "sync");
    expect(result.inserted).toBe(2);
    expect(result.duplicates).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.skippedReasons).toHaveLength(3);
    expect(result.skippedReasons.join(" ")).toMatch(/price/);
    expect(result.skippedReasons.join(" ")).toMatch(/quantity/);
    expect(result.skippedReasons.join(" ")).toMatch(/fee/);
    expect(db.select().from(executions).all()).toHaveLength(2);
  });

  it("skips invalid rows from an imported file instead of rejecting the file", () => {
    const result = insertExecutions("broker", mixed, "import");
    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(3);
  });

  it("still rejects a manually entered batch when any fill is invalid", () => {
    expect(() => insertExecutions("broker", mixed, "manual")).toThrow();
    expect(db.select().from(executions).all()).toHaveLength(0);
  });

  it("caps the list of skip reasons so a large broken batch stays reportable", () => {
    const broken = Array.from({ length: 20 }, (_, i) => ({
      ...good,
      quantity: -1,
      executedAt: `2026-09-01T10:${String(i).padStart(2, "0")}:00Z`,
    }));
    const { skipped, skippedReasons, usable } = partitionExecutions(broken, "sync");
    expect(skipped).toBe(20);
    expect(usable).toHaveLength(0);
    expect(skippedReasons.length).toBeLessThanOrEqual(5);
  });

  it("enriches an existing broker fill without duplicating it", () => {
    expect(insertExecutions("broker", [good], "sync")).toMatchObject({
      inserted: 1,
      duplicates: 0,
    });
    const enriched: ImportedExecution = {
      ...good,
      importMetadata: {
        id: "ibkr-trade:t1",
        order: 0,
        preserveFee: true,
        broker: {
          provider: "ibkr-flex",
          kind: "trade",
          tradeId: "t1",
          orderId: "order-1",
          strategyGroupId: "ibkr-order:U1:order-1",
        },
      },
    };
    expect(insertExecutions("broker", [enriched], "sync")).toMatchObject({
      inserted: 0,
      duplicates: 1,
    });
    const saved = db.select().from(executions).all();
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0]!.importMetadataJson!)).toMatchObject({
      broker: { tradeId: "t1", strategyGroupId: "ibkr-order:U1:order-1" },
    });
  });

  it("deduplicates one IBKR transaction across XML import and live sync", () => {
    const flex: ImportedExecution = {
      ...good,
      importMetadata: {
        id: "ibkr-trade:U1:transaction-1",
        group: "ibkr-account:U1",
        order: 0,
        preserveFee: true,
        broker: {
          provider: "ibkr-flex",
          kind: "trade",
          accountId: "U1",
          transactionId: "transaction-1",
        },
      },
    };

    expect(insertExecutions("broker", [flex], "import")).toMatchObject({
      inserted: 1,
      duplicates: 0,
    });
    expect(insertExecutions("broker", [flex], "sync")).toMatchObject({
      inserted: 0,
      duplicates: 1,
    });
    expect(db.select().from(executions).all()).toHaveLength(1);
  });

  it("migrates a legacy sync hash when XML later supplies the broker ID", () => {
    expect(insertExecutions("broker", [good], "sync")).toMatchObject({ inserted: 1 });
    const uploaded: ImportedExecution = {
      ...good,
      importMetadata: {
        id: "ibkr-trade:U1:transaction-1",
        group: "ibkr-account:U1",
        order: 0,
        preserveFee: true,
        broker: {
          provider: "ibkr-flex",
          kind: "trade",
          accountId: "U1",
          transactionId: "transaction-1",
        },
      },
    };

    expect(insertExecutions("broker", [uploaded], "import")).toMatchObject({
      inserted: 0,
      duplicates: 1,
    });
    const saved = db.select().from(executions).all();
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0]!.importMetadataJson!)).toMatchObject({
      id: "ibkr-trade:U1:transaction-1",
      broker: { transactionId: "transaction-1" },
    });
  });
});
