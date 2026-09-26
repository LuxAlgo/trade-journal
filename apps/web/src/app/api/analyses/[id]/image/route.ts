import { bad, handler } from "@/server/api";
import { analysisImage } from "@/server/chart-analyses";

type Context = { params: Promise<{ id: string }> };

/** The embedded snapshot journal notes reference; re-saving an analysis replaces it. */
export const GET = handler(async (_request: Request, { params }: Context) => {
  const image = analysisImage((await params).id);
  if (!image) return bad("Chart snapshot not found", 404);
  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-cache",
    },
  });
});
