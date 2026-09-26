import { bad, handler } from "@/server/api";
import { snapshotImage } from "@/server/analysis-snapshots";
import { isDayKey } from "@/lib/chart-analysis";

type Context = { params: Promise<{ id: string; day: string }> };

/** The chart as it was that day; a day's journal embeds this instead of the live image. */
export const GET = handler(async (_request: Request, { params }: Context) => {
  const { id, day } = await params;
  const image = isDayKey(day) ? snapshotImage(id, day) : null;
  if (!image) return bad("Chart snapshot not found", 404);
  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      // Today's version still changes, and a day can be re-pinned.
      "Cache-Control": "private, no-cache",
    },
  });
});
