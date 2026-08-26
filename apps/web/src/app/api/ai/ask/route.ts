import {
  byDuration,
  byHour,
  byMistake,
  byPlaybook,
  bySymbol,
  byTag,
  byWeekday,
  computeMetrics,
  type BucketStats,
} from "@luxalgo/journal-core";
import { bad, handler, ok } from "@/server/api";
import { runAi } from "@/server/ai";
import { getTimeZone } from "@/server/settings";
import { queryTrades } from "@/server/trades-query";

const bucketBlock = (title: string, buckets: BucketStats[]): string =>
  buckets.length === 0
    ? ""
    : `${title}:\n${buckets
        .map(
          (b) =>
            `  ${b.key}: ${b.trades} trades, net ${b.netPnl.toFixed(2)}, win ${b.winRate === null ? "n/a" : `${(b.winRate * 100).toFixed(0)}%`}`,
        )
        .join("\n")}\n`;

/**
 * "Ask your journal" — natural-language questions answered from the trader's
 * own aggregates. The same questions an agent can ask through the MCP tools.
 */
export const POST = handler(async (request: Request) => {
  const { question } = (await request.json()) as { question?: string };
  if (!question) return bad("question is required");
  const timeZone = getTimeZone();

  const { trades } = queryTrades();
  if (trades.length === 0) return bad("The journal is empty — import trades first");
  const m = computeMetrics(trades, { timeZone });

  const context = [
    `Overall: net ${m.netPnl.toFixed(2)} over ${m.closedTrades} closed trades (${m.tradingDays} days), win rate ${m.winRate === null ? "n/a" : `${(m.winRate * 100).toFixed(1)}%`}, profit factor ${m.profitFactorIsInfinite ? "inf" : (m.profitFactor?.toFixed(2) ?? "n/a")}, avg win ${m.avgWin?.toFixed(2) ?? "n/a"}, avg loss ${m.avgLoss?.toFixed(2) ?? "n/a"}, max drawdown ${m.maxDrawdown.toFixed(2)}, day win rate ${m.dayWinRate === null ? "n/a" : `${(m.dayWinRate * 100).toFixed(0)}%`}, fees ${m.fees.toFixed(2)}.`,
    bucketBlock("By symbol (top 12)", bySymbol(trades).slice(0, 12)),
    bucketBlock("By weekday", byWeekday(trades, timeZone)),
    bucketBlock("By hour of open", byHour(trades, timeZone)),
    bucketBlock("By holding time", byDuration(trades)),
    bucketBlock("By tag", byTag(trades).slice(0, 12)),
    bucketBlock("By mistake", byMistake(trades).slice(0, 12)),
    bucketBlock("By playbook", byPlaybook(trades)),
  ].join("\n");

  const answer = await runAi(
    `Answer the trader's question using ONLY these aggregates from their journal. If the data
can't answer it, say exactly what's missing (e.g. "tag your trades' stops to get R stats").
Cite the numbers you used. Under 200 words.

${context}

Question: ${question}`,
  );

  return ok({ answer });
});
