import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { netReturnOnEntry } from "@luxalgo/journal-core";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-trade-roi-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, trades, settings } = await import("../src/db");
const { setSetting } = await import("../src/server/settings");
const { GET } = await import("../src/app/api/trades/route");
const { GET: detail } = await import("../src/app/api/trades/[key]/route");

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  db.delete(trades).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.insert(accounts)
    .values({ id: "a", name: "Test", kind: "manual", createdAt: "2026-01-01" })
    .run();
  setSetting("multipliers", JSON.stringify({ MNQ: 2, SPREAD: 100 }));
  const fixtures = [
    { symbol: "MNQ", assetClass: "futures", avgEntry: 31157.25, quantity: 4, netPnl: 283 },
    { symbol: "SPREAD", assetClass: "option", avgEntry: -2.47, quantity: 1, netPnl: -1.3 },
    { symbol: "UNKNOWN", assetClass: "futures", avgEntry: 100, quantity: 1, netPnl: 10 },
    { symbol: "STOCK", assetClass: "equity", avgEntry: 100, quantity: 1, netPnl: 10 },
  ];
  db.insert(trades)
    .values(
      fixtures.map((trade, index) => ({
        key: trade.symbol,
        accountId: "a",
        direction: "long" as const,
        status: "win" as const,
        openedAt: `2026-10-0${index + 1}T10:00:00Z`,
        closedAt: `2026-10-0${index + 1}T11:00:00Z`,
        openQuantity: 0,
        grossPnl: trade.netPnl + 1.3,
        fees: 1.3,
        executionCount: 2,
        executionIdsJson: "[]",
        exitsJson: "[]",
        ...trade,
      })),
    )
    .run();
});

afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

it.each(["", "view=list"])(
  "provides matching ROI inputs on the list and detail APIs (%s)",
  async (query) => {
    const response = await GET(new Request(`http://localhost/api/trades?${query}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.trades.map((trade: { contractMultiplier: number | null }) => trade.contractMultiplier),
    ).toEqual([2, 100, null, null]);
    const expected = [283 / 249258, -1.3 / 247, null, 0.1];
    for (const [index, trade] of body.trades.entries()) {
      const result = await detail(new Request(`http://localhost/api/trades/${trade.key}`), {
        params: Promise.resolve({ key: trade.key }),
      });
      expect(result.status).toBe(200);
      const full = (await result.json()).trade;
      expect(netReturnOnEntry(trade)).toEqual(expected[index]);
      expect(netReturnOnEntry(full)).toEqual(expected[index]);
      expect(trade.netPnl).toBe(full.netPnl);
    }
  },
);

it("keeps multipliers attached to their symbols after filtering", async () => {
  const response = await GET(new Request("http://localhost/api/trades?view=list&symbol=SPREAD"));
  const body = await response.json();
  expect(body.trades).toHaveLength(1);
  expect(body.trades[0]).toMatchObject({ symbol: "SPREAD", contractMultiplier: 100 });
});
