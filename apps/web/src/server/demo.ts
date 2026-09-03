import { eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import { accounts, db } from "@/db";
import { insertExecutions } from "./executions";
import { newId, nowIso } from "./ids";

/** Demo accounts are tagged by broker so they can be found and deleted. */
export const DEMO_BROKER = "demo";

/* Deterministic RNG: the demo journal looks the same on every install. */
const rng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
};

const SYMBOLS = [
  { symbol: "NVDA", price: 128, qtyMin: 50, qtyMax: 150 },
  { symbol: "TSLA", price: 242, qtyMin: 30, qtyMax: 100 },
  { symbol: "AAPL", price: 226, qtyMin: 50, qtyMax: 200 },
  { symbol: "AMD", price: 158, qtyMin: 80, qtyMax: 250 },
  { symbol: "META", price: 512, qtyMin: 20, qtyMax: 60 },
  { symbol: "SPY", price: 556, qtyMin: 40, qtyMax: 120 },
] as const;

/**
 * ~90 days of plausible equity day trading ending today: 56% winners, winners
 * run further than losers, some scaled exits, two still-open positions.
 * Sessions are generated in UTC around US cash hours.
 */
const generateExecutions = (): ImportedExecution[] => {
  const rnd = rng(42);
  const rows: ImportedExecution[] = [];
  const at = (day: Date, minuteOfSession: number) =>
    new Date(
      Date.UTC(
        day.getUTCFullYear(),
        day.getUTCMonth(),
        day.getUTCDate(),
        13,
        30 + minuteOfSession,
        Math.floor(rnd() * 60),
      ),
    ).toISOString();

  const today = new Date();
  for (let back = 90; back >= 1; back--) {
    const day = new Date(today.getTime() - back * 86_400_000);
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (rnd() < 0.28) continue; // days off
    const tradesToday = 1 + Math.floor(rnd() * 4);
    let minute = 5 + Math.floor(rnd() * 40);
    for (let i = 0; i < tradesToday; i++) {
      const spec = SYMBOLS[Math.floor(rnd() * SYMBOLS.length)]!;
      const long = rnd() < 0.72;
      const quantity = Math.round(spec.qtyMin + rnd() * (spec.qtyMax - spec.qtyMin));
      const entry = spec.price * (0.97 + rnd() * 0.06);
      const win = rnd() < 0.56;
      const magnitude = win ? 0.004 + rnd() * 0.014 : 0.003 + rnd() * 0.008;
      const exit = entry + (win ? 1 : -1) * (long ? 1 : -1) * magnitude * entry;
      const hold = 4 + Math.floor(rnd() * 55);
      const entrySide = long ? "buy" : "sell";
      const exitSide = long ? "sell" : "buy";
      rows.push({
        symbol: spec.symbol,
        side: entrySide,
        quantity,
        price: Number(entry.toFixed(2)),
        fee: 1,
        executedAt: at(day, minute),
      });
      if (rnd() < 0.3 && quantity >= 60) {
        const half = Math.round(quantity / 2);
        const mid = entry + (exit - entry) * (0.4 + rnd() * 0.3);
        rows.push({
          symbol: spec.symbol,
          side: exitSide,
          quantity: half,
          price: Number(mid.toFixed(2)),
          fee: 1,
          executedAt: at(day, minute + Math.floor(hold / 2)),
        });
        rows.push({
          symbol: spec.symbol,
          side: exitSide,
          quantity: quantity - half,
          price: Number(exit.toFixed(2)),
          fee: 1,
          executedAt: at(day, minute + hold),
        });
      } else {
        rows.push({
          symbol: spec.symbol,
          side: exitSide,
          quantity,
          price: Number(exit.toFixed(2)),
          fee: 1,
          executedAt: at(day, minute + hold),
        });
      }
      minute += hold + 10 + Math.floor(rnd() * 50);
      if (minute > 340) break;
    }
  }

  // A handful of crypto round trips: these chart on real candles (Vela's
  // keyless Binance/Coinbase providers), so the demo shows that path too.
  const CRYPTO = [
    { symbol: "BTCUSDT", price: 96000, qty: () => Number((0.05 + rnd() * 0.3).toFixed(3)) },
    { symbol: "ETHUSDT", price: 4400, qty: () => Number((0.5 + rnd() * 3).toFixed(2)) },
  ] as const;
  for (let back = 80; back >= 2; back -= 4 + Math.floor(rnd() * 12)) {
    const day = new Date(today.getTime() - back * 86_400_000);
    const spec = CRYPTO[Math.floor(rnd() * CRYPTO.length)]!;
    const long = rnd() < 0.7;
    const quantity = spec.qty();
    const entry = spec.price * (0.94 + rnd() * 0.12);
    const win = rnd() < 0.55;
    const magnitude = win ? 0.006 + rnd() * 0.02 : 0.004 + rnd() * 0.012;
    const exit = entry + (win ? 1 : -1) * (long ? 1 : -1) * magnitude * entry;
    const minute = 10 + Math.floor(rnd() * 300);
    const hold = 20 + Math.floor(rnd() * 180);
    rows.push({
      symbol: spec.symbol,
      side: long ? "buy" : "sell",
      quantity,
      price: Number(entry.toFixed(2)),
      fee: 2,
      executedAt: at(day, minute),
      assetClass: "crypto",
    });
    rows.push({
      symbol: spec.symbol,
      side: long ? "sell" : "buy",
      quantity,
      price: Number(exit.toFixed(2)),
      fee: 2,
      executedAt: at(day, minute + hold),
      assetClass: "crypto",
    });
  }

  // Two open positions so the dashboard's "Open positions" tab has content.
  const lastDay = new Date(today.getTime() - 86_400_000);
  rows.push({
    symbol: "NVDA",
    side: "buy",
    quantity: 120,
    price: 131.42,
    fee: 1,
    executedAt: at(lastDay, 44),
  });
  rows.push({
    symbol: "SPY",
    side: "sell",
    quantity: 80,
    price: 561.18,
    fee: 1,
    executedAt: at(lastDay, 92),
  });
  return rows;
};

export interface DemoResult {
  accountId: string;
  inserted: number;
  alreadyLoaded: boolean;
}

/** Idempotent: a second call returns the existing demo account untouched. */
export const loadDemoData = (): DemoResult => {
  const existing = db.select().from(accounts).where(eq(accounts.broker, DEMO_BROKER)).get();
  if (existing) {
    if (existing.archivedAt)
      db.update(accounts).set({ archivedAt: null }).where(eq(accounts.id, existing.id)).run();
    return { accountId: existing.id, inserted: 0, alreadyLoaded: true };
  }

  const id = newId();
  db.insert(accounts)
    .values({
      id,
      name: "Demo data",
      broker: DEMO_BROKER,
      kind: "import",
      currency: "USD",
      initialBalance: 25000,
      profitCalcMethod: "fifo",
      credentialsEnc: null,
      autoSync: false,
      createdAt: nowIso(),
    })
    .run();
  const { inserted } = insertExecutions(id, generateExecutions(), "import");
  return { accountId: id, inserted, alreadyLoaded: false };
};
