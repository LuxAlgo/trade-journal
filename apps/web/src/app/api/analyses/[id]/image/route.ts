import { bad, handler } from "@/server/api";
import { analysisImage } from "@/server/chart-analyses";
import { pngResponse } from "@/server/png-response";

type Context = { params: Promise<{ id: string }> };

/** The embedded snapshot journal notes reference; re-saving an analysis replaces it. */
export const GET = handler(async (request: Request, { params }: Context) => {
  const image = analysisImage((await params).id);
  if (!image) return bad("Chart snapshot not found", 404);
  return pngResponse(request, image);
});
