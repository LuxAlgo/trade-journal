"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
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
import { postJson, useApi } from "@/lib/use-api";
import type { CalendarPnlPoint } from "@/lib/calendar-insights";
import { cn, fmtDuration, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";
import { fill } from "@/lib/messages";
import { useI18n } from "@/components/locale";
import { localeTag } from "@/lib/locale";

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
  const { text } = useI18n();
  const { query } = useFilters();
  const { data, loading, error, refresh } = useApi<StatsPayload>(`/api/stats?${query}`);

  return (
    <>
      <FilterBar title={text.pages.dashboard} actions={<AddTradeDialog onSaved={refresh} />} />
      <DashboardContent
        data={data}
        loading={loading}
        error={error}
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
  refresh,
  query,
}: {
  data: StatsPayload | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  query: string;
}) {
  const { text, locale } = useI18n();
  if (loading && !data) return <DashboardSkeleton />;
  if (!data)
    return (
      <div>
        <div className="space-y-3 p-4">
          <p role="alert" className="text-sm text-destructive">
            {error ?? "Could not load the dashboard."}
          </p>
          <button
            type="button"
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
            onClick={refresh}
          >
            {text.pages.tryAgain}
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
              <CardTitle>{text.dashboard.allAccounts}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {closed} closed trades · {closed ? fmtPercent(wins / closed) : "–"} trade win rate
            </CardContent>
          </Card>
          {data.currencyGroups.map((group) => (
            <Card key={group.currency}>
              <CardHeader>
                <CardTitle>
                  {fill(text.dashboard.currencyAccounts, { currency: group.currency })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Pnl
                  value={group.metrics.netPnl}
                  currency={group.currency}
                  className="text-2xl font-semibold"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {fill(text.dashboard.closedTrades, {
                    count: group.metrics.closedTrades,
                    win: fmtPercent(group.metrics.winRate),
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
        <p className="p-12 text-center text-sm text-muted-foreground">
          No trades match these filters. Clear or adjust Filters to see more results.
        </p>
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
            label: text.dashboard.net,
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={text.dashboard.net}
                  icon={CircleDollarSign}
                  hint={text.dashboard.netHint}
                />
                <CardContent>
                  <Pnl
                    value={m.netPnl}
                    currency={currency}
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
                        {fmtMoney(Math.abs(weekDelta), currency).replace("+", "")}
                      </MonetaryValue>{" "}
                      vs prior 7d
                    </div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {m.closedTrades} closed trades ·{" "}
                    <MonetaryValue>{fmtMoney(m.fees, currency)}</MonetaryValue> fees
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-1",
            label: text.dashboard.win,
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={text.dashboard.win}
                  icon={Target}
                  hint={text.dashboard.winHint}
                />
                <CardContent className="flex items-center justify-between gap-2">
                  <Gauge value={m.winRate} label="Trade win rate" />
                  <div className="space-y-0.5 text-xs text-muted-foreground">
                    <div>{m.wins} W</div>
                    <div>{m.breakevens} BE</div>
                    <div>{m.losses} L</div>
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-2",
            label: text.dashboard.factor,
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={text.dashboard.factor}
                  icon={Scale}
                  hint={text.dashboard.factorHint}
                />
                <CardContent>
                  <div className="text-3xl font-semibold tracking-tight tnum">
                    {m.profitFactorIsInfinite
                      ? "∞"
                      : m.profitFactor === null
                        ? "–"
                        : fmtNumber(m.profitFactor)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    gross profit ÷ gross loss
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-3",
            label: text.dashboard.dayWin,
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={text.dashboard.dayWin}
                  icon={CalendarCheck2}
                  hint={text.dashboard.dayWinHint}
                />
                <CardContent className="flex items-center justify-between gap-2">
                  <Gauge value={m.dayWinRate} label="Day win rate" />
                  <div className="text-xs text-muted-foreground">{m.tradingDays} days</div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-4",
            label: text.dashboard.avg,
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={text.dashboard.avg}
                  icon={ArrowUpDown}
                  hint={text.dashboard.avgHint}
                />
                <CardContent>
                  <div className="text-3xl font-semibold tracking-tight tnum">
                    {m.avgWinLossRatio === null ? "–" : fmtNumber(m.avgWinLossRatio)}
                  </div>
                  {m.avgWin !== null && m.avgLoss !== null && m.avgWin + m.avgLoss > 0 && (
                    <div
                      className="journal-progress-visual mt-2 flex h-1.5 gap-0.5"
                      role="img"
                      aria-label="Average win vs average loss, to scale"
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
                    <span className="text-profit">
                      {m.avgWin === null ? (
                        "–"
                      ) : (
                        <MonetaryValue>{fmtMoney(m.avgWin, currency)}</MonetaryValue>
                      )}
                    </span>
                    {" avg win · "}
                    <span className="text-loss">
                      {m.avgLoss === null ? (
                        "–"
                      ) : (
                        <MonetaryValue>{fmtMoney(-m.avgLoss, currency)}</MonetaryValue>
                      )}
                    </span>
                    {" avg loss"}
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-5",
            label: text.dashboard.edge,
            size: "medium",
            layoutGroup: "visuals",
            content: (
              <Card className="dashboard-visual-card h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <div className="flex min-w-0 items-center gap-1">
                    <CardTitle>{text.dashboard.edge}</CardTitle>
                    <HelpHint heading="Edge Score">
                      A 0–100 score combining win rate, profit factor, average win/loss, drawdown,
                      recovery, and consistency. Requires at least five closed trades.
                    </HelpHint>
                  </div>
                  <span className="text-2xl font-semibold tracking-tight tnum">
                    {edgeScore.score === null ? (
                      "–"
                    ) : (
                      <span className="text-brand">{edgeScore.score}</span>
                    )}
                    <span className="text-xs text-muted-foreground"> /100</span>
                  </span>
                </CardHeader>
                <CardContent className="dashboard-visual-card-content">
                  {edgeScore.score === null ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Needs 5+ closed trades. The formula is open —{" "}
                      <a
                        className="underline"
                        href="https://github.com/LuxAlgo/trade-journal/blob/main/docs/edge-score.md"
                        target="_blank"
                        rel="noreferrer"
                      >
                        read it
                      </a>
                      .
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
            label: text.dashboard.cumulative,
            size: "medium",
            layoutGroup: "visuals",
            content: (
              <Card className="dashboard-visual-card h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>{text.dashboard.cumulative}</CardTitle>
                  <HelpHint heading="Cumulative P&L">
                    Running total of net profit and loss over the selected period. The drawdown bars
                    below show declines from the running equity peak.
                  </HelpHint>
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
            label: text.dashboard.daily,
            size: "medium",
            layoutGroup: "visuals",
            content: (
              <Card className="dashboard-visual-card h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>{text.dashboard.daily}</CardTitle>
                  <HelpHint heading="Daily P&L">
                    Net profit or loss for each trading day. Bars above zero are profitable; bars
                    below zero are losses.
                  </HelpHint>
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
            label: text.pages.calendar,
            size: "wide",
            layoutGroup: "detail",
            content: (
              <Card className="h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>
                    {new Date(Date.UTC(data.calendar.year, data.calendar.month - 1)).toLocaleString(
                      localeTag(locale),
                      { month: "long", year: "numeric", timeZone: "UTC" },
                    )}
                  </CardTitle>
                  <Link
                    href={`/calendar?${query}`}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {text.dashboard.fullCalendar}
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
            label: text.dashboard.activity,
            size: "medium",
            layoutGroup: "detail",
            content: (
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>{text.dashboard.activity}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="recent">
                    <TabsList className="h-8">
                      <TabsTrigger value="recent" className="text-xs">
                        Recent trades
                      </TabsTrigger>
                      <TabsTrigger value="open" className="text-xs">
                        Open positions
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="recent" className="space-y-1">
                      {data.recentTrades.length === 0 && <Empty label="No closed trades yet" />}
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
                              {trade.status.toUpperCase()}
                            </Badge>
                            {trade.symbol}
                          </span>
                          <span className="dashboard-activity-detail flex items-center">
                            <span className="text-xs text-muted-foreground">
                              {trade.closedAt && dayKeyOf(trade.closedAt, data.timeZone)}
                            </span>
                            <Pnl value={trade.netPnl} currency={trade.currency} />
                          </span>
                        </Link>
                      ))}
                    </TabsContent>
                    <TabsContent value="open" className="space-y-1">
                      {data.openPositions.length === 0 && (
                        <Empty label="Flat — no open positions" />
                      )}
                      {data.openPositions.map((position) => (
                        <div
                          key={position.key}
                          className="dashboard-activity-row flex items-center justify-between rounded-md px-2 py-1.5 text-sm"
                        >
                          <span className="flex items-center gap-2">
                            <Badge variant="secondary">{position.direction.toUpperCase()}</Badge>
                            {position.symbol}
                          </span>
                          <span className="tnum text-xs text-muted-foreground">
                            {fmtNumber(position.quantity, 4)} @{" "}
                            <MonetaryValue>
                              {fmtNumber(position.avgEntry)} {position.currency}
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
            label: text.dashboard.drawdown,
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={text.dashboard.drawdown}
                  icon={TrendingDown}
                  hint={text.dashboard.drawdownHint}
                />
                <CardContent>
                  <div className="text-xl font-semibold tnum text-loss">
                    <MonetaryValue>{fmtMoney(-m.maxDrawdown, currency)}</MonetaryValue>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {m.maxDrawdownPct === null
                      ? "set an initial balance for %"
                      : fmtPercent(m.maxDrawdownPct)}
                    {m.recoveryFactor !== null && ` · recovery ${fmtNumber(m.recoveryFactor)}x`}
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-11",
            label: text.dashboard.streaks,
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={text.dashboard.streaks}
                  icon={Flame}
                  hint={text.dashboard.streaksHint}
                />
                <CardContent>
                  <div className="text-xl font-semibold tnum">
                    {m.currentStreak > 0
                      ? `${m.currentStreak}W`
                      : m.currentStreak < 0
                        ? `${-m.currentStreak}L`
                        : "–"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    best {m.maxWinStreak}W · worst {m.maxLossStreak}L
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-12",
            label: text.dashboard.expectancy,
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={text.dashboard.expectancy}
                  icon={Sigma}
                  hint={text.dashboard.expectancyHint}
                />
                <CardContent>
                  {m.expectancy === null ? (
                    "–"
                  ) : (
                    <Pnl
                      value={m.expectancy}
                      currency={currency}
                      className="text-xl font-semibold"
                    />
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {m.avgRealizedR !== null && m.tradesWithRisk > 0
                      ? `avg ${fmtNumber(m.avgRealizedR)}R over ${m.tradesWithRisk} risk-tagged trades`
                      : "tag stop-losses to unlock R multiples"}
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-13",
            label: text.dashboard.duration,
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={text.dashboard.duration}
                  icon={Timer}
                  hint={text.dashboard.durationHint}
                />
                <CardContent>
                  <div className="text-xl font-semibold tnum">{fmtDuration(m.avgDurationMs)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    winners vs losers in Reports
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-14",
            label: text.dashboard.bestWorst,
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title={text.dashboard.bestWorst}
                  icon={Trophy}
                  hint={text.dashboard.bestWorstHint}
                />
                <CardContent className="space-y-1">
                  {bestDay && (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <Pnl
                        value={bestDay.netPnl}
                        currency={currency}
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
            label: text.dashboard.time,
            size: "full",
            layoutGroup: "full",
            content: (
              <Card className="h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>{text.dashboard.time}</CardTitle>
                  <HelpHint heading="Trade time performance">
                    Trades grouped by their opening hour. The upper chart shows net P&L; the lower
                    chart shows trade count.
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
  const { text } = useI18n();
  return (
    <CardHeader className="flex-row items-center justify-between space-y-0">
      <CardTitle>{title}</CardTitle>
      <Tooltip>
        <TooltipTrigger className="cursor-help" aria-label={fill(text.dashboard.about, { title })}>
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
  const { text } = useI18n();
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
        <h2 className="text-xl font-semibold">{text.dashboard.emptyTitle}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{text.dashboard.emptyBody}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/import"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {text.dashboard.importFirst}
          </Link>
          <button
            onClick={loadDemo}
            disabled={loadingDemo}
            className="rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {loadingDemo ? text.dashboard.loading : text.dashboard.loadDemo}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{text.dashboard.demoNote}</p>
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
