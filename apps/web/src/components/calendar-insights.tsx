"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import type { DayStats } from "@luxalgo/journal-core";
import { calendarTradeHref, type CalendarResponse } from "@/lib/calendar-insights";
import { formatLocale, type Locale } from "@/i18n/config";
import { cn, fmtMoney, fmtPercent } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { HelpHint, HoverHint } from "./ui/tooltip";
import { Pnl } from "./pnl";
import { usePrivacy } from "./privacy";
// Keep the calendar and summaries usable before the plotting bundle loads.
const CalendarDailyChart = dynamic(
  () => import("./charts/calendar-daily-chart").then((module) => module.CalendarDailyChart),
  {
    loading: () => <ChartLoading />,
  },
);

function ChartLoading() {
  const t = useTranslations("calendar");
  return (
    <div role="status" aria-label={t("loadingChart")} className="h-60 rounded-lg bg-muted/20" />
  );
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const localeDateLabel = (locale: string, date: string) => {
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    dateFormatters.set(locale, formatter);
  }
  return formatter.format(new Date(`${date}T12:00:00Z`));
};

function Metric({
  title,
  value,
  detail,
  hint,
}: {
  title: string;
  value: ReactNode;
  detail: ReactNode;
  hint: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{title}</CardTitle>
        <HelpHint heading={title}>{hint}</HelpHint>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}

export function CalendarPerformance({ data, query }: { data: CalendarResponse; query: string }) {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const { insights: i, scope, timeZone, currencies } = data;
  const currency = currencies[0] ?? "USD";
  const mixed = currencies.length > 1;
  const privateMode = usePrivacy();
  const router = useRouter();
  const [weekday, setWeekday] = useState<number | null>(null);
  const href = (date?: string) => calendarTradeHref(query, scope, date);
  const dateLabel = (date: string) => localeDateLabel(tag, date);
  const money = (value: number | null) =>
    value === null || mixed ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <Pnl value={value} currency={currency} locale={tag} />
    );
  const selected = weekday === null ? null : i.weekdays[weekday]!;
  const peak = Math.max(1, ...i.weekdays.map((day) => Math.abs(day.netPnl)));
  const dayLink = (day: DayStats | null) =>
    day && !mixed ? (
      <Link
        href={href(day.date)}
        className="inline-flex max-w-full items-center gap-2 rounded text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {money(day.netPnl)}
        <span className="text-xs font-normal text-muted-foreground">{dateLabel(day.date)}</span>
        <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
      </Link>
    ) : (
      money(null)
    );
  return (
    <section
      aria-labelledby="calendar-insights-heading"
      className="space-y-3"
      data-calendar-insights
    >
      <div className="flex flex-wrap items-end justify-between gap-2 pt-3">
        <div>
          <h2 id="calendar-insights-heading" className="text-base font-semibold tracking-tight">
            {t("insightsHeading")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("insightsScope", { timeZone })}</p>
        </div>
        {i.trades > 0 && (
          <Link
            href={href()}
            className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("viewMatchingTrades")} <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </Link>
        )}
      </div>
      {!i.tradingDays ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <CalendarDays aria-hidden="true" className="mb-1 size-6 text-muted-foreground" />
            <h3 className="text-sm font-medium">{t("emptyTitle")}</h3>
            <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {mixed && (
            <p
              role="status"
              className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
            >
              {t("mixedCurrencies", { currencies: currencies.join(", ") })}
            </p>
          )}
          <div className="grid gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
            <Metric
              title={t("netPnl")}
              value={money(i.netPnl)}
              detail={
                mixed
                  ? t("tradingDaysOnly", { days: i.tradingDays })
                  : t("netPnlDetail", { days: i.tradingDays, currency })
              }
              hint={t("netPnlHint")}
            />
            <Metric
              title={t("avgDailyPnl")}
              value={money(i.avgDailyPnl)}
              detail={t("avgDailyDetail")}
              hint={t("avgDailyHint")}
            />
            <Metric
              title={t("tradeWinRate")}
              value={fmtPercent(i.winRate, 1, tag)}
              detail={t("winRateDetail", {
                wins: i.wins,
                losses: i.losses,
                breakevens: i.breakevens,
              })}
              hint={t("winRateHint")}
            />
            <Metric
              title={t("totalClosedTrades")}
              value={
                <Link
                  className="rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  href={href()}
                >
                  {i.trades}
                </Link>
              }
              detail={t("totalTradesDetail")}
              hint={t("totalTradesHint")}
            />
          </div>
          {!mixed && (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle>{t("bestWorstTitle")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-xs text-muted-foreground">{t("bestDay")}</span>
                      {dayLink(i.bestDay)}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-xs text-muted-foreground">{t("worstDay")}</span>
                      {dayLink(i.worstDay)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("extremaNote", { days: i.tradingDays })}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t("greenRedTitle")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">
                        {t("profitableDays", { days: i.greenDays })}
                      </span>
                      {money(i.avgGreenDay)}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">
                        {t("losingDays", { days: i.redDays })}
                      </span>
                      {money(i.avgRedDay)}
                    </div>
                    <p className="text-xs text-muted-foreground">{t("avgGroupNote")}</p>
                  </CardContent>
                </Card>
                <Metric
                  title={t("consistencyTitle")}
                  value={fmtPercent(i.profitableDayRate, 1, tag)}
                  detail={t("consistencyDetail", {
                    green: i.greenDays,
                    red: i.redDays,
                    flat: i.flatDays,
                  })}
                  hint={t("consistencyHint")}
                />
              </div>
              <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
                <Card>
                  <CardHeader>
                    <h3 className="text-sm font-medium">{t("dailyPerfTitle")}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t("dailyPerfNote", {
                        currency,
                        withAverage: i.tradingDays >= 8 ? "yes" : "no",
                      })}
                    </p>
                  </CardHeader>
                  <CardContent>
                    {i.tradingDays >= 2 ? (
                      <CalendarDailyChart
                        data={i.trend}
                        currency={currency}
                        onInspect={(date) => router.push(href(date))}
                      />
                    ) : (
                      <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg bg-muted/30 p-5 text-center">
                        <span className="text-sm font-medium">{t("trendNeedsMore")}</span>
                        <span className="text-xs text-muted-foreground">
                          {dateLabel(i.days[0]!.date)} · {money(i.netPnl)} ·{" "}
                          {t("singleDayTrades", { count: i.trades })}
                        </span>
                        <span className="text-xs text-muted-foreground">{t("exploreEarlier")}</span>
                      </div>
                    )}
                    <details className="mt-3 border-t pt-3">
                      <summary className="cursor-pointer rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                        {t("dailyValuesSummary", { count: i.tradingDays })}
                      </summary>
                      <div className="mt-2 max-h-60 overflow-auto">
                        <table className="w-full text-left text-xs">
                          <caption className="sr-only">{t("dailyTableCaption")}</caption>
                          <thead className="sticky top-0 bg-card text-muted-foreground">
                            <tr>
                              <th scope="col" className="py-2 font-medium">
                                {t("colClosingDay")}
                              </th>
                              <th scope="col" className="text-right font-medium">
                                {t("colTrades")}
                              </th>
                              <th scope="col" className="text-right font-medium">
                                {t("colNetPnl")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {i.days.map((day) => (
                              <tr key={day.date} className="border-t">
                                <th scope="row" className="py-2 font-normal">
                                  <Link
                                    href={href(day.date)}
                                    className="rounded underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  >
                                    {dateLabel(day.date)}
                                  </Link>
                                </th>
                                <td className="text-right tabular-nums">{day.trades}</td>
                                <td className="text-right">{money(day.netPnl)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <h3 className="text-sm font-medium">{t("weekdayTitle")}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t("weekdayNote", { currency })}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 rounded-lg bg-muted/40 px-3 py-2">
                      <div className="text-[11px] text-muted-foreground">
                        {t("mostProfitableWeekday")}
                      </div>
                      <div className="mt-0.5 flex flex-wrap justify-between gap-1 text-sm font-medium">
                        {i.mostProfitableWeekday ? (
                          <>
                            <span>{i.mostProfitableWeekday.label}</span>
                            {money(i.mostProfitableWeekday.netPnl)}
                          </>
                        ) : (
                          <span className="text-muted-foreground">{t("noProfitableWeekday")}</span>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      {i.weekdays.map((day) => (
                        <HoverHint
                          key={day.index}
                          heading={day.label}
                          content={t("weekdayTooltip", {
                            days: day.days.length,
                            count: day.trades,
                            pnl: privateMode ? t("pnlHidden") : fmtMoney(day.netPnl, currency, tag),
                          })}
                        >
                          <button
                            type="button"
                            disabled={!day.trades}
                            onClick={() => setWeekday(weekday === day.index ? null : day.index)}
                            aria-pressed={weekday === day.index}
                            aria-label={t("weekdayAria", {
                              label: day.label,
                              count: day.trades,
                              pnl: privateMode
                                ? ""
                                : t("weekdayPnl", { money: fmtMoney(day.netPnl, currency, tag) }),
                            })}
                            className={cn(
                              "grid w-full grid-cols-[2rem_minmax(0,1fr)_5.75rem] items-center gap-2 rounded-md px-2 py-2 text-left text-xs outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-transparent",
                              weekday === day.index && "bg-accent",
                            )}
                          >
                            <span>{day.label.slice(0, 3)}</span>
                            <span aria-hidden="true" className="relative h-4">
                              <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                              <span
                                className={cn(
                                  "absolute top-1 h-2 rounded-sm",
                                  day.netPnl > 0
                                    ? "bg-profit"
                                    : day.netPnl < 0
                                      ? "bg-loss"
                                      : "bg-muted-foreground",
                                )}
                                style={{
                                  left:
                                    day.netPnl < 0
                                      ? `${50 - (Math.abs(day.netPnl) / peak) * 50}%`
                                      : "50%",
                                  width:
                                    day.netPnl === 0
                                      ? "2px"
                                      : `${(Math.abs(day.netPnl) / peak) * 50}%`,
                                }}
                              />
                            </span>
                            <span className="text-right">
                              {day.trades ? money(day.netPnl) : "—"}
                            </span>
                          </button>
                        </HoverHint>
                      ))}
                    </div>
                    {selected && (
                      <div className="mt-3 border-t pt-3" aria-live="polite">
                        <p className="mb-2 text-xs font-medium">
                          {t("weekdaySelected", {
                            label: selected.label,
                            trades: selected.trades,
                            days: selected.days.length,
                          })}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {selected.days.map((day) => (
                            <Link
                              key={day.date}
                              href={href(day.date)}
                              className="rounded-md border px-2 py-1.5 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {dateLabel(day.date)}{" "}
                              <span className="text-muted-foreground">
                                {t("dayChipTrades", { count: day.trades })}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
              {i.tradingDays < 5 && (
                <p className="px-1 text-xs text-muted-foreground">
                  {t("smallSample", { days: i.tradingDays })}
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
