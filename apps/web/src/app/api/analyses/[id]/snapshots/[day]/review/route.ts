import { bad, handler, ok, requireValue } from "@/server/api";
import { getSnapshot, previousSnapshot } from "@/server/analysis-snapshots";
import { describeChanges } from "@/lib/analysis-diff";
import { listReviews, saveReview } from "@/server/plan-reviews";
import { isDayKey } from "@/lib/chart-analysis";
import { isOutcome } from "@/lib/analysis-plan";

type Context = { params: Promise<{ id: string; day: string }> };

const read = async (context: Context) => {
  const { id, day } = await context.params;
  requireValue(isDayKey(day), "Choose a valid journal day.");
  const snapshot = getSnapshot(id, day);
  return { id, day, snapshot };
};

/** The day's plan (as it stood that day) and your grades for its scenarios. */
export const GET = handler(async (_request: Request, context: Context) => {
  const { id, day, snapshot } = await read(context);
  if (!snapshot) return bad("That day has no version of this analysis.", 404);
  const previous = previousSnapshot(id, day);
  return ok({
    plan: snapshot.plan,
    reviews: listReviews(id, day),
    changes: previous ? { since: previous.day, list: describeChanges(previous, snapshot) } : null,
  });
});

/** Grade one scenario for the day: `{ scenarioId, outcome, note? }`; outcome null clears it. */
export const PUT = handler(async (request: Request, context: Context) => {
  const { id, day, snapshot } = await read(context);
  if (!snapshot) return bad("That day has no version of this analysis.", 404);
  const body = (await request.json()) as Record<string, unknown> | null;
  requireValue(body && typeof body === "object", "Invalid grade.");
  const scenario = snapshot.plan.scenarios.find((s) => s.id === body.scenarioId);
  requireValue(scenario, "That scenario is not in the day's plan.");
  requireValue(body.outcome === null || isOutcome(body.outcome), "Choose an outcome.");
  const note = body.note === undefined ? "" : body.note;
  requireValue(
    typeof note === "string" && note.length <= 1000,
    "Notes are 1000 characters or fewer.",
  );
  saveReview(id, day, scenario.id, body.outcome, note);
  return ok({ reviews: listReviews(id, day) });
});
