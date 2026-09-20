import { eq } from "drizzle-orm";
import { computeMetrics, dayKeyOf } from "@luxalgo/journal-core";
import { db, journalDays } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { runAi } from "@/server/ai";
import { queryTrades } from "@/server/trades-query";
import { accountContext, readAiRequest } from "@/server/ai-scope";

/** Generate a session recap for one trading day from the day's actual trades. */
export const POST = handler(async (request: Request) => {
  const scope = readAiRequest(await request.json(), "date");
  const { timeZone, filters } = scope;
  const date = scope.date!;

  const { trades } = queryTrades(filters);
  const dayTrades = trades.filter(
    (trade) => trade.closedAt && dayKeyOf(trade.closedAt, timeZone) === date,
  );
  if (dayTrades.length === 0)
    return bad("No closed trades match this day and the selected filters");

  const metrics = computeMetrics(dayTrades, { timeZone });
  // Day notes are shared across accounts and cannot be attributed to a filtered subset.
  const onlyDateFilters = Object.keys(filters).every((key) => key === "from" || key === "to");
  const existingNote = onlyDateFilters
    ? db.select().from(journalDays).where(eq(journalDays.date, date)).get()?.note
    : undefined;

  const tradeLines = dayTrades
    .map(
      (trade) =>
        `${JSON.stringify(scope.accounts.find((a) => a.id === trade.accountId)?.name)} | ${trade.symbol} ${trade.direction} qty ${trade.quantity} | entry ${trade.avgEntry} → exit ${trade.avgExit} | net ${trade.netPnl.toFixed(2)} | held ${Math.round((trade.durationMs ?? 0) / 60_000)}m` +
        (trade.annotations?.tags?.length ? ` | tags: ${trade.annotations.tags.join(", ")}` : "") +
        (trade.annotations?.mistakes?.length
          ? ` | mistakes: ${trade.annotations.mistakes.join(", ")}`
          : ""),
    )
    .join("\n");

  const recap = await runAi(
    `Write a session recap for ${date} in first person ("I"), 120-200 words, markdown with a
short "**Keep**" and "**Fix**" list at the end.

${scope.context}
${accountContext(dayTrades, scope)}

Day stats: net P&L ${metrics.netPnl.toFixed(2)}, ${metrics.closedTrades} trades,
win rate ${metrics.winRate === null ? "n/a" : (metrics.winRate * 100).toFixed(0)}%,
fees ${metrics.fees.toFixed(2)}.

Trades:
${tradeLines}

${existingNote ? `The trader's own note so far (respect it, build on it):\n${existingNote}` : ""}`,
  );

  return ok({ recap, scope: scope.scope });
});
