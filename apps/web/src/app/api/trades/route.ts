import { readFilters } from "@luxalgo/journal-core";
import { computeMetrics } from "@luxalgo/journal-core";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { queryTrades, type TradeFilters } from "@/server/trades-query";

const filtersFrom = (url: URL): TradeFilters => readFilters(url.searchParams);

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const { rows, trades } = queryTrades(filtersFrom(url));
  const metrics = computeMetrics(trades, { timeZone: getTimeZone() });
  const listView = url.searchParams.get("view") === "list";
  return ok({
    trades: rows.map((row, index) => {
      const { notes, exitsJson, executionIdsJson, tagsJson, mistakesJson, ...summary } = row;
      return {
        ...(listView ? summary : row),
        tags: trades[index]!.annotations?.tags ?? [],
        mistakes: trades[index]!.annotations?.mistakes ?? [],
        reviewed: row.reviewedAt !== null,
      };
    }),
    metrics,
  });
});
