import { bad, handler, ok, requireValue } from "@/server/api";
import { createAnalysis, listAnalyses, parseAnalysisInput } from "@/server/chart-analyses";
import { isDayKey } from "@/lib/chart-analysis";

export const GET = handler((request: Request) => {
  const day = new URL(request.url).searchParams.get("day");
  if (day !== null && !isDayKey(day)) return bad("Choose a valid journal day.");
  return ok({ analyses: listAnalyses({ day: day ?? undefined }) });
});

export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as Record<string, unknown> | null;
  const input = parseAnalysisInput(body, false);
  const embed = body?.addToJournal === true;
  requireValue(!embed || input.dayDate, "Choose a journal day to add this analysis to.");
  return ok({ analysis: createAnalysis(input, { embed }) });
});
