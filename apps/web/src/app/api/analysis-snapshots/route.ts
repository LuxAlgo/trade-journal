import { bad, handler, ok } from "@/server/api";
import { listSnapshots } from "@/server/analysis-snapshots";
import { isDayKey } from "@/lib/chart-analysis";

/** Every analysis snapshot of a journal day, in the order they were started. */
export const GET = handler((request: Request) => {
  const day = new URL(request.url).searchParams.get("day");
  if (!isDayKey(day)) return bad("Choose a valid journal day.");
  return ok({ snapshots: listSnapshots({ day }) });
});
