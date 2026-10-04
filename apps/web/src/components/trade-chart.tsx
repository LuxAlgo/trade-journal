"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { fmtMoney } from "@/lib/utils";
import { usePrivacy } from "./privacy";
import { EquityArea } from "./charts/equity-area";

export interface ChartExecution {
  side: "buy" | "sell";
  quantity: number;
  price: number;
  executedAt: string;
}

export interface ChartTrade {
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
 * The initial chart uses recorded fills only. Market candles are supplied through
 * the separate, explicitly selected market-data connection and replay flow.
 */
export function TradeChart(props: {
  trade: ChartTrade;
  executions: ChartExecution[];
  height?: number;
}) {
  const t = useTranslations("charts");
  const privateMode = usePrivacy();
  if (!privateMode) return <PriceChart {...props} />;
  const data = [...props.executions]
    .sort((a, b) => a.executedAt.localeCompare(b.executedAt))
    .map((fill) => ({
      t: fill.executedAt,
      cumNetPnl: fill.price / props.trade.avgEntry - 1,
    }));
  return (
    <figure className="rounded-lg border bg-card p-4">
      <p className="mb-2 text-sm font-medium">{t("executionChangeTitle")}</p>
      {props.trade.avgEntry !== 0 && data.length ? (
        <EquityArea
          data={data}
          height={props.height ?? 340}
          valueFormat="percent"
          valueLabel={t("executionChangeValue")}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t("noExecutionPrices")}</p>
      )}
      <figcaption className="mt-2 text-xs text-muted-foreground">{t("privacyCaption")}</figcaption>
    </figure>
  );
}

function PriceChart({
  trade,
  executions,
  height = 420,
}: {
  trade: ChartTrade;
  executions: ChartExecution[];
  height?: number;
}) {
  const t = useTranslations("charts");
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

      let dark = document.documentElement.classList.contains("dark");
      const sorted = [...executions].sort(
        (a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt),
      );
      const openMs = Date.parse(trade.openedAt);
      const closeMs = trade.closedAt
        ? Date.parse(trade.closedAt)
        : Date.parse(sorted.at(-1)!.executedAt);
      const durationMs = Math.max(closeMs - openMs, 60_000);
      const pad = Math.max(durationMs * 0.35, 15 * 60_000);

      let profitColor = dark ? "#0ca30c" : "#006300";
      const lossColor = "#d03b3b";
      let entryColor = trade.direction === "long" ? profitColor : lossColor;

      // Engine-free trade painting: a per-mount native indicator that emits
      // arrow labels for each fill plus an entry→exit line with the P&L.
      const type = `journal-trade-${trade.key.replace(/[^a-zA-Z0-9]/g, "-")}`;
      registerNativeIndicator({
        type,
        title: t("indicatorTitle"),
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
              text:
                execution.side === "buy"
                  ? t("executionBuy", { quantity: execution.quantity })
                  : t("executionSell", { quantity: execution.quantity }),
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

      // Vela renders supplied fills only; opening a trade never selects a data provider.
      const chart = new Vela(host, {
        symbol: trade.symbol,
        timeframe: timeframeFor(durationMs),
        theme: dark ? "dark" : "light",
        height,
        live: false,
        volume: false,
        drawings: false,
        visibleRange: { from: openMs - pad, to: closeMs + pad },
        priceStyle: "line",
        data: sorted.map((execution) => ({
          time: Date.parse(execution.executedAt),
          open: execution.price,
          high: execution.price,
          low: execution.price,
          close: execution.price,
          volume: 0,
        })),
      });
      let indicator = chart.addNativeIndicator(type);
      const themeObserver = new MutationObserver(() => {
        const nextDark = document.documentElement.classList.contains("dark");
        if (dark === nextDark) return;
        dark = nextDark;
        profitColor = dark ? "#0ca30c" : "#006300";
        entryColor = trade.direction === "long" ? profitColor : lossColor;
        chart.setTheme(dark ? "dark" : "light");
        // Repaint annotations without recreating the price chart or fetching candles.
        indicator.remove();
        indicator = chart.addNativeIndicator(type);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      cleanup = () => {
        themeObserver.disconnect();
        chart.destroy();
        unregisterNativeIndicator(type);
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [trade.key, height]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <figure>
      <div ref={hostRef} style={{ height }} className="overflow-hidden rounded-lg border" />
      <figcaption className="mt-1.5 px-1 text-xs text-muted-foreground">
        {t("pricePathCaption")}
      </figcaption>
    </figure>
  );
}
