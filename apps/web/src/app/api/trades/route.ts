import { computeMetrics } from "@luxalgo/journal-core";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { queryTrades, type TradeFilters } from "@/server/trades-query";

const filtersFrom = (url: URL): TradeFilters => ({
  accountIds: url.searchParams.get("accounts")?.split(",").filter(Boolean),
  from: url.searchParams.get("from") ?? undefined,
  to: url.searchParams.get("to") ?? undefined,
  symbol: url.searchParams.get("symbol") ?? undefined,
  tag: url.searchParams.get("tag") ?? undefined,
  playbookId: url.searchParams.get("playbook") ?? undefined,
  direction: (url.searchParams.get("direction") as TradeFilters["direction"]) ?? undefined,
  status: (url.searchParams.get("status") as TradeFilters["status"]) ?? undefined,
});

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const { rows, trades } = queryTrades(filtersFrom(url));
  const metrics = computeMetrics(trades, { timeZone: getTimeZone() });
  return ok({
    trades: rows.map((row, index) => ({
      ...row,
      tags: trades[index]!.annotations?.tags ?? [],
      mistakes: trades[index]!.annotations?.mistakes ?? [],
      reviewed: row.reviewedAt !== null,
    })),
    metrics,
  });
});
