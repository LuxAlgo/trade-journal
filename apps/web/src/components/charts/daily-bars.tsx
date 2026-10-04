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
import { useLocale, useTranslations } from "next-intl";
import { formatLocale, type Locale } from "@/i18n/config";
import { fmtMoney } from "@/lib/utils";
import { usePrivacy } from "../privacy";
import { tooltipStyle, useVizTokens } from "./tokens";
import { ChartFrame } from "./chart-frame";

export interface DailyBarDatum {
  date: string;
  netPnl: number;
}

/**
 * Net daily P&L. Polarity is geometry first (bars grow from the zero baseline);
 * green/red only reinforces. Rounded corners sit at the data end.
 */
export function DailyBars({
  data,
  height = 240,
  currency = "USD",
}: {
  data: DailyBarDatum[];
  height?: number | `${number}%`;
  currency?: string;
}) {
  const t = useTranslations("charts");
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const viz = useVizTokens();
  const privateMode = usePrivacy();
  if (!viz) return <div style={{ height }} />;
  return (
    <ChartFrame height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          key={String(privateMode)}
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
          barCategoryGap="20%"
        >
          <CartesianGrid stroke={viz.gridline} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: viz.inkMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: viz.baseline }}
            minTickGap={48}
          />
          <YAxis
            tick={{ fill: viz.inkMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={70}
            tickFormatter={(value: number) =>
              privateMode ? "••••" : fmtMoney(value, currency, tag).replace(/\.00$/, "")
            }
          />
          <ReferenceLine y={0} stroke={viz.baseline} />
          <Tooltip
            contentStyle={tooltipStyle(viz)}
            formatter={(value) => [
              privateMode ? t("hidden") : fmtMoney(Number(value), currency, tag),
              t("seriesNetPnl"),
            ]}
            cursor={{ fill: viz.gridline, opacity: 0.4 }}
          />
          <Bar dataKey="netPnl" isAnimationActive={false} maxBarSize={28}>
            {data.map((entry) => (
              <Cell
                key={entry.date}
                fill={entry.netPnl >= 0 ? viz.profitFill : viz.loss}
                radius={(entry.netPnl >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4]) as unknown as number}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
