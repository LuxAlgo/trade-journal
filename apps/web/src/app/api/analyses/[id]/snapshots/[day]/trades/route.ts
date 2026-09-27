import { eq } from "drizzle-orm";
import { db, trades } from "@/db";
import { bad, handler, ok, requireValue } from "@/server/api";
import { getSnapshot } from "@/server/analysis-snapshots";
import { dayTradesFor, setTradeLink } from "@/server/trade-links";
import { getTimeZone } from "@/server/settings";
import { isDayKey } from "@/lib/chart-analysis";

type Context = { params: Promise<{ id: string; day: string }> };

const read = async (context: Context) => {
  const { id, day } = await context.params;
  requireValue(isDayKey(day), "Choose a valid journal day.");
  return { id, day, snapshot: getSnapshot(id, day) };
};

/** The day's trades on the analysis's symbol, with their links and suggested scenarios. */
export const GET = handler(async (_request: Request, context: Context) => {
  const { day, snapshot } = await read(context);
  if (!snapshot) return bad("That day has no version of this analysis.", 404);
  return ok({ trades: dayTradesFor(snapshot, day, getTimeZone()) });
});

/**
 * Link a trade to this analysis: `{ tradeKey, linked, scenarioId? }`. `linked: false`
 * removes its link; a trade belongs to one analysis at a time.
 */
export const PUT = handler(async (request: Request, context: Context) => {
  const { id, day, snapshot } = await read(context);
  if (!snapshot) return bad("That day has no version of this analysis.", 404);
  const body = (await request.json()) as Record<string, unknown> | null;
  requireValue(body && typeof body.tradeKey === "string", "Choose a trade.");
  requireValue(typeof body.linked === "boolean", "Say whether the trade is linked.");
  const trade = db
    .select({ key: trades.key })
    .from(trades)
    .where(eq(trades.key, body.tradeKey))
    .get();
  requireValue(trade, "That trade does not exist.");
  const scenarioId = body.scenarioId ?? null;
  requireValue(
    scenarioId === null || snapshot.plan.scenarios.some((s) => s.id === scenarioId),
    "That scenario is not in the day's plan.",
  );
  setTradeLink(
    trade.key,
    body.linked ? { analysisId: id, scenarioId: scenarioId as string | null } : null,
  );
  return ok({ trades: dayTradesFor(snapshot, day, getTimeZone()) });
});
