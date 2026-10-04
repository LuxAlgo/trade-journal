"use client";

import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  clockLabel,
  type PlottedTrade,
  type TradeXAxis,
  type TradeYAxis,
} from "@/lib/trade-explorer";
import { formatLocale, type Locale } from "@/i18n/config";
import { fmtMoney } from "@/lib/utils";
import { usePrivacy } from "../privacy";
import { ChartFrame } from "./chart-frame";
import { tooltipStyle, useVizTokens } from "./tokens";

export function TradeScatter({
  points,
  x,
  y,
  currency,
  timeZone,
  onSelect,
}: {
  points: PlottedTrade[];
  x: TradeXAxis;
  y: TradeYAxis;
  currency: string;
  timeZone: string;
  onSelect: (point: PlottedTrade) => void;
}) {
  const t = useTranslations("charts");
  const te = useTranslations("enums");
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const tokens = useVizTokens();
  const privateMode = usePrivacy();
  const groups = useMemo(
    () => [
      points.filter((p) => (p.netPnl ?? 0) > 0),
      points.filter((p) => (p.netPnl ?? 0) < 0),
      points.filter((p) => (p.netPnl ?? 0) === 0),
    ],
    [points],
  );
  const date = useMemo(
    () => new Intl.DateTimeFormat(tag, { timeZone, dateStyle: "medium", timeStyle: "short" }),
    [tag, timeZone],
  );
  const compactNumber = useMemo(
    () => new Intl.NumberFormat(tag, { maximumFractionDigits: 1, notation: "compact" }),
    [tag],
  );
  const number2 = useMemo(() => new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }), [tag]);
  const yLabel = (n: number) =>
    y === "realizedR" ? `${n.toFixed(2)}R` : privateMode ? "••••" : fmtMoney(n, currency, tag);
  const xLabel = (n: number) =>
    x === "entryMinute"
      ? clockLabel(n)
      : x === "mae" || x === "mfe"
        ? privateMode
          ? "••••"
          : fmtMoney(n, currency, tag)
        : compactNumber.format(n);
  if (!tokens) return <div className="h-80" />;
  const yAxisName = (axis: "netPnl" | "realizedR" | "mae" | "mfe") =>
    axis === "netPnl"
      ? t("yNetPnl")
      : axis === "realizedR"
        ? t("yRealizedR")
        : t("yEstimated", { axis: axis.toUpperCase() });
  return (
    <ChartFrame height={340}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart
          margin={{ top: 12, right: 24, bottom: 8, left: 0 }}
          aria-label={t("scatterAria")}
        >
          <CartesianGrid stroke={tokens.gridline} />
          <XAxis
            type="number"
            dataKey="x"
            domain={x === "entryMinute" ? [0, 1440] : [0, "auto"]}
            ticks={x === "entryMinute" ? [0, 360, 720, 1080, 1440] : undefined}
            minTickGap={24}
            tickFormatter={xLabel}
            tick={{ fill: tokens.inkMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: tokens.baseline }}
          />
          <YAxis
            type="number"
            dataKey="y"
            width={82}
            domain={[(min: number) => Math.min(min, 0), (max: number) => Math.max(max, 0)]}
            tickFormatter={yLabel}
            tick={{ fill: tokens.inkMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <ZAxis range={[44, 44]} />
          <ReferenceLine y={0} stroke={tokens.inkMuted} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3", stroke: tokens.inkMuted }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as PlottedTrade | undefined;
              return active && point ? (
                <div style={{ ...tooltipStyle(tokens), maxWidth: 230, overflowWrap: "anywhere" }}>
                  <p className="font-medium">
                    {point.symbol} ·{" "}
                    {te.has(`direction.${point.direction}`)
                      ? te(`direction.${point.direction}`)
                      : point.direction}
                  </p>
                  <p className="text-xs">
                    {t("closedAt", { time: date.format(new Date(point.closedAt)) })}
                  </p>
                  <p>
                    {x === "durationMinutes"
                      ? t("minutesFull", { value: number2.format(point.x) })
                      : x === "entryMinute"
                        ? t("entryAt", { time: clockLabel(point.x) })
                        : t("estimatedAxis", {
                            axis: x.toUpperCase(),
                            value: xLabel(point.x),
                          })}
                  </p>
                  <p>
                    {yAxisName(y)}: {yLabel(point.y)}
                  </p>
                  <p className="text-xs text-muted-foreground">{t("scatterInspectHint")}</p>
                </div>
              ) : null;
            }}
          />
          {groups.map((data, index) => (
            <Scatter
              key={index}
              data={data}
              name={[t("legendPositive"), t("legendNegative"), t("legendZero")][index]}
              shape="circle"
              fill={[tokens.profitFill, tokens.loss, tokens.inkMuted][index]}
              fillOpacity={0.7}
              stroke={[tokens.profit, tokens.loss, tokens.inkMuted][index]}
              strokeWidth={1}
              isAnimationActive={false}
              onClick={(value: { payload?: PlottedTrade }) => {
                if (value.payload) onSelect(value.payload);
              }}
              cursor="pointer"
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
