"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CalendarInsights } from "@/lib/calendar-insights";
import { fmtMoney } from "@/lib/utils";
import { usePrivacy } from "../privacy";
import { ChartFrame } from "./chart-frame";
import { tooltipStyle, useVizTokens } from "./tokens";

export function CalendarDailyChart({
  data,
  currency,
  onInspect,
}: {
  data: CalendarInsights["trend"];
  currency: string;
  onInspect: (date: string) => void;
}) {
  const tokens = useVizTokens();
  const privacy = usePrivacy();
  if (!tokens) return <div className="h-60" />;
  return (
    <ChartFrame height={240}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          aria-label="Daily net profit and loss. Exact values and trade links are available in the table below."
          data={data}
          margin={{ top: 12, right: 8, bottom: 4, left: 0 }}
          onClick={(state) => {
            if (
              typeof state.activeLabel === "string" &&
              data.some((day) => day.date === state.activeLabel)
            )
              onInspect(state.activeLabel);
          }}
        >
          <CartesianGrid stroke={tokens.gridline} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(date: string) => date.slice(5).replace("-", "/")}
            minTickGap={24}
            tick={{ fill: tokens.inkMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: tokens.baseline }}
          />
          <YAxis
            width={76}
            tick={{ fill: tokens.inkMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) =>
              privacy ? "••••" : fmtMoney(value, currency).replace(/\.00$/, "")
            }
          />
          <ReferenceLine y={0} stroke={tokens.baseline} />
          <Tooltip
            contentStyle={tooltipStyle(tokens)}
            cursor={{ fill: tokens.gridline, opacity: 0.35 }}
            formatter={(value, name) => [
              privacy ? "Hidden" : fmtMoney(Number(value), currency),
              name === "average" ? "5-trading-day average" : "Daily net P&L",
            ]}
          />
          <Bar dataKey="netPnl" maxBarSize={22} isAnimationActive={false} cursor="pointer">
            {data.map((day) => (
              <Cell
                key={day.date}
                fill={
                  day.netPnl > 0
                    ? tokens.profitFill
                    : day.netPnl < 0
                      ? tokens.loss
                      : tokens.inkMuted
                }
              />
            ))}
          </Bar>
          {data.length >= 8 && (
            <Line
              dataKey="average"
              type="linear"
              stroke={tokens.foreground}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
