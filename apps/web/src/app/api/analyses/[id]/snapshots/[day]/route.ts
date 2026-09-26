import { bad, handler, ok, requireValue } from "@/server/api";
import { getAnalysis } from "@/server/chart-analyses";
import {
  deleteSnapshot,
  getSnapshot,
  recordSnapshot,
  restoreSnapshot,
} from "@/server/analysis-snapshots";
import { isDayKey } from "@/lib/chart-analysis";

type Context = { params: Promise<{ id: string; day: string }> };

const read = async ({ params }: Context) => {
  const { id, day } = await params;
  requireValue(isDayKey(day), "Choose a valid journal day.");
  return { id, day };
};

/** One day's version of the analysis, to open read-only on the chart. */
export const GET = handler(async (_request: Request, context: Context) => {
  const { id, day } = await read(context);
  const snapshot = getSnapshot(id, day);
  return snapshot ? ok({ snapshot }) : bad("No snapshot of this analysis for that day", 404);
});

/**
 * `pin`: save the analysis as it is now as that day's version. `ensure`: the same, unless
 * the day already has one (inserting into a note never overwrites a day's version).
 * `restore`: make that day's version the live analysis again.
 */
export const POST = handler(async (request: Request, context: Context) => {
  const { id, day } = await read(context);
  const body = (await request.json()) as { action?: unknown } | null;
  const action = body?.action;
  requireValue(
    action === "pin" || action === "ensure" || action === "restore",
    "Choose pin, ensure or restore.",
  );
  if (!getAnalysis(id)) return bad("Chart analysis not found", 404);
  if (action === "pin" || (action === "ensure" && !getSnapshot(id, day)))
    recordSnapshot(id, day, { image: true });
  else if (action === "restore" && !restoreSnapshot(id, day))
    return bad("No snapshot of this analysis for that day", 404);
  return ok({ snapshot: getSnapshot(id, day), analysis: getAnalysis(id) });
});

/** Remove the day's version; the live analysis and other days are untouched. */
export const DELETE = handler(async (_request: Request, context: Context) => {
  const { id, day } = await read(context);
  return deleteSnapshot(id, day)
    ? ok({ deleted: true })
    : bad("No snapshot of this analysis for that day", 404);
});
