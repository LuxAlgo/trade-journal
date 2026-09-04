"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { MIN_TREND_POINTS, type PerformanceTrendsResponse } from "@/lib/performance-trends";
import { useApi } from "@/lib/use-api";
import { fmtPercent } from "@/lib/utils";
import { Pnl } from "./pnl";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

const RollingTradeChart = dynamic(
  () => import("./charts/rolling-trade-chart").then((module) => module.RollingTradeChart),
  {
    loading: () => (
      <div role="status" aria-label="Loading trend chart">
        <Skeleton className="h-60" />
      </div>
    ),
  },
);
const tradeHref = (key: string) => `/trades/${encodeURIComponent(key)}`;

export function PerformanceTrendsReport({ query }: { query: string }) {
  const { data, loading, error, refresh } = useApi<PerformanceTrendsResponse>(
    `/api/performance-trends?${query}`,
  );
  const [tableOpen, setTableOpen] = useState(false);
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat("en", {
        timeZone: data?.timeZone ?? "UTC",
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [data?.timeZone],
  );
  if (loading)
    return (
      <div
        role="status"
        aria-label="Loading performance trends"
        className="grid gap-3 md:grid-cols-2"
      >
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    );
  if (error || !data)
    return (
      <div role="alert" className="rounded-xl border p-5">
        <p className="text-sm text-destructive">{error ?? "Unable to load performance trends."}</p>
        <Button onClick={refresh} variant="outline" size="sm" className="mt-3">
          Try again
        </Button>
      </div>
    );
  const { trends, timeZone, currencies } = data;
  const currency = currencies[0] ?? "USD";
  const monetary = currencies.length <= 1;
  const latest = trends.points.at(-1);
  const chartReady = trends.points.length >= MIN_TREND_POINTS;
  return (
    <section
      className="space-y-4"
      aria-labelledby="performance-trends-title"
      data-performance-trends
    >
      <div>
        <h2 id="performance-trends-title" className="text-lg font-semibold">
          Performance trends
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {trends.count} closed trades · Active account and filters · Closing order · {timeZone}
          {monetary && trends.count > 0 ? ` · ${currency}` : ""}
        </p>
      </div>
      {trends.count === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <h3 className="font-medium">No closed trades in this selection</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Change the date range or filters to explore your trading history. Open positions are
              excluded.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {!monetary && (
            <p
              role="note"
              className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground"
            >
              These trades use different currencies ({currencies.join(", ")}). Win rate is
              available; select accounts with one currency to compare P&L and largest trades. No
              currency conversion is applied.
            </p>
          )}
          <div className={`grid items-start gap-3 ${monetary ? "lg:grid-cols-2" : ""}`}>
            {(["winRate", ...(monetary ? ["avgNetPnl" as const] : [])] as const).map((metric) => {
              const rate = metric === "winRate";
              const reference = rate ? trends.overallWinRate! : trends.overallAvgNetPnl!;
              return (
                <Card key={metric} className="min-w-0 overflow-hidden">
                  <CardHeader>
                    <CardTitle>{rate ? "Win-rate trend" : "Average trade P&L trend"}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Last 20 closed trades at each point
                      {rate ? " · Breakevens included" : " · After fees"}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Latest full window</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">
                          {latest ? (
                            rate ? (
                              fmtPercent(latest.winRate, 1)
                            ) : (
                              <Pnl value={latest.avgNetPnl} currency={currency} />
                            )
                          ) : (
                            "—"
                          )}
                        </p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p>Selected-period {rate ? "win rate" : "average"}</p>
                        <p className="mt-1 text-sm tabular-nums">
                          {rate ? (
                            fmtPercent(reference, 1)
                          ) : (
                            <Pnl value={reference} currency={currency} />
                          )}
                        </p>
                      </div>
                    </div>
                    {chartReady ? (
                      <>
                        <RollingTradeChart
                          data={trends.points}
                          metric={metric}
                          reference={reference}
                          currency={currency}
                          timeZone={timeZone}
                        />
                        <p className="text-xs text-muted-foreground">
                          Closed-trade sequence · Dashed line: selected-period{" "}
                          {rate ? "win rate" : "average"}
                        </p>
                      </>
                    ) : (
                      <div className="rounded-lg bg-muted/30 px-4 py-6 text-sm leading-relaxed text-muted-foreground">
                        {!latest
                          ? `${20 - trends.count} more closed ${20 - trends.count === 1 ? "trade is" : "trades are"} needed for the first full 20-trade window.`
                          : `Latest window available. A line chart appears at 27 closed trades, when there are 8 full windows to compare.`}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {monetary && (
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Largest winning and losing trade</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Individual closed trades, after fees—not daily totals. Uses your journal’s
                  win/loss classification.
                </p>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["Largest winner", trends.largestWin],
                    ["Largest loser", trends.largestLoss],
                  ] as const
                ).map(([label, trade]) => (
                  <div key={label} className="min-w-0 rounded-lg border p-4">
                    <h3 className="text-xs text-muted-foreground">{label}</h3>
                    {trade ? (
                      <>
                        <p className="mt-2 text-xl font-semibold">
                          <Pnl value={trade.netPnl} currency={currency} />
                        </p>
                        <Link
                          href={tradeHref(trade.key)}
                          className="mt-2 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded text-sm underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-current"
                        >
                          <span className="break-all font-medium">
                            {trade.symbol} · {trade.direction}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {dateFormat.format(new Date(trade.closedAt))} ↗
                          </span>
                        </Link>
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-muted-foreground">
                        No {label === "Largest winner" ? "winning" : "losing"} trades in this
                        selection.
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {latest && (
            <details
              className="rounded-xl border bg-card"
              onToggle={(event) => setTableOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-medium">
                Explore window values and trades
              </summary>
              {tableOpen && (
                <div className="max-h-72 overflow-auto px-4 pb-4">
                  <table className="w-full text-left text-xs">
                    <caption className="pb-3 text-left text-muted-foreground">
                      Each row covers 20 trades ending at the linked trade. Dates use {timeZone}.
                    </caption>
                    <thead>
                      <tr className="border-b">
                        <th scope="col" className="py-2 pr-3">
                          Window / closing trade
                        </th>
                        <th scope="col" className="px-2 text-right">
                          Win rate
                        </th>
                        {monetary && (
                          <th scope="col" className="pl-2 text-right">
                            Avg net P&L
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {trends.points.map((point) => (
                        <tr key={point.key} className="border-b last:border-0">
                          <th scope="row" className="py-3 pr-3 font-normal">
                            <Link
                              className="rounded underline underline-offset-4"
                              href={tradeHref(point.key)}
                            >
                              #{point.sequence - 19}–{point.sequence}
                              <span className="mt-1 block text-muted-foreground">
                                {dateFormat.format(new Date(point.closedAt))}
                              </span>
                            </Link>
                          </th>
                          <td className="px-2 text-right tabular-nums">
                            {fmtPercent(point.winRate, 1)}
                          </td>
                          {monetary && (
                            <td className="pl-2 text-right">
                              <Pnl value={point.avgNetPnl} currency={currency} />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Only trades within your selection are used; earlier trades are not borrowed to fill a
            window. Rolling windows overlap and describe recent results—not a forecast. Small
            samples can change sharply.
          </p>
        </>
      )}
    </section>
  );
}
