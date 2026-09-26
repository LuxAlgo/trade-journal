import { bad, handler, ok, requireValue } from "@/server/api";
import { getAnalysis } from "@/server/chart-analyses";
import { isWatched, runningAlertEngine, setWatched } from "@/server/background-alerts/engine";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

const state = (analysisId: string) => ({
  analysisId,
  watched: isWatched(analysisId),
  running: runningAlertEngine() !== null,
  watch:
    runningAlertEngine()
      ?.status()
      .find((w) => w.analysisId === analysisId) ?? null,
});

/** Whether the server watches an analysis's alerts, and how that watch is doing. */
export const GET = handler((request: Request) => {
  const id = new URL(request.url).searchParams.get("analysisId") ?? "";
  requireValue(ID.test(id), "Choose an analysis.");
  return ok(state(id));
});

/** Switch background watching for an analysis: `{ analysisId, watched }`. */
export const PUT = handler(async (request: Request) => {
  const body = (await request.json()) as { analysisId?: unknown; watched?: unknown } | null;
  const id = typeof body?.analysisId === "string" ? body.analysisId : "";
  requireValue(ID.test(id), "Choose an analysis.");
  requireValue(typeof body?.watched === "boolean", "watched must be true or false.");
  if (!getAnalysis(id)) return bad("Chart analysis not found", 404);
  setWatched(id, body.watched);
  return ok(state(id));
});
