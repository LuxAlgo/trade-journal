"use client";

import { useMemo, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import type { EChartsOption } from "echarts";
import { formatLocale, type Locale } from "@/i18n/config";
import { fmtMoney, fmtNumber } from "@/lib/utils";
import { usePrivacy } from "../privacy";
import { useVizTokens } from "./tokens";

const EChart = dynamic(() => import("./echart").then((module) => module.EChart), { ssr: false });

export interface HourBucket {
  key: string; // "09"
  netPnl: number;
  trades: number;
}

/**
 * Time-of-day performance (ECharts — the heavy plot). Two aligned rows:
 * P&L per opening hour as diverging columns, trade count as a muted line.
 * One value axis per pane — never dual-axis on one grid.
 *
 * The option is rebuilt whenever the interface locale changes (axis names,
 * series names and tooltip formatters all live inside it), and the EChart is
 * re-keyed on locale so no stale tooltip text survives a language switch.
 */
export function TimeHeatmap({
  hours,
  height = 300,
  currency = "USD",
}: {
  hours: HourBucket[];
  height?: number;
  currency?: string;
}) {
  const t = useTranslations("charts");
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const viz = useVizTokens();
  const privateMode = usePrivacy();
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const option = useMemo<EChartsOption | null>(() => {
    if (!viz) return null;
    const categories = hours.map((h) => `${h.key}:00`);
    const pnlAxisName = privateMode ? t("pnlAxisHidden") : t("pnlAxis", { currency });
    return {
      backgroundColor: "transparent",
      grid: [
        { left: 64, right: 16, top: 24, height: "48%" },
        { left: 64, right: 16, bottom: 28, height: "22%" },
      ],
      tooltip: {
        confine: true,
        trigger: "axis",
        backgroundColor: viz.card,
        borderColor: viz.border,
        borderWidth: 1,
        padding: [12, 14],
        extraCssText:
          "border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.1);line-height:1.6;",
        textStyle: { color: viz.foreground, fontSize: 13 },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      xAxis: [
        {
          type: "category",
          data: categories,
          gridIndex: 0,
          axisLine: { lineStyle: { color: viz.baseline } },
          axisLabel: { show: false },
          axisTick: { show: false },
        },
        {
          type: "category",
          data: categories,
          gridIndex: 1,
          axisLine: { lineStyle: { color: viz.baseline } },
          axisLabel: { color: viz.inkMuted, fontSize: 11 },
          axisTick: { show: false },
        },
      ],
      yAxis: [
        {
          type: "value",
          gridIndex: 0,
          name: pnlAxisName,
          nameTextStyle: { color: viz.inkMuted, fontSize: 11 },
          splitLine: { lineStyle: { color: viz.gridline } },
          axisLabel: {
            color: viz.inkMuted,
            fontSize: 11,
            formatter: (value: number) => (privateMode ? "••••" : fmtNumber(value, 0, tag)),
          },
        },
        {
          type: "value",
          gridIndex: 1,
          name: t("seriesTrades"),
          nameTextStyle: { color: viz.inkMuted, fontSize: 11 },
          splitLine: { show: false },
          axisLabel: { color: viz.inkMuted, fontSize: 11 },
        },
      ],
      series: [
        {
          type: "bar",
          name: t("seriesNetPnl"),
          tooltip: {
            valueFormatter: (value) =>
              privateMode ? t("hidden") : fmtMoney(Number(value), currency, tag),
          },
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: hours.map((h) => ({
            value: h.netPnl,
            itemStyle: {
              color: h.netPnl >= 0 ? viz.profitFill : viz.loss,
              borderRadius: h.netPnl >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4],
            },
          })),
          barMaxWidth: 26,
        },
        {
          type: "line",
          name: t("seriesTrades"),
          tooltip: { valueFormatter: (value) => fmtNumber(Number(value), 0, tag) },
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: hours.map((h) => h.trades),
          lineStyle: { color: viz.inkMuted, width: 2 },
          itemStyle: { color: viz.inkMuted },
          symbolSize: 6,
        },
      ],
    };
  }, [hours, viz, privateMode, currency, tag, t]);

  return (
    <div ref={host} style={{ height }}>
      {visible && option && (
        <EChart key={`${privateMode}:${tag}`} option={option} height={height} />
      )}
    </div>
  );
}
