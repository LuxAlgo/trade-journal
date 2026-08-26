import { bad, handler, ok } from "@/server/api";
import { runAi } from "@/server/ai";
import { listExecutions } from "@/server/executions";
import { getTradeByKey, rowToTrade } from "@/server/trades-query";

/** Critique one trade: entries, exits, sizing, and the trader's own annotations. */
export const POST = handler(async (request: Request) => {
  const { key } = (await request.json()) as { key?: string };
  if (!key) return bad("key is required");
  const row = getTradeByKey(key);
  if (!row) return bad("Trade not found", 404);
  const trade = rowToTrade(row);
  const fills = listExecutions(row.accountId, trade.executionIds).sort((a, b) =>
    a.executedAt.localeCompare(b.executedAt),
  );

  const critique = await runAi(
    `Critique this single trade in under 150 words. Focus on execution quality visible in the
fills (entry clustering, scaling, exit discipline), risk (stop honored or not, R multiple),
and the trader's own tags/mistakes. End with one concrete instruction for the next
occurrence of this setup.

Trade: ${trade.symbol} ${trade.direction}, status ${trade.status}
Net P&L: ${trade.netPnl.toFixed(2)} (gross ${trade.grossPnl.toFixed(2)}, fees ${trade.fees.toFixed(2)})
Avg entry ${trade.avgEntry} → avg exit ${trade.avgExit ?? "still open"}
Planned stop: ${row.stopLoss ?? "none recorded"} | target: ${row.profitTarget ?? "none recorded"}
Rating: ${row.rating ?? "unrated"} | tags: ${(trade.annotations?.tags ?? []).join(", ") || "none"} | mistakes: ${(trade.annotations?.mistakes ?? []).join(", ") || "none"}
Notes: ${row.notes ?? "none"}

Fills:
${fills.map((fill) => `${fill.executedAt} ${fill.side} ${fill.quantity} @ ${fill.price}${fill.fee ? ` fee ${fill.fee}` : ""}`).join("\n")}`,
  );

  return ok({ critique });
});
