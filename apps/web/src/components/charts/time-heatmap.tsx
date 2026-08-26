"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { fmtMoney } from "@/lib/utils";
import { EChart } from "./echart";
import { useVizTokens } from "./tokens";

export interface HourBucket {
  key: string; // "09"
  netPnl: number;
  trades: number;
}

/**
 * Time-of-day performance (ECharts — the heavy plot). Two aligned rows:
 * P&L per opening hour as diverging columns, trade count as a muted line.
 * One value axis per pane — never dual-axis on one grid.
 */
export function TimeHeatmap({ hours, height = 300 }: { hours: HourBucket[]; height?: number }) {
  const t = useVizTokens();
  const option = useMemo<EChartsOption | null>(() => {
    if (!t) return null;
    const categories = hours.map((h) => `${h.key}:00`);
    return {
      backgroundColor: "transparent",
      grid: [
        { left: 64, right: 16, top: 24, height: "48%" },
        { left: 64, right: 16, bottom: 28, height: "22%" },
      ],
      tooltip: {
        trigger: "axis",
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.foreground, fontSize: 12 },
        valueFormatter: (value) =>
          typeof value === "number" ? fmtMoney(value) : String(value ?? ""),
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      xAxis: [
        {
          type: "category",
          data: categories,
          gridIndex: 0,
          axisLine: { lineStyle: { color: t.baseline } },
          axisLabel: { show: false },
          axisTick: { show: false },
        },
        {
          type: "category",
          data: categories,
          gridIndex: 1,
          axisLine: { lineStyle: { color: t.baseline } },
          axisLabel: { color: t.inkMuted, fontSize: 11 },
          axisTick: { show: false },
        },
      ],
      yAxis: [
        {
          type: "value",
          gridIndex: 0,
          name: "Net P&L",
          nameTextStyle: { color: t.inkMuted, fontSize: 11 },
          splitLine: { lineStyle: { color: t.gridline } },
          axisLabel: { color: t.inkMuted, fontSize: 11 },
        },
        {
          type: "value",
          gridIndex: 1,
          name: "Trades",
          nameTextStyle: { color: t.inkMuted, fontSize: 11 },
          splitLine: { show: false },
          axisLabel: { color: t.inkMuted, fontSize: 11 },
        },
      ],
      series: [
        {
          type: "bar",
          name: "Net P&L",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: hours.map((h) => ({
            value: h.netPnl,
            itemStyle: {
              color: h.netPnl >= 0 ? t.profitFill : t.loss,
              borderRadius: h.netPnl >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4],
            },
          })),
          barMaxWidth: 26,
        },
        {
          type: "line",
          name: "Trades",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: hours.map((h) => h.trades),
          lineStyle: { color: t.inkMuted, width: 2 },
          itemStyle: { color: t.inkMuted },
          symbolSize: 6,
        },
      ],
    };
  }, [hours, t]);

  if (!option) return <div style={{ height }} />;
  return <EChart option={option} height={height} />;
}
