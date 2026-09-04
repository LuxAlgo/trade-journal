"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RelativeDrawdownPoint } from "@luxalgo/journal-core";
import { fmtPercent } from "@/lib/utils";
import { tooltipStyle, useVizTokens } from "./tokens";
import { ChartFrame } from "./chart-frame";

export function RelativeDrawdownBars({ data }: { data: RelativeDrawdownPoint[] }) {
  const tokens = useVizTokens();
  const chartData = data.map((point) => ({
    t: point.t,
    drawdownPct: point.drawdownPct === null ? null : -point.drawdownPct,
  }));
  const available = chartData.filter(
    (point): point is { t: string; drawdownPct: number } => point.drawdownPct !== null,
  );
  const maxDrawdown = Math.max(0, ...available.map((point) => Math.abs(point.drawdownPct)));

  if (!tokens) return <div className="h-24" />;

  return (
    <div className="mt-2 border-t pt-3">
      <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        <span>Relative drawdown</span>
        <span className="tnum text-loss">
          {available.length === 0 ? "Initial balance required" : `Max −${fmtPercent(maxDrawdown)}`}
        </span>
      </div>
      {available.length === 0 ? (
        <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
          Set an initial balance to chart relative drawdown.
        </div>
      ) : (
        <ChartFrame height={96}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 2, right: 8, bottom: 0, left: 8 }}
              barCategoryGap={0}
            >
              <CartesianGrid stroke={tokens.gridline} strokeWidth={1} vertical={false} />
              <XAxis
                dataKey="t"
                tick={false}
                tickLine={false}
                axisLine={{ stroke: tokens.baseline }}
                height={8}
              />
              <YAxis
                tick={{ fill: tokens.inkMuted, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={70}
                domain={[-Math.max(maxDrawdown, 0.01), 0]}
                tickFormatter={(value: number) => fmtPercent(Math.abs(value), 0)}
                tickCount={3}
              />
              <Tooltip
                contentStyle={tooltipStyle(tokens)}
                labelFormatter={(value) => String(value).slice(0, 10)}
                formatter={(value) => [fmtPercent(Math.abs(Number(value)), 2), "Relative drawdown"]}
                cursor={{ fill: tokens.loss, fillOpacity: 0.08 }}
              />
              <Bar
                dataKey="drawdownPct"
                fill={tokens.loss}
                fillOpacity={0.82}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      )}
    </div>
  );
}
