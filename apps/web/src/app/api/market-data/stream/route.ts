import { bad, handler, requireValue } from "@/server/api";
import { connectionKey, providerFor } from "@/server/market-data/connections";
import { listenLive, upstreamFor } from "@/server/market-data/live";
import { MarketDataError } from "@/server/market-data/provider";
import { isResolution } from "@/lib/market-data";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 20_000;

/**
 * Server-Sent Events with a chart's live prices (see `server/market-data/live.ts`).
 * 204 when the source has no stream, which tells EventSource not to retry; the chart
 * then keeps polling.
 */
export const GET = handler((request: Request) => {
  const params = new URL(request.url).searchParams;
  const providerId = params.get("provider") ?? "";
  const symbol = params.get("symbol")?.trim() ?? "";
  const resolution = params.get("resolution");
  try {
    providerFor(providerId);
  } catch {
    return bad("Choose an available market data provider.");
  }
  requireValue(
    symbol.length > 0 && symbol.length <= 100 && !/[\x00-\x1f]/.test(symbol),
    "Enter the provider's exact instrument symbol.",
  );
  requireValue(isResolution(resolution), "Choose a supported candle resolution.");
  try {
    if (!upstreamFor(providerId, symbol, resolution)) return new Response(null, { status: 204 });
    // Same gate as history: a public source must be enabled in Settings first.
    connectionKey(providerId);
  } catch (error) {
    if (error instanceof MarketDataError) return bad(error.message);
    throw error;
  }

  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let unsubscribe: (() => void) | null = null;
      let done = false;
      const write = (text: string) => {
        if (done) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      stop = () => {
        if (done) return;
        done = true;
        clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // The client already went away.
        }
      };
      write("retry: 3000\n\n");
      unsubscribe = listenLive(providerId, symbol, resolution, (message) =>
        write(`data: ${JSON.stringify(message)}\n\n`),
      );
      if (request.signal.aborted) stop();
      else request.signal.addEventListener("abort", () => stop(), { once: true });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform keeps response compression from buffering the stream.
      "Cache-Control": "private, no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
