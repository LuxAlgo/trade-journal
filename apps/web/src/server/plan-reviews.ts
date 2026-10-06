import { and, eq } from "drizzle-orm";
import { chartPlanReviews, db } from "@/db";
import { isOutcome, type ScenarioOutcome, type ScenarioReview } from "@/lib/analysis-plan";
import { nowIso } from "./ids";

/** How you graded each scenario of an analysis's plan on one journal day. */
export function listReviews(analysisId: string, day: string): ScenarioReview[] {
  return db
    .select({
      scenarioId: chartPlanReviews.scenarioId,
      outcome: chartPlanReviews.outcome,
      note: chartPlanReviews.note,
    })
    .from(chartPlanReviews)
    .where(and(eq(chartPlanReviews.analysisId, analysisId), eq(chartPlanReviews.day, day)))
    .all()
    .flatMap((r) => (isOutcome(r.outcome) ? [{ ...r, outcome: r.outcome }] : []));
}

/** Save a grade, or clear it with null (back to the suggestion from the candles). */
export function saveReview(
  analysisId: string,
  day: string,
  scenarioId: string,
  outcome: ScenarioOutcome | null,
  note: string,
) {
  const key = and(
    eq(chartPlanReviews.analysisId, analysisId),
    eq(chartPlanReviews.day, day),
    eq(chartPlanReviews.scenarioId, scenarioId),
  );
  if (outcome === null) {
    db.delete(chartPlanReviews).where(key).run();
    return;
  }
  const values = { outcome, note, updatedAt: nowIso() };
  db.insert(chartPlanReviews)
    .values({ analysisId, day, scenarioId, ...values })
    .onConflictDoUpdate({
      target: [chartPlanReviews.analysisId, chartPlanReviews.day, chartPlanReviews.scenarioId],
      set: values,
    })
    .run();
}
