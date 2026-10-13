import { bad, handler, ok } from "@/server/api";
import { chartOverlayData } from "@/server/chart-overlays";

/** Trades and missed trades for a chart symbol (`extra`: more journal symbols, comma-separated). */
export const GET = handler((request: Request) => {
  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol")?.trim() ?? "";
  if (!symbol || symbol.length > 100) return bad("Choose a chart symbol.");
  const extra = (params.get("extra") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 100)
    .slice(0, 10);
  return ok(chartOverlayData(symbol, extra));
});
