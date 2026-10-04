"use client";

import type { AnalysisFilters, BucketStats } from "@luxalgo/journal-core";
import { useLocale, useTranslations } from "next-intl";
import { TimeHeatmap } from "./charts/time-heatmap";
import { ReviewExport } from "./review-export";
import { MonetaryValue } from "./privacy";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { formatApiError } from "@/lib/api-error";
import { useApi } from "@/lib/use-api";
import { fmtMoney, fmtPercent, pnlClass } from "@/lib/utils";
import { describeFilters } from "@/lib/filter-description";
import { formatLocale, type Locale } from "@/i18n/config";

interface OverviewData {
  buckets: Record<
    "symbol" | "tag" | "mistake" | "playbook" | "weekday" | "hour" | "duration" | "direction",
    BucketStats[]
  >;
  currencies: string[];
  timeZone: string;
  accounts: { id: string; name: string }[];
  playbooks: { id: string; name: string }[];
}

// Keep the original overview's aggregations and ordering alongside the advanced reports.
const SECTIONS = [
  "symbol",
  "direction",
  "weekday",
  "duration",
  "tag",
  "mistake",
  "playbook",
] as const;

export function ReportOverview({ query, filters }: { query: string; filters: AnalysisFilters }) {
  const t = useTranslations("reports");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const { data, error, errorInfo, loading } = useApi<OverviewData>(`/api/stats?${query}`);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {formatApiError(tErrors, errorInfo ?? error)}
      </p>
    );
  if (loading || !data) return <Skeleton className="h-72" />;
  if (data.currencies.length > 1)
    return (
      <p className="rounded-lg border p-4 text-sm">
        {t("multiCurrency", { currencies: data.currencies.join(", ") })}
      </p>
    );
  const currency = data.currencies[0] ?? "USD";
  const label = (dimension: string, key: string) =>
    dimension === "playbook" ? (data.playbooks.find((book) => book.id === key)?.name ?? key) : key;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t("overview.overviewLine", { timeZone: data.timeZone, currency })}
        </p>
        <ReviewExport
          containsFinancialData
          document={{
            title: t("overview.exportTitle"),
            subtitle: t("exportSubtitle", { timeZone: data.timeZone, currency }),
            lines: [
              t("overview.exportFilters", {
                filters: describeFilters(filters, data.accounts, data.playbooks),
              }),
              "",
              t("overview.exportHourHeader"),
              ...data.buckets.hour.map((b) =>
                t("overview.exportHourLine", {
                  hour: b.key,
                  trades: b.trades,
                  pnl: fmtMoney(b.netPnl, currency, tag),
                }),
              ),
              ...SECTIONS.flatMap((section) => [
                "",
                t(`overview.sections.${section}`),
                ...data.buckets[section].map((b) =>
                  t("overview.exportGroupLine", {
                    label: label(section, b.key),
                    trades: b.trades,
                    win: fmtPercent(b.winRate, 0, tag),
                    pnl: fmtMoney(b.netPnl, currency, tag),
                  }),
                ),
              ]),
            ],
          }}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("overview.timePerformance")}</CardTitle>
          </CardHeader>
          <CardContent>
            <TimeHeatmap hours={data.buckets.hour} currency={currency} />
          </CardContent>
        </Card>
        {SECTIONS.map((section) => (
          <Card key={section}>
            <CardHeader>
              <CardTitle>{t(`overview.sections.${section}`)}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.buckets[section].length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {section === "tag" || section === "mistake" || section === "playbook"
                    ? t("overview.annotateEmpty")
                    : t("overview.noData")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t(`overview.columns.${section}`)}</TableHead>
                      <TableHead className="text-right">{t("overview.thTrades")}</TableHead>
                      <TableHead className="text-right">{t("overview.thWinPct")}</TableHead>
                      <TableHead className="text-right">{t("overview.thNetPnl")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.buckets[section].map((bucket) => (
                      <TableRow key={bucket.key}>
                        <TableCell className="font-medium">{label(section, bucket.key)}</TableCell>
                        <TableCell className="tnum text-right text-muted-foreground">
                          {bucket.trades}
                        </TableCell>
                        <TableCell className="tnum text-right">
                          {fmtPercent(bucket.winRate, 0, tag)}
                        </TableCell>
                        <TableCell className={`tnum text-right ${pnlClass(bucket.netPnl)}`}>
                          <MonetaryValue>{fmtMoney(bucket.netPnl, currency, tag)}</MonetaryValue>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("overview.footnote")}</p>
    </div>
  );
}
