import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalMarketProvider, type LatestBar } from "../src/lib/live-market";

/**
 * The chart's candle provider reports the current price to the page (header and line
 * alerts). A slow answer must never report a price for a timeframe or chart you left.
 */

const bar = (time: number, close: number) => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});

afterEach(() => vi.unstubAllGlobals());

/** fetch that answers each history request when the test says so. */
function heldFetch() {
  const pending: { resolution: string; answer: (bars: unknown[]) => void }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          const body = JSON.parse(String(init.body)) as { resolution: string };
          pending.push({
            resolution: body.resolution,
            answer: (bars) => resolve(Response.json({ bars })),
          });
        }),
    ),
  );
  return pending;
}

describe("the chart's price comes from the chart you are looking at", () => {
  it("a slow answer for the timeframe you left does not report its price", async () => {
    const pending = heldFetch();
    const latest: LatestBar[] = [];
    const provider = new JournalMarketProvider(
      { provider: "binance" },
      { onStatus: () => {}, onLatest: (l) => latest.push(l) },
    );
    const oneMinute = provider.getBars("BTCUSDT", "1", { limit: 500 });
    const daily = provider.getBars("BTCUSDT", "1D", { limit: 500 });
    pending.find((p) => p.resolution === "1d")!.answer([bar(1_000, 99)]);
    await daily;
    pending.find((p) => p.resolution === "1m")!.answer([bar(2_000, 50)]);
    await oneMinute;
    expect(latest.map((l) => l.bar.close)).toEqual([99]);
  });

  it("a removed chart reports nothing, even when its request answers later", async () => {
    const pending = heldFetch();
    const onLatest = vi.fn();
    const onStatus = vi.fn();
    const provider = new JournalMarketProvider({ provider: "binance" }, { onStatus, onLatest });
    const request = provider.getBars("BTCUSDT", "1", { limit: 500 });
    provider.dispose();
    onStatus.mockClear();
    pending[0]!.answer([bar(1_000, 60_000)]);
    await request;
    expect(onLatest).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });

  it("scrolling back through older candles never reports them as the price", async () => {
    const pending = heldFetch();
    const onLatest = vi.fn();
    const provider = new JournalMarketProvider(
      { provider: "binance" },
      { onStatus: () => {}, onLatest },
    );
    const request = provider.getBars("BTCUSDT", "1", { from: 0, to: 60_000 });
    pending[0]!.answer([bar(0, 10)]);
    await request;
    expect(onLatest).not.toHaveBeenCalled();
  });
});
