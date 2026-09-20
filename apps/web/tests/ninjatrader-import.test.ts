import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { ImportReviewOptions } from "../src/lib/import-review";
import { parseAuto } from "@luxalgo/journal-importers";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-ninjatrader-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, executions, trades, settings } = await import("../src/db");
const { insertExecutions } = await import("../src/server/executions");
const { rebuildAccount } = await import("../src/server/rebuild");
const { POST } = await import("../src/app/api/import/route");
const { PATCH: updateSettings } = await import("../src/app/api/settings/route");
const sample = readFileSync(
  new URL(
    "../../../packages/importers/tests/fixtures/ninjatrader-copy-trades.csv",
    import.meta.url,
  ),
  "utf8",
);
const request = (body: object) =>
  new Request("http://localhost/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const preview = async (content = sample, accountId = "test", review: ImportReviewOptions = {}) => {
  const response = await POST(
    request({ mode: "preview", content, accountId, timeZone: "UTC", review }),
  );
  expect(response.status).toBe(200);
  return response.json();
};
const commit = async (content = sample, accountId = "test", review: ImportReviewOptions = {}) => {
  const inspected = await preview(content, accountId, review);
  return POST(
    request({
      mode: "commit",
      content,
      accountId,
      timeZone: "UTC",
      review: { ...review, previewToken: inspected.reconciliation?.token ?? undefined },
    }),
  );
};
const csv = (rows: string[]) =>
  [
    "Instrument,Action,Quantity,Price,Time,Account,Connection,Execution ID,Commission",
    ...rows,
  ].join("\n");
const accountTrades = () => db.select().from(trades).where(eq(trades.accountId, "test")).all();

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.insert(accounts)
    .values(
      ["test", "other"].map((id) => ({
        id,
        name: id,
        kind: "import" as const,
        createdAt: "2026-01-01",
      })),
    )
    .run();
  db.insert(settings)
    .values({ key: "multipliers", value: JSON.stringify({ MNQZ6: 2 }) })
    .run();
});
afterAll(() => {
  vi.unstubAllEnvs();
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("NinjaTrader imports through preview, storage and rebuild", () => {
  it("imports the issue #10 attachment as 26 fills, five closed trades and $5,265", async () => {
    const previewResponse = await POST(
      request({ mode: "preview", content: sample, timeZone: "UTC" }),
    );
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    expect(preview.totals).toMatchObject({ executions: 26, skippedRows: 0 });
    expect(preview.errors).toEqual([]);
    expect(preview.warnings.join(" ")).toContain("5 source accounts");
    expect(db.select().from(executions).all()).toHaveLength(0);
    const response = await commit();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ inserted: 26, duplicates: 0, skipped: 0 });
    expect(db.select().from(executions).all()).toHaveLength(26);
    const saved = accountTrades();
    expect(saved).toHaveLength(5);
    expect(
      saved.every(
        (t) => t.status === "win" && t.openQuantity === 0 && t.quantity === 12 && t.netPnl === 1053,
      ),
    ).toBe(true);
    expect(saved.reduce((sum, t) => sum + t.netPnl, 0)).toBe(5265);
    expect(saved.map((t) => t.executionCount).sort()).toEqual([5, 5, 5, 5, 6]);
  });

  it("deduplicates original and reordered reimports without changing trade keys or annotations", async () => {
    await commit();
    const saved = accountTrades();
    const key = saved[0]!.key;
    db.update(trades).set({ notes: "Keep my review", rating: 5 }).where(eq(trades.key, key)).run();
    const [header, ...rows] = sample.trim().split(/\r?\n/);
    for (const content of [sample, [header, ...rows.toReversed()].join("\n")]) {
      const response = await commit(content);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ inserted: 0, duplicates: 26 });
    }
    rebuildAccount("test");
    expect(
      accountTrades()
        .map((t) => t.key)
        .sort(),
    ).toEqual(saved.map((t) => t.key).sort());
    expect(db.select().from(trades).where(eq(trades.key, key)).get()).toMatchObject({
      notes: "Keep my review",
      rating: 5,
      netPnl: 1053,
    });
    expect(db.select().from(executions).all()).toHaveLength(26);
  });

  it("reconciles a complete growing export and permits independent destination accounts", async () => {
    await commit();
    const extra =
      "MNQZ6,Buy,9/16/2026 9:30,29400,Entry,TRADEIFY,1,ACCOUNT-1\nMNQZ6,Sell,9/16/2026 9:31,29402,Exit,TRADEIFY,1,ACCOUNT-1";
    expect(
      await (await commit(sample.trim() + "\n" + extra, "test", { completeHistory: true })).json(),
    ).toMatchObject({
      inserted: 2,
      duplicates: 26,
    });
    expect(accountTrades()).toHaveLength(6);
    expect(accountTrades().reduce((sum, t) => sum + t.netPnl, 0)).toBe(5269);
    expect(await (await commit(sample, "other")).json()).toMatchObject({
      inserted: 26,
      duplicates: 0,
    });
  });

  it("keeps opposite source-account positions separate and deduplicates broker execution IDs", async () => {
    const content = csv([
      "AAPL,Buy,1,100,2026-09-15 09:30,A,broker,e1,0",
      "AAPL,Buy,1,100,2026-09-15 09:30,A,broker,e1,0",
      "AAPL,Buy,1,100,2026-09-15 09:30,A,broker,e2,0",
      "AAPL,Sell,2,100,2026-09-15 09:30,B,broker,e1,0",
    ]);
    expect(await (await commit(content)).json()).toMatchObject({ inserted: 3, duplicates: 1 });
    expect(accountTrades()).toHaveLength(2);
    expect(
      accountTrades()
        .map((t) => [t.direction, t.openQuantity])
        .sort(),
    ).toEqual([
      ["long", 2],
      ["short", 2],
    ]);
  });

  it("blocks reimports into an account containing legacy lossy fills, without touching reviews", async () => {
    const old = parseAuto(sample)!.executions.map(({ importMetadata, ninjaTrader, ...row }) => row);
    expect(insertExecutions("test", old, "import")).toMatchObject({ inserted: 5, duplicates: 21 });
    const key = accountTrades()[0]!.key;
    db.update(trades).set({ notes: "Existing review", rating: 4 }).where(eq(trades.key, key)).run();
    const before = db.select().from(executions).all();
    const response = await commit();
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("new journal account");
    expect(db.select().from(executions).all()).toEqual(before);
    expect(db.select().from(trades).where(eq(trades.key, key)).get()).toMatchObject({
      notes: "Existing review",
      rating: 4,
    });
    expect(await (await commit(sample, "other")).json()).toMatchObject({
      inserted: 26,
      duplicates: 0,
    });
    expect(
      db
        .select()
        .from(trades)
        .where(eq(trades.accountId, "other"))
        .all()
        .reduce((sum, t) => sum + t.netPnl, 0),
    ).toBe(5265);
  });

  it("rejects changed execution details and mixed identity layouts atomically", async () => {
    const original = csv(["AAPL,Buy,1,100,2026-09-15 09:30,A,broker,e1,0"]);
    await commit(original);
    const changed = csv([
      "AAPL,Buy,1,100,2026-09-15 09:31,A,broker,new,0",
      "AAPL,Buy,1,101,2026-09-15 09:30,A,broker,e1,0",
    ]);
    const response = await commit(changed);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("has changed quantity");
    expect(db.select().from(executions).all()).toHaveLength(1);
    const noIds = original.replace("Execution ID", "Order ID");
    const mixed = await commit(noIds);
    expect(mixed.status).toBe(400);
    expect((await mixed.json()).error).toContain("different execution-ID layouts");
    expect(db.select().from(executions).all()).toHaveLength(1);
  });

  it("blocks legacy fills whose fractional seconds were previously lost", async () => {
    const content = csv(["AAPL,Buy,1,100,2026-09-15 09:30:00.123,A,broker,e1,0"]);
    const legacy = parseAuto(content)!.executions.map(
      ({ importMetadata, ninjaTrader, ...row }) => ({
        ...row,
        executedAt: "2026-09-15T09:30:00.000Z",
      }),
    );
    insertExecutions("test", legacy, "import");
    const before = db.select().from(executions).all();
    const response = await commit(content);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("legacy fills");
    expect(db.select().from(executions).all()).toEqual(before);
  });

  it("blocks conflicting native IDs in the uploaded file before any write", async () => {
    const content = csv([
      "AAPL,Buy,1,100,2026-09-15 09:30,A,broker,e1,0",
      "AAPL,Buy,1,101,2026-09-15 09:30,A,broker,e1,0",
    ]);
    expect((await commit(content)).status).toBe(400);
    expect(db.select().from(executions).all()).toHaveLength(0);
  });

  it("preserves reported zero commissions despite account fee defaults", async () => {
    db.insert(settings)
      .values({
        key: "journalDefaults",
        value: JSON.stringify({
          feeRules: [{ id: "fee", accountId: "test", symbol: "", amount: 5, mode: "execution" }],
        }),
      })
      .run();
    const content = csv([
      "AAPL,Buy,1,100,2026-09-15 09:30,A,broker,e1,0",
      "AAPL,Sell,1,101,2026-09-15 09:31,A,broker,e2,0",
    ]);
    expect((await commit(content)).status).toBe(200);
    expect(accountTrades()[0]).toMatchObject({ netPnl: 1, fees: 0 });
  });

  it("requires the exact contract multiplier before committing the sample", async () => {
    db.delete(settings).run();
    expect((await commit()).status).toBe(400);
    expect(accountTrades()).toHaveLength(0);
    const response = await updateSettings(
      new Request("http://localhost/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ multipliers: { MNQZ6: 2 } }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await commit()).status).toBe(200);
    expect(accountTrades().reduce((sum, t) => sum + t.netPnl, 0)).toBe(5265);
  });
});
