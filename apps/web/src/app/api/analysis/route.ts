import {
  analyzeGroups,
  DIMENSIONS,
  readFilters,
  summarizeGroup,
  type Dimension,
} from "@luxalgo/journal-core";
import { handler, ok } from "@/server/api";
import { queryTrades } from "@/server/trades-query";
import { getTimeZone } from "@/server/settings";
import { db, playbooks, accounts } from "@/db";
export const GET = handler((request: Request) => {
  const params = new URL(request.url).searchParams;
  const primary = params.get("primary") as Dimension,
    secondary = params.get("secondary") as Dimension;
  const { trades } = queryTrades(readFilters(params));
  const tz = getTimeZone(),
    accountRows = db.select().from(accounts).all();
  const accountCurrencies = new Map(accountRows.map((a) => [a.id, a.currency]));
  const currencies = [...new Set(trades.map((t) => accountCurrencies.get(t.accountId) ?? "USD"))];
  return ok({
    summary: summarizeGroup(trades),
    groups: analyzeGroups(
      trades,
      Object.hasOwn(DIMENSIONS, primary) ? primary : "symbol",
      Object.hasOwn(DIMENSIONS, secondary) ? secondary : undefined,
      tz,
    ),
    playbooks: db.select({ id: playbooks.id, name: playbooks.name }).from(playbooks).all(),
    currencies,
    timeZone: tz,
    accounts: accountRows.map((a) => ({ id: a.id, name: a.name })),
  });
});
