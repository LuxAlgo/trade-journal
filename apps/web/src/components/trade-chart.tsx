"use client";

import { useEffect, useRef } from "react";
import { fmtMoney } from "@/lib/utils";

interface ChartExecution {
  side: "buy" | "sell";
  quantity: number;
  price: number;
  executedAt: string;
}

interface ChartTrade {
  key: string;
  symbol: string;
  assetClass?: string | null;
  direction: string;
  openedAt: string;
  closedAt?: string | null;
  netPnl: number;
  avgEntry: number;
  avgExit?: number | null;
}

/** Crypto symbols get live candles from Vela's keyless public providers. */
const looksCrypto = (trade: ChartTrade): boolean =>
  trade.assetClass === "crypto" ||
  /^[A-Z0-9]{2,10}(USDT|USDC|USD|PERP|BTC|ETH)(\.P)?$/.test(trade.symbol);

/** Pick a timeframe that gives the trade ~30-200 bars of context. */
const timeframeFor = (durationMs: number): string => {
  const minutes = durationMs / 60_000;
  if (minutes <= 90) return "1";
  if (minutes <= 60 * 8) return "5";
  if (minutes <= 60 * 48) return "15";
  if (minutes <= 60 * 24 * 10) return "60";
  return "1D";
};

/**
 * The trade chart, on Vela (@luxalgo/vela — Apache-2.0). Entries and exits are
 * painted as arrow labels (shape + position carry the side; color reinforces),
 * connected by a dashed line with the net P&L at the exit.
 *
 * Crypto trades chart on real candles from Vela's public Binance/Coinbase
 * providers — no API key. Everything else charts offline on the trade's own
 * fills (a price path of what actually happened), because a journal fabricates
 * nothing it doesn't know.
 */
export function TradeChart({
  trade,
  executions,
  height = 420,
}: {
  trade: ChartTrade;
  executions: ChartExecution[];
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || executions.length === 0) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const vela = await import("@luxalgo/vela");
      const { Vela, registerNativeIndicator, unregisterNativeIndicator } = vela;
      if (disposed || !hostRef.current) return;

      const dark = document.documentElement.classList.contains("dark");
      const sorted = [...executions].sort(
        (a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt),
      );
      const openMs = Date.parse(trade.openedAt);
      const closeMs = trade.closedAt
        ? Date.parse(trade.closedAt)
        : Date.parse(sorted.at(-1)!.executedAt);
      const durationMs = Math.max(closeMs - openMs, 60_000);
      const pad = Math.max(durationMs * 0.35, 15 * 60_000);
      const crypto = looksCrypto(trade);

      const profitColor = "#0ca30c";
      const lossColor = "#d03b3b";
      const entryColor = trade.direction === "long" ? profitColor : lossColor;

      // Engine-free trade painting: a per-mount native indicator that emits
      // arrow labels for each fill plus an entry→exit line with the P&L.
      const type = `journal-trade-${trade.key.replace(/[^a-zA-Z0-9]/g, "-")}`;
      registerNativeIndicator({
        type,
        title: "Trade",
        shortTitle: trade.symbol,
        paneHint: "price",
        overlay: true,
        inputsSchema: () => [],
        defaultInputs: () => ({}),
        create: () => ({
          start(ctx) {
            const labels = sorted.map((execution, index) => ({
              id: `fill-${index}`,
              paneId: "price",
              xloc: "bar_time" as const,
              x: Date.parse(execution.executedAt),
              y: execution.price,
              yloc: (execution.side === "buy" ? "belowbar" : "abovebar") as "belowbar" | "abovebar",
              text: `${execution.side === "buy" ? "▲ BUY" : "▼ SELL"} ${execution.quantity}`,
              style: (execution.side === "buy" ? "triangleup" : "triangledown") as
                "triangleup" | "triangledown",
              color: execution.side === "buy" ? profitColor : lossColor,
              textColor: dark ? "#f4f4f2" : "#0b0b0b",
              size: "small" as const,
              textAlign: "center" as const,
              fontFamily: "default" as const,
              overlay: true,
            }));
            const pnlLabel =
              trade.avgExit !== null && trade.avgExit !== undefined
                ? [
                    {
                      id: "pnl",
                      paneId: "price",
                      xloc: "bar_time" as const,
                      x: closeMs,
                      y: trade.avgExit,
                      yloc: "price" as const,
                      text: fmtMoney(trade.netPnl),
                      style: "label_left" as const,
                      color: trade.netPnl >= 0 ? profitColor : lossColor,
                      textColor: "#ffffff",
                      size: "normal" as const,
                      textAlign: "left" as const,
                      fontFamily: "default" as const,
                      overlay: true,
                    },
                  ]
                : [];
            ctx.emit({
              lines:
                trade.avgExit !== null && trade.avgExit !== undefined
                  ? [
                      {
                        id: "entry-exit",
                        paneId: "price",
                        xloc: "bar_time" as const,
                        x1: openMs,
                        y1: trade.avgEntry,
                        x2: closeMs,
                        y2: trade.avgExit,
                        extend: "none" as const,
                        color: trade.netPnl >= 0 ? profitColor : lossColor,
                        invisible: false,
                        width: 2,
                        style: "dashed" as const,
                        arrowLeft: false,
                        arrowRight: true,
                        overlay: true,
                      },
                    ]
                  : [],
              labels: [...labels, ...pnlLabel],
            });
            ctx.setStatus("idle");
          },
          onBars() {},
          onViewport() {},
          setInputs() {},
          suspend() {},
          resume() {},
          stop() {},
        }),
      });

      const chart = new Vela(host, {
        symbol: trade.symbol,
        timeframe: timeframeFor(durationMs),
        theme: dark ? "dark" : "light",
        height,
        live: false,
        volume: crypto,
        drawings: false,
        visibleRange: { from: openMs - pad, to: closeMs + pad },
        priceStyle: crypto ? "candles" : "line",
        // Offline path: the trade's own fills as the price series — a journal
        // charts what happened, it doesn't invent bars it never saw.
        ...(crypto
          ? {}
          : {
              data: sorted.map((execution) => ({
                time: Date.parse(execution.executedAt),
                open: execution.price,
                high: execution.price,
                low: execution.price,
                close: execution.price,
                volume: 0,
              })),
            }),
      });

      if (crypto) {
        const [{ BinanceProvider }, { CoinbaseProvider }] = await Promise.all([
          import("@luxalgo/vela/providers/binance"),
          import("@luxalgo/vela/providers/coinbase"),
        ]);
        chart.data.registerProvider("binance", new BinanceProvider());
        chart.data.registerProvider("coinbase", new CoinbaseProvider());
      }

      chart.addNativeIndicator(type);

      cleanup = () => {
        chart.destroy();
        unregisterNativeIndicator(type);
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [trade.key, height]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={hostRef} style={{ height }} className="overflow-hidden rounded-lg border" />;
}
