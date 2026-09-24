import { readFilters } from "@luxalgo/journal-core";
import { accounts, db } from "@/db";
import { tradeExplorerPoints } from "@/lib/trade-explorer";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { queryTradeModels } from "@/server/trades-query";

import { savedEstimates } from "@/server/market-data/estimates";

export const GET = handler((request: Request) => {
  const trades = queryTradeModels(readFilters(new URL(request.url).searchParams));
  const timeZone = getTimeZone();
  const currencies = new Map(
    db
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .all()
      .map((account) => [account.id, account.currency]),
  );
  const estimates = savedEstimates(trades);
  return ok({
    points: tradeExplorerPoints(trades, timeZone).map((point) => ({
      ...point,
      mae: estimates.get(point.key)?.estimate.mae ?? null,
      mfe: estimates.get(point.key)?.estimate.mfe ?? null,
    })),
    currencies: [
      ...new Set(
        trades
          .filter((trade) => trade.status !== "open" && trade.closedAt)
          .map((trade) => currencies.get(trade.accountId) ?? "USD"),
      ),
    ],
    timeZone,
  });
});
