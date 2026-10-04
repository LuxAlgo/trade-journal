"use client";
import { OptionSelect } from "@/components/ui/option-select";

import { HoverHint } from "@/components/ui/tooltip";
import { Suspense, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import {
  DIMENSIONS,
  type Dimension,
  type AnalysisFilters,
  type GroupSummary,
} from "@luxalgo/journal-core";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { FilterFields, Field, fieldClass } from "@/components/filter-fields";
import { ReviewExport } from "@/components/review-export";
import { AskJournal } from "@/components/ask-journal";
import { ReportOverview } from "@/components/report-overview";
import { MonetaryValue, usePrivacy } from "@/components/privacy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatApiError } from "@/lib/api-error";
import { useApi } from "@/lib/use-api";
import { describeFilters } from "@/lib/filter-description";
import { fmtDurationLocalized, fmtPercent } from "@/lib/utils";
import { formatLocale, type Locale } from "@/i18n/config";
const TradeExplorer = dynamic(
  () => import("@/components/trade-explorer").then((module) => module.TradeExplorer),
  {
    loading: () => <LoadingNote noteKey="loadingExplorer" />,
  },
);
const PerformanceTrendsReport = dynamic(
  () => import("@/components/performance-trends").then((module) => module.PerformanceTrendsReport),
  {
    loading: () => <LoadingNote noteKey="loadingTrends" />,
  },
);
function LoadingNote({ noteKey }: { noteKey: "loadingExplorer" | "loadingTrends" }) {
  const t = useTranslations("reports");
  return (
    <p role="status" className="py-6 text-sm text-muted-foreground">
      {t(noteKey)}
    </p>
  );
}
interface Group extends GroupSummary {
  row: string;
  column: string;
}
interface Analysis {
  accounts: { id: string; name: string }[];
  summary: GroupSummary;
  groups: Group[];
  playbooks: { id: string; name: string }[];
  currencies: string[];
  timeZone: string;
}
// Server weekday keys are stable English abbreviations; this canonical order is
// only used for sorting, display goes through the localized weekday labels.
const WEEKDAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekdayIndex = (key: string) => {
  const index = WEEKDAY_ORDER.indexOf(key);
  return index === -1 ? WEEKDAY_ORDER.length : index;
};
function Summary({ data }: { data: Analysis }) {
  const t = useTranslations("reports");
  const tControls = useTranslations("controls");
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const s = data.summary;
  const number = (n: number | null) =>
    n === null ? "-" : n.toLocaleString(tag, { maximumFractionDigits: 2 });
  const percent = (n: number | null) => fmtPercent(n, 1, tag);
  const money = (n: number, currency: string) => `${number(n)} ${currency}`;
  return (
    <div className="report-summary">
      <div className="report-summary-grid grid grid-cols-2 gap-4">
        {(
          [
            ["closedTrades", String(s.trades)],
            ["netPnl", money(s.netPnl, data.currencies[0] ?? "USD")],
            ["winRate", percent(s.winRate)],
            ["profitFactor", s.noLosses ? "∞" : number(s.profitFactor)],
            ["entryVolume", number(s.volume)],
            ["avgHoldingTime", fmtDurationLocalized(s.avgDurationMs, tControls)],
            ["avgPlannedR", number(s.avgPlannedR)],
            ["avgRealizedR", number(s.avgRealizedR)],
          ] as const
        ).map(([id, value]) => (
          <div key={id}>
            <p className="text-xs text-muted-foreground">{t(`summary.${id}`)}</p>
            <p className="mt-1 break-words text-base font-semibold tabular-nums sm:text-lg">
              {id === "netPnl" ? <MonetaryValue>{value}</MonetaryValue> : value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
function DimensionSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Dimension;
  onChange: (d: Dimension) => void;
}) {
  const t = useTranslations("reports");
  return (
    <Field label={label}>
      <OptionSelect
        className={fieldClass}
        value={value}
        onValueChange={(next) => onChange(next as Dimension)}
      >
        {Object.keys(DIMENSIONS).map((key) => (
          <option key={key} value={key}>
            {t(`dimension.${key}`)}
          </option>
        ))}
      </OptionSelect>
    </Field>
  );
}
const labels = (data: Analysis, key: string) =>
  data.playbooks.find((p) => p.id === key)?.name ?? key;
function GroupLabel({ dimension, children }: { dimension: Dimension; children: string }) {
  return dimension === "entryPrice" || dimension === "exitPrice" ? (
    <MonetaryValue>{children}</MonetaryValue>
  ) : (
    children
  );
}
function Breakdown({
  data,
  cross,
  primary,
  secondary,
}: {
  data: Analysis;
  cross: boolean;
  primary: Dimension;
  secondary: Dimension;
}) {
  const t = useTranslations("reports");
  const tControls = useTranslations("controls");
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const number = (n: number | null) =>
    n === null ? "-" : n.toLocaleString(tag, { maximumFractionDigits: 2 });
  const percent = (n: number | null) => fmtPercent(n, 1, tag);
  const money = (n: number, currency: string) => `${number(n)} ${currency}`;
  // Playbook rows show playbook names; weekday rows show localized day names;
  // every other dimension key is already display-ready text.
  const displayKey = (dimension: Dimension, k: string) =>
    dimension === "playbook" ? labels(data, k) : dimension === "weekday" ? t(`weekday.${k}`) : k;
  const rowLabel = (k: string) => displayKey(primary, k),
    colLabel = (k: string) => displayKey(secondary, k);
  const rows = [...new Set(data.groups.map((g) => g.row))],
    columns = [...new Set(data.groups.map((g) => g.column))].sort((a, b) =>
      secondary === "weekday"
        ? weekdayIndex(a) - weekdayIndex(b)
        : a.localeCompare(b, undefined, { numeric: true }),
    );
  if (primary === "weekday") rows.sort((a, b) => weekdayIndex(a) - weekdayIndex(b));
  const max = data.groups.reduce((max, g) => Math.max(max, Math.abs(g.netPnl)), 1);
  const cells = new Map(data.groups.map((g) => [JSON.stringify([g.row, g.column]), g]));
  return (
    <div className="space-y-4">
      {cross && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="p-3 text-left">
                  {t(`dimension.${primary}`)} / {t(`dimension.${secondary}`)}
                </th>
                {columns.map((c) => (
                  <th key={c} className="min-w-24 p-2">
                    <GroupLabel dimension={secondary}>{colLabel(c)}</GroupLabel>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r}>
                  <th className="p-3 text-left font-medium">
                    <GroupLabel dimension={primary}>{rowLabel(r)}</GroupLabel>
                  </th>
                  {columns.map((c) => {
                    const g = cells.get(JSON.stringify([r, c]));
                    return (
                      <HoverHint
                        key={c}
                        content={
                          g
                            ? t("cellTooltip", { trades: g.trades, percent: percent(g.winRate) })
                            : t("noTrades")
                        }
                      >
                        <td
                          key={c}
                          className="border border-background p-2 text-center tabular-nums"
                          style={{
                            background: g
                              ? `color-mix(in srgb, ${g.netPnl >= 0 ? "var(--profit-fill)" : "var(--loss)"} ${8 + (Math.abs(g.netPnl) / max) * 35}%, transparent)`
                              : undefined,
                          }}
                          tabIndex={0}
                        >
                          {g ? <MonetaryValue>{number(g.netPnl)}</MonetaryValue> : "-"}
                        </td>
                      </HoverHint>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("cellNote", { currency: data.currencies[0] ?? t("accountCurrency") })}
          </p>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              {[
                t(`dimension.${primary}`),
                ...(cross ? [t(`dimension.${secondary}`)] : []),
                t("th.trades"),
                t("th.winPct"),
                t("th.netPnl"),
                t("th.entryVolume"),
                t("th.avgPlannedR"),
                t("th.avgRealizedR"),
                t("th.avgDuration"),
              ].map((h) => (
                <th key={h} className="whitespace-nowrap border-b px-3 py-3 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.groups.map((g) => (
              <tr
                key={JSON.stringify([g.row, g.column])}
                className="border-b border-border/50 hover:bg-accent/30"
              >
                <td className="px-3 py-3 font-medium">
                  <GroupLabel dimension={primary}>{rowLabel(g.row)}</GroupLabel>
                </td>
                {cross && (
                  <td className="px-3 py-3">
                    <GroupLabel dimension={secondary}>{colLabel(g.column)}</GroupLabel>
                  </td>
                )}
                <td className="px-3">{g.trades}</td>
                <td className="px-3">{percent(g.winRate)}</td>
                <td
                  className={`whitespace-nowrap px-3 tabular-nums ${g.netPnl >= 0 ? "text-profit" : "text-loss"}`}
                >
                  <MonetaryValue>{money(g.netPnl, data.currencies[0] ?? "USD")}</MonetaryValue>
                </td>
                <td className="px-3">{number(g.volume)}</td>
                <td className="px-3">{number(g.avgPlannedR)}</td>
                <td className="px-3">{number(g.avgRealizedR)}</td>
                <td className="whitespace-nowrap px-3">
                  {fmtDurationLocalized(g.avgDurationMs, tControls)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.groups.length && (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("noTradesMatch")}</p>
      )}
    </div>
  );
}
export default function ReportsPage() {
  return (
    <Suspense>
      <Reports />
    </Suspense>
  );
}
function Reports() {
  const t = useTranslations("reports");
  const tControls = useTranslations("controls");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tRoot = useTranslations();
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const { query, values } = useFilters();
  const [mode, setMode] = useState<
      "overview" | "trends" | "explorer" | "breakdown" | "cross" | "compare"
    >("overview"),
    [primary, setPrimary] = useState<Dimension>("symbol"),
    [secondary, setSecondary] = useState<Dimension>("weekday");
  const { data, error, errorInfo, loading } = useApi<Analysis>(
    mode === "breakdown" || mode === "cross"
      ? `/api/analysis?${query}&primary=${primary}${mode === "cross" ? `&secondary=${secondary}` : ""}`
      : null,
  );
  const multi = (data?.currencies.length ?? 0) > 1;
  const number = (n: number | null) =>
    n === null ? "-" : n.toLocaleString(tag, { maximumFractionDigits: 2 });
  const percent = (n: number | null) => fmtPercent(n, 1, tag);
  const displayKey = (d: Analysis, dimension: Dimension, k: string) =>
    dimension === "playbook" ? labels(d, k) : dimension === "weekday" ? t(`weekday.${k}`) : k;
  return (
    <div>
      <FilterBar title={t("title")} />
      <div className="space-y-4 p-4">
        <AskJournal />
        <div className="flex flex-wrap items-center gap-2">
          {(["overview", "trends", "explorer", "breakdown", "cross", "compare"] as const).map(
            (key) => (
              <Button
                key={key}
                size="sm"
                variant={mode === key ? "default" : "outline"}
                aria-pressed={mode === key}
                onClick={() => setMode(key)}
              >
                {t(`mode.${key}`)}
              </Button>
            ),
          )}
        </div>
        <div key={mode} className="journal-report-section space-y-4" data-report-section={mode}>
          {mode === "overview" ? (
            <ReportOverview query={query} filters={values} />
          ) : mode === "trends" ? (
            <PerformanceTrendsReport key={query} query={query} />
          ) : mode === "explorer" ? (
            <TradeExplorer key={query} query={query} />
          ) : mode === "compare" ? (
            <Comparison key={query} initial={values} />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="flex flex-wrap gap-3">
                      <DimensionSelect label={t("groupBy")} value={primary} onChange={setPrimary} />
                      {mode === "cross" && (
                        <DimensionSelect
                          label={t("thenBy")}
                          value={secondary}
                          onChange={setSecondary}
                        />
                      )}
                    </div>
                    {data && !multi && (
                      <ReviewExport
                        containsFinancialData
                        document={{
                          title:
                            mode === "cross"
                              ? t("exportCrossTitle", {
                                  primary: t(`dimension.${primary}`),
                                  secondary: t(`dimension.${secondary}`),
                                })
                              : t("exportDimensionTitle", { dimension: t(`dimension.${primary}`) }),
                          subtitle: t("exportSubtitle", {
                            timeZone: data.timeZone,
                            currency: data.currencies[0] ?? t("accountCurrencyTitle"),
                          }),
                          lines: [
                            t("exportFilters", {
                              filters: describeFilters(values, data.accounts, data.playbooks),
                            }),
                            t("exportSummary", {
                              trades: data.summary.trades,
                              pnl: number(data.summary.netPnl),
                              winRate: percent(data.summary.winRate),
                            }),
                            "",
                            ...data.groups.map((g) =>
                              t("exportGroupLine", {
                                group: `${displayKey(data, primary, g.row)}${g.column ? ` / ${displayKey(data, secondary, g.column)}` : ""}`,
                                trades: g.trades,
                                pnl: number(g.netPnl),
                                win: percent(g.winRate),
                                planned: number(g.avgPlannedR),
                                realized: number(g.avgRealizedR),
                                volume: number(g.volume),
                                duration: fmtDurationLocalized(g.avgDurationMs, tControls),
                              }),
                            ),
                          ],
                        }}
                      />
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {error ? (
                    <p role="alert" className="text-destructive">
                      {formatApiError(tRoot, errorInfo ?? error)}
                    </p>
                  ) : loading ? (
                    <p className="text-sm text-muted-foreground">{t("loadingReport")}</p>
                  ) : multi ? (
                    <p className="text-sm">
                      {t("multiCurrency", {
                        currencies: data ? data.currencies.join(", ") : "",
                      })}
                    </p>
                  ) : data ? (
                    <Summary data={data} />
                  ) : null}
                </CardContent>
              </Card>
              {data && !multi && !loading && (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {mode === "cross"
                        ? t("crossTitle", {
                            primary: t(`dimension.${primary}`),
                            secondary: t(`dimension.${secondary}`),
                          })
                        : t("byTitle", { dimension: t(`dimension.${primary}`).toLowerCase() })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Breakdown
                      data={data}
                      cross={mode === "cross"}
                      primary={primary}
                      secondary={secondary}
                    />
                  </CardContent>
                </Card>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("footnote", { timeZone: data?.timeZone ?? t("journalTimezone") })}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
function Comparison({ initial }: { initial: AnalysisFilters }) {
  const t = useTranslations("reports");
  const tControls = useTranslations("controls");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tRoot = useTranslations();
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const privateMode = usePrivacy();
  const [a, setA] = useState<AnalysisFilters>({ ...initial, direction: "long" }),
    [b, setB] = useState<AnalysisFilters>({ ...initial, direction: "short" }),
    [nameA, setNameA] = useState(t("compare.longTrades")),
    [nameB, setNameB] = useState(t("compare.shortTrades")),
    [editing, setEditing] = useState<"a" | "b" | null>(null),
    [draft, setDraft] = useState<AnalysisFilters>({});
  const aa = useApi<Analysis>(`/api/analysis?${new URLSearchParams(a).toString()}`),
    bb = useApi<Analysis>(`/api/analysis?${new URLSearchParams(b).toString()}`);
  const currencies = new Set([...(aa.data?.currencies ?? []), ...(bb.data?.currencies ?? [])]),
    multi = currencies.size > 1;
  const number = (n: number | null) =>
    n === null ? "-" : n.toLocaleString(tag, { maximumFractionDigits: 2 });
  const percent = (n: number | null) => fmtPercent(n, 1, tag);
  const money = (n: number, currency: string) => `${number(n)} ${currency}`;
  const metricLines = (name: string, d: Analysis) => [
    name,
    t("compare.exportMetricTrades", {
      trades: d.summary.trades,
      pnl: number(d.summary.netPnl),
      currency: d.currencies[0] ?? "",
    }),
    t("compare.exportMetricRates", {
      winRate: percent(d.summary.winRate),
      planned: number(d.summary.avgPlannedR),
      realized: number(d.summary.avgRealizedR),
    }),
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("compare.intro")}</p>
      {multi && (
        <p role="alert" className="rounded-md border p-3 text-sm">
          {t("compare.currencyWarning")}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {(
          [
            { key: "a", name: nameA, setName: setNameA, filters: a, result: aa },
            { key: "b", name: nameB, setName: setNameB, filters: b, result: bb },
          ] as const
        ).map((group) => (
          <Card key={group.key}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  aria-label={t("compare.nameAria", { group: group.key.toUpperCase() })}
                  className={`${fieldClass} min-w-32 flex-1 font-semibold`}
                  value={group.name}
                  onChange={(e) =>
                    group.key === "a" ? setNameA(e.target.value) : setNameB(e.target.value)
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraft({ ...group.filters });
                    setEditing(group.key);
                  }}
                >
                  {t("compare.editFilters")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground break-words">
                {describeFilters(
                  group.filters,
                  group.result.data?.accounts,
                  group.result.data?.playbooks,
                  privateMode,
                )}
              </p>
            </CardHeader>
            <CardContent>
              {group.result.error ? (
                <p role="alert" className="text-destructive">
                  {formatApiError(tRoot, group.result.errorInfo ?? group.result.error)}
                </p>
              ) : group.result.loading ? (
                <p>{t("loading")}</p>
              ) : group.result.data && !multi ? (
                <Summary data={group.result.data} />
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      {aa.data && bb.data && !aa.loading && !bb.loading && !multi && (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <p className="text-sm">
              {t.rich("compare.difference", {
                b: nameB,
                a: nameA,
                amount: money(
                  bb.data.summary.netPnl - aa.data.summary.netPnl,
                  [...currencies][0] ?? "USD",
                ),
                trades: number(bb.data.summary.trades - aa.data.summary.trades),
                strong: (chunks) => (
                  <strong>
                    <MonetaryValue>{chunks}</MonetaryValue>
                  </strong>
                ),
              })}
            </p>
            <ReviewExport
              containsFinancialData
              document={{
                title: t("compare.exportTitle", { a: nameA, b: nameB }),
                lines: [
                  t("compare.exportGroupA", {
                    filters: describeFilters(a, aa.data.accounts, aa.data.playbooks),
                  }),
                  t("compare.exportGroupB", {
                    filters: describeFilters(b, bb.data.accounts, bb.data.playbooks),
                  }),
                  "",
                  ...metricLines(nameA, aa.data),
                  "",
                  ...metricLines(nameB, bb.data),
                ],
              }}
            />
          </CardContent>
        </Card>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(v) => {
          if (!v) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {t("compare.groupFiltersTitle", { group: editing?.toUpperCase() ?? "" })}
            </DialogTitle>
          </DialogHeader>
          <FilterFields value={draft} onChange={setDraft} />
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setDraft({})}>
              {tControls("clear")}
            </Button>
            <Button
              onClick={() => {
                if (editing === "a") setA(draft);
                else setB(draft);
                setEditing(null);
              }}
            >
              {t("compare.applyToGroup")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
