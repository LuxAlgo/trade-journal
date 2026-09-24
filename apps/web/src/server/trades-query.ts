import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import {
  matchesFilters,
  resolveContractMultiplier,
  type AnalysisFilters,
  type AnnotatedTrade,
} from "@luxalgo/journal-core";
import { getTimeZone, getMultipliers, getJournalDefaults } from "./settings";
import { db, trades } from "@/db";

export type TradeFilters = AnalysisFilters & { accountIds?: string[] };

export type TradeRow = typeof trades.$inferSelect;
type TradeModelRow = Pick<
  TradeRow,
  | "key"
  | "accountId"
  | "symbol"
  | "assetClass"
  | "direction"
  | "status"
  | "openedAt"
  | "closedAt"
  | "quantity"
  | "openQuantity"
  | "avgEntry"
  | "avgExit"
  | "grossPnl"
  | "fees"
  | "netPnl"
  | "executionCount"
  | "durationMs"
  | "tagsJson"
  | "mistakesJson"
  | "playbookId"
  | "rating"
  | "stopLoss"
  | "profitTarget"
  | "reviewedAt"
> &
  Partial<Pick<TradeRow, "executionIdsJson" | "exitsJson">>;

const parseJsonArray = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
};

const context = () => ({ multipliers: getMultipliers(), defaults: getJournalDefaults() });
export const rowToTrade = (row: TradeModelRow, config = context()): AnnotatedTrade => {
  const multiplier = resolveContractMultiplier(
    row.symbol,
    (row.assetClass ?? undefined) as AnnotatedTrade["assetClass"],
    config.multipliers,
  );
  const defaults = config.defaults;
  const missingMultiplier =
    multiplier == null && ["futures", "forex", "cfd"].includes(row.assetClass ?? "");
  const notional = missingMultiplier
    ? 0
    : Math.abs(row.avgEntry * row.quantity * (multiplier ?? 1));
  const tolerance =
    defaults.breakevenMode === "percent"
      ? (notional * defaults.breakeven) / 100
      : defaults.breakeven;
  const status =
    row.status === "open"
      ? "open"
      : Math.abs(row.netPnl) <= Math.max(1e-9, tolerance)
        ? "breakeven"
        : row.netPnl > 0
          ? "win"
          : "loss";
  return {
    key: row.key,
    accountId: row.accountId,
    symbol: row.symbol,
    assetClass: (row.assetClass ?? undefined) as AnnotatedTrade["assetClass"],
    direction: row.direction,
    status,
    contractMultiplier: multiplier,
    openedAt: row.openedAt,
    closedAt: row.closedAt ?? undefined,
    quantity: row.quantity,
    openQuantity: row.openQuantity,
    avgEntry: row.avgEntry,
    avgExit: row.avgExit ?? undefined,
    grossPnl: row.grossPnl,
    fees: row.fees,
    netPnl: row.netPnl,
    executionCount: row.executionCount,
    executionIds: parseJsonArray(row.executionIdsJson ?? null),
    exits: row.exitsJson ? (JSON.parse(row.exitsJson) as AnnotatedTrade["exits"]) : [],
    durationMs: row.durationMs ?? undefined,
    annotations: {
      tags: parseJsonArray(row.tagsJson),
      mistakes: parseJsonArray(row.mistakesJson),
      playbook: row.playbookId ?? undefined,
      rating: row.rating ?? undefined,
      stopLoss: row.stopLoss ?? undefined,
      profitTarget: row.profitTarget ?? undefined,
      reviewed: row.reviewedAt !== null,
    },
  };
};

const modelColumns = {
  key: trades.key,
  accountId: trades.accountId,
  symbol: trades.symbol,
  assetClass: trades.assetClass,
  direction: trades.direction,
  status: trades.status,
  openedAt: trades.openedAt,
  closedAt: trades.closedAt,
  quantity: trades.quantity,
  openQuantity: trades.openQuantity,
  avgEntry: trades.avgEntry,
  avgExit: trades.avgExit,
  grossPnl: trades.grossPnl,
  fees: trades.fees,
  netPnl: trades.netPnl,
  executionCount: trades.executionCount,
  executionIdsJson: trades.executionIdsJson,
  durationMs: trades.durationMs,
  tagsJson: trades.tagsJson,
  mistakesJson: trades.mistakesJson,
  playbookId: trades.playbookId,
  rating: trades.rating,
  stopLoss: trades.stopLoss,
  profitTarget: trades.profitTarget,
  reviewedAt: trades.reviewedAt,
};

const nextUtcDay = (day: string): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

const sqlConditions = (filters: TradeFilters, timeZone: string): SQL[] => {
  const accountIds = filters.accounts
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const symbols = filters.symbol
    ?.split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const conditions: Array<SQL | undefined> = [
    accountIds?.length ? inArray(trades.accountId, accountIds) : undefined,
    filters.playbookId ? eq(trades.playbookId, filters.playbookId) : undefined,
    filters.direction ? eq(trades.direction, filters.direction as "long" | "short") : undefined,
    filters.assetClass ? eq(trades.assetClass, filters.assetClass) : undefined,
    symbols?.length ? inArray(trades.symbol, symbols) : undefined,
  ];
  // ISO timestamps sort chronologically. Keep non-UTC ranges in the authoritative
  // core predicate because their date boundaries depend on the journal timezone.
  if (timeZone === "UTC" && filters.from) {
    const start = `${filters.from}T00:00:00`;
    conditions.push(
      or(
        and(isNotNull(trades.closedAt), gte(trades.closedAt, start)),
        and(isNull(trades.closedAt), gte(trades.openedAt, start)),
      ),
    );
  }
  if (timeZone === "UTC" && filters.to) {
    const end = `${nextUtcDay(filters.to)}T00:00:00`;
    conditions.push(
      or(
        and(isNotNull(trades.closedAt), lt(trades.closedAt, end)),
        and(isNull(trades.closedAt), lt(trades.openedAt, end)),
      ),
    );
  }
  return conditions.filter((condition): condition is SQL => condition !== undefined);
};

/**
 * Narrow indexed identity fields before decoding rows. The core predicate
 * remains authoritative for timezone, risk and breakeven semantics.
 */
export const queryTrades = (
  filters: TradeFilters = {},
): { rows: TradeRow[]; trades: AnnotatedTrade[] } => {
  const effective = { ...filters, accounts: filters.accounts ?? filters.accountIds?.join(",") };
  const timeZone = getTimeZone();
  const all = db
    .select()
    .from(trades)
    .where(and(...sqlConditions(effective, timeZone)))
    .orderBy(asc(trades.openedAt))
    .all();
  const config = context();
  const pairs = all
    .map((row) => ({ row, trade: rowToTrade(row, config) }))
    .filter(({ trade }) => matchesFilters(trade, effective, timeZone));
  return {
    rows: pairs.map(({ row, trade }) => ({ ...row, status: trade.status })),
    trades: pairs.map((p) => p.trade),
  };
};

/** Analytics reads omit notes and the large per-exit JSON payload. */
export const queryTradeModels = (filters: TradeFilters = {}): AnnotatedTrade[] => {
  const effective = { ...filters, accounts: filters.accounts ?? filters.accountIds?.join(",") };
  const timeZone = getTimeZone();
  const config = context();
  return db
    .select(modelColumns)
    .from(trades)
    .where(and(...sqlConditions(effective, timeZone)))
    .orderBy(asc(trades.openedAt))
    .all()
    .map((row) => rowToTrade(row, config))
    .filter((trade) => matchesFilters(trade, effective, timeZone));
};

export const getTradeByKey = (key: string): TradeRow | undefined =>
  db.select().from(trades).where(eq(trades.key, key)).get();
