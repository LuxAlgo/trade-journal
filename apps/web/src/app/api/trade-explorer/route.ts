import { readFilters } from "@luxalgo/journal-core";
import { accounts, db } from "@/db";
import { tradeExplorerPoints } from "@/lib/trade-explorer";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { queryTrades } from "@/server/trades-query";

export const GET = handler((request: Request) => {
  const { trades } = queryTrades(readFilters(new URL(request.url).searchParams));
  const timeZone = getTimeZone();
  const currencies = new Map(
    db
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .all()
      .map((account) => [account.id, account.currency]),
  );
  return ok({
    points: tradeExplorerPoints(trades, timeZone),
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
