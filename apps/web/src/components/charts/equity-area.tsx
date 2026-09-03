"use client";

import { useId } from "react";
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
import { fmtMoney, fmtPercent } from "@/lib/utils";
import { usePrivacy } from "../privacy";
import { tooltipStyle, useVizTokens } from "./tokens";

export interface EquityPointDatum {
  t: string;
  cumNetPnl: number;
}

/** Cumulative P&L area — single series, crosshair tooltip, zero baseline. */
export function EquityArea({
  data,
  height = 240,
  valueFormat = "money",
  valueLabel = "Cumulative P&L",
}: {
  data: EquityPointDatum[];
  height?: number;
  valueFormat?: "money" | "percent";
  valueLabel?: string;
}) {
  const t = useVizTokens();
  const id = useId().replace(/:/g, "");
  const privacy = usePrivacy();
  const privateMode = privacy && valueFormat === "money";
  const formatValue = (value: number) =>
    valueFormat === "percent" ? fmtPercent(value, 2) : fmtMoney(value);
  if (!t) return <div style={{ height }} />;
  const line = t.brand;
  const top = Math.max(0, ...data.map((point) => point.cumNetPnl));
  const bottom = Math.min(0, ...data.map((point) => point.cumNetPnl));
  const zero = top === bottom ? 100 : (top / (top - bottom)) * 100;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        key={String(privateMode)}
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
      >
        <defs>
          <linearGradient id={`${id}-line`} x1="0" y1="0" x2="0" y2="1">
            <stop offset={`${zero}%`} stopColor={line} />
            <stop offset={`${zero}%`} stopColor={t.loss} />
          </linearGradient>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={line} stopOpacity={0.3} />
            <stop offset={`${zero}%`} stopColor={line} stopOpacity={0.035} />
            <stop offset={`${zero}%`} stopColor={t.loss} stopOpacity={0.035} />
            <stop offset="100%" stopColor={t.loss} stopOpacity={0.3} />
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
          domain={[bottom, top === bottom ? 1 : top]}
          tickFormatter={(value: number) =>
            privateMode ? "••••" : formatValue(value).replace(".00", "")
          }
        />
        <ReferenceLine y={0} stroke={t.baseline} />
        <Tooltip
          contentStyle={tooltipStyle(t)}
          labelFormatter={(value) => String(value).slice(0, 10)}
          formatter={(value) => [privateMode ? "Hidden" : formatValue(Number(value)), valueLabel]}
          cursor={{ stroke: t.inkMuted, strokeDasharray: "3 3" }}
        />
        <Area
          type="monotone"
          dataKey="cumNetPnl"
          stroke={bottom < 0 ? (top > 0 ? `url(#${id}-line)` : t.loss) : line}
          strokeWidth={2}
          fill={`url(#${id}-fill)`}
          baseValue={0}
          dot={false}
          activeDot={({ cx, cy, payload }) => (
            <circle
              cx={cx}
              cy={cy}
              r={4}
              fill={payload.cumNetPnl < 0 ? t.loss : line}
              stroke={t.card}
              strokeWidth={2}
            />
          )}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
