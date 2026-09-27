import { bad, handler } from "@/server/api";
import { snapshotImage } from "@/server/analysis-snapshots";
import { pngResponse } from "@/server/png-response";
import { isDayKey } from "@/lib/chart-analysis";

type Context = { params: Promise<{ id: string; day: string }> };

/** The chart as it was that day; a day's journal embeds this instead of the live image. */
export const GET = handler(async (request: Request, { params }: Context) => {
  const { id, day } = await params;
  // Today's version still changes, and a day can be re-pinned: revalidated each time.
  const image = isDayKey(day) ? snapshotImage(id, day) : null;
  if (!image) return bad("Chart snapshot not found", 404);
  return pngResponse(request, image);
});
