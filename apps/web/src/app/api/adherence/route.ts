import { analyzeAdherence, readFilters } from "@luxalgo/journal-core";
import { db, playbooks, tradeRuleChecks, accounts } from "@/db";
import { queryTrades } from "@/server/trades-query";
import { handler, ok } from "@/server/api";

export const GET = handler((request: Request) => {
  const { trades } = queryTrades(readFilters(new URL(request.url).searchParams));
  const checks = db.select().from(tradeRuleChecks).all();
  const books = db
    .select()
    .from(playbooks)
    .all()
    .map((book) => ({
      id: book.id,
      rules: JSON.parse(book.rulesJson) as string[],
    }));
  const currencies = new Map(
    db
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .all()
      .map((a) => [a.id, a.currency]),
  );
  return ok({
    books: analyzeAdherence(trades, books, checks).map(({ accountIds, ...book }) => ({
      ...book,
      currencies: [...new Set(accountIds.map((id) => currencies.get(id) ?? "USD"))],
    })),
  });
});
