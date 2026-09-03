/* Adapted from ChristopherDownie/prop-firm-sim, commit 2aedb92208ab34ef7a1d0e42c290b8b78bae081f.
 * Copyright (c) 2026 LuxAlgo. MIT license: packages/importers/LICENSE.
 * Journal adaptation keeps history parsing separate from existing fill importers. */

/*
  Trade reconstruction: many exports carry no "one row = one trade" shape.
  Two reconstructors cover the real-world cases:

  - pairEvents: rows are ENTRY/EXIT records (TradingView strategy exports,
    journal event logs). Pairing uses trade/position IDs whenever the file has
    them; only when it has none does it fall back to FIFO matching within
    (symbol, direction) - and says so. Rows are never paired merely for being
    neighbors.

  Raw fills are passed through to the journal matching engine unchanged.
*/

import { issue, type ImportIssue, type ImportedTrade, type TradeDirection } from "./model";

/** One normalized entry/exit record handed to pairEvents by an adapter. */
export interface TradeEvent {
  /** 1-based source line. */
  row: number;
  kind: "entry" | "exit";
  id: string | null;
  symbol: string | null;
  /** Direction of the POSITION ("Exit long" → long). */
  direction: TradeDirection | null;
  time: number | null;
  price: number | null;
  quantity: number | null;
  /** Realized P&L carried by this event (adapters must put trade totals on ONE event only). */
  pnl: number | null;
  fees: number | null;
  stopPrice: number | null;
  /** Explicit R carried by this event. */
  r: number | null;
}

export interface ReconstructionResult {
  closed: ImportedTrade[];
  open: ImportedTrade[];
}

function blankTrade(): ImportedTrade {
  return {
    id: null,
    symbol: null,
    direction: null,
    entryTime: null,
    exitTime: null,
    entryPrice: null,
    exitPrice: null,
    quantity: null,
    pnl: null,
    fees: null,
    stopPrice: null,
    riskAmount: null,
    r: null,
    rSource: "unavailable",
    status: "closed",
    sourceRows: [],
  };
}

function weightedAverage(
  pairs: ReadonlyArray<readonly [price: number, qty: number | null]>,
): number | null {
  if (pairs.length === 0) return null;
  if (pairs.some(([, qty]) => qty === null || qty <= 0)) {
    // No usable weights: plain mean.
    return pairs.reduce((sum, [price]) => sum + price, 0) / pairs.length;
  }
  let notional = 0;
  let quantity = 0;
  for (const [price, qty] of pairs) {
    notional += price * (qty as number);
    quantity += qty as number;
  }
  return quantity > 0 ? notional / quantity : null;
}

function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
}

/** Build one canonical trade from grouped entry and exit events. */
function buildTradeFromGroup(
  id: string | null,
  entries: TradeEvent[],
  exits: TradeEvent[],
  issues: ImportIssue[],
): ImportedTrade {
  const trade = blankTrade();
  trade.id = id;
  const all = [...entries, ...exits];
  trade.sourceRows = all.map((e) => e.row).sort((a, b) => a - b);
  trade.symbol = all.find((e) => e.symbol !== null)?.symbol ?? null;
  trade.direction =
    entries.find((e) => e.direction !== null)?.direction ??
    exits.find((e) => e.direction !== null)?.direction ??
    null;

  const entryTimes = entries.map((e) => e.time).filter((t): t is number => t !== null);
  const exitTimes = exits.map((e) => e.time).filter((t): t is number => t !== null);
  trade.entryTime = entryTimes.length > 0 ? Math.min(...entryTimes) : null;
  trade.exitTime = exitTimes.length > 0 ? Math.max(...exitTimes) : null;

  trade.entryPrice = weightedAverage(
    entries.filter((e) => e.price !== null).map((e) => [e.price as number, e.quantity] as const),
  );
  trade.exitPrice = weightedAverage(
    exits.filter((e) => e.price !== null).map((e) => [e.price as number, e.quantity] as const),
  );
  trade.quantity = sumOrNull(entries.map((e) => e.quantity));
  trade.fees = sumOrNull(all.map((e) => e.fees));
  trade.stopPrice = entries.find((e) => e.stopPrice !== null)?.stopPrice ?? null;

  const explicitR = all.filter((e) => e.r !== null).map((e) => e.r as number);
  if (explicitR.length > 0) {
    trade.r = explicitR[explicitR.length - 1]!;
    trade.rSource = "explicit";
  }

  const exitPnl = sumOrNull(exits.map((e) => e.pnl));
  const entryPnl = sumOrNull(entries.map((e) => e.pnl));
  trade.pnlReported = exitPnl !== null || entryPnl !== null;
  if (exitPnl !== null) trade.pnl = exitPnl;
  else if (entryPnl !== null) trade.pnl = entryPnl;
  else if (
    trade.entryPrice !== null &&
    trade.exitPrice !== null &&
    trade.quantity !== null &&
    trade.direction !== null
  ) {
    const sign = trade.direction === "long" ? 1 : -1;
    trade.pnl =
      (trade.exitPrice - trade.entryPrice) * sign * trade.quantity - Math.abs(trade.fees ?? 0);
    issues.push(
      issue(
        "info",
        "pnl-derived-from-prices",
        `Trade ${id ?? `at line ${trade.sourceRows[0] ?? "?"}`}: P&L was computed from entry/exit prices × ` +
          "quantity (assumes 1 currency unit per point per unit of quantity - correct for stocks/spot, " +
          "NOT for futures or CFDs with a contract multiplier).",
        trade.sourceRows[0] !== undefined ? { row: trade.sourceRows[0] } : {},
      ),
    );
  }

  if (trade.entryTime !== null && trade.exitTime !== null && trade.exitTime < trade.entryTime) {
    issues.push(
      issue(
        "warning",
        "exit-before-entry",
        `Trade ${id ?? `at line ${trade.sourceRows[0] ?? "?"}`}: the exit timestamp precedes the entry ` +
          "timestamp. Check the file's row pairing or date format.",
        trade.sourceRows[0] !== undefined ? { row: trade.sourceRows[0] } : {},
      ),
    );
  }

  const exitedQuantity = sumOrNull(exits.map((e) => e.quantity));
  if (
    trade.quantity !== null &&
    exitedQuantity !== null &&
    exitedQuantity > trade.quantity + 1e-9
  ) {
    issues.push(
      issue(
        "error",
        "ambiguous-mapping",
        `Trade ${id ?? ""}: exit quantity exceeds entry quantity.`,
        { row: trade.sourceRows[0] },
      ),
    );
  }
  if (
    exits.length === 0 ||
    (trade.quantity !== null && exitedQuantity !== null && exitedQuantity < trade.quantity - 1e-9)
  )
    trade.status = "open";
  return trade;
}

/**
 * Pair entry/exit events into trades. Strategy, in order:
 * 1. When most events carry an id: group strictly by id (a group mixing two
 *    symbols is flagged). Handles multiple fills per side via VWAP.
 * 2. Otherwise: FIFO within (symbol, direction) with lot splitting when
 *    quantities are present - and an explicit warning that pairing is
 *    positional, since the file gave us nothing stronger.
 */
export function pairEvents(
  events: readonly TradeEvent[],
  issues: ImportIssue[],
): ReconstructionResult {
  const closed: ImportedTrade[] = [];
  const open: ImportedTrade[] = [];
  if (events.length === 0) return { closed, open };

  const withId = events.filter((e) => e.id !== null && e.id !== "");
  if (withId.length >= events.length * 0.9) {
    interface Group {
      id: string;
      entries: TradeEvent[];
      exits: TradeEvent[];
    }
    // A trade id is reused when the same id shows up again after its rows
    // already form a complete trade (both legs present and, when quantities
    // are known, balanced): typically two exports pasted together so the
    // numbering restarts. Each occurrence is then its own trade.
    const complete = (group: Group): boolean => {
      if (group.entries.length === 0 || group.exits.length === 0) return false;
      const entered = sumOrNull(group.entries.map((e) => e.quantity));
      const exited = sumOrNull(group.exits.map((e) => e.quantity));
      if (entered === null || exited === null) return true;
      return Math.abs(entered - exited) <= 1e-9;
    };
    const current = new Map<string, Group>();
    const groups: Group[] = [];
    const reused = new Map<string, number>();
    for (const event of events) {
      const key = event.id ?? `__row_${event.row}`;
      let group = current.get(key);
      if (group !== undefined && complete(group)) {
        reused.set(key, (reused.get(key) ?? 1) + 1);
        group = undefined;
      }
      if (group === undefined) {
        group = { id: key, entries: [], exits: [] };
        current.set(key, group);
        groups.push(group);
      }
      (event.kind === "entry" ? group.entries : group.exits).push(event);
    }
    if (reused.size > 0) {
      const sample = [...reused.keys()].slice(0, 5).join(", ");
      issues.push(
        issue(
          "warning",
          "trade-id-reused",
          `${reused.size} trade id(s) (${sample}${reused.size > 5 ? ", ..." : ""}) appear again after the ` +
            "trade with that id was already closed. Each occurrence was imported as a separate trade; " +
            "the file may combine several exports whose numbering restarts.",
        ),
      );
    }
    for (const group of groups) {
      const key = group.id;
      const symbols = new Set(
        [...group.entries, ...group.exits]
          .map((e) => e.symbol)
          .filter((s): s is string => s !== null),
      );
      if (symbols.size > 1) {
        issues.push(
          issue(
            "error",
            "ambiguous-mapping",
            `Trade id "${key}" spans multiple symbols (${[...symbols].join(", ")}); its rows were skipped. ` +
              "The id column mapping is probably wrong.",
          ),
        );
        continue;
      }
      if (group.entries.length === 0) {
        issues.push(
          issue(
            "warning",
            "unmatched-exit",
            `Trade id "${key}" has exit rows but no entry row; skipped. The entry may predate the export window.`,
            group.exits[0] !== undefined ? { row: group.exits[0].row } : {},
          ),
        );
        continue;
      }
      const trade = buildTradeFromGroup(key, group.entries, group.exits, issues);
      (trade.status === "open" ? open : closed).push(trade);
    }
    return { closed, open };
  }

  // FIFO fallback: no ids to trust.
  issues.push(
    issue(
      "warning",
      "row-recovered",
      "The file has entry/exit rows but no trade id column, so entries and exits were matched " +
        "first-in-first-out within each symbol and direction. Verify a few reconstructed trades " +
        "before trusting the result.",
    ),
  );
  const sorted = [...events].sort((a, b) => (a.time ?? 0) - (b.time ?? 0) || a.row - b.row);
  const queues = new Map<string, TradeEvent[]>();
  const keyOf = (e: TradeEvent): string => `${e.symbol ?? ""}|${e.direction ?? ""}`;
  for (const event of sorted) {
    if (event.kind === "entry") {
      const key = keyOf(event);
      const queue = queues.get(key) ?? [];
      queue.push({ ...event });
      queues.set(key, queue);
      continue;
    }
    const queue = queues.get(keyOf(event));
    if (!queue?.length) {
      issues.push(
        issue(
          "warning",
          "unmatched-exit",
          `Line ${event.row}: exit with no prior matching entry; skipped.`,
          { row: event.row },
        ),
      );
      continue;
    }
    let remaining = event.quantity;
    do {
      const entry = queue.shift();
      if (!entry) {
        issues.push(
          issue(
            "error",
            "unmatched-exit",
            `Line ${event.row}: exit quantity exceeds the entries in this file.`,
            { row: event.row },
          ),
        );
        break;
      }
      const take =
        remaining !== null && entry.quantity !== null
          ? Math.min(remaining, entry.quantity)
          : entry.quantity;
      const entryShare =
        take !== null && entry.quantity !== null && entry.quantity > 0 ? take / entry.quantity : 1;
      const exitShare =
        take !== null && event.quantity !== null && event.quantity > 0 ? take / event.quantity : 1;
      const allocated = {
        ...entry,
        quantity: take,
        fees: entry.fees === null ? null : entry.fees * entryShare,
      };
      const exit = {
        ...event,
        quantity: take,
        pnl: event.pnl === null ? null : event.pnl * exitShare,
        fees: event.fees === null ? null : event.fees * exitShare,
      };
      if (entryShare < 1 && take !== null && entry.quantity !== null) {
        queue.unshift({
          ...entry,
          quantity: entry.quantity - take,
          fees: entry.fees === null ? null : entry.fees * (1 - entryShare),
        });
      }
      closed.push(buildTradeFromGroup(null, [allocated], [exit], issues));
      remaining = remaining !== null && take !== null ? remaining - take : 0;
    } while (remaining > 1e-9);
  }
  for (const queue of queues.values()) {
    for (const entry of queue) {
      const trade = buildTradeFromGroup(null, [entry], [], issues);
      open.push(trade);
    }
  }
  return { closed, open };
}

/** One raw fill passed to the journal matching engine. */
export interface Execution {
  id?: string;
  effect?: "in" | "out" | "in/out";
  reportedGrossPnl?: number;
  row: number;
  symbol: string | null;
  /** buy = +quantity, sell = -quantity against the running position. */
  side: "buy" | "sell";
  quantity: number;
  price: number;
  time: number | null;
  fees: number | null;
}
