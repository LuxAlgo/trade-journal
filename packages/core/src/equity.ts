import type { RoundTrip } from "./types";
import { dayKeyOf } from "./time";

export interface EquityPoint {
  /** ISO timestamp (trade close) or day key, depending on the curve. */
  t: string;
  cumNetPnl: number;
}

export interface DayStats {
  date: string;
  netPnl: number;
  grossPnl: number;
  fees: number;
  trades: number;
  wins: number;
  losses: number;
  breakevens: number;
  volume: number;
}

const closedByCloseTime = (trades: RoundTrip[]): RoundTrip[] =>
  trades
    .filter((t): t is RoundTrip & { closedAt: string } => t.status !== "open" && !!t.closedAt)
    .sort(
      (a, b) => Date.parse(a.closedAt!) - Date.parse(b.closedAt!) || a.key.localeCompare(b.key),
    );

/** Trade-level equity curve: cumulative net P&L at each trade close. */
export const equityCurve = (trades: RoundTrip[]): EquityPoint[] => {
  let cum = 0;
  return closedByCloseTime(trades).map((trade) => {
    cum += trade.netPnl;
    return { t: trade.closedAt!, cumNetPnl: cum };
  });
};

/** Per-day realized stats, keyed "YYYY-MM-DD" in the given timezone. */
export const dailyStats = (trades: RoundTrip[], timeZone = "UTC"): DayStats[] => {
  const days = new Map<string, DayStats>();
  for (const trade of closedByCloseTime(trades)) {
    const date = dayKeyOf(trade.closedAt!, timeZone);
    let day = days.get(date);
    if (!day) {
      day = {
        date,
        netPnl: 0,
        grossPnl: 0,
        fees: 0,
        trades: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        volume: 0,
      };
      days.set(date, day);
    }
    day.netPnl += trade.netPnl;
    day.grossPnl += trade.grossPnl;
    day.fees += trade.fees;
    day.trades += 1;
    day.volume += trade.quantity;
    if (trade.status === "win") day.wins += 1;
    else if (trade.status === "loss") day.losses += 1;
    else day.breakevens += 1;
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
};

/** Daily cumulative net P&L curve (one point per trading day). */
export const dailyCumulative = (trades: RoundTrip[], timeZone = "UTC"): EquityPoint[] => {
  return dailyCumulativeFromDays(dailyStats(trades, timeZone));
};

/** Daily totals are already ordered by date. */
export const dailyCumulativeFromDays = (days: DayStats[]): EquityPoint[] => {
  let cum = 0;
  return days.map((day) => {
    cum += day.netPnl;
    return { t: day.date, cumNetPnl: cum };
  });
};

export interface DrawdownStats {
  /** Deepest peak-to-trough fall of the curve, as a positive number. */
  maxDrawdown: number;
  /** Fall relative to (initialBalance + peak). Null when the base is not positive. */
  maxDrawdownPct: number | null;
  peak: number;
}

/** Drawdown over any cumulative curve. `initialBalance` anchors the percentage. */
export const drawdown = (curve: EquityPoint[], initialBalance = 0): DrawdownStats => {
  let peak = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct: number | null = null;
  for (const point of curve) {
    if (point.cumNetPnl > peak) peak = point.cumNetPnl;
    const dd = peak - point.cumNetPnl;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      const base = initialBalance + peak;
      maxDrawdownPct = base > 0 ? dd / base : null;
    }
  }
  return { maxDrawdown, maxDrawdownPct, peak };
};

export interface IntradayPoint {
  t: string;
  cumNetPnl: number;
}

/**
 * Running realized P&L across one day, built from per-exit attributions.
 * Fees are spread across a trade's exits pro-rata by exit quantity, so the
 * curve ends exactly at the day's net P&L.
 */
export const intradayCurve = (
  trades: RoundTrip[],
  executionTimes: Map<string, string>,
  date: string,
  timeZone = "UTC",
): IntradayPoint[] => {
  const events: { t: string; pnl: number }[] = [];
  for (const trade of trades) {
    const totalExitQty = trade.exits.reduce((total, exit) => total + exit.quantity, 0);
    for (const exit of trade.exits) {
      const t = executionTimes.get(exit.executionId);
      if (!t || dayKeyOf(t, timeZone) !== date) continue;
      const feeShare = totalExitQty > 0 ? trade.fees * (exit.quantity / totalExitQty) : 0;
      events.push({ t, pnl: exit.grossPnl - feeShare });
    }
  }
  events.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  let cum = 0;
  return events.map((event) => {
    cum += event.pnl;
    return { t: event.t, cumNetPnl: cum };
  });
};
