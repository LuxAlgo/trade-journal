"use client";

import { useMemo } from "react";
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
import { useLocale, useTranslations } from "next-intl";
import type { PerformanceTrends } from "@/lib/performance-trends";
import { formatLocale, type Locale } from "@/i18n/config";
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
  const t = useTranslations("charts");
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const tokens = useVizTokens();
  const privacy = usePrivacy();
  const rate = metric === "winRate";
  const format = (value: number) =>
    rate ? fmtPercent(value, 0, tag) : privacy ? "••••" : fmtMoney(value, currency, tag);
  const closeLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(tag, { timeZone, month: "short", day: "numeric", year: "numeric" }),
    [tag, timeZone],
  );
  if (!tokens) return <div className="h-60" />;
  return (
    <ChartFrame height={240}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 12, right: 14, bottom: 4, left: 0 }}
          aria-label={rate ? t("rollingAriaWinRate") : t("rollingAriaAvgPnl")}
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
              return `${t("rollingTradeNumber", { number: Number(label) })}${point ? ` · ${closeLabel.format(new Date(point.closedAt))}` : ""}`;
            }}
            formatter={(value) => [format(Number(value)), t("rollingSeries")]}
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
