"use client";
import { OptionSelect } from "@/components/ui/option-select";

import { HoverHint } from "@/components/ui/tooltip";
import { Suspense, useState } from "react";
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
import { useApi } from "@/lib/use-api";
import { describeFilters } from "@/lib/filter-description";
import { fmtDuration } from "@/lib/utils";
const TradeExplorer = dynamic(
  () => import("@/components/trade-explorer").then((module) => module.TradeExplorer),
  {
    loading: () => (
      <p role="status" className="py-6 text-sm text-muted-foreground">
        Loading trade explorer…
      </p>
    ),
  },
);
const PerformanceTrendsReport = dynamic(
  () => import("@/components/performance-trends").then((module) => module.PerformanceTrendsReport),
  {
    loading: () => (
      <p role="status" className="py-6 text-sm text-muted-foreground">
        Loading performance trends…
      </p>
    ),
  },
);
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
const number = (n: number | null) =>
  n === null ? "-" : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const percent = (n: number | null) => (n === null ? "-" : `${(n * 100).toFixed(1)}%`);
const money = (n: number, currency: string) => `${number(n)} ${currency}`;
function Summary({ data }: { data: Analysis }) {
  const s = data.summary;
  return (
    <div className="report-summary">
      <div className="report-summary-grid grid grid-cols-2 gap-4">
        {[
          ["Closed trades", String(s.trades)],
          ["Net P&L", money(s.netPnl, data.currencies[0] ?? "USD")],
          ["Win rate", percent(s.winRate)],
          ["Profit factor", s.noLosses ? "∞" : number(s.profitFactor)],
          ["Entry volume", number(s.volume)],
          ["Avg holding time", fmtDuration(s.avgDurationMs)],
          ["Avg planned R", number(s.avgPlannedR)],
          ["Avg realized R", number(s.avgRealizedR)],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 break-words text-base font-semibold tabular-nums sm:text-lg">
              {label === "Net P&L" ? <MonetaryValue>{value}</MonetaryValue> : value}
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
  return (
    <Field label={label}>
      <OptionSelect
        className={fieldClass}
        value={value}
        onValueChange={(next) => onChange(next as Dimension)}
      >
        {Object.entries(DIMENSIONS).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
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
  const rowLabel = (k: string) => (primary === "playbook" ? labels(data, k) : k),
    colLabel = (k: string) => (secondary === "playbook" ? labels(data, k) : k);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const rows = [...new Set(data.groups.map((g) => g.row))],
    columns = [...new Set(data.groups.map((g) => g.column))].sort((a, b) =>
      secondary === "weekday"
        ? weekdays.indexOf(a) - weekdays.indexOf(b)
        : a.localeCompare(b, undefined, { numeric: true }),
    );
  if (primary === "weekday") rows.sort((a, b) => weekdays.indexOf(a) - weekdays.indexOf(b));
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
                  {DIMENSIONS[primary]} / {DIMENSIONS[secondary]}
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
                          g ? `${g.trades} trades · Win rate ${percent(g.winRate)}` : "No trades"
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
            Cell values are net P&L in {data.currencies[0] ?? "account currency"}.
          </p>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              {[
                DIMENSIONS[primary],
                ...(cross ? [DIMENSIONS[secondary]] : []),
                "Trades",
                "Win %",
                "Net P&L",
                "Entry volume",
                "Avg planned R",
                "Avg realized R",
                "Avg duration",
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
                <td className="whitespace-nowrap px-3">{fmtDuration(g.avgDurationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.groups.length && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No closed trades match these filters.
        </p>
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
  const { query, values } = useFilters();
  const [mode, setMode] = useState<
      "overview" | "trends" | "explorer" | "breakdown" | "cross" | "compare"
    >("overview"),
    [primary, setPrimary] = useState<Dimension>("symbol"),
    [secondary, setSecondary] = useState<Dimension>("weekday");
  const { data, error, loading } = useApi<Analysis>(
    mode === "breakdown" || mode === "cross"
      ? `/api/analysis?${query}&primary=${primary}${mode === "cross" ? `&secondary=${secondary}` : ""}`
      : null,
  );
  const multi = (data?.currencies.length ?? 0) > 1;
  return (
    <div>
      <FilterBar title="Reports" />
      <div className="space-y-4 p-4">
        <AskJournal />
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["overview", "Overview"],
              ["trends", "Performance trends"],
              ["explorer", "Trade explorer"],
              ["breakdown", "Breakdowns"],
              ["cross", "Cross-analysis"],
              ["compare", "Compare groups"],
            ] as const
          ).map(([key, name]) => (
            <Button
              key={key}
              size="sm"
              variant={mode === key ? "default" : "outline"}
              aria-pressed={mode === key}
              onClick={() => setMode(key)}
            >
              {name}
            </Button>
          ))}
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
                      <DimensionSelect label="Group by" value={primary} onChange={setPrimary} />
                      {mode === "cross" && (
                        <DimensionSelect
                          label="Then by"
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
                              ? `${DIMENSIONS[primary]} by ${DIMENSIONS[secondary]}`
                              : `${DIMENSIONS[primary]} performance`,
                          subtitle: `${data.timeZone} · ${data.currencies[0] ?? "Account currency"}`,
                          lines: [
                            `Filters: ${describeFilters(values, data.accounts, data.playbooks)}`,
                            `Closed trades: ${data.summary.trades} | Net P&L: ${number(data.summary.netPnl)} | Win rate: ${percent(data.summary.winRate)}`,
                            "",
                            ...data.groups.map(
                              (g) =>
                                `${labels(data, g.row)}${g.column ? ` / ${labels(data, g.column)}` : ""}: ${g.trades} trades | P&L ${number(g.netPnl)} | Win ${percent(g.winRate)} | Planned ${number(g.avgPlannedR)}R | Realized ${number(g.avgRealizedR)}R | Volume ${number(g.volume)} | Holding time ${fmtDuration(g.avgDurationMs)}`,
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
                      {error}
                    </p>
                  ) : loading ? (
                    <p className="text-sm text-muted-foreground">Loading report…</p>
                  ) : multi ? (
                    <p className="text-sm">
                      These accounts use different currencies ({data?.currencies.join(", ")}).
                      Select accounts with the same currency in Filters to compare monetary results.
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
                        ? `${DIMENSIONS[primary]} × ${DIMENSIONS[secondary]}`
                        : `Performance by ${DIMENSIONS[primary].toLowerCase()}`}
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
                Closed trades only. Dates use the closing day; weekday and entry time use the
                opening time in {data?.timeZone ?? "your journal timezone"}. Volume is total entry
                quantity. R uses weighted entry and total entry quantity; missing or invalid risk
                inputs are excluded from R averages. Derivatives require a configured multiplier for
                realized R. Multiple tags or mistakes can place a trade in more than one group, so
                those group totals can overlap.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
function Comparison({ initial }: { initial: AnalysisFilters }) {
  const privateMode = usePrivacy();
  const [a, setA] = useState<AnalysisFilters>({ ...initial, direction: "long" }),
    [b, setB] = useState<AnalysisFilters>({ ...initial, direction: "short" }),
    [nameA, setNameA] = useState("Long trades"),
    [nameB, setNameB] = useState("Short trades"),
    [editing, setEditing] = useState<"a" | "b" | null>(null),
    [draft, setDraft] = useState<AnalysisFilters>({});
  const aa = useApi<Analysis>(`/api/analysis?${new URLSearchParams(a).toString()}`),
    bb = useApi<Analysis>(`/api/analysis?${new URLSearchParams(b).toString()}`);
  const currencies = new Set([...(aa.data?.currencies ?? []), ...(bb.data?.currencies ?? [])]),
    multi = currencies.size > 1;
  const metricLines = (name: string, d: Analysis) => [
    name,
    `Trades: ${d.summary.trades} | P&L: ${number(d.summary.netPnl)} ${d.currencies[0] ?? ""}`,
    `Win rate: ${percent(d.summary.winRate)} | Planned R: ${number(d.summary.avgPlannedR)} | Realized R: ${number(d.summary.avgRealizedR)}`,
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each group has its own filters. Compare strategies, accounts, periods, or trade
        characteristics. Groups may overlap.
      </p>
      {multi && (
        <p role="alert" className="rounded-md border p-3 text-sm">
          Select accounts with the same currency in both groups. Currency conversion is not applied.
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
                  aria-label={`Group ${group.key.toUpperCase()} name`}
                  className={`${fieldClass} min-w-32 flex-1 font-semibold`}
                  value={group.name}
                  onChange={(e) => group.setName(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraft({ ...group.filters });
                    setEditing(group.key);
                  }}
                >
                  Edit filters
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
                  {group.result.error}
                </p>
              ) : group.result.loading ? (
                <p>Loading…</p>
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
              {nameB} minus {nameA}:{" "}
              <strong>
                <MonetaryValue>
                  {money(
                    bb.data.summary.netPnl - aa.data.summary.netPnl,
                    [...currencies][0] ?? "USD",
                  )}
                </MonetaryValue>
              </strong>{" "}
              net P&L · {number(bb.data.summary.trades - aa.data.summary.trades)} trades
            </p>
            <ReviewExport
              containsFinancialData
              document={{
                title: `${nameA} vs ${nameB}`,
                lines: [
                  `Group A: ${describeFilters(a, aa.data.accounts, aa.data.playbooks)}`,
                  `Group B: ${describeFilters(b, bb.data.accounts, bb.data.playbooks)}`,
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
            <DialogTitle>Group {editing?.toUpperCase()} filters</DialogTitle>
          </DialogHeader>
          <FilterFields value={draft} onChange={setDraft} />
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setDraft({})}>
              Clear
            </Button>
            <Button
              onClick={() => {
                if (editing === "a") setA(draft);
                else setB(draft);
                setEditing(null);
              }}
            >
              Apply to group
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
