import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "journal-identical-fills-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
const { db, accounts, executions, trades } = await import("../src/db");
const { encryptJson } = await import("../src/server/crypto");
const { syncAccount } = await import("../src/server/sync");
const { insertExecutions, partitionExecutions } = await import("../src/server/executions");
const { brokerTradesToExecutions } = await import("../src/server/broker-trades");

// Hyperliquid userFills rows, as broker-sdk's Hyperliquid adapter reads them.
const fill = (side: "A" | "B", px: string, sz: string, time: number, tid: number) => ({
  coin: "ETH",
  side,
  px,
  sz,
  time,
  fee: "0.5",
  tid,
});
// Issue #50: a closed short, then a new short on the same coin that is still open.
// One marketable buy closed the first short in two identical partial fills.
const opened = Date.UTC(2026, 9, 1, 9, 0, 0, 120);
const closed = Date.UTC(2026, 9, 1, 10, 0, 0, 450);
const reopened = Date.UTC(2026, 9, 1, 11, 0, 0, 900);
const history = [
  fill("A", "3000", "1", opened, 1),
  fill("B", "2900", "0.5", closed, 2),
  fill("B", "2900", "0.5", closed, 3),
  fill("A", "2950", "1", reopened, 4),
];
let userFills = history;

beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.insert(accounts)
    .values({
      id: "hl",
      name: "Hyperliquid",
      kind: "sync",
      broker: "hyperliquid",
      credentialsEnc: encryptJson({ walletAddress: `0x${"1".repeat(40)}` }),
      createdAt: "2026-01-01",
    })
    .run();
  userFills = history;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (_input, init) => {
      const { type } = JSON.parse(String(init?.body)) as { type: string };
      if (type === "clearinghouseState")
        return Response.json({ marginSummary: { accountValue: "1000" }, assetPositions: [] });
      if (type === "spotClearinghouseState") return Response.json({ balances: [] });
      if (type === "userFills") return Response.json(userFills);
      throw new Error(`Unexpected Hyperliquid request: ${type}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

const journal = () =>
  db
    .select()
    .from(trades)
    .all()
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt));

describe("broker sync keeps every fill, even identical partial fills", () => {
  it("a short closed by two identical partial fills shows as closed before the next short opens", async () => {
    expect(await syncAccount("hl")).toMatchObject({ inserted: 4, duplicates: 0 });
    expect(db.select().from(executions).all()).toHaveLength(4);
    expect(journal()).toMatchObject([
      { direction: "short", status: "win", quantity: 1, grossPnl: 100, netPnl: 98.5 },
      { direction: "short", status: "open", quantity: 1, openQuantity: 1 },
    ]);
  });

  it("syncing the same fills again adds nothing", async () => {
    await syncAccount("hl");
    const before = journal();
    expect(await syncAccount("hl")).toMatchObject({ inserted: 0, duplicates: 4 });
    expect(journal()).toEqual(before);
  });

  it("an account synced before this fix keeps its fills and gains only the missing copy", async () => {
    // What earlier versions stored: the second identical fill was dropped as a duplicate.
    const legacy = brokerTradesToExecutions([
      {
        symbol: "ETH",
        side: "sell",
        quantity: 1,
        price: 3000,
        fee: 0.5,
        executedAt: new Date(opened).toISOString(),
      },
      {
        symbol: "ETH",
        side: "buy",
        quantity: 0.5,
        price: 2900,
        fee: 0.5,
        executedAt: new Date(closed).toISOString(),
      },
      {
        symbol: "ETH",
        side: "sell",
        quantity: 1,
        price: 2950,
        fee: 0.5,
        executedAt: new Date(reopened).toISOString(),
      },
    ]).timed;
    insertExecutions("hl", legacy, "sync");
    const legacyIds = db.select({ id: executions.id }).from(executions).all();
    expect(journal()).toMatchObject([{ status: "open", openQuantity: 1.5 }]);

    expect(await syncAccount("hl")).toMatchObject({ inserted: 1, duplicates: 3 });
    expect(db.select({ id: executions.id }).from(executions).all()).toEqual(
      expect.arrayContaining(legacyIds),
    );
    expect(journal()).toMatchObject([
      { status: "win", grossPnl: 100, netPnl: 98.5 },
      { status: "open", quantity: 1 },
    ]);
  });

  it("identical fills keep their count however the broker orders them", async () => {
    userFills = [history[2]!, history[3]!, history[1]!, history[0]!];
    await syncAccount("hl");
    userFills = history;
    expect(await syncAccount("hl")).toMatchObject({ inserted: 0, duplicates: 4 });
    expect(db.select().from(executions).all()).toHaveLength(4);
  });

  it("only broker and file sources can number identical fills, with whole numbers from 1", () => {
    const [row] = brokerTradesToExecutions([
      { symbol: "ETH", side: "buy", quantity: 1, price: 2900, executedAt: "2026-10-01T10:00:00Z" },
    ]).timed;
    const problem = (occurrence: number, source: "sync" | "import" | "manual" = "sync") =>
      partitionExecutions([{ ...row!, occurrence }], source).skippedReasons[0];
    expect(problem(1)).toBeUndefined();
    expect(problem(2, "import")).toBeUndefined();
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(problem(bad)).toMatch(/copy number/);
    expect(() => insertExecutions("hl", [{ ...row!, occurrence: 1 }], "manual")).toThrow();
  });

  it("a later sync that sees fewer identical copies does not remove or re-add any", async () => {
    await syncAccount("hl");
    // The broker's history window moved past one copy; the stored copy stays.
    userFills = history.filter((row) => row.tid !== 3);
    expect(await syncAccount("hl")).toMatchObject({ inserted: 0, duplicates: 3 });
    expect(db.select().from(executions).all()).toHaveLength(4);
  });
});
