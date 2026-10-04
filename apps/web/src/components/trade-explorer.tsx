"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  clockLabel,
  plotTradePoints,
  type PlottedTrade,
  type TradeExplorerResponse,
  type TradeXAxis,
  type TradeYAxis,
} from "@/lib/trade-explorer";
import { formatLocale, type Locale } from "@/i18n/config";
import { formatApiError } from "@/lib/api-error";
import { useApi } from "@/lib/use-api";
import { ReportMarketEstimates } from "./report-market-estimates";
import { MonetaryValue } from "./privacy";
import { fmtMoney } from "@/lib/utils";
import { Pnl } from "./pnl";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { OptionSelect } from "./ui/option-select";
import { Skeleton } from "./ui/skeleton";

const TradeScatter = dynamic(
  () => import("./charts/trade-scatter").then((module) => module.TradeScatter),
  {
    loading: () => <ExplorerChartLoading />,
  },
);
function ExplorerChartLoading() {
  const t = useTranslations("trades");
  return (
    <div role="status" aria-label={t("explorerLoading")}>
      <Skeleton className="h-80" />
    </div>
  );
}
const PAGE_SIZE = 25;
const detailHref = (key: string) => `/trades/${encodeURIComponent(key)}`;

export function TradeExplorer({ query }: { query: string }) {
  const t = useTranslations("trades");
  const te = useTranslations("enums");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const { data, error, errorInfo, loading, refresh } = useApi<TradeExplorerResponse>(
    `/api/trade-explorer?${query}`,
  );
  const [x, setX] = useState<TradeXAxis>("durationMinutes");
  const [y, setY] = useState<TradeYAxis>("netPnl");
  const [selected, setSelected] = useState<PlottedTrade | null>(null);
  const [page, setPage] = useState(0);
  const [tableOpen, setTableOpen] = useState(false);
  const points = useMemo(() => plotTradePoints(data?.points ?? [], x, y), [data, x, y]);
  const date = useMemo(
    () =>
      new Intl.DateTimeFormat(tag, {
        timeZone: data?.timeZone ?? "UTC",
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [data?.timeZone, tag],
  );
  const numberText = useMemo(() => new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }), [tag]);
  if (loading && !data)
    return (
      <div role="status" aria-label={t("explorerLoading")}>
        <Skeleton className="h-96" />
      </div>
    );
  if (error || !data)
    return (
      <div role="alert" className="rounded-xl border p-5">
        <p className="text-sm text-destructive">
          {error ? formatApiError(tErrors, errorInfo ?? error) : t("explorerLoadError")}
        </p>
        <Button onClick={refresh} variant="outline" size="sm" className="mt-3">
          {t("tryAgain")}
        </Button>
      </div>
    );
  const currency = data.currencies[0] ?? "USD";
  const excursion = x === "mae" || x === "mfe" || y === "mae" || y === "mfe";
  const blocked = (y !== "realizedR" || excursion) && data.currencies.length > 1;
  const axisName = (axis: string) => axis.toUpperCase();
  const xTitle =
    x === "durationMinutes"
      ? t("xTitleDuration")
      : x === "entryMinute"
        ? t("xTitleEntryTime", { timeZone: data.timeZone })
        : t("xTitleEstimated", { axis: axisName(x), currency });
  const yTitle =
    y === "netPnl"
      ? t("yTitleNetPnl", { currency })
      : y === "realizedR"
        ? t("yTitleRealizedR")
        : t("yTitleEstimated", { axis: axisName(y), currency });
  const value = (point: PlottedTrade) =>
    y === "mae" || y === "mfe" ? (
      <MonetaryValue>{fmtMoney(point.y, currency, tag)}</MonetaryValue>
    ) : y === "netPnl" ? (
      <Pnl value={point.y} currency={currency} locale={tag} />
    ) : (
      <span className="tabular-nums">
        {point.y > 0 ? "+" : ""}
        {numberText.format(point.y)}R
      </span>
    );
  const xValue = (point: PlottedTrade) =>
    x === "mae" || x === "mfe" ? (
      <MonetaryValue>{fmtMoney(point.x, currency, tag)}</MonetaryValue>
    ) : x === "entryMinute" ? (
      clockLabel(point.x)
    ) : (
      t("minutes", { value: numberText.format(point.x) })
    );
  const pages = Math.ceil(points.length / PAGE_SIZE);
  const shownPage = Math.min(page, Math.max(0, pages - 1));
  const table = (
    <div className="space-y-3 px-4 pb-4">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="pb-3 text-left text-muted-foreground">
            {t("explorerTableCaption", { count: points.length })}
          </caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-3">
                {t("colTradeClosed")}
              </th>
              <th scope="col" className="px-2 text-right">
                {xTitle}
              </th>
              <th scope="col" className="pl-2 text-right">
                {yTitle}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE).map((point) => (
              <tr key={point.key} className="border-b last:border-0">
                <th scope="row" className="py-3 pr-3 font-normal">
                  <Link
                    href={detailHref(point.key)}
                    className="rounded underline underline-offset-4"
                  >
                    <span className="break-all font-medium">
                      {point.symbol} ·{" "}
                      {te.has(`direction.${point.direction}`)
                        ? te(`direction.${point.direction}`)
                        : point.direction}
                    </span>
                    <span className="mt-1 block text-muted-foreground">
                      {date.format(new Date(point.closedAt))}
                    </span>
                  </Link>
                </th>
                <td className="px-2 text-right tabular-nums">{xValue(point)}</td>
                <td className="pl-2 text-right">{value(point)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={shownPage === 0}
            onClick={() => setPage(shownPage - 1)}
          >
            {t("previous")}
          </Button>
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {t("pageOf", { page: shownPage + 1, pages })}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={shownPage === pages - 1}
            onClick={() => setPage(shownPage + 1)}
          >
            {t("next")}
          </Button>
        </div>
      )}
    </div>
  );
  return (
    <section className="space-y-4" aria-labelledby="trade-explorer-title" data-trade-explorer>
      <div>
        <h2 id="trade-explorer-title" className="text-lg font-semibold">
          {t("explorerTitle")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("explorerSubtitle", { timeZone: data.timeZone })}
        </p>
      </div>
      <ReportMarketEstimates
        points={data.points}
        currencies={data.currencies}
        onComplete={refresh}
      />
      <div className="flex flex-wrap gap-2" aria-label={t("presetsLabel")}>
        {(
          [
            ["durationMinutes", "netPnl", t("presetHoldingTime")],
            ["mae", "netPnl", t("presetMaeNetPnl")],
            ["mfe", "netPnl", t("presetMfeNetPnl")],
            ["mae", "mfe", t("presetMaeMfe")],
          ] as const
        ).map(([nextX, nextY, label]) => (
          <Button
            key={label}
            size="sm"
            variant={x === nextX && y === nextY ? "secondary" : "outline"}
            onClick={() => {
              setX(nextX);
              setY(nextY);
              setSelected(null);
              setPage(0);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <CardTitle>
                {excursion
                  ? t("outcomesExcursion", { x: xTitle, y: yTitle })
                  : x === "durationMinutes"
                    ? t("outcomesByHoldingTime")
                    : t("outcomesByEntryTime")}
              </CardTitle>
              <p className="mt-2 text-xs text-muted-foreground">
                {blocked
                  ? t("closedTradesCount", { count: data.points.length })
                  : t("comparableCount", { shown: points.length, count: data.points.length })}{" "}
                · {t("onePointPerTrade")} · {excursion ? t("excursionNote") : t("afterFees")}
              </p>
            </div>
            <div className="flex w-full flex-wrap gap-3 sm:w-auto">
              <div className="min-w-0 flex-1 sm:w-44">
                <label
                  htmlFor="trade-x-axis"
                  className="mb-1.5 block text-xs text-muted-foreground"
                >
                  {t("xAxis")}
                </label>
                <OptionSelect
                  id="trade-x-axis"
                  value={x}
                  onValueChange={(value) => {
                    setX(value as TradeXAxis);
                    setSelected(null);
                    setPage(0);
                  }}
                >
                  <option value="durationMinutes">{t("optDuration")}</option>
                  <option value="entryMinute">{t("optEntryTime")}</option>
                  <option value="mae">{t("optEstimatedMae")}</option>
                  <option value="mfe">{t("optEstimatedMfe")}</option>
                </OptionSelect>
              </div>
              <div className="min-w-0 flex-1 sm:w-44">
                <label
                  htmlFor="trade-y-axis"
                  className="mb-1.5 block text-xs text-muted-foreground"
                >
                  {t("yAxis")}
                </label>
                <OptionSelect
                  id="trade-y-axis"
                  value={y}
                  onValueChange={(value) => {
                    setY(value as TradeYAxis);
                    setSelected(null);
                    setPage(0);
                  }}
                >
                  <option value="netPnl">{t("optNetPnl")}</option>
                  <option value="realizedR">{t("optRealizedR")}</option>
                  <option value="mae">{t("optEstimatedMae")}</option>
                  <option value="mfe">{t("optEstimatedMfe")}</option>
                </OptionSelect>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.points.length === 0 ? (
            <div className="py-10 text-center">
              <h3 className="font-medium">{t("explorerEmptyTitle")}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t("explorerEmptyBody")}</p>
            </div>
          ) : blocked ? (
            <p role="note" className="rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">
              {t("blockedCurrencies", { currencies: data.currencies.join(", ") })}
            </p>
          ) : (
            <>
              {points.length < data.points.length && (
                <p role="note" className="text-xs leading-relaxed text-muted-foreground">
                  {y === "realizedR" && excursion
                    ? t("excludedNoteBoth", { count: data.points.length - points.length })
                    : y === "realizedR"
                      ? t("excludedNoteR", { count: data.points.length - points.length })
                      : excursion
                        ? t("excludedNoteEstimates", {
                            count: data.points.length - points.length,
                          })
                        : t("excludedNotePlain", { count: data.points.length - points.length })}
                </p>
              )}
              {y === "realizedR" && (
                <p className="text-xs leading-relaxed text-muted-foreground">{t("rExplainer")}</p>
              )}
              {points.length >= (excursion ? 1 : 8) ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>{yTitle}</span>
                    <span className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>
                        <span aria-hidden="true" className="text-[var(--profit)]">
                          ●
                        </span>{" "}
                        {t("legendPositive")}
                      </span>
                      <span>
                        <span aria-hidden="true" className="text-[var(--loss)]">
                          ●
                        </span>{" "}
                        {t("legendNegative")}
                      </span>
                      <span>
                        <span aria-hidden="true">●</span> {t("legendZero")}
                      </span>
                    </span>
                  </div>
                  <TradeScatter
                    points={points}
                    x={x}
                    y={y}
                    currency={currency}
                    timeZone={data.timeZone}
                    onSelect={setSelected}
                  />
                  <p className="text-center text-xs text-muted-foreground">{xTitle}</p>
                  <p className="text-xs text-muted-foreground">{t("inspectPointHint")}</p>
                  <div aria-live="polite">
                    {selected && (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-4">
                        <div>
                          <p className="text-sm font-medium break-all">
                            {selected.symbol} ·{" "}
                            {te.has(`direction.${selected.direction}`)
                              ? te(`direction.${selected.direction}`)
                              : selected.direction}{" "}
                            · {value(selected)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {xValue(selected)} ·{" "}
                            {t("closedAt", { time: date.format(new Date(selected.closedAt)) })}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Link
                            href={detailHref(selected.key)}
                            className="rounded text-sm underline underline-offset-4"
                          >
                            {t("openTrade")}
                          </Link>
                          <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                            {t("dismiss")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="rounded-lg bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
                  {points.length === 0 ? t("noAxisData") : t("tooFewPoints")}
                </p>
              )}
              {points.length > 0 && points.length < 20 && (
                <p className="text-xs text-muted-foreground">{t("smallSample")}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
      {!blocked &&
        points.length > 0 &&
        (points.length < 8 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("comparableTrades")}</CardTitle>
            </CardHeader>
            {table}
          </Card>
        ) : (
          <details
            className="rounded-xl border bg-card"
            onToggle={(event) => setTableOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-medium">
              {t("exploreAll", { count: points.length })}
            </summary>
            {tableOpen && table}
          </details>
        ))}
      <p className="text-xs leading-relaxed text-muted-foreground">{t("durationFootnote")}</p>
    </section>
  );
}
