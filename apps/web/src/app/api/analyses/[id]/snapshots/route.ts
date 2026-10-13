import { bad, handler, ok } from "@/server/api";
import { getAnalysis } from "@/server/chart-analyses";
import { listSnapshots } from "@/server/analysis-snapshots";

type Context = { params: Promise<{ id: string }> };

/** The days this analysis has a snapshot for, newest first. */
export const GET = handler(async (_request: Request, { params }: Context) => {
  const { id } = await params;
  if (!getAnalysis(id)) return bad("Chart analysis not found", 404);
  return ok({ snapshots: listSnapshots({ analysisId: id }) });
});
