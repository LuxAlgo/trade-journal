import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@luxalgo/broker-sdk", () => ({
  connect: vi.fn(),
  listBrokers: vi.fn(),
}));

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-ibkr-timezone-"));
process.env.JOURNAL_DATA_DIR = scratch;

const { connect } = await import("@luxalgo/broker-sdk");
const { accounts, db, executions, settings, trades } = await import("../src/db");
const { encryptJson } = await import("../src/server/crypto");
const { setSetting } = await import("../src/server/settings");
const { syncAccount } = await import("../src/server/sync");

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.insert(accounts)
    .values({
      id: "ibkr",
      name: "IBKR",
      broker: "ibkr-flex",
      kind: "sync",
      credentialsEnc: encryptJson({ token: "fixture", queryId: "fixture" }),
      createdAt: "2026-01-01",
    })
    .run();
});

afterAll(() => {
  vi.unstubAllGlobals();
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("IBKR Flex live sync timezone", () => {
  it("interprets naive statement timestamps in the configured import timezone", async () => {
    setSetting("importTimeZone", "Asia/Singapore");
    const xml = `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1">
      <Trade assetCategory="STK" symbol="NVDA" dateTime="20260102;100000"
        buySell="BUY" quantity="1" tradePrice="100" transactionID="tx-1" />
    </FlexStatement></FlexStatements></FlexQueryResponse>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(xml, { status: 200 })),
    );
    vi.mocked(connect).mockImplementation(((options: { fetch: typeof globalThis.fetch }) => ({
      fetchSnapshot: async () => {
        await options.fetch("https://fixture.invalid/flex");
        return {
          fetchedAt: "2026-01-03T00:00:00.000Z",
          accounts: [{ equity: 0, positions: [], trades: [] }],
        };
      },
    })) as unknown as typeof connect);

    await syncAccount("ibkr");

    expect(db.select().from(executions).all()).toEqual([
      expect.objectContaining({
        symbol: "NVDA",
        executedAt: "2026-01-02T02:00:00.000Z",
      }),
    ]);
  });
});
