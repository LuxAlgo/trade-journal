import { bad, handler, ok, requireValue } from "@/server/api";
import { getSnapshot } from "@/server/analysis-snapshots";
import { dayPriceAction } from "@/server/day-price-action";
import { getTimeZone } from "@/server/settings";
import { isDayKey } from "@/lib/chart-analysis";

type Context = { params: Promise<{ id: string; day: string }> };

/**
 * What price did that day against the day's version of an analysis: the session and each
 * level's outcome. A source that is off or unreachable answers with its reason instead.
 */
export const GET = handler(async (request: Request, { params }: Context) => {
  const { id, day } = await params;
  requireValue(isDayKey(day), "Choose a valid journal day.");
  const snapshot = getSnapshot(id, day);
  if (!snapshot) return bad("That day has no version of this analysis.", 404);
  try {
    const action = await dayPriceAction(snapshot, day, getTimeZone(), request.signal);
    return ok({ priceAction: action, problem: null });
  } catch (error) {
    return ok({
      priceAction: null,
      problem: error instanceof Error ? error.message : "Market data is unavailable.",
    });
  }
});
