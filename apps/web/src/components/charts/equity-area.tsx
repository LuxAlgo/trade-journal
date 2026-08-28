"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMoney } from "@/lib/utils";
import { tooltipStyle, useVizTokens } from "./tokens";

export interface EquityPointDatum {
  t: string;
  cumNetPnl: number;
}

/** Cumulative P&L area — single series, crosshair tooltip, zero baseline. */
export function EquityArea({ data, height = 240 }: { data: EquityPointDatum[]; height?: number }) {
  const t = useVizTokens();
  if (!t) return <div style={{ height }} />;
  const line = t.brand;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={line} stopOpacity={0.3} />
            <stop offset="100%" stopColor={line} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={t.gridline} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="t"
          tick={{ fill: t.inkMuted, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: t.baseline }}
          minTickGap={48}
          tickFormatter={(value: string) => value.slice(0, 10)}
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
          labelFormatter={(value) => String(value).slice(0, 10)}
          formatter={(value) => [fmtMoney(Number(value)), "Cumulative P&L"]}
          cursor={{ stroke: t.inkMuted, strokeDasharray: "3 3" }}
        />
        <Area
          type="monotone"
          dataKey="cumNetPnl"
          stroke={line}
          strokeWidth={2}
          fill="url(#equityFill)"
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
