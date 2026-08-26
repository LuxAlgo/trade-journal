"use client";

import Link from "next/link";
import { Suspense } from "react";
import type {
  CalendarMonth,
  DayStats,
  EdgeScore,
  EquityPoint,
  TradeMetrics,
} from "@luxalgo/journal-core";
import { CalendarPnl } from "@/components/calendar-pnl";
import { DailyBars } from "@/components/charts/daily-bars";
import { EdgeRadar } from "@/components/charts/edge-radar";
import { EquityArea } from "@/components/charts/equity-area";
import { Gauge } from "@/components/charts/gauge";
import { TimeHeatmap } from "@/components/charts/time-heatmap";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/lib/use-api";
import { fmtDuration, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";

interface Bucket {
  key: string;
  trades: number;
  netPnl: number;
  winRate: number | null;
}

interface StatsPayload {
  metrics: TradeMetrics;
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
  const { data, loading } = useApi<StatsPayload>(`/api/stats?${query}`);

  if (loading && !data) return <DashboardSkeleton />;
  if (!data) return null;
  const { metrics: m, edgeScore } = data;

  if (m.totalTrades === 0) return <EmptyState />;

  return (
    <div>
      <FilterBar title="Dashboard" />
      <div className="space-y-3 p-4">
        {/* Headline tiles */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Card>
            <CardHeader>
              <CardTitle>Net P&L</CardTitle>
            </CardHeader>
            <CardContent>
              <Pnl value={m.netPnl} className="text-2xl font-semibold" />
              <div className="mt-1 text-xs text-muted-foreground">
                {m.closedTrades} closed trades · {fmtMoney(m.fees)} fees
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Trade win %</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-2">
              <Gauge value={m.winRate} label="Trade win rate" />
              <div className="space-y-0.5 text-xs text-muted-foreground">
                <div>{m.wins} W</div>
                <div>{m.breakevens} BE</div>
                <div>{m.losses} L</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Profit factor</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tnum">
                {m.profitFactorIsInfinite
                  ? "∞"
                  : m.profitFactor === null
                    ? "–"
                    : fmtNumber(m.profitFactor)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">gross profit ÷ gross loss</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Day win %</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-2">
              <Gauge value={m.dayWinRate} label="Day win rate" />
              <div className="text-xs text-muted-foreground">{m.tradingDays} days</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Avg win / loss</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tnum">
                {m.avgWinLossRatio === null ? "–" : fmtNumber(m.avgWinLossRatio)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                <span className="text-profit">{m.avgWin === null ? "–" : fmtMoney(m.avgWin)}</span>
                {" avg win · "}
                <span className="text-loss">{m.avgLoss === null ? "–" : fmtMoney(-m.avgLoss)}</span>
                {" avg loss"}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Edge score + curves */}
        <div className="grid gap-3 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Edge Score</CardTitle>
              <span className="text-xl font-semibold tnum">
                {edgeScore.score === null ? "–" : edgeScore.score}
                <span className="text-xs text-muted-foreground">/100</span>
              </span>
            </CardHeader>
            <CardContent>
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
                <EdgeRadar components={edgeScore.components} />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Daily net cumulative P&L</CardTitle>
            </CardHeader>
            <CardContent>
              <EquityArea
                data={data.dailyCumulative.map((p) => ({ t: p.t, cumNetPnl: p.cumNetPnl }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Net daily P&L</CardTitle>
            </CardHeader>
            <CardContent>
              <DailyBars data={data.days.map((d) => ({ date: d.date, netPnl: d.netPnl }))} />
            </CardContent>
          </Card>
        </div>

        {/* Calendar + recent activity */}
        <div className="grid gap-3 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>
                {new Date(Date.UTC(data.calendar.year, data.calendar.month - 1)).toLocaleString(
                  "en-US",
                  { month: "long", year: "numeric", timeZone: "UTC" },
                )}
              </CardTitle>
              <Link
                href="/calendar"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Full calendar
              </Link>
            </CardHeader>
            <CardContent>
              <CalendarPnl calendar={data.calendar} />
            </CardContent>
          </Card>
          <Card>
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
                      href={`/trades/${encodeURIComponent(trade.key)}`}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent/60"
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
                      <span className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {trade.closedAt?.slice(0, 10)}
                        </span>
                        <Pnl value={trade.netPnl} />
                      </span>
                    </Link>
                  ))}
                </TabsContent>
                <TabsContent value="open" className="space-y-1">
                  {data.openPositions.length === 0 && <Empty label="Flat — no open positions" />}
                  {data.openPositions.map((position) => (
                    <div
                      key={position.key}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <Badge variant="secondary">{position.direction.toUpperCase()}</Badge>
                        {position.symbol}
                      </span>
                      <span className="tnum text-xs text-muted-foreground">
                        {fmtNumber(position.quantity, 4)} @ {fmtNumber(position.avgEntry)}
                      </span>
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Risk + behavior row */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Max drawdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-semibold tnum text-loss">{fmtMoney(-m.maxDrawdown)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {m.maxDrawdownPct === null
                  ? "set an initial balance for %"
                  : fmtPercent(m.maxDrawdownPct)}
                {m.recoveryFactor !== null && ` · recovery ${fmtNumber(m.recoveryFactor)}x`}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Streaks</CardTitle>
            </CardHeader>
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
          <Card>
            <CardHeader>
              <CardTitle>Expectancy / trade</CardTitle>
            </CardHeader>
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
          <Card>
            <CardHeader>
              <CardTitle>Avg duration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-semibold tnum">{fmtDuration(m.avgDurationMs)}</div>
              <div className="mt-1 text-xs text-muted-foreground">winners vs losers in Reports</div>
            </CardContent>
          </Card>
        </div>

        {/* Time performance (the heavy plot) */}
        <Card>
          <CardHeader>
            <CardTitle>Trade time performance</CardTitle>
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
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="px-2 py-6 text-center text-sm text-muted-foreground">{label}</p>;
}

function EmptyState() {
  return (
    <div>
      <FilterBar title="Dashboard" />
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <h2 className="text-xl font-semibold">Your journal is empty</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Connect a broker for automatic sync, upload a statement from 10+ platforms (including your
          TradeZella export), or add trades manually.
        </p>
        <Link
          href="/import"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Import your first trades
        </Link>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div>
      <FilterBar title="Dashboard" />
      <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-3 px-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-72" />
        ))}
      </div>
    </div>
  );
}
