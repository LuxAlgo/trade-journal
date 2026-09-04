import type { AnnotatedTrade } from "@luxalgo/journal-core";

export const ROLLING_TRADE_WINDOW = 20;
export const MIN_TREND_POINTS = 8;

export function performanceTrends(trades: AnnotatedTrade[]) {
  const closed = trades
    .filter((trade) => trade.status !== "open" && trade.closedAt)
    .slice()
    .sort(
      (a, b) => Date.parse(a.closedAt!) - Date.parse(b.closedAt!) || a.key.localeCompare(b.key),
    );
  const points: {
    sequence: number;
    key: string;
    closedAt: string;
    winRate: number;
    avgNetPnl: number;
  }[] = [];
  let wins = 0,
    netPnl = 0,
    windowWins = 0,
    windowPnl = 0;
  let largestWin: AnnotatedTrade | null = null,
    largestLoss: AnnotatedTrade | null = null;
  for (let index = 0; index < closed.length; index++) {
    const trade = closed[index]!;
    const win = Number(trade.status === "win");
    wins += win;
    netPnl += trade.netPnl;
    windowWins += win;
    windowPnl += trade.netPnl;
    if (index >= ROLLING_TRADE_WINDOW) {
      const previous = closed[index - ROLLING_TRADE_WINDOW]!;
      windowWins -= Number(previous.status === "win");
      windowPnl -= previous.netPnl;
    }
    if (trade.status === "win" && (!largestWin || trade.netPnl > largestWin.netPnl))
      largestWin = trade;
    if (trade.status === "loss" && (!largestLoss || trade.netPnl < largestLoss.netPnl))
      largestLoss = trade;
    if (index >= ROLLING_TRADE_WINDOW - 1)
      points.push({
        sequence: index + 1,
        key: trade.key,
        closedAt: trade.closedAt!,
        winRate: windowWins / ROLLING_TRADE_WINDOW,
        avgNetPnl: windowPnl / ROLLING_TRADE_WINDOW,
      });
  }
  const detail = (trade: AnnotatedTrade | null) =>
    trade
      ? {
          key: trade.key,
          symbol: trade.symbol,
          direction: trade.direction,
          closedAt: trade.closedAt!,
          netPnl: trade.netPnl,
        }
      : null;
  return {
    count: closed.length,
    window: ROLLING_TRADE_WINDOW,
    points,
    overallWinRate: closed.length ? wins / closed.length : null,
    overallAvgNetPnl: closed.length ? netPnl / closed.length : null,
    largestWin: detail(largestWin),
    largestLoss: detail(largestLoss),
  };
}

export type PerformanceTrends = ReturnType<typeof performanceTrends>;
export interface PerformanceTrendsResponse {
  trends: PerformanceTrends;
  currencies: string[];
  timeZone: string;
}
