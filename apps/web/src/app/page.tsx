"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type {
  CalendarMonth,
  DayStats,
  EdgeScore,
  EquityPoint,
  TradeMetrics,
} from "@luxalgo/journal-core";
import { dayKeyOf, relativeDrawdownCurve } from "@luxalgo/journal-core";
import { CurrencyNotice } from "@/components/currency-notice";
import type { CurrencyScope } from "@/lib/currencies";
import { CalendarPnl } from "@/components/calendar-pnl";
import { DailyBars } from "@/components/charts/daily-bars";
import { EdgeRadar } from "@/components/charts/edge-radar";
import { EquityArea } from "@/components/charts/equity-area";
import { Gauge } from "@/components/charts/gauge";
import { RelativeDrawdownBars } from "@/components/charts/relative-drawdown-bars";
import { TimeHeatmap } from "@/components/charts/time-heatmap";
import {
  ArrowUpDown,
  CalendarCheck2,
  CircleDollarSign,
  Flame,
  Scale,
  Sigma,
  Target,
  Timer,
  TrendingDown,
  Trophy,
} from "lucide-react";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { AddTradeDialog } from "@/components/add-trade-dialog";
import { DashboardLayout } from "@/components/dashboard-layout";
import { MonetaryValue } from "@/components/privacy";
import { Pnl } from "@/components/pnl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HelpHint, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatApiError, type ApiErrorInfo } from "@/lib/api-error";
import { postJson, useApi } from "@/lib/use-api";
import type { CalendarPnlPoint } from "@/lib/calendar-insights";
import { formatLocale, type Locale } from "@/i18n/config";
import { cn, fmtDurationLocalized, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";

interface Bucket {
  key: string;
  trades: number;
  netPnl: number;
  winRate: number | null;
}

interface StatsPayload {
  timeZone: string;
  metrics: TradeMetrics | null;
  currencyScope: CurrencyScope;
  currencyGroups: { currency: string; metrics: TradeMetrics }[];
  initialBalance: number;
  edgeScore: EdgeScore | null;
  days: DayStats[];
  dailyCumulative: EquityPoint[];
  calendar: CalendarMonth;
  calendarCurrencies: string[];
  runningPnl: Record<string, CalendarPnlPoint[]>;
  buckets: Record<"symbol" | "weekday" | "hour" | "duration" | "direction", Bucket[]>;
  openPositions: {
    key: string;
    symbol: string;
    direction: string;
    openedAt: string;
    quantity: number;
    avgEntry: number;
    currency: string;
  }[];
  recentTrades: {
    key: string;
    symbol: string;
    closedAt: string;
    netPnl: number;
    currency: string;
    status: string;
  }[];
}

export default function DashboardPage() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const t = useTranslations("dashboard");
  const { query } = useFilters();
  const { data, loading, error, errorInfo, refresh } = useApi<StatsPayload>(`/api/stats?${query}`);

  return (
    <>
      <FilterBar title={t("title")} actions={<AddTradeDialog onSaved={refresh} />} />
      <DashboardContent
        data={data}
        loading={loading}
        error={error}
        errorInfo={errorInfo}
        refresh={refresh}
        query={query}
      />
    </>
  );
}

function DashboardContent({
  data,
  loading,
  error,
  errorInfo,
  refresh,
  query,
}: {
  data: StatsPayload | null;
  loading: boolean;
  error: string | null;
  errorInfo: ApiErrorInfo | null;
  refresh: () => void;
  query: string;
}) {
  const t = useTranslations("dashboard");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const tEnums = useTranslations("enums");
  const tControls = useTranslations("controls");
  const locale = useLocale();
  const fmtLocale = formatLocale(locale as Locale);

  if (loading && !data) return <DashboardSkeleton />;
  if (!data)
    return (
      <div>
        <div className="space-y-3 p-4">
          <p role="alert" className="text-sm text-destructive">
            {error ? formatApiError(tErrors, errorInfo ?? error) : t("loadFailed")}
          </p>
          <button
            type="button"
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
            onClick={refresh}
          >
            {t("tryAgain")}
          </button>
        </div>
      </div>
    );
  if (!data.currencyScope.monetary) {
    const closed = data.currencyGroups.reduce((sum, group) => sum + group.metrics.closedTrades, 0);
    const wins = data.currencyGroups.reduce((sum, group) => sum + group.metrics.wins, 0);
    return (
      <>
        <CurrencyNotice scope={data.currencyScope} />
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("allAccounts")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {t("closedWinRate", {
                count: closed,
                percent: closed ? fmtPercent(wins / closed, 1, fmtLocale) : "–",
              })}
            </CardContent>
          </Card>
          {data.currencyGroups.map((group) => (
            <Card key={group.currency}>
              <CardHeader>
                <CardTitle>{t("currencyAccounts", { currency: group.currency })}</CardTitle>
              </CardHeader>
              <CardContent>
                <Pnl
                  value={group.metrics.netPnl}
                  currency={group.currency}
                  locale={fmtLocale}
                  className="text-2xl font-semibold"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("closedWinRate", {
                    count: group.metrics.closedTrades,
                    percent: fmtPercent(group.metrics.winRate, 1, fmtLocale),
                  })}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </>
    );
  }
  const { metrics: m, edgeScore } = data;
  if (!m || !edgeScore) return null;
  const currency = data.currencyScope.currency ?? "USD";

  if (m.totalTrades === 0)
    return query ? (
      <div>
        <p className="p-12 text-center text-sm text-muted-foreground">{t("noFilterMatches")}</p>
      </div>
    ) : (
      <EmptyState />
    );

  // Momentum: net P&L of the last 7 calendar days vs the 7 before them.
  // Hidden when either window has no trading days (e.g. the 7D range).
  const weekDelta = (() => {
    const now = Date.now();
    let last = 0;
    let prior = 0;
    let lastDays = 0;
    let priorDays = 0;
    for (const day of data.days) {
      const ageDays = (now - Date.parse(`${day.date}T00:00:00Z`)) / 86_400_000;
      if (ageDays <= 7) {
        last += day.netPnl;
        lastDays++;
      } else if (ageDays <= 14) {
        prior += day.netPnl;
        priorDays++;
      }
    }
    return lastDays > 0 && priorDays > 0 ? last - prior : null;
  })();
  const bestDay = data.days.length
    ? data.days.reduce((a, b) => (b.netPnl > a.netPnl ? b : a))
    : null;
  const worstDay = data.days.length
    ? data.days.reduce((a, b) => (b.netPnl < a.netPnl ? b : a))
    : null;

  return (
    <>
      <CurrencyNotice scope={data.currencyScope} />
      <DashboardLayout
        widgets={[
          {
            id: "widget-0",
            label: t("netPnl.label"),
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={t("netPnl.label")}
                  hint={t("netPnl.hint")}
                  icon={CircleDollarSign}
                />
                <CardContent>
                  <Pnl
                    value={m.netPnl}
                    currency={currency}
                    locale={fmtLocale}
                    className="text-3xl font-semibold tracking-tight"
                  />
                  {weekDelta !== null && (
                    <div
                      className={cn(
                        "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        weekDelta >= 0 ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss",
                      )}
                    >
                      {weekDelta >= 0 ? "▲" : "▼"}{" "}
                      <MonetaryValue>
                        {fmtMoney(Math.abs(weekDelta), currency, fmtLocale).replace("+", "")}
                      </MonetaryValue>{" "}
                      {t("vsPrior7d")}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t.rich("closedFees", {
                      count: m.closedTrades,
                      feesText: fmtMoney(m.fees, currency, fmtLocale),
                      fees: (chunks) => <MonetaryValue>{chunks}</MonetaryValue>,
                    })}
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-1",
            label: t("tradeWin.label"),
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader title={t("tradeWin.label")} hint={t("tradeWin.hint")} icon={Target} />
                <CardContent className="flex items-center justify-between gap-2">
                  <Gauge value={m.winRate} label={t("tradeWin.gaugeLabel")} />
                  <div className="space-y-0.5 text-xs text-muted-foreground">
                    <div>{t("tradeWin.wins", { count: m.wins })}</div>
                    <div>{t("tradeWin.breakevens", { count: m.breakevens })}</div>
                    <div>{t("tradeWin.losses", { count: m.losses })}</div>
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-2",
            label: t("profitFactor.label"),
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={t("profitFactor.label")}
                  hint={t("profitFactor.hint")}
                  icon={Scale}
                />
                <CardContent>
                  <div className="text-3xl font-semibold tracking-tight tnum">
                    {m.profitFactorIsInfinite
                      ? "∞"
                      : m.profitFactor === null
                        ? "–"
                        : fmtNumber(m.profitFactor, 2, fmtLocale)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("profitFactor.formula")}
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-3",
            label: t("dayWin.label"),
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={t("dayWin.label")}
                  hint={t("dayWin.hint")}
                  icon={CalendarCheck2}
                />
                <CardContent className="flex items-center justify-between gap-2">
                  <Gauge value={m.dayWinRate} label={t("dayWin.gaugeLabel")} />
                  <div className="text-xs text-muted-foreground">
                    {t("dayWin.days", { count: m.tradingDays })}
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-4",
            label: t("avgWinLoss.label"),
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={t("avgWinLoss.label")}
                  hint={t("avgWinLoss.hint")}
                  icon={ArrowUpDown}
                />
                <CardContent>
                  <div className="text-3xl font-semibold tracking-tight tnum">
                    {m.avgWinLossRatio === null ? "–" : fmtNumber(m.avgWinLossRatio, 2, fmtLocale)}
                  </div>
                  {m.avgWin !== null && m.avgLoss !== null && m.avgWin + m.avgLoss > 0 && (
                    <div
                      className="journal-progress-visual mt-2 flex h-1.5 gap-0.5"
                      role="img"
                      aria-label={t("avgWinLoss.barLabel")}
                    >
                      <span
                        className="rounded-full bg-profit"
                        style={{
                          width: `${((m.avgWin / (m.avgWin + m.avgLoss)) * 100).toFixed(1)}%`,
                        }}
                      />
                      <span className="flex-1 rounded-full bg-loss" />
                    </div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t.rich("avgWinLoss.footnote", {
                      winText: m.avgWin === null ? "–" : fmtMoney(m.avgWin, currency, fmtLocale),
                      win: (chunks) => (
                        <span className="text-profit">
                          {m.avgWin === null ? chunks : <MonetaryValue>{chunks}</MonetaryValue>}
                        </span>
                      ),
                      lossText:
                        m.avgLoss === null ? "–" : fmtMoney(-m.avgLoss, currency, fmtLocale),
                      loss: (chunks) => (
                        <span className="text-loss">
                          {m.avgLoss === null ? chunks : <MonetaryValue>{chunks}</MonetaryValue>}
                        </span>
                      ),
                    })}
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-5",
            label: t("edgeScore.label"),
            size: "medium",
            layoutGroup: "visuals",
            content: (
              <Card className="dashboard-visual-card h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <div className="flex min-w-0 items-center gap-1">
                    <CardTitle>{t("edgeScore.label")}</CardTitle>
                    <HelpHint heading={t("edgeScore.label")}>{t("edgeScore.help")}</HelpHint>
                  </div>
                  <span className="text-2xl font-semibold tracking-tight tnum">
                    {edgeScore.score === null ? (
                      "–"
                    ) : (
                      <span className="text-brand">{edgeScore.score}</span>
                    )}
                    <span className="text-xs text-muted-foreground">{t("edgeScore.outOf")}</span>
                  </span>
                </CardHeader>
                <CardContent className="dashboard-visual-card-content">
                  {edgeScore.score === null ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {t.rich("edgeScore.empty", {
                        a: (chunks) => (
                          <a
                            className="underline"
                            href="https://github.com/LuxAlgo/trade-journal/blob/main/docs/edge-score.md"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {chunks}
                          </a>
                        ),
                      })}
                    </p>
                  ) : (
                    <EdgeRadar components={edgeScore.components} height="100%" />
                  )}
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-6",
            label: t("cumulative.label"),
            size: "medium",
            layoutGroup: "visuals",
            content: (
              <Card className="dashboard-visual-card h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>{t("cumulative.title")}</CardTitle>
                  <HelpHint heading={t("cumulative.label")}>{t("cumulative.help")}</HelpHint>
                </CardHeader>
                <CardContent>
                  <EquityArea
                    currency={currency}
                    data={data.dailyCumulative.map((p) => ({ t: p.t, cumNetPnl: p.cumNetPnl }))}
                  />
                  <RelativeDrawdownBars
                    data={relativeDrawdownCurve(data.dailyCumulative, data.initialBalance)}
                  />
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-7",
            label: t("dailyPnl.label"),
            size: "medium",
            layoutGroup: "visuals",
            content: (
              <Card className="dashboard-visual-card h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>{t("dailyPnl.title")}</CardTitle>
                  <HelpHint heading={t("dailyPnl.label")}>{t("dailyPnl.help")}</HelpHint>
                </CardHeader>
                <CardContent className="dashboard-visual-card-content">
                  <DailyBars
                    currency={currency}
                    data={data.days.map((d) => ({ date: d.date, netPnl: d.netPnl }))}
                    height="100%"
                  />
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-8",
            label: t("calendar.label"),
            size: "wide",
            layoutGroup: "detail",
            content: (
              <Card className="h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>
                    {new Date(Date.UTC(data.calendar.year, data.calendar.month - 1)).toLocaleString(
                      fmtLocale,
                      { month: "long", year: "numeric", timeZone: "UTC" },
                    )}
                  </CardTitle>
                  <Link
                    href={`/calendar?${query}`}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {t("calendar.fullCalendar")}
                  </Link>
                </CardHeader>
                <CardContent>
                  <CalendarPnl
                    calendar={data.calendar}
                    runningPnl={data.runningPnl}
                    currency={data.calendarCurrencies[0] ?? "USD"}
                    monetary={data.calendarCurrencies.length <= 1}
                  />
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-9",
            label: t("activity.label"),
            size: "medium",
            layoutGroup: "detail",
            content: (
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>{t("activity.label")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="recent">
                    <TabsList className="h-8">
                      <TabsTrigger value="recent" className="text-xs">
                        {t("activity.recent")}
                      </TabsTrigger>
                      <TabsTrigger value="open" className="text-xs">
                        {t("activity.open")}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="recent" className="space-y-1">
                      {data.recentTrades.length === 0 && <Empty label={t("activity.noClosed")} />}
                      {data.recentTrades.map((trade) => (
                        <Link
                          key={trade.key}
                          href={`/trades/${encodeURIComponent(trade.key)}?${query}`}
                          className="dashboard-activity-row flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent/60"
                        >
                          <span className="flex items-center gap-2">
                            <Badge
                              variant={
                                trade.status === "win"
                                  ? "profit"
                                  : trade.status === "loss"
                                    ? "loss"
                                    : "secondary"
                              }
                            >
                              {tEnums.has(`status.${trade.status}`)
                                ? tEnums(`status.${trade.status}`)
                                : trade.status.toUpperCase()}
                            </Badge>
                            {trade.symbol}
                          </span>
                          <span className="dashboard-activity-detail flex items-center">
                            <span className="text-xs text-muted-foreground">
                              {trade.closedAt && dayKeyOf(trade.closedAt, data.timeZone)}
                            </span>
                            <Pnl
                              value={trade.netPnl}
                              currency={trade.currency}
                              locale={fmtLocale}
                            />
                          </span>
                        </Link>
                      ))}
                    </TabsContent>
                    <TabsContent value="open" className="space-y-1">
                      {data.openPositions.length === 0 && <Empty label={t("activity.flat")} />}
                      {data.openPositions.map((position) => (
                        <div
                          key={position.key}
                          className="dashboard-activity-row flex items-center justify-between rounded-md px-2 py-1.5 text-sm"
                        >
                          <span className="flex items-center gap-2">
                            <Badge variant="secondary">
                              {tEnums.has(`direction.${position.direction}`)
                                ? tEnums(`direction.${position.direction}`)
                                : position.direction.toUpperCase()}
                            </Badge>
                            {position.symbol}
                          </span>
                          <span className="tnum text-xs text-muted-foreground">
                            {fmtNumber(position.quantity, 4, fmtLocale)} @{" "}
                            <MonetaryValue>
                              {fmtNumber(position.avgEntry, 2, fmtLocale)} {position.currency}
                            </MonetaryValue>
                          </span>
                        </div>
                      ))}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-10",
            label: t("maxDrawdown.label"),
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={t("maxDrawdown.label")}
                  hint={t("maxDrawdown.hint")}
                  icon={TrendingDown}
                />
                <CardContent>
                  <div className="text-xl font-semibold tnum text-loss">
                    <MonetaryValue>{fmtMoney(-m.maxDrawdown, currency, fmtLocale)}</MonetaryValue>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {m.maxDrawdownPct === null
                      ? t("maxDrawdown.needsBalance")
                      : m.recoveryFactor !== null
                        ? t("maxDrawdown.withRecovery", {
                            percent: fmtPercent(m.maxDrawdownPct, 1, fmtLocale),
                            value: fmtNumber(m.recoveryFactor, 2, fmtLocale),
                          })
                        : fmtPercent(m.maxDrawdownPct, 1, fmtLocale)}
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-11",
            label: t("streaks.label"),
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader title={t("streaks.label")} hint={t("streaks.hint")} icon={Flame} />
                <CardContent>
                  <div className="text-xl font-semibold tnum">
                    {m.currentStreak > 0
                      ? `${m.currentStreak}W`
                      : m.currentStreak < 0
                        ? `${-m.currentStreak}L`
                        : "–"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("streaks.bestWorst", { wins: m.maxWinStreak, losses: m.maxLossStreak })}
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-12",
            label: t("expectancy.label"),
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={t("expectancy.label")}
                  hint={t("expectancy.hint")}
                  icon={Sigma}
                />
                <CardContent>
                  {m.expectancy === null ? (
                    "–"
                  ) : (
                    <Pnl
                      value={m.expectancy}
                      currency={currency}
                      locale={fmtLocale}
                      className="text-xl font-semibold"
                    />
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {m.avgRealizedR !== null && m.tradesWithRisk > 0
                      ? t("expectancy.avgR", {
                          value: fmtNumber(m.avgRealizedR, 2, fmtLocale),
                          count: m.tradesWithRisk,
                        })
                      : t("expectancy.needsRisk")}
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-13",
            label: t("avgDuration.label"),
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={t("avgDuration.label")}
                  hint={t("avgDuration.hint")}
                  icon={Timer}
                />
                <CardContent>
                  <div className="text-xl font-semibold tnum">
                    {fmtDurationLocalized(m.avgDurationMs, tControls)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("avgDuration.reportsHint")}
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-14",
            label: t("bestWorstDay.label"),
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={t("bestWorstDay.label")}
                  hint={t("bestWorstDay.hint")}
                  icon={Trophy}
                />
                <CardContent className="space-y-1">
                  {bestDay && (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <Pnl
                        value={bestDay.netPnl}
                        currency={currency}
                        locale={fmtLocale}
                        className="text-base font-semibold"
                      />
                      <span className="text-xs text-muted-foreground">{bestDay.date.slice(5)}</span>
                    </div>
                  )}
                  {worstDay && (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <Pnl
                        value={worstDay.netPnl}
                        currency={currency}
                        locale={fmtLocale}
                        className="text-base font-semibold"
                      />
                      <span className="text-xs text-muted-foreground">
                        {worstDay.date.slice(5)}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-15",
            label: t("timePerformance.label"),
            size: "full",
            layoutGroup: "full",
            content: (
              <Card className="h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>{t("timePerformance.label")}</CardTitle>
                  <HelpHint heading={t("timePerformance.label")}>
                    {t("timePerformance.help")}
                  </HelpHint>
                </CardHeader>
                <CardContent>
                  <TimeHeatmap
                    currency={currency}
                    hours={data.buckets.hour.map((b) => ({
                      key: b.key,
                      netPnl: b.netPnl,
                      trades: b.trades,
                    }))}
                  />
                </CardContent>
              </Card>
            ),
          },
        ]}
      />
    </>
  );
}

/** Stat-tile header: quiet label left, metric icon with an explainer right. */
function StatHeader({
  title,
  hint,
  icon: Icon,
}: {
  title: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const t = useTranslations("dashboard");
  return (
    <CardHeader className="flex-row items-center justify-between space-y-0">
      <CardTitle>{title}</CardTitle>
      <Tooltip>
        <TooltipTrigger className="cursor-help" aria-label={t("about", { title })}>
          <Icon className="h-3.5 w-3.5 text-muted-foreground/70" />
        </TooltipTrigger>
        <TooltipContent>
          <div className="mb-1 font-semibold">{title}</div>
          <div className="text-muted-foreground">{hint}</div>
        </TooltipContent>
      </Tooltip>
    </CardHeader>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="px-2 py-6 text-center text-sm text-muted-foreground">{label}</p>;
}

function EmptyState() {
  const t = useTranslations("dashboard");
  const [loadingDemo, setLoadingDemo] = useState(false);
  const loadDemo = async () => {
    setLoadingDemo(true);
    try {
      await postJson("/api/demo", {});
      window.location.reload();
    } catch {
      setLoadingDemo(false);
    }
  };
  return (
    <div>
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-24 text-center">
        <h2 className="text-xl font-semibold">{t("empty.title")}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{t("empty.body")}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/import"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("empty.import")}
          </Link>
          <button
            onClick={loadDemo}
            disabled={loadingDemo}
            className="rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {loadingDemo ? t("empty.loadingDemo") : t("empty.loadDemo")}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t("empty.demoNote")}</p>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div>
      <div className="dashboard-grid-stage space-y-3 p-4">
        <div className="dashboard-grid grid gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} data-card-size="small" className="dashboard-grid-card h-28" />
          ))}
        </div>
        <div className="dashboard-grid grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} data-card-size="medium" className="dashboard-grid-card h-72" />
          ))}
        </div>
      </div>
    </div>
  );
}
