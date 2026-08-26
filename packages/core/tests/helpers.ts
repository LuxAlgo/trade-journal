import type { Execution } from "../src/types";

let counter = 0;

/** Terse execution factory: fill("AAPL", "buy", 100, 10.0, "2026-01-05T14:30:00Z"). */
export const fill = (
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  price: number,
  executedAt: string,
  overrides: Partial<Execution> = {},
): Execution => ({
  id: `e${++counter}`,
  accountId: "acct-1",
  symbol,
  side,
  quantity,
  price,
  fee: 0,
  executedAt,
  source: "manual",
  ...overrides,
});
