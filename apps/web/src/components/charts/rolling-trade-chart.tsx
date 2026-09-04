"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PerformanceTrends } from "@/lib/performance-trends";
import { fmtMoney, fmtPercent } from "@/lib/utils";
import { usePrivacy } from "../privacy";
import { ChartFrame } from "./chart-frame";
import { tooltipStyle, useVizTokens } from "./tokens";

export function RollingTradeChart({
  data,
  metric,
  reference,
  currency,
  timeZone,
}: {
  data: PerformanceTrends["points"];
  metric: "winRate" | "avgNetPnl";
  reference: number;
  currency: string;
  timeZone: string;
}) {
  const tokens = useVizTokens();
  const privacy = usePrivacy();
  const rate = metric === "winRate";
  const format = (value: number) =>
    rate ? fmtPercent(value, 0) : privacy ? "••••" : fmtMoney(value, currency);
  if (!tokens) return <div className="h-60" />;
  return (
    <ChartFrame height={240}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 12, right: 14, bottom: 4, left: 0 }}
          aria-label={`${rate ? "Win rate" : "Average net P&L"} over 20-trade windows. Exact values and links follow below.`}
        >
          <CartesianGrid stroke={tokens.gridline} vertical={false} />
          <XAxis
            dataKey="sequence"
            type="number"
            domain={["dataMin", "dataMax"]}
            allowDecimals={false}
            tickFormatter={(value: number) => `#${value}`}
            tick={{ fill: tokens.inkMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: tokens.baseline }}
            minTickGap={24}
          />
          <YAxis
            width={rate ? 48 : 80}
            domain={
              rate ? [0, 1] : [(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]
            }
            tickFormatter={format}
            tick={{ fill: tokens.inkMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          {!rate && <ReferenceLine y={0} stroke={tokens.baseline} />}
          <ReferenceLine
            y={reference}
            stroke={tokens.inkMuted}
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
          />
          <Tooltip
            contentStyle={tooltipStyle(tokens)}
            labelFormatter={(label) => {
              const point = data.find((point) => point.sequence === Number(label));
              return `Trade #${label}${point ? ` · ${new Intl.DateTimeFormat("en", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(point.closedAt))}` : ""}`;
            }}
            formatter={(value) => [format(Number(value)), "Last 20 trades"]}
          />
          <Line
            dataKey={metric}
            type="linear"
            stroke={tokens.brand}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
