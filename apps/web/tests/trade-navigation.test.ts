import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-trade-navigation-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, trades, executions, settings } = await import("../src/db");
const { insertExecutions } = await import("../src/server/executions");
const { setSetting } = await import("../src/server/settings");
const { queryTrades } = await import("../src/server/trades-query");
const { GET } = await import("../src/app/api/trades/[key]/navigation/route");

const add = (account: string, symbol: string, time: string, exit = 110) =>
  insertExecutions(
    account,
    [
      { symbol, side: "buy", quantity: 1, price: 100, fee: 0, executedAt: time },
      {
        symbol,
        side: "sell",
        quantity: 1,
        price: exit,
        fee: 0,
        executedAt: new Date(Date.parse(time) + 60_000).toISOString(),
      },
    ],
    "manual",
  );
const key = (symbol: string) => queryTrades().trades.find((trade) => trade.symbol === symbol)!.key;
const navigate = (tradeKey: string, query = "") =>
  GET(
    new Request(`http://localhost/api/trades/${encodeURIComponent(tradeKey)}/navigation?${query}`),
    { params: Promise.resolve({ key: tradeKey }) },
  );

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.insert(accounts)
    .values(
      ["a", "b"].map((id) => ({
        id,
        name: id,
        kind: "manual" as const,
        createdAt: "2026-01-01",
      })),
    )
    .run();
  setSetting("timeZone", "America/Jamaica");
  // Insert out of chronological order, including two entries at exactly the same time.
  add("b", "MIDDLE", "2026-09-02T14:00:00Z", 90);
  add("a", "LATE", "2026-09-03T14:00:00Z");
  add("a", "EARLY", "2026-09-01T14:00:00Z");
  add("a", "TIE", "2026-09-02T14:00:00Z");
});

afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

it("walks entries in deterministic chronological order in both directions", async () => {
  const order = ["EARLY", "TIE", "MIDDLE", "LATE"].map(key);
  for (let index = 0; index < order.length; index++) {
    const response = await navigate(order[index]!);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      prevKey: order[index - 1] ?? null,
      nextKey: order[index + 1] ?? null,
      position: index + 1,
      total: 4,
    });
  }
});

it("restricts same-account navigation without dropping the active date filter", async () => {
  const response = await navigate(key("TIE"), "tradeScope=account&from=2026-09-02");
  expect(await response.json()).toEqual({
    prevKey: null,
    nextKey: key("LATE"),
    position: 1,
    total: 2,
  });
});

it("honors account and status filters, including a one-trade result", async () => {
  const response = await navigate(key("MIDDLE"), "accounts=b&status=loss");
  expect(await response.json()).toEqual({ prevKey: null, nextKey: null, position: 1, total: 1 });
});

it("does not navigate outside filters when the current trade is excluded", async () => {
  const response = await navigate(key("MIDDLE"), "accounts=a");
  expect(await response.json()).toEqual({ prevKey: null, nextKey: null, position: null, total: 3 });
  const empty = await navigate(key("EARLY"), "from=2027-01-01");
  expect(await empty.json()).toEqual({ prevKey: null, nextKey: null, position: null, total: 0 });
});

it("uses the journal timezone for date boundaries", async () => {
  add("a", "OVERNIGHT", "2026-09-02T02:00:00Z");
  const response = await navigate(key("EARLY"), "from=2026-09-01&to=2026-09-01");
  expect(await response.json()).toEqual({
    prevKey: null,
    nextKey: key("OVERNIGHT"),
    position: 1,
    total: 2,
  });
});

it("returns 404 for an unknown trade", async () => {
  expect((await navigate("missing")).status).toBe(404);
});
