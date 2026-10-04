"use client";

import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";
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
import { formatLocale, type Locale } from "@/i18n/config";
import { fmtMoney, fmtPercent } from "@/lib/utils";
import { usePrivacy } from "../privacy";
import { tooltipStyle, useVizTokens } from "./tokens";
import { ChartFrame } from "./chart-frame";

export interface EquityPointDatum {
  t: string;
  cumNetPnl: number;
}

/** Cumulative P&L area — single series, crosshair tooltip, zero baseline. */
export function EquityArea({
  data,
  height = 240,
  valueFormat = "money",
  valueLabel,
  currency = "USD",
  curve = "monotone",
}: {
  data: EquityPointDatum[];
  height?: number;
  valueFormat?: "money" | "percent";
  valueLabel?: string;
  currency?: string;
  curve?: "monotone" | "stepAfter";
}) {
  const t = useTranslations("charts");
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const viz = useVizTokens();
  const id = useId().replace(/:/g, "");
  const privacy = usePrivacy();
  const privateMode = privacy && valueFormat === "money";
  const seriesLabel = valueLabel ?? t("equityValueLabel");
  const formatValue = (value: number) =>
    valueFormat === "percent" ? fmtPercent(value, 2, tag) : fmtMoney(value, currency, tag);
  if (!viz) return <div style={{ height }} />;
  const line = viz.brand;
  const top = Math.max(0, ...data.map((point) => point.cumNetPnl));
  const bottom = Math.min(0, ...data.map((point) => point.cumNetPnl));
  const zero = top === bottom ? 100 : (top / (top - bottom)) * 100;
  return (
    <ChartFrame height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          key={String(privateMode)}
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        >
          <defs>
            <linearGradient id={`${id}-line`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={`${zero}%`} stopColor={line} />
              <stop offset={`${zero}%`} stopColor={viz.loss} />
            </linearGradient>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={line} stopOpacity={0.3} />
              <stop offset={`${zero}%`} stopColor={line} stopOpacity={0.035} />
              <stop offset={`${zero}%`} stopColor={viz.loss} stopOpacity={0.035} />
              <stop offset="100%" stopColor={viz.loss} stopOpacity={0.3} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={viz.gridline} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="t"
            tick={{ fill: viz.inkMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: viz.baseline }}
            minTickGap={48}
            tickFormatter={(value: string) => value.slice(0, 10)}
          />
          <YAxis
            tick={{ fill: viz.inkMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={70}
            domain={[bottom, top === bottom ? 1 : top]}
            tickFormatter={(value: number) =>
              privateMode ? "••••" : formatValue(value).replace(".00", "")
            }
          />
          <ReferenceLine y={0} stroke={viz.baseline} />
          <Tooltip
            contentStyle={tooltipStyle(viz)}
            labelFormatter={(value) => String(value).slice(0, 10)}
            formatter={(value) => [
              privateMode ? t("hidden") : formatValue(Number(value)),
              seriesLabel,
            ]}
            cursor={{ stroke: viz.inkMuted, strokeDasharray: "3 3" }}
          />
          <Area
            type={curve}
            dataKey="cumNetPnl"
            stroke={bottom < 0 ? (top > 0 ? `url(#${id}-line)` : viz.loss) : line}
            strokeWidth={2}
            fill={`url(#${id}-fill)`}
            baseValue={0}
            dot={data.length === 1 ? { r: 3 } : false}
            activeDot={({ cx, cy, payload }) => (
              <circle
                cx={cx}
                cy={cy}
                r={4}
                fill={payload.cumNetPnl < 0 ? viz.loss : line}
                stroke={viz.card}
                strokeWidth={2}
              />
            )}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
