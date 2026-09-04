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
import { relativeDrawdownCurve } from "@luxalgo/journal-core";
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
import { DashboardLayout } from "@/components/dashboard-layout";
import { MonetaryValue } from "@/components/privacy";
import { Pnl } from "@/components/pnl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HelpHint, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { postJson, useApi } from "@/lib/use-api";
import { cn, fmtDuration, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";

interface Bucket {
  key: string;
  trades: number;
  netPnl: number;
  winRate: number | null;
}

interface StatsPayload {
  metrics: TradeMetrics;
  initialBalance: number;
  edgeScore: EdgeScore;
  days: DayStats[];
  dailyCumulative: EquityPoint[];
  calendar: CalendarMonth;
  buckets: Record<"symbol" | "weekday" | "hour" | "duration" | "direction", Bucket[]>;
  openPositions: {
    key: string;
    symbol: string;
    direction: string;
    openedAt: string;
    quantity: number;
    avgEntry: number;
  }[];
  recentTrades: { key: string; symbol: string; closedAt: string; netPnl: number; status: string }[];
}

export default function DashboardPage() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const { query } = useFilters();
  const { data, loading, error, refresh } = useApi<StatsPayload>(`/api/stats?${query}`);

  if (loading && !data) return <DashboardSkeleton />;
  if (!data)
    return (
      <div>
        <FilterBar title="Dashboard" />
        <div className="space-y-3 p-4">
          <p role="alert" className="text-sm text-destructive">
            {error ?? "Could not load the dashboard."}
          </p>
          <button
            type="button"
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
            onClick={refresh}
          >
            Try again
          </button>
        </div>
      </div>
    );
  const { metrics: m, edgeScore } = data;

  if (m.totalTrades === 0)
    return query ? (
      <div>
        <FilterBar title="Dashboard" />
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
      <FilterBar title="Dashboard" />
      <DashboardLayout
        widgets={[
          {
            id: "widget-0",
            label: "Net P&L",
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title="Net P&L"
                  icon={CircleDollarSign}
                  hint="Realized profit and loss net of fees, over the selected range."
                />
                <CardContent>
                  <Pnl value={m.netPnl} className="text-3xl font-semibold tracking-tight" />
                  {weekDelta !== null && (
                    <div
                      className={cn(
                        "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        weekDelta >= 0 ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss",
                      )}
                    >
                      {weekDelta >= 0 ? "▲" : "▼"}{" "}
                      <MonetaryValue>
                        {fmtMoney(Math.abs(weekDelta)).replace("+", "")}
                      </MonetaryValue>{" "}
                      vs prior 7d
                    </div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {m.closedTrades} closed trades ·{" "}
                    <MonetaryValue>{fmtMoney(m.fees)}</MonetaryValue> fees
                  </div>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-1",
            label: "Trade win %",
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title="Trade win %"
                  icon={Target}
                  hint="Winning trades divided by all closed trades, including breakevens."
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
            label: "Profit factor",
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title="Profit factor"
                  icon={Scale}
                  hint="Gross profit ÷ gross loss. Above 1 means the wins outweigh the losses."
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
            label: "Day win %",
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title="Day win %"
                  icon={CalendarCheck2}
                  hint="Green trading days ÷ all trading days in the selected range."
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
            label: "Avg win / loss",
            size: "small",
            layoutGroup: "summary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title="Avg win / loss"
                  icon={ArrowUpDown}
                  hint="Average winning trade ÷ average losing trade. The bar shows the two to scale."
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
                        <MonetaryValue>{fmtMoney(m.avgWin)}</MonetaryValue>
                      )}
                    </span>
                    {" avg win · "}
                    <span className="text-loss">
                      {m.avgLoss === null ? (
                        "–"
                      ) : (
                        <MonetaryValue>{fmtMoney(-m.avgLoss)}</MonetaryValue>
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
            label: "Edge Score",
            size: "medium",
            layoutGroup: "visuals",
            content: (
              <Card className="dashboard-visual-card h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <div className="flex min-w-0 items-center gap-1">
                    <CardTitle>Edge Score</CardTitle>
                    <HelpHint heading="Edge Score">
                      A 0–100 score combining win rate, profit factor, average win/loss, drawdown,
                      recovery, and consistency. Requires at least five closed trades.
                    </HelpHint>
                  </div>
                  <span className="text-2xl font-semibold tracking-tight tnum">
                    {edgeScore.score === null ? (
                      "–"
                    ) : (
                      <span className="prism-text">{edgeScore.score}</span>
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
            label: "Cumulative P&L",
            size: "medium",
            layoutGroup: "visuals",
            content: (
              <Card className="dashboard-visual-card h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Daily net cumulative P&L</CardTitle>
                  <HelpHint heading="Cumulative P&L">
                    Running total of net profit and loss over the selected period. The drawdown bars
                    below show declines from the running equity peak.
                  </HelpHint>
                </CardHeader>
                <CardContent>
                  <EquityArea
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
            label: "Daily P&L",
            size: "medium",
            layoutGroup: "visuals",
            content: (
              <Card className="dashboard-visual-card h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Net daily P&L</CardTitle>
                  <HelpHint heading="Daily P&L">
                    Net profit or loss for each trading day. Bars above zero are profitable; bars
                    below zero are losses.
                  </HelpHint>
                </CardHeader>
                <CardContent className="dashboard-visual-card-content">
                  <DailyBars
                    data={data.days.map((d) => ({ date: d.date, netPnl: d.netPnl }))}
                    height="100%"
                  />
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-8",
            label: "Calendar",
            size: "wide",
            layoutGroup: "detail",
            content: (
              <Card className="h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>
                    {new Date(Date.UTC(data.calendar.year, data.calendar.month - 1)).toLocaleString(
                      "en-US",
                      { month: "long", year: "numeric", timeZone: "UTC" },
                    )}
                  </CardTitle>
                  <Link
                    href={`/calendar?${query}`}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Full calendar
                  </Link>
                </CardHeader>
                <CardContent>
                  <CalendarPnl calendar={data.calendar} />
                </CardContent>
              </Card>
            ),
          },
          {
            id: "widget-9",
            label: "Activity",
            size: "medium",
            layoutGroup: "detail",
            content: (
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Activity</CardTitle>
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
                              {trade.closedAt?.slice(0, 10)}
                            </span>
                            <Pnl value={trade.netPnl} />
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
                            <MonetaryValue>{fmtNumber(position.avgEntry)}</MonetaryValue>
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
            label: "Max drawdown",
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title="Max drawdown"
                  icon={TrendingDown}
                  hint="Largest peak-to-trough drop of the cumulative P&L curve."
                />
                <CardContent>
                  <div className="text-xl font-semibold tnum text-loss">
                    <MonetaryValue>{fmtMoney(-m.maxDrawdown)}</MonetaryValue>
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
            label: "Streaks",
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title="Streaks"
                  icon={Flame}
                  hint="Current run of consecutive wins (W) or losses (L), with the best and worst runs."
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
            label: "Expectancy / trade",
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title="Expectancy / trade"
                  icon={Sigma}
                  hint="Average net P&L per closed trade: what one more trade is worth on your numbers."
                />
                <CardContent>
                  {m.expectancy === null ? (
                    "–"
                  ) : (
                    <Pnl value={m.expectancy} className="text-xl font-semibold" />
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
            label: "Avg duration",
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title="Avg duration"
                  icon={Timer}
                  hint="Average time from first entry fill to final exit."
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
            label: "Best / worst day",
            size: "small",
            layoutGroup: "secondary",
            content: (
              <Card className="h-full">
                <StatHeader
                  title="Best / worst day"
                  icon={Trophy}
                  hint="Highest and lowest single-day net P&L in the selected range."
                />
                <CardContent className="space-y-1">
                  {bestDay && (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <Pnl value={bestDay.netPnl} className="text-base font-semibold" />
                      <span className="text-xs text-muted-foreground">{bestDay.date.slice(5)}</span>
                    </div>
                  )}
                  {worstDay && (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <Pnl value={worstDay.netPnl} className="text-base font-semibold" />
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
            label: "Trade time performance",
            size: "full",
            layoutGroup: "full",
            content: (
              <Card className="h-full">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Trade time performance</CardTitle>
                  <HelpHint heading="Trade time performance">
                    Trades grouped by their opening hour. The upper chart shows net P&L; the lower
                    chart shows trade count.
                  </HelpHint>
                </CardHeader>
                <CardContent>
                  <TimeHeatmap
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
  return (
    <CardHeader className="flex-row items-center justify-between space-y-0">
      <CardTitle>{title}</CardTitle>
      <Tooltip>
        <TooltipTrigger className="cursor-help" aria-label={`About ${title}`}>
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
      <FilterBar title="Dashboard" />
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-24 text-center">
        <h2 className="text-xl font-semibold">Your journal is empty</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Connect a broker for automatic sync, upload a statement from 10+ platforms (including your
          TradeZella export), or add trades manually.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/import"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Import your first trades
          </Link>
          <button
            onClick={loadDemo}
            disabled={loadingDemo}
            className="rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {loadingDemo ? "Loading…" : "Load demo data"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Demo data lands in its own account; delete it anytime under Accounts.
        </p>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div>
      <FilterBar title="Dashboard" />
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
