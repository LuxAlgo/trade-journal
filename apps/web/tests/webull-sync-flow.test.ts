import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "journal-webull-sync-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
const { db, accounts, executions, settings, trades } = await import("../src/db");
const { encryptJson } = await import("../src/server/crypto");
const { syncAccount } = await import("../src/server/sync");

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

// Webull historical orders, as broker-sdk's Webull adapter reads them.
const order = (fields: Record<string, unknown>) => ({
  status: "FILLED",
  instrument_type: "EQUITY",
  fees: [],
  commission: {},
  ...fields,
});
let orders: Record<string, unknown>[] = [];
let positions: Record<string, unknown>[] = [];

beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.insert(accounts)
    .values({
      id: "wb",
      name: "Webull",
      kind: "sync",
      broker: "webull",
      credentialsEnc: encryptJson({ apiKey: "k", apiSecret: "s" }),
      createdAt: "2026-01-01",
    })
    .run();
  orders = [];
  positions = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/trading/accounts/list") return Response.json([{ account_id: "A1" }]);
      if (url.pathname === "/trading/assets/balances/get")
        return Response.json({ total_net_liquidation_value: "1000" });
      if (url.pathname === "/trading/assets/positions/list") return Response.json(positions);
      if (url.pathname === "/trading/orders/historical-orders/list") {
        // Each 30-day window answers with the orders filled inside it.
        const start = Date.parse(url.searchParams.get("start_time")!);
        const end = Date.parse(url.searchParams.get("end_time")!);
        return Response.json({
          data: orders.filter((o) => {
            const at = Date.parse(String(o.filled_time_at));
            return at >= start && at < end;
          }),
        });
      }
      throw new Error(`Unexpected Webull request: ${url.pathname}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

describe("Webull sync", () => {
  it("selling shares bought before the history floor is skipped, not journaled as a short", async () => {
    orders = [
      order({
        symbol: "ABC",
        side: "SELL",
        filled_quantity: "7",
        filled_price: "20",
        filled_time_at: daysAgo(3).toISOString(),
      }),
    ];
    const outcome = await syncAccount("wb");
    expect(outcome).toMatchObject({ inserted: 0, skipped: 1 });
    expect(outcome.skippedReasons.join(" ")).toContain("before the broker's available history");
    expect(db.select().from(trades).all()).toEqual([]);
  });

  it("a close of shares partly bought before the history keeps the covered part, and later syncs leave it be", async () => {
    // 2 shares bought before the floor, 1 more bought after the first sync, then all 3 sold.
    const buy = order({
      symbol: "ABC",
      side: "BUY",
      filled_quantity: "1",
      filled_price: "100",
      filled_time_at: daysAgo(5).toISOString(),
    });
    orders = [buy];
    positions = [{ symbol: "ABC", quantity: "3", market_value: "300" }];
    expect(await syncAccount("wb")).toMatchObject({ inserted: 1, skipped: 0 });

    orders = [
      buy,
      order({
        symbol: "ABC",
        side: "SELL",
        filled_quantity: "3",
        filled_price: "110",
        filled_time_at: daysAgo(1).toISOString(),
      }),
    ];
    positions = [];
    const outcome = await syncAccount("wb");
    expect(outcome).toMatchObject({ inserted: 1, skipped: 1 });
    expect(outcome.skippedReasons.join(" ")).toContain(
      "only the part that history covers was kept",
    );
    const [trade] = db.select().from(trades).all();
    expect(trade).toMatchObject({ status: "win", direction: "long", quantity: 1 });
    expect(trade!.grossPnl).toBeCloseTo(10, 9);

    expect(await syncAccount("wb")).toMatchObject({ inserted: 0, duplicates: 2, skipped: 0 });
  });

  it("two identical orders filled in the same second are both kept, and a re-sync adds nothing", async () => {
    const filledAt = daysAgo(2).toISOString();
    const buy = {
      symbol: "ABC",
      side: "BUY",
      filled_quantity: "1",
      filled_price: "100",
      filled_time_at: filledAt,
    };
    orders = [order(buy), order(buy)];
    positions = [{ symbol: "ABC", quantity: "2", market_value: "200" }];

    expect(await syncAccount("wb")).toMatchObject({ inserted: 2, skipped: 0 });
    expect(await syncAccount("wb")).toMatchObject({ inserted: 0, duplicates: 2, skipped: 0 });
    expect(db.select().from(trades).all()).toMatchObject([
      { symbol: "ABC", status: "open", openQuantity: 2 },
    ]);
  });

  it("an option that expired while held closes at 0, priced with its contract size", async () => {
    const expiry = daysAgo(10).toISOString().slice(0, 10);
    orders = [
      order({
        symbol: "XYZ",
        side: "BUY",
        instrument_type: "OPTION",
        position_intent: "BUY_TO_OPEN",
        legs: [
          {
            symbol: "XYZ",
            option_type: "PUT",
            option_expire_date: expiry,
            strike_price: "50",
            option_contract_multiplier: "100",
          },
        ],
        filled_quantity: "1",
        filled_price: "1.10",
        filled_time_at: daysAgo(20).toISOString(),
      }),
    ];

    expect(await syncAccount("wb")).toMatchObject({ inserted: 2 });
    const [trade] = db.select().from(trades).all();
    expect(trade).toMatchObject({ status: "loss", direction: "long" });
    expect(trade!.grossPnl).toBeCloseTo(-110, 9);
    // The next sync recomputes nothing: the expiry close is already journaled.
    expect(await syncAccount("wb")).toMatchObject({ inserted: 0, duplicates: 1 });
  });
});
