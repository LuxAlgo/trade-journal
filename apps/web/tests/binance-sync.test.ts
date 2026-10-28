import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "journal-binance-sync-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
const { db, accounts, executions, trades } = await import("../src/db");
const { encryptJson } = await import("../src/server/crypto");
const { syncAccount } = await import("../src/server/sync");

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const hoursAgo = (hours: number) => Math.floor(Date.now() / HOUR_MS) * HOUR_MS - hours * HOUR_MS;

// USDⓈ-M userTrades rows, as broker-sdk's Binance adapter reads them.
let nextId = 1;
const fill = (
  symbol: string,
  side: "BUY" | "SELL",
  qty: string,
  price: string,
  time: number,
  extra: Record<string, unknown> = {},
) => ({
  id: nextId++,
  symbol,
  side,
  positionSide: "BOTH",
  qty,
  price,
  commission: "0",
  commissionAsset: "USDT",
  time,
  ...extra,
});
let fills: ReturnType<typeof fill>[] = [];
let positions: Record<string, string>[] = [];
let bnbCloses: Record<number, string> = {};

beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.insert(accounts)
    .values({
      id: "bn",
      name: "Binance",
      kind: "sync",
      broker: "binance",
      credentialsEnc: encryptJson({ apiKey: "k", apiSecret: "s" }),
      createdAt: "2026-01-01",
    })
    .run();
  fills = [];
  positions = [];
  bnbCloses = {};
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const query = url.searchParams;
      const inWindow = (time: number) =>
        time >= Number(query.get("startTime")) && time <= Number(query.get("endTime"));
      switch (url.pathname) {
        case "/api/v3/account":
          return Response.json({ balances: [{ asset: "USDT", free: "10", locked: "0" }] });
        case "/api/v3/ticker/price":
          return Response.json([]);
        case "/api/v3/klines":
          return Response.json(
            Object.entries(bnbCloses)
              .filter(([hour]) => inWindow(Number(hour)))
              .map(([hour, close]) => [Number(hour), close, close, close, close, "1"]),
          );
        case "/fapi/v3/account":
          return Response.json({ totalMarginBalance: "1000" });
        case "/fapi/v3/positionRisk":
          return Response.json(positions);
        case "/fapi/v1/income":
          return Response.json(
            fills
              .filter((f) => inWindow(f.time))
              .map((f) => ({ symbol: f.symbol, incomeType: "COMMISSION" })),
          );
        case "/fapi/v1/userTrades":
          return Response.json(
            fills.filter((f) => f.symbol === query.get("symbol") && inWindow(f.time)),
          );
      }
      throw new Error(`Unexpected Binance request: ${url.pathname}`);
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

describe("Binance futures sync", () => {
  it("futures fills become futures trades with their fees, and a re-sync adds nothing", async () => {
    const closedAt = hoursAgo(20) + 600_000;
    fills = [
      fill("BTCUSDT", "BUY", "0.01", "60000", hoursAgo(30), { commission: "0.24" }),
      fill("BTCUSDT", "SELL", "0.01", "61000", closedAt, {
        commission: "0.0004",
        commissionAsset: "BNB",
      }),
    ];
    bnbCloses = { [hoursAgo(20)]: "600" };

    expect(await syncAccount("bn")).toMatchObject({ inserted: 2, skipped: 0, equity: 1010 });
    const [trade] = journal();
    expect(trade).toMatchObject({ symbol: "BTCUSDT", status: "win", direction: "long" });
    expect(trade!.grossPnl).toBeCloseTo(10, 9);
    expect(trade!.fees).toBeCloseTo(0.48, 9);
    expect(
      db
        .select()
        .from(executions)
        .all()
        .every((row) => row.assetClass === "futures"),
    ).toBe(true);

    expect(await syncAccount("bn")).toMatchObject({ inserted: 0, duplicates: 2 });
  });

  it("in hedge mode, a long and a short held at once on one symbol stay two trades", async () => {
    fills = [
      fill("ETHUSDT", "BUY", "1", "3000", hoursAgo(10), { positionSide: "LONG" }),
      fill("ETHUSDT", "SELL", "1", "3010", hoursAgo(9), { positionSide: "SHORT" }),
      fill("ETHUSDT", "SELL", "1", "3050", hoursAgo(8), { positionSide: "LONG" }),
    ];
    positions = [
      { symbol: "ETHUSDT", positionSide: "SHORT", positionAmt: "-1", notional: "-3000" },
    ];

    expect(await syncAccount("bn")).toMatchObject({ inserted: 3, skipped: 0 });
    const [long, short] = journal();
    expect(long).toMatchObject({ direction: "long", status: "win" });
    expect(long!.grossPnl).toBeCloseTo(50, 9);
    expect(short).toMatchObject({ direction: "short", status: "open", openQuantity: 1 });
  });

  it("closes of positions opened before Binance's three months of history are skipped", async () => {
    fills = [
      // One-way mode: selling a long bought before the history starts.
      fill("BTCUSDT", "SELL", "1", "60000", hoursAgo(5)),
      // Hedge mode: closing a long with nothing open on that side.
      fill("ETHUSDT", "SELL", "1", "3000", hoursAgo(4), { positionSide: "LONG" }),
    ];

    const outcome = await syncAccount("bn");
    expect(outcome).toMatchObject({ inserted: 0, skipped: 2 });
    expect(outcome.skippedReasons.join(" ")).toContain("before the broker's available history");
    expect(journal()).toEqual([]);
  });

  it("a close of a position partly opened before the history keeps the covered part, in both modes", async () => {
    // A long of 2 opened before the history: buy 1 more, sell all 3, then trade 1 again.
    const cycle = (symbol: string, positionSide: string) => [
      fill(symbol, "BUY", "1", "100", hoursAgo(10), { positionSide }),
      fill(symbol, "SELL", "3", "110", hoursAgo(9), { positionSide }),
      fill(symbol, "BUY", "1", "120", hoursAgo(8), { positionSide }),
      fill(symbol, "SELL", "1", "130", hoursAgo(7), { positionSide }),
    ];
    fills = [...cycle("BTCUSDT", "BOTH"), ...cycle("ETHUSDT", "LONG")];

    const outcome = await syncAccount("bn");
    expect(outcome).toMatchObject({ inserted: 8, skipped: 2 });
    const booked = journal();
    expect(
      booked.map((trade) => [trade.symbol, trade.direction, trade.status, trade.quantity]),
    ).toEqual([
      ["BTCUSDT", "long", "win", 1],
      ["ETHUSDT", "long", "win", 1],
      ["BTCUSDT", "long", "win", 1],
      ["ETHUSDT", "long", "win", 1],
    ]);
    for (const trade of booked) expect(trade.grossPnl).toBeCloseTo(10, 9);
    expect(await syncAccount("bn")).toMatchObject({ inserted: 0, duplicates: 8, skipped: 0 });
  });

  it("an open hedge-mode short doesn't hide a one-way close from before the history", async () => {
    fills = [
      fill("BTCUSDT", "SELL", "1", "60000", hoursAgo(6)),
      fill("BTCUSDT", "SELL", "1", "61000", hoursAgo(2), { positionSide: "SHORT" }),
    ];
    positions = [
      { symbol: "BTCUSDT", positionSide: "SHORT", positionAmt: "-1", notional: "-61000" },
    ];

    expect(await syncAccount("bn")).toMatchObject({ inserted: 1, skipped: 1 });
    expect(journal()).toMatchObject([{ direction: "short", status: "open", openQuantity: 1 }]);
  });

  it("a quarterly contract held to delivery keeps its opening fill", async () => {
    // Settlement leaves no fill, so the flat position list can't prove the history is short.
    fills = [fill("BTCUSDT_261225", "BUY", "1", "60000", hoursAgo(40))];

    expect(await syncAccount("bn")).toMatchObject({ inserted: 1, skipped: 0 });
  });

  it("a later sync asks Binance only for recent fills", async () => {
    fills = [fill("BTCUSDT", "BUY", "0.01", "60000", hoursAgo(30))];
    positions = [{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "0.01", notional: "600" }];
    await syncAccount("bn");
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockClear();

    await syncAccount("bn");
    const starts = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname === "/fapi/v1/userTrades")
      .map((url) => Number(url.searchParams.get("startTime")));
    expect(Math.min(...starts)).toBeGreaterThan(Date.now() - 31 * DAY_MS);
  });
});
