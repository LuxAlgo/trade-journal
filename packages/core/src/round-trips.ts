import { resolveContractMultiplier } from "./options";
import type {
  Execution,
  ExitAttribution,
  ProfitCalcMethod,
  RoundTrip,
  TradeDirection,
} from "./types";

/** Positions smaller than this are considered flat (guards float drift on fractional crypto sizes). */
const FLAT_EPS = 1e-9;

export interface BuildRoundTripsOptions {
  method?: ProfitCalcMethod;
  /**
   * Per-symbol contract multiplier (futures point value, option contract size).
   * P&L for a matched chunk is (priceDiff × qty × multiplier). Defaults to 1.
   */
  multipliers?: Record<string, number>;
}

interface OpenLot {
  quantity: number;
  price: number;
}

interface OpenCycle {
  direction: TradeDirection;
  openedAt: string;
  lots: OpenLot[];
  entryQuantity: number;
  entryNotional: number;
  exitQuantity: number;
  exitNotional: number;
  grossPnl: number;
  fees: number;
  executionIds: string[];
  exits: ExitAttribution[];
  executionCount: number;
}

const sum = (values: number[]): number => values.reduce((total, v) => total + v, 0);

const openQuantityOf = (cycle: OpenCycle): number => sum(cycle.lots.map((lot) => lot.quantity));

/**
 * Consume `quantity` from the cycle's open lots under the given method and
 * return the total entry notional matched (entry price × matched quantity).
 */
const consumeLots = (cycle: OpenCycle, quantity: number, method: ProfitCalcMethod): number => {
  let remaining = quantity;
  let matchedNotional = 0;

  if (method === "wavg") {
    const totalQty = openQuantityOf(cycle);
    const totalNotional = sum(cycle.lots.map((lot) => lot.quantity * lot.price));
    const avgPrice = totalQty > 0 ? totalNotional / totalQty : 0;
    matchedNotional = avgPrice * quantity;
    const scale = totalQty > 0 ? (totalQty - quantity) / totalQty : 0;
    cycle.lots = cycle.lots
      .map((lot) => ({ ...lot, quantity: lot.quantity * scale }))
      .filter((lot) => lot.quantity > FLAT_EPS);
    return matchedNotional;
  }

  while (remaining > FLAT_EPS && cycle.lots.length > 0) {
    const index = method === "fifo" ? 0 : cycle.lots.length - 1;
    const lot = cycle.lots[index]!;
    const take = Math.min(lot.quantity, remaining);
    matchedNotional += take * lot.price;
    lot.quantity -= take;
    remaining -= take;
    if (lot.quantity <= FLAT_EPS) cycle.lots.splice(index, 1);
  }
  return matchedNotional;
};

const finalizeCycle = (
  cycle: OpenCycle,
  accountId: string,
  symbol: string,
  assetClass: Execution["assetClass"],
  closedAt: string | undefined,
  keyCollisions: Map<string, number>,
  importGroup?: string,
  contractMultiplier?: number,
): RoundTrip => {
  const openQuantity = openQuantityOf(cycle);
  const netPnl = cycle.grossPnl - cycle.fees;
  const isOpen = openQuantity > FLAT_EPS;
  const status: RoundTrip["status"] = isOpen
    ? "open"
    : Math.abs(netPnl) <= 1e-9
      ? "breakeven"
      : netPnl > 0
        ? "win"
        : "loss";

  const baseKey = `${accountId}|${symbol}|${cycle.direction}|${cycle.openedAt}${importGroup ? `|import:${encodeURIComponent(importGroup)}` : ""}`;
  const collision = keyCollisions.get(baseKey) ?? 0;
  keyCollisions.set(baseKey, collision + 1);
  const key = collision === 0 ? baseKey : `${baseKey}|${collision}`;

  return {
    key,
    accountId,
    symbol,
    assetClass,
    direction: cycle.direction,
    status,
    openedAt: cycle.openedAt,
    closedAt: isOpen ? undefined : closedAt,
    quantity: cycle.entryQuantity,
    openQuantity: isOpen ? openQuantity : 0,
    avgEntry: cycle.entryQuantity > 0 ? cycle.entryNotional / cycle.entryQuantity : 0,
    avgExit: cycle.exitQuantity > 0 ? cycle.exitNotional / cycle.exitQuantity : undefined,
    grossPnl: cycle.grossPnl,
    fees: cycle.fees,
    netPnl,
    executionCount: cycle.executionCount,
    executionIds: cycle.executionIds,
    exits: cycle.exits,
    durationMs: !isOpen && closedAt ? Date.parse(closedAt) - Date.parse(cycle.openedAt) : undefined,
    ...(contractMultiplier !== undefined ? { contractMultiplier } : {}),
  };
};

const compareNumbers = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);

/** Fills without an import order sort after every ordered fill at the same instant. */
const importOrderOf = (execution: Execution): number =>
  execution.importMetadata?.order ?? Number.POSITIVE_INFINITY;

/**
 * Total order over executions: time, then import order, then id. Every fill has
 * a defined value at each level, so the comparator is transitive and the result
 * never depends on the input order.
 */
const compareExecutions = (a: Execution, b: Execution): number =>
  compareNumbers(Date.parse(a.executedAt), Date.parse(b.executedAt)) ||
  compareNumbers(importOrderOf(a), importOrderOf(b)) ||
  a.id.localeCompare(b.id);

/**
 * Build round trips (position cycles, flat → flat) from raw executions.
 *
 * Invariants this function defends:
 * - A fill that crosses through flat is split: the crossing part closes the
 *   cycle, the remainder opens a new cycle in the opposite direction, and the
 *   fee is split pro-rata by quantity.
 * - The total P&L of a completed cycle is independent of the profit-calc
 *   method; the method only changes per-exit attribution.
 * - Executions are processed in `executedAt` order (import order, then id, as
 *   tiebreaks) so results are deterministic regardless of input order.
 * - When a symbol has a contract multiplier, the round trip carries it as
 *   `contractMultiplier` so derivative R statistics can be computed.
 */
export const buildRoundTrips = (
  executions: Execution[],
  options: BuildRoundTripsOptions = {},
): RoundTrip[] => {
  const method = options.method ?? "fifo";
  const trips: RoundTrip[] = [];
  const keyCollisions = new Map<string, number>();

  const groups = new Map<string, Execution[]>();
  for (const execution of executions) {
    const groupKey = `${execution.accountId}\u0000${execution.symbol}${execution.importMetadata?.group ? `\u0000${execution.importMetadata.group}` : ""}`;
    const group = groups.get(groupKey);
    if (group) group.push(execution);
    else groups.set(groupKey, [execution]);
  }

  for (const group of groups.values()) {
    group.sort(compareExecutions);
    const { accountId, symbol } = group[0]!;
    const importGroup = group[0]!.importMetadata?.group;
    const assetClass = group.find((e) => e.assetClass)?.assetClass;
    const contractMultiplier = resolveContractMultiplier(symbol, assetClass, options.multipliers);
    const multiplier = contractMultiplier ?? 1;

    let cycle: OpenCycle | null = null;

    for (const execution of group) {
      let signedQty = execution.side === "buy" ? execution.quantity : -execution.quantity;
      let feeRemaining = execution.fee;
      let counted = false;

      while (Math.abs(signedQty) > FLAT_EPS) {
        if (!cycle) {
          cycle = {
            direction: signedQty > 0 ? "long" : "short",
            openedAt: execution.executedAt,
            lots: [],
            entryQuantity: 0,
            entryNotional: 0,
            exitQuantity: 0,
            exitNotional: 0,
            grossPnl: 0,
            fees: 0,
            executionIds: [],
            exits: [],
            executionCount: 0,
          };
        }

        const isEntry =
          (cycle.direction === "long" && signedQty > 0) ||
          (cycle.direction === "short" && signedQty < 0);

        if (!counted) {
          cycle.executionIds.push(execution.id);
          cycle.executionCount += 1;
          counted = true;
        } else if (!cycle.executionIds.includes(execution.id)) {
          // The remainder of a flat-crossing fill lands in the new cycle too.
          cycle.executionIds.push(execution.id);
          cycle.executionCount += 1;
        }

        if (isEntry) {
          const qty = Math.abs(signedQty);
          cycle.lots.push({ quantity: qty, price: execution.price });
          cycle.entryQuantity += qty;
          cycle.entryNotional += qty * execution.price;
          cycle.fees += feeRemaining;
          feeRemaining = 0;
          signedQty = 0;
        } else {
          const openQty = openQuantityOf(cycle);
          const exitQty = Math.min(Math.abs(signedQty), openQty);
          const matchedNotional = consumeLots(cycle, exitQty, method);
          const exitNotional = exitQty * execution.price;
          const chunkGross =
            execution.importMetadata?.reportedGrossPnl ??
            (cycle.direction === "long"
              ? (exitNotional - matchedNotional) * multiplier
              : (matchedNotional - exitNotional) * multiplier);

          const feeShare =
            Math.abs(signedQty) > 0 ? feeRemaining * (exitQty / Math.abs(signedQty)) : 0;
          cycle.grossPnl += chunkGross;
          cycle.fees += feeShare;
          feeRemaining -= feeShare;
          cycle.exitQuantity += exitQty;
          cycle.exitNotional += exitNotional;
          cycle.exits.push({ executionId: execution.id, grossPnl: chunkGross, quantity: exitQty });

          signedQty += cycle.direction === "long" ? exitQty : -exitQty;

          if (openQuantityOf(cycle) <= FLAT_EPS) {
            trips.push(
              finalizeCycle(
                cycle,
                accountId,
                symbol,
                assetClass,
                execution.executedAt,
                keyCollisions,
                importGroup,
                contractMultiplier,
              ),
            );
            cycle = null;
            // Any residual signedQty flips direction and opens a new cycle on
            // the next loop iteration; residual fee follows it.
          }
        }
      }

      // A zero-quantity execution (bad data) still shouldn't leak fees.
      if (feeRemaining !== 0 && cycle) {
        cycle.fees += feeRemaining;
      }
    }

    if (cycle) {
      trips.push(
        finalizeCycle(
          cycle,
          accountId,
          symbol,
          assetClass,
          undefined,
          keyCollisions,
          importGroup,
          contractMultiplier,
        ),
      );
    }
  }

  trips.sort(
    (a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt) || a.key.localeCompare(b.key),
  );
  return trips;
};
