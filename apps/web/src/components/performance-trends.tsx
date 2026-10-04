"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatApiError } from "@/lib/api-error";
import { MIN_TREND_POINTS, type PerformanceTrendsResponse } from "@/lib/performance-trends";
import { useApi } from "@/lib/use-api";
import { fmtPercent } from "@/lib/utils";
import { formatLocale, type Locale } from "@/i18n/config";
import { Pnl } from "./pnl";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

function LoadingChart() {
  const t = useTranslations("reports");
  return (
    <div role="status" aria-label={t("trends.loadingChartAria")}>
      <Skeleton className="h-60" />
    </div>
  );
}
const RollingTradeChart = dynamic(
  () => import("./charts/rolling-trade-chart").then((module) => module.RollingTradeChart),
  { loading: () => <LoadingChart /> },
);
const tradeHref = (key: string) => `/trades/${encodeURIComponent(key)}`;

export function PerformanceTrendsReport({ query }: { query: string }) {
  const t = useTranslations("reports");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const { data, loading, error, errorInfo, refresh } = useApi<PerformanceTrendsResponse>(
    `/api/performance-trends?${query}`,
  );
  const [tableOpen, setTableOpen] = useState(false);
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(tag, {
        timeZone: data?.timeZone ?? "UTC",
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [data?.timeZone, tag],
  );
  if (loading)
    return (
      <div role="status" aria-label={t("trends.loadingAria")} className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    );
  if (error || !data)
    return (
      <div role="alert" className="rounded-xl border p-5">
        <p className="text-sm text-destructive">
          {error ? formatApiError(tErrors, errorInfo ?? error) : t("trends.loadFailed")}
        </p>
        <Button onClick={refresh} variant="outline" size="sm" className="mt-3">
          {t("trends.tryAgain")}
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
          {t("trends.title")}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("trends.summaryLine", {
            count: trends.count,
            timeZone,
            currencySuffix: monetary && trends.count > 0 ? ` · ${currency}` : "",
          })}
        </p>
      </div>
      {trends.count === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <h3 className="font-medium">{t("trends.emptyTitle")}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{t("trends.emptyHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {!monetary && (
            <p
              role="note"
              className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground"
            >
              {t("trends.multiCurrency", { currencies: currencies.join(", ") })}
            </p>
          )}
          <div className={`grid items-start gap-3 ${monetary ? "lg:grid-cols-2" : ""}`}>
            {(["winRate", ...(monetary ? ["avgNetPnl" as const] : [])] as const).map((metric) => {
              const rate = metric === "winRate";
              const reference = rate ? trends.overallWinRate! : trends.overallAvgNetPnl!;
              return (
                <Card key={metric} className="min-w-0 overflow-hidden">
                  <CardHeader>
                    <CardTitle>
                      {rate ? t("trends.winRateTrend") : t("trends.avgPnlTrend")}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {rate ? t("trends.pointsNoteWin") : t("trends.pointsNotePnl")}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">{t("trends.latestWindow")}</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">
                          {latest ? (
                            rate ? (
                              fmtPercent(latest.winRate, 1, tag)
                            ) : (
                              <Pnl value={latest.avgNetPnl} currency={currency} locale={tag} />
                            )
                          ) : (
                            "—"
                          )}
                        </p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p>{rate ? t("trends.selectedWinRate") : t("trends.selectedAverage")}</p>
                        <p className="mt-1 text-sm tabular-nums">
                          {rate ? (
                            fmtPercent(reference, 1, tag)
                          ) : (
                            <Pnl value={reference} currency={currency} locale={tag} />
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
                          {rate ? t("trends.sequenceNoteWin") : t("trends.sequenceNotePnl")}
                        </p>
                      </>
                    ) : (
                      <div className="rounded-lg bg-muted/30 px-4 py-6 text-sm leading-relaxed text-muted-foreground">
                        {!latest
                          ? t("trends.needMore", { count: 20 - trends.count })
                          : t("trends.latestWindowAvailable")}
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
                <CardTitle>{t("trends.largestTitle")}</CardTitle>
                <p className="text-xs text-muted-foreground">{t("trends.largestNote")}</p>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["largestWinner", trends.largestWin],
                    ["largestLoser", trends.largestLoss],
                  ] as const
                ).map(([id, trade]) => (
                  <div key={id} className="min-w-0 rounded-lg border p-4">
                    <h3 className="text-xs text-muted-foreground">{t(`trends.${id}`)}</h3>
                    {trade ? (
                      <>
                        <p className="mt-2 text-xl font-semibold">
                          <Pnl value={trade.netPnl} currency={currency} locale={tag} />
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
                        {id === "largestWinner" ? t("trends.noWinners") : t("trends.noLosers")}
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
                {t("trends.exploreSummary")}
              </summary>
              {tableOpen && (
                <div className="max-h-72 overflow-auto px-4 pb-4">
                  <table className="w-full text-left text-xs">
                    <caption className="pb-3 text-left text-muted-foreground">
                      {t("trends.tableCaption", { timeZone })}
                    </caption>
                    <thead>
                      <tr className="border-b">
                        <th scope="col" className="py-2 pr-3">
                          {t("trends.windowCol")}
                        </th>
                        <th scope="col" className="px-2 text-right">
                          {t("trends.winRateCol")}
                        </th>
                        {monetary && (
                          <th scope="col" className="pl-2 text-right">
                            {t("trends.avgPnlCol")}
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
                            {fmtPercent(point.winRate, 1, tag)}
                          </td>
                          {monetary && (
                            <td className="pl-2 text-right">
                              <Pnl value={point.avgNetPnl} currency={currency} locale={tag} />
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
          <p className="text-xs leading-relaxed text-muted-foreground">{t("trends.footnote")}</p>
        </>
      )}
    </section>
  );
}
