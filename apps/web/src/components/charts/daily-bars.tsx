"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMoney } from "@/lib/utils";
import { tooltipStyle, useVizTokens } from "./tokens";

export interface DailyBarDatum {
  date: string;
  netPnl: number;
}

/**
 * Net daily P&L. Polarity is geometry first (bars grow from the zero baseline);
 * green/red only reinforces. Rounded corners sit at the data end.
 */
export function DailyBars({ data, height = 240 }: { data: DailyBarDatum[]; height?: number }) {
  const t = useVizTokens();
  if (!t) return <div style={{ height }} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="20%">
        <CartesianGrid stroke={t.gridline} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: t.inkMuted, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: t.baseline }}
          minTickGap={48}
        />
        <YAxis
          tick={{ fill: t.inkMuted, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={70}
          tickFormatter={(value: number) => fmtMoney(value).replace(".00", "")}
        />
        <ReferenceLine y={0} stroke={t.baseline} />
        <Tooltip
          contentStyle={tooltipStyle(t)}
          formatter={(value) => [fmtMoney(Number(value)), "Net P&L"]}
          cursor={{ fill: t.gridline, opacity: 0.4 }}
        />
        <Bar dataKey="netPnl" isAnimationActive={false} maxBarSize={28}>
          {data.map((entry) => (
            <Cell
              key={entry.date}
              fill={entry.netPnl >= 0 ? t.profitFill : t.loss}
              radius={(entry.netPnl >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4]) as unknown as number}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
