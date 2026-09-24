import { readFilters } from "@luxalgo/journal-core";
import { computeMetrics } from "@luxalgo/journal-core";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { queryTradeModels, queryTrades, type TradeFilters } from "@/server/trades-query";

const filtersFrom = (url: URL): TradeFilters => readFilters(url.searchParams);

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const filters = filtersFrom(url);
  const timeZone = getTimeZone();
  const listView = url.searchParams.get("view") === "list";
  if (listView) {
    const trades = queryTradeModels(filters);
    const metrics = computeMetrics(trades, { timeZone });
    const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize")) || 50));
    const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
    const direction = url.searchParams.get("dir") === "asc" ? 1 : -1;
    const sort = url.searchParams.get("sort") ?? "closedAt";
    const sortable = new Set([
      "closedAt",
      "symbol",
      "status",
      "quantity",
      "avgEntry",
      "avgExit",
      "netPnl",
      "fees",
      "durationMs",
      "executionCount",
      "rating",
      "roi",
      "reviewed",
    ]);
    const sortKey = sortable.has(sort) ? sort : "closedAt";
    const compare = (a: (typeof trades)[number], b: (typeof trades)[number]) => {
      const value = (trade: typeof a): string | number | boolean | null => {
        if (sortKey === "rating") return trade.annotations?.rating ?? null;
        if (sortKey === "reviewed") return trade.annotations?.reviewed ?? false;
        if (sortKey === "roi") {
          const notional = trade.avgEntry * trade.quantity * (trade.contractMultiplier ?? 1);
          return notional > 0 ? trade.netPnl / notional : 0;
        }
        const candidate = trade[sortKey as keyof typeof trade];
        return typeof candidate === "string" ||
          typeof candidate === "number" ||
          typeof candidate === "boolean"
          ? candidate
          : null;
      };
      const av = value(a);
      const bv = value(b);
      if (av === bv) return a.key.localeCompare(b.key);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return (
        (typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv))) * direction
      );
    };
    const sorted = [...trades].sort(compare);
    const start = page * pageSize;
    return ok({
      timeZone,
      metrics,
      total: sorted.length,
      page,
      pageSize,
      trades: sorted.slice(start, start + pageSize).map((trade) => ({
        key: trade.key,
        accountId: trade.accountId,
        symbol: trade.symbol,
        contractMultiplier: trade.contractMultiplier ?? null,
        direction: trade.direction,
        status: trade.status,
        openedAt: trade.openedAt,
        closedAt: trade.closedAt ?? null,
        quantity: trade.quantity,
        avgEntry: trade.avgEntry,
        avgExit: trade.avgExit ?? null,
        grossPnl: trade.grossPnl,
        fees: trade.fees,
        netPnl: trade.netPnl,
        executionCount: trade.executionCount,
        durationMs: trade.durationMs ?? null,
        rating: trade.annotations?.rating ?? null,
        tags: trade.annotations?.tags ?? [],
        mistakes: trade.annotations?.mistakes ?? [],
        reviewed: trade.annotations?.reviewed ?? false,
      })),
    });
  }

  const { rows, trades } = queryTrades(filters);
  const metrics = computeMetrics(trades, { timeZone });
  return ok({
    timeZone,
    trades: rows.map((row, index) => {
      return {
        ...row,
        contractMultiplier: trades[index]!.contractMultiplier ?? null,
        tags: trades[index]!.annotations?.tags ?? [],
        mistakes: trades[index]!.annotations?.mistakes ?? [],
        reviewed: row.reviewedAt !== null,
      };
    }),
    metrics,
  });
});
