"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { Card, CardContent } from "./ui/card";
import { useVizTokens, tooltipStyle } from "./charts/tokens";
import { formatLocale, type Locale } from "@/i18n/config";
import { fmtPercent } from "@/lib/utils";
import { cashSummary, currencyDigits, propMoney } from "@/lib/prop-firms";

type Summary = ReturnType<typeof cashSummary>;
export function PropCashSummary({
  summary,
  currency,
  privacy,
}: {
  summary: Summary;
  currency: string;
  privacy: boolean;
}) {
  const t = useTranslations("prop-firms");
  const locale = useLocale() as Locale;
  const money = (value: number) =>
    privacy ? "••••" : currency ? propMoney(value, currency, formatLocale(locale)) : "—";
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card>
        <CardContent className="p-5 sm:p-6">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="h-2 w-2 rounded-full bg-[var(--loss)]" />
            {t("cash.spent")}
          </p>
          <p className="mt-3 break-words text-3xl font-semibold tracking-tight tabular-nums">
            {money(summary.spent)}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">{t("cash.spentNote")}</p>
          <div className="mt-4 flex flex-wrap justify-between gap-2 border-t pt-3 text-xs">
            <span className="text-muted-foreground">
              {t("cash.refunded")} <span className="text-foreground">{money(summary.refunds)}</span>
            </span>
            <span className="text-muted-foreground">
              {t("cash.netCost")} <span className="text-foreground">{money(summary.netSpend)}</span>
            </span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5 sm:p-6">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="h-2 w-2 rounded-full bg-[var(--brand)]" />
            {t("cash.payoutsReceived")}
          </p>
          <p className="mt-3 break-words text-3xl font-semibold tracking-tight tabular-nums">
            {money(summary.received)}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">{t("cash.receivedNote")}</p>
          <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            {t("cash.pendingNote")}
          </p>
        </CardContent>
      </Card>
      <Card className="bg-muted/30">
        <CardContent className="p-5 sm:p-6">
          <p className="text-sm font-medium">{t("cash.netAfterCosts")}</p>
          <p
            className="mt-3 break-words text-3xl font-semibold tracking-tight tabular-nums"
            style={{
              color:
                privacy || !currency
                  ? undefined
                  : summary.net < 0
                    ? "var(--loss)"
                    : summary.net > 0
                      ? "var(--profit)"
                      : undefined,
            }}
          >
            {money(summary.net)}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">{t("cash.netFormula")}</p>
          <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            {t("cash.roi")}{" "}
            <span className="text-foreground">
              {privacy
                ? "••••"
                : !currency || summary.roi === null
                  ? "—"
                  : fmtPercent(summary.roi, 1, formatLocale(locale))}
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
export function PropCashComparison({
  months,
  currency,
  privacy,
}: {
  months: (Summary & { month: string })[];
  currency: string;
  privacy: boolean;
}) {
  const t = useTranslations("prop-firms");
  const locale = useLocale() as Locale;
  const tag = formatLocale(locale);
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(tag, { month: "short", year: "2-digit", timeZone: "UTC" }),
    [tag],
  );
  const compact = useMemo(
    () => new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 }),
    [tag],
  );
  const viz = useVizTokens();
  const divisor = currency ? 10 ** currencyDigits(currency) : 1;
  const rows = [...months]
    .reverse()
    .map((row) => ({ ...row, spent: row.spent / divisor, received: row.received / divisor }));
  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{t("cash.comparisonTitle")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("cash.monthlyFlow")}
              {currency ? ` · ${currency}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--loss)]" />
              {t("cash.spent")}
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--brand)]" />
              {t("cash.payoutsReceived")}
            </span>
          </div>
        </div>
        {privacy || !currency || !rows.length ? (
          <p className="flex min-h-48 items-center justify-center text-center text-sm text-muted-foreground">
            {privacy
              ? t("breakdown.chartHidden")
              : !currency
                ? t("cash.chooseCurrencyCompare")
                : t("cash.startComparison")}
          </p>
        ) : (
          <div className="h-64 min-w-0 sm:h-72" key={locale}>
            {viz && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  accessibilityLayer
                  data={rows}
                  margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
                  barGap={2}
                >
                  <CartesianGrid vertical={false} stroke={viz.gridline} />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                    tick={{ fill: viz.inkMuted, fontSize: 11 }}
                    tickFormatter={(v) => monthLabel.format(new Date(`${v}-01T12:00:00Z`))}
                  />
                  <YAxis
                    width={65}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: viz.inkMuted, fontSize: 11 }}
                    tickFormatter={(v) => compact.format(v)}
                  />
                  <ReferenceLine y={0} stroke={viz.baseline} />
                  <Tooltip
                    cursor={{ fill: viz.gridline, opacity: 0.35 }}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div style={tooltipStyle(viz)}>
                          <p className="mb-1 font-medium">{String(label)}</p>
                          {payload.map((item) => (
                            <p key={String(item.dataKey)}>
                              {item.name}:{" "}
                              {propMoney(
                                Math.round(Number(item.value) * divisor),
                                currency,
                                formatLocale(locale),
                              )}
                            </p>
                          ))}
                          <p>
                            {t("cash.refundsLine", {
                              amount: propMoney(
                                payload[0]!.payload.refunds,
                                currency,
                                formatLocale(locale),
                              ),
                            })}
                          </p>
                          <p className="mt-1 border-t pt-1">
                            {t("cash.netLine", {
                              amount: propMoney(
                                payload[0]!.payload.net,
                                currency,
                                formatLocale(locale),
                              ),
                            })}
                          </p>
                        </div>
                      ) : null
                    }
                  />
                  <Bar
                    name={t("cash.spent")}
                    dataKey="spent"
                    fill={viz.loss}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={24}
                    isAnimationActive={false}
                  />
                  <Bar
                    name={t("cash.payoutsReceived")}
                    dataKey="received"
                    fill={viz.brand}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={24}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">{t("cash.comparisonNote")}</p>
      </CardContent>
    </Card>
  );
}
