import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

const scratch = mkdtempSync(join(tmpdir(), "journal-hyperliquid-import-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
vi.stubEnv("JOURNAL_PASSWORD", "");
const { db, accounts, executions, trades } = await import("../src/db");
const { encryptJson } = await import("../src/server/crypto");
const { insertExecutions } = await import("../src/server/executions");
const { POST } = await import("../src/app/api/import/route");

// Reporter-provided, anonymized export from issue #53.
const sample = readFileSync(
  new URL(
    "../../../packages/importers/tests/fixtures/hyperliquid-trade-history.csv",
    import.meta.url,
  ),
  "utf8",
);
const csv = (rows: string[]) => ["time,coin,dir,px,sz,ntl,fee,closedPnl", ...rows].join("\n");
const post = async (body: object) => {
  const response = await POST(
    new Request("http://localhost/api/import", { method: "POST", body: JSON.stringify(body) }),
  );
  return { status: response.status, body: await response.json() };
};
const preview = (accountId: string, content: string, timeZone = "UTC") =>
  post({ mode: "preview", accountId, content, timeZone });
const commit = (accountId: string, content: string, timeZone = "UTC") =>
  post({ mode: "commit", accountId, content, timeZone });
const stored = (accountId: string) =>
  db.select().from(executions).where(eq(executions.accountId, accountId)).all();
const journal = (accountId: string) =>
  db
    .select()
    .from(trades)
    .where(eq(trades.accountId, accountId))
    .all()
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt));

// Broker sync's history reaches back only to Oct 2, where it closed a long
// opened the day before, so sync alone shows a short that never existed.
const sync = () =>
  insertExecutions(
    "hl",
    [
      ["sell", 3100, "2026-10-02T09:00:00.123Z"],
      ["buy", 3050, "2026-10-03T10:00:00.456Z"],
    ].map(([side, price, executedAt]) => ({
      symbol: "ETH",
      side: side as "buy" | "sell",
      quantity: 1,
      price: price as number,
      fee: 0.5,
      executedAt: executedAt as string,
    })),
    "sync",
  );
// The same wallet's export: one older fill, then the two fills sync already has.
const history = csv([
  "10/1/2026 - 09:00:00,ETH,Open Long,3000,1,3000,0.5,-0.5",
  "10/2/2026 - 09:00:00,ETH,Close Long,3100,1,3100,0.5,99.5",
  "10/3/2026 - 10:00:00,ETH,Open Long,3050,1,3050,0.5,-0.5",
]);

beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  const account = (id: string, extra: Partial<typeof accounts.$inferInsert> = {}) =>
    db
      .insert(accounts)
      .values({ id, name: id, kind: "import", createdAt: "2026-01-01", ...extra })
      .run();
  account("file");
  account("hl", {
    kind: "sync",
    broker: "hyperliquid",
    credentialsEnc: encryptJson({ walletAddress: `0x${"1".repeat(40)}` }),
  });
  account("ibkr", {
    kind: "sync",
    broker: "ibkr-flex",
    credentialsEnc: encryptJson({ flexToken: "test-only", flexQueryId: "test-only" }),
  });
});
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

describe("Hyperliquid history files", () => {
  it("import every perpetual fill into a journal account, and importing again adds nothing", async () => {
    const { body } = await preview("file", sample);
    expect(body).toMatchObject({ detected: "hyperliquid", totals: { executions: 100 } });
    expect((await commit("file", sample)).body).toMatchObject({ inserted: 100, duplicates: 0 });
    expect((await commit("file", sample)).body).toMatchObject({ inserted: 0, duplicates: 100 });
    expect(stored("file")).toHaveLength(100);
  });

  it("add only the history older than a synced account's first synced fill", async () => {
    sync();
    expect(journal("hl")).toMatchObject([{ direction: "short", grossPnl: 50 }]);

    const { body } = await preview("hl", history);
    expect(body.errors ?? []).toEqual([]);
    expect(body.totals.executions).toBe(1);
    expect(body.warnings.join(" ")).toMatch(
      /2 fill\(s\) at or after this account's first synced fill \(2026-10-02T09:00:00\.123Z\) are left to broker sync/,
    );
    expect((await commit("hl", history)).body).toMatchObject({ inserted: 1, duplicates: 2 });
    expect(stored("hl")).toHaveLength(3);
    expect(journal("hl")).toMatchObject([
      { direction: "long", status: "win", grossPnl: 100 },
      { direction: "long", status: "open", openQuantity: 1 },
    ]);
    expect((await commit("hl", history)).body).toMatchObject({ inserted: 0, duplicates: 3 });
  });

  it("are refused when their times don't line up with synced fills, so nothing is stored twice", async () => {
    sync();
    // The file was read in the wrong timezone: every fill lands four hours late.
    const { body } = await preview("hl", history, "America/New_York");
    expect(body.errors.join(" ")).toMatch(/None of this file's 1 fill\(s\) from .* match/);
    expect((await commit("hl", history, "America/New_York")).status).toBe(400);
    expect(stored("hl")).toHaveLength(2);
  });

  it("are refused by an account that syncs from another broker", async () => {
    expect((await preview("ibkr", history)).body.errors.join(" ")).toMatch(/another broker/);
    expect((await commit("ibkr", history)).status).toBe(400);
  });

  it("wait for a Hyperliquid account's first sync, so sync and file can't overlap", async () => {
    expect((await preview("hl", history)).body.errors.join(" ")).toMatch(
      /Sync this Hyperliquid account before importing/,
    );
    expect((await commit("hl", history)).status).toBe(400);
    expect(stored("hl")).toHaveLength(0);
  });
});
