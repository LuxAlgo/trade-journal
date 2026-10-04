"use client";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock3,
  Landmark,
  Plus,
  Download,
  Upload,
} from "lucide-react";
import { FilterBar } from "./filter-bar";
import { Field } from "./filter-fields";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { OptionSelect } from "./ui/option-select";
import { DatePicker } from "./ui/date-picker";
import { EquityArea } from "./charts/equity-area";
import { usePrivacy } from "./privacy";
import { formatApiError } from "@/lib/api-error";
import { useApi } from "@/lib/use-api";
import { formatLocale, type Locale } from "@/i18n/config";
import { fmtPercent } from "@/lib/utils";
import { PropCashSummary, PropCashComparison } from "./prop-cash-overview";
import { createPropDemo } from "@/lib/prop-demo";
import { PropFirmModal, type PropModal } from "./prop-firm-forms";
import {
  cashMovements,
  cashSummary,
  cashTimeline,
  payoutProgress,
  propMoney,
  currencyDigits,
  fromMinor,
  label,
  type PropData,
  type PropEntry,
  type CashMovement,
  type PropReceipt,
} from "@/lib/prop-firms";
const PAGE_SIZE = 40;
const inDates = (day: string, from: string, to: string) =>
  (!from || day >= from) && (!to || day <= to);
function downloadCsv(rows: CashMovement[]) {
  const cell = (value: string) => {
    const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const header = "id,entry_id,account_id,firm,currency,date,kind,amount,category,reference";
  const csv = [
    header,
    ...rows.map((row) =>
      [
        row.id,
        row.entryId,
        row.accountId ?? "",
        row.firm,
        row.currency,
        row.date,
        row.kind,
        fromMinor(row.amountMinor, row.currency),
        row.category,
        row.reference,
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "prop-cash-flows.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}
export function PropFirmTracker() {
  const t = useTranslations("prop-firms");
  const tEnum = useTranslations("enums");
  const locale = useLocale() as Locale;
  const tag = formatLocale(locale);
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const {
    data: savedData,
    error,
    errorInfo,
    loading,
    refresh,
  } = useApi<PropData>("/api/prop-firms");
  const [demo, setDemo] = useState<PropData | null>(null);
  const [showBreakdowns, setShowBreakdowns] = useState(false);
  const data = demo ?? savedData;
  const privacy = usePrivacy();
  const [tab, setTab] = useState("overview"),
    [firm, setFirm] = useState(""),
    [accountId, setAccountId] = useState(""),
    [currency, setCurrency] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [search, setSearch] = useState(""),
    [showArchived, setShowArchived] = useState(false),
    [showVoided, setShowVoided] = useState(false),
    [page, setPage] = useState(0),
    [modal, setModal] = useState<PropModal | null>(null);
  useEffect(
    () => setPage(0),
    [tab, firm, accountId, currency, from, to, search, showArchived, showVoided],
  );
  useEffect(() => {
    if (privacy) setModal(null);
  }, [privacy]);
  const readOnly = privacy || Boolean(demo);
  const switchDemo = () => {
    setDemo(
      demo ? null : createPropDemo(savedData?.today ?? new Date().toISOString().slice(0, 10)),
    );
    setModal(null);
    setFirm("");
    setAccountId("");
    setCurrency(demo ? "" : "USD");
    setFrom("");
    setTo("");
    setSearch("");
    setPage(0);
    setShowArchived(false);
    setShowVoided(false);
    setTab("overview");
  };
  const allCash = useMemo(() => (data ? cashMovements(data.entries, data.receipts) : []), [data]);
  const payouts = useMemo(
    () => (data ? payoutProgress(data.entries, data.receipts, data.today) : []),
    [data],
  );
  const payoutById = useMemo(() => new Map(payouts.map((row) => [row.entry.id, row])), [payouts]);
  const receiptsById = useMemo(() => {
    const map = new Map<string, PropReceipt[]>();
    for (const row of data?.receipts ?? []) {
      const list = map.get(row.payoutId) ?? [];
      list.push(row);
      map.set(row.payoutId, list);
    }
    return map;
  }, [data]);
  const firms = useMemo(
    () =>
      [
        ...new Set([
          ...(data?.accounts.map((a) => a.firm) ?? []),
          ...(data?.entries.map((e) => e.firm) ?? []),
        ]),
      ].sort(),
    [data],
  );
  const currencies = useMemo(
    () =>
      [
        ...new Set([
          ...(data?.accounts.map((a) => a.currency) ?? []),
          ...(data?.entries.map((e) => e.currency) ?? []),
        ]),
      ].sort(),
    [data],
  );
  const selectedCurrency = currency || (currencies.length === 1 ? currencies[0]! : "");
  const matches = (row: { firm: string; accountId: string | null; currency: string }) =>
    (!firm || row.firm === firm) &&
    (!accountId || row.accountId === accountId) &&
    (!currency || row.currency === currency);
  const cash = useMemo(
    () => allCash.filter((row) => matches(row) && inDates(row.date, from, to)),
    [allCash, firm, accountId, currency, from, to],
  );
  const summaryCash = useMemo(
    () => cash.filter((row) => row.currency === selectedCurrency),
    [cash, selectedCurrency],
  );
  const summary = useMemo(() => cashSummary(summaryCash), [summaryCash]);
  const selectedPayouts = payouts.filter((row) => matches(row.entry));
  const outstanding = selectedPayouts
    .filter((row) => row.entry.currency === selectedCurrency)
    .reduce((sum, row) => sum + row.remaining, 0);
  const overdue = selectedPayouts.filter((row) => row.overdue);
  const accountRows = (data?.accounts ?? []).filter((a) => matches({ ...a, accountId: a.id }));
  const active = accountRows.filter((a) => a.status === "active" && !a.archived);
  const resolved = accountRows.filter(
    (a) =>
      ["evaluation", "verification"].includes(a.program) &&
      ["passed", "breached"].includes(a.status),
  );
  const passed = resolved.filter((a) => a.status === "passed").length;
  const renewals = active
    .filter(
      (a) =>
        a.renewalOn &&
        a.renewalOn <=
          new Date(Date.parse(`${data?.today}T12:00:00Z`) + 30 * 86_400_000)
            .toISOString()
            .slice(0, 10),
    )
    .sort((a, b) => a.renewalOn!.localeCompare(b.renewalOn!));
  const money = (amount: number, code = selectedCurrency) =>
    privacy ? "••••" : code ? propMoney(amount, code, tag) : "—";
  const name = (id: string | null) =>
    data?.accounts.find((a) => a.id === id)?.name ?? t("accounts.sharedCost");
  const query = search.toLowerCase().trim();
  const entries = (data?.entries ?? [])
    .filter(
      (e) =>
        matches(e) &&
        (showVoided || !e.voided) &&
        inDates(e.occurredOn, from, to) &&
        (!query ||
          `${e.firm} ${name(e.accountId)} ${e.kind} ${e.category} ${e.reference}`
            .toLowerCase()
            .includes(query)),
    )
    .sort(
      (a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt),
    );
  const listedPayouts = selectedPayouts
    .filter(
      (row) =>
        (row.entry.status === "requested" ||
          row.entry.status === "approved" ||
          inDates(row.entry.occurredOn, from, to)) &&
        (!query ||
          `${row.entry.firm} ${name(row.entry.accountId)} ${row.entry.status} ${row.entry.reference}`
            .toLowerCase()
            .includes(query)),
    )
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        b.entry.occurredOn.localeCompare(a.entry.occurredOn),
    );
  const listedAccounts = accountRows.filter(
    (a) =>
      (showArchived || !a.archived) &&
      (!query || `${a.firm} ${a.name} ${a.program} ${a.status}`.toLowerCase().includes(query)),
  );
  const cashByAccount = useMemo(() => {
    const groups = new Map<string, CashMovement[]>();
    for (const row of cash) {
      const key = row.accountId ?? "";
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    return groups;
  }, [cash]);
  const byFirm = [...new Set(summaryCash.map((row) => row.firm))]
    .map((value) => ({
      firm: value,
      ...cashSummary(summaryCash.filter((row) => row.firm === value)),
    }))
    .sort((a, b) => b.net - a.net);
  const byCategory = EXPENSE_ROWS(summaryCash);
  const months = [...new Set(summaryCash.map((row) => row.date.slice(0, 7)))]
    .sort()
    .reverse()
    .map((month) => ({
      month,
      ...cashSummary(summaryCash.filter((row) => row.date.startsWith(month))),
    }));
  const rowCount =
    tab === "accounts"
      ? listedAccounts.length
      : tab === "payouts"
        ? listedPayouts.length
        : entries.length;
  const safePage = Math.min(page, Math.max(0, Math.ceil(rowCount / PAGE_SIZE) - 1));
  const slice = <T,>(rows: T[]) => rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const entryActions = (entry: PropEntry) => (
    <div className="flex flex-wrap gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={readOnly}
        onClick={() => setModal({ kind: "detail", type: "entry", id: entry.id })}
      >
        {t("actions.details")}
      </Button>
      {!entry.voided && (
        <Button
          size="sm"
          variant="ghost"
          disabled={readOnly}
          onClick={() => setModal({ kind: "entry", entry, type: entry.kind })}
        >
          {t("actions.edit")}
        </Button>
      )}
      {!entry.voided && entry.kind === "expense" && (
        <Button
          size="sm"
          variant="ghost"
          disabled={readOnly}
          onClick={() => setModal({ kind: "entry", type: "refund", expense: entry })}
        >
          {t("actions.refund")}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={readOnly}
        onClick={() =>
          setModal({
            kind: "change",
            action: "entry.void",
            id: entry.id,
            revision: entry.revision,
            value: !entry.voided,
            name: entry.voided ? t("actions.restoreEntry") : t("actions.voidEntry"),
          })
        }
      >
        {entry.voided ? t("actions.restore") : t("actions.void")}
      </Button>
    </div>
  );
  return (
    <div>
      <FilterBar
        title={t("title")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!data || readOnly}
              onClick={() => setModal({ kind: "account" })}
            >
              <Plus className="h-4 w-4" />
              {t("actions.trackAccount")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!data || readOnly}
              onClick={() => setModal({ kind: "entry", type: "expense" })}
            >
              <ArrowUpRight className="h-4 w-4" />
              {t("actions.addExpense")}
            </Button>
            <Button
              size="sm"
              disabled={!data || readOnly}
              onClick={() => setModal({ kind: "entry", type: "payout" })}
            >
              <ArrowDownLeft className="h-4 w-4" />
              {t("actions.trackPayout")}
            </Button>
          </div>
        }
      />
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("header.heading")}</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("header.subheading")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={switchDemo}>
              {demo ? t("actions.exitDemo") : t("actions.loadDemo")}
            </Button>
            <details className="relative">
              <summary className="cursor-pointer rounded-md border px-3 py-2 text-xs font-medium">
                {t("header.dataTools")}
              </summary>
              <div className="absolute right-0 z-20 mt-2 flex w-48 flex-col gap-1 rounded-lg border bg-card p-2 shadow-lg">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!data || readOnly}
                  onClick={() => setModal({ kind: "import" })}
                >
                  <Upload className="h-4 w-4" />
                  {t("actions.importCsv")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!cash.length || readOnly}
                  onClick={() => downloadCsv(cash)}
                >
                  <Download className="h-4 w-4" />
                  {t("actions.exportCsv")}
                </Button>
              </div>
            </details>
          </div>
        </div>
        {demo && (
          <div
            role="status"
            className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm"
          >
            <span className="font-medium">{t("header.demoPreview")}</span>
            <span className="ml-2 text-muted-foreground">{t("header.demoNote")}</span>
          </div>
        )}
        {privacy && (
          <p className="rounded-lg border p-3 text-sm text-muted-foreground">
            {t("header.privacyNotice")}
          </p>
        )}
        {error && !demo && (
          <p
            role="alert"
            className="rounded-lg border border-destructive p-3 text-sm text-destructive"
          >
            {formatApiError(tErrors, errorInfo ?? error)}{" "}
            <Button variant="ghost" onClick={refresh}>
              {t("actions.retry")}
            </Button>
          </p>
        )}
        {loading && !data && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("header.loading")}
          </p>
        )}
        {data && (
          <>
            {!data.accounts.length && !data.entries.length && (
              <Card>
                <CardContent className="flex flex-wrap items-center gap-5 py-7">
                  <Landmark className="h-10 w-10 text-muted-foreground" />
                  <div className="max-w-2xl">
                    <h3 className="font-semibold">{t("empty.startTitle")}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{t("empty.startBody")}</p>
                  </div>
                </CardContent>
              </Card>
            )}
            <details className="rounded-xl border bg-card">
              <summary className="cursor-pointer px-4 py-3 text-sm">
                <span className="font-medium">{t("filters.toggle")}</span>
                <span className="ml-3 text-xs text-muted-foreground">
                  {firm || t("filters.allFirms")} ·{" "}
                  {accountId ? name(accountId) : t("filters.allAccounts")} ·{" "}
                  {from || to
                    ? t("filters.range", {
                        from: from || t("filters.start"),
                        to: to || t("filters.today"),
                      })
                    : t("filters.allDates")}
                  {selectedCurrency
                    ? ` · ${selectedCurrency}`
                    : ` · ${t("filters.chooseCurrency")}`}
                </span>
              </summary>
              <div className="grid gap-3 border-t p-4 sm:grid-cols-2 xl:grid-cols-5">
                <Field label={t("filters.firm")}>
                  <OptionSelect
                    value={firm}
                    onValueChange={(value) => {
                      setFirm(value);
                      setAccountId("");
                    }}
                  >
                    <option value="">{t("filters.allFirms")}</option>
                    {firms.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </OptionSelect>
                </Field>
                <Field label={t("filters.account")}>
                  <OptionSelect value={accountId} onValueChange={setAccountId}>
                    <option value="">{t("filters.allAccounts")}</option>
                    {data.accounts
                      .filter((a) => !firm || a.firm === firm)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                          {a.archived ? ` (${t("filters.archived")})` : ""}
                        </option>
                      ))}
                  </OptionSelect>
                </Field>
                <Field label={t("filters.currency")}>
                  <OptionSelect value={currency} onValueChange={setCurrency}>
                    <option value="">
                      {currencies.length > 1
                        ? t("filters.chooseCurrencyTotals")
                        : t("filters.allCurrencies")}
                    </option>
                    {currencies.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </OptionSelect>
                </Field>
                <Field label={t("filters.from")}>
                  <DatePicker
                    label={t("filters.fromDate")}
                    value={from}
                    max={to || data.today}
                    onValueChange={setFrom}
                  />
                </Field>
                <Field label={t("filters.through")}>
                  <DatePicker
                    label={t("filters.throughDate")}
                    value={to}
                    min={from}
                    max={data.today}
                    onValueChange={setTo}
                  />
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2 xl:col-span-5">
                  <p className="text-xs text-muted-foreground">{t("filters.datesNote")}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFirm("");
                      setAccountId("");
                      setCurrency("");
                      setFrom("");
                      setTo("");
                      setSearch("");
                    }}
                  >
                    {t("actions.clearFilters")}
                  </Button>
                </div>
              </div>
            </details>
            {from && to && from > to && (
              <p role="alert" className="text-sm text-destructive">
                {t("filters.dateOrderError")}
              </p>
            )}
            {currencies.length > 1 && !selectedCurrency && (
              <Card>
                <CardContent className="py-4">
                  <p className="mb-3 text-sm">{t("summary.mixedCurrencies")}</p>
                  <div className="flex flex-wrap gap-4">
                    {currencies.map((c) => (
                      <p key={c} className="text-sm">
                        <strong>{c}</strong> · {t("summary.netCash")}{" "}
                        {money(cashSummary(cash.filter((r) => r.currency === c)).net, c)}
                      </p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            <PropCashSummary summary={summary} currency={selectedCurrency} privacy={privacy} />
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="text-muted-foreground">{t("summary.awaitingPayout")}</span>
                <strong className="tabular-nums">{money(outstanding)}</strong>
                <span className="text-xs text-muted-foreground">
                  {overdue.length ? t("summary.overdueSuffix", { count: overdue.length }) : ""}
                  {t("summary.awaitingNote")}
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setTab("payouts")}>
                {t("actions.viewPayouts")}
              </Button>
            </div>
            <div
              role="tablist"
              aria-label={t("tabs.sectionsLabel")}
              className="flex gap-2 overflow-x-auto"
            >
              {["overview", "accounts", "payouts", "ledger"].map((v) => (
                <Button
                  key={v}
                  role="tab"
                  aria-selected={tab === v}
                  variant={tab === v ? "secondary" : "outline"}
                  onClick={() => setTab(v)}
                >
                  {v === "ledger"
                    ? t("tabs.ledger")
                    : v === "overview"
                      ? t("tabs.overview")
                      : v === "accounts"
                        ? t("tabs.accounts")
                        : t("tabs.payouts")}
                </Button>
              ))}
            </div>
            {tab === "overview" ? (
              <div className="space-y-4">
                <PropCashComparison months={months} currency={selectedCurrency} privacy={privacy} />
                <details
                  className="rounded-xl border bg-card"
                  open={showBreakdowns}
                  onToggle={(event) => setShowBreakdowns(event.currentTarget.open)}
                >
                  <summary className="cursor-pointer p-4">
                    <span className="text-sm font-medium">{t("breakdown.toggle")}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t("breakdown.toggleNote")}
                    </span>
                  </summary>
                  {showBreakdowns && (
                    <div className="space-y-4 border-t p-3 sm:p-4">
                      <div className="grid gap-4 xl:grid-cols-3">
                        <Card className="xl:col-span-2">
                          <CardHeader>
                            <CardTitle>
                              {t("breakdown.netCashOverTime")}
                              {selectedCurrency ? ` · ${selectedCurrency}` : ""}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            {privacy ? (
                              <Empty>{t("breakdown.chartHidden")}</Empty>
                            ) : !selectedCurrency ? (
                              <Empty>{t("breakdown.chooseCurrencyChart")}</Empty>
                            ) : summaryCash.length ? (
                              <EquityArea
                                curve="stepAfter"
                                currency={selectedCurrency}
                                valueLabel={t("breakdown.valueLabel")}
                                data={cashTimeline(summaryCash).map((p) => ({
                                  t: p.date,
                                  cumNetPnl: p.net / 10 ** currencyDigits(selectedCurrency),
                                }))}
                              />
                            ) : (
                              <Empty>{t("breakdown.buildHistory")}</Empty>
                            )}
                            <p className="mt-3 text-xs text-muted-foreground">
                              {t("breakdown.chartNote")}
                            </p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader>
                            <CardTitle>{t("breakdown.progressTitle")}</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="flex justify-between text-sm">
                              <span>{t("breakdown.activeEvals")}</span>
                              <strong>
                                {
                                  active.filter((a) =>
                                    ["evaluation", "verification"].includes(a.program),
                                  ).length
                                }
                              </strong>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span>{t("breakdown.activeFunded")}</span>
                              <strong>
                                {
                                  active.filter((a) =>
                                    ["funded", "instant_funded", "live"].includes(a.program),
                                  ).length
                                }
                              </strong>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span>{t("breakdown.passRate")}</span>
                              <strong>
                                {resolved.length
                                  ? fmtPercent(passed / resolved.length, 0, tag)
                                  : "—"}
                              </strong>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {t("breakdown.passRateNote", {
                                passed,
                                total: resolved.length,
                              })}
                            </p>
                            <p className="border-t pt-4 text-xs text-muted-foreground">
                              {t("breakdown.progressNote")}
                            </p>
                          </CardContent>
                        </Card>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card>
                          <CardHeader>
                            <CardTitle>
                              {t("breakdown.byFirmTitle")}
                              {selectedCurrency ? ` · ${selectedCurrency}` : ""}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            {byFirm.length ? (
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                  <thead>
                                    <tr className="border-b text-xs text-muted-foreground">
                                      <th className="py-2">{t("breakdown.thFirm")}</th>
                                      <th>{t("breakdown.thNetSpend")}</th>
                                      <th>{t("breakdown.thPayoutCash")}</th>
                                      <th>{t("breakdown.thNetReturn")}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {byFirm.map((row) => (
                                      <tr key={row.firm} className="border-b last:border-0">
                                        <td className="py-3 pr-3">{row.firm}</td>
                                        <td className="pr-3">{money(row.netSpend)}</td>
                                        <td className="pr-3">{money(row.received)}</td>
                                        <td>{money(row.net)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <Empty>{t("breakdown.noMovements")}</Empty>
                            )}
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader>
                            <CardTitle>{t("breakdown.breakdownTitle")}</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {byCategory.length ? (
                              byCategory.map((row) => (
                                <div key={row.category}>
                                  <div className="flex justify-between gap-3 text-sm">
                                    <span>{label(row.category, tEnum)}</span>
                                    <span>{money(row.amount)}</span>
                                  </div>
                                  {!privacy && (
                                    <div className="mt-1 h-1.5 rounded-full bg-muted">
                                      <div
                                        className="h-full rounded-full bg-foreground/60"
                                        style={{
                                          width: `${summary.spent ? (row.amount / summary.spent) * 100 : 0}%`,
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              ))
                            ) : (
                              <Empty>{t("breakdown.noExpenses")}</Empty>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {t("breakdown.breakdownNote")}
                            </p>
                          </CardContent>
                        </Card>
                      </div>
                      <Card>
                        <CardHeader>
                          <CardTitle>{t("breakdown.renewalsTitle")}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {renewals.length ? (
                            <div className="space-y-3">
                              {renewals.map((a) => (
                                <div
                                  key={a.id}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                                >
                                  <div>
                                    <p className="text-sm font-medium">
                                      {a.firm} · {a.name}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {a.renewalOn} ·{" "}
                                      {a.renewalMinor === null
                                        ? t("breakdown.amountNotSet")
                                        : money(a.renewalMinor, a.currency)}
                                      {a.renewalOn! < data.today
                                        ? ` ${t("breakdown.renewalOverdue")}`
                                        : ""}
                                    </p>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={readOnly}
                                    onClick={() =>
                                      setModal({
                                        kind: "entry",
                                        type: "expense",
                                        accountId: a.id,
                                        category: "subscription",
                                      })
                                    }
                                  >
                                    {t("actions.recordCharge")}
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <Empty>{t("breakdown.noRenewals")}</Empty>
                          )}
                          <p className="mt-3 text-xs text-muted-foreground">
                            {t("breakdown.renewalsNote")}
                          </p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>{t("breakdown.monthlyTitle")}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {months.length ? (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="border-b text-xs text-muted-foreground">
                                    <th className="py-2">{t("breakdown.thMonth")}</th>
                                    <th>{t("breakdown.thSpent")}</th>
                                    <th>{t("breakdown.thRefunded")}</th>
                                    <th>{t("breakdown.thPayoutCash")}</th>
                                    <th>{t("breakdown.thNet")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {months.map((row) => (
                                    <tr key={row.month} className="border-b last:border-0">
                                      <td className="py-3">{row.month}</td>
                                      <td>{money(row.spent)}</td>
                                      <td>{money(row.refunds)}</td>
                                      <td>{money(row.received)}</td>
                                      <td>{money(row.net)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <Empty>{t("breakdown.noSettled")}</Empty>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </details>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    aria-label={t("search.label")}
                    className="max-w-sm"
                    placeholder={t("search.placeholder")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {tab === "accounts" && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(e) => setShowArchived(e.target.checked)}
                      />
                      {t("filters.showArchived")}
                    </label>
                  )}
                  {tab === "ledger" && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={showVoided}
                        onChange={(e) => setShowVoided(e.target.checked)}
                      />
                      {t("filters.showVoided")}
                    </label>
                  )}
                  <p className="ml-auto text-xs text-muted-foreground">
                    {t("filters.recordCount", { count: rowCount })}
                  </p>
                </div>
                {tab === "accounts" && (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {slice(listedAccounts).map((a) => {
                      const accountSummary = cashSummary(
                        (cashByAccount.get(a.id) ?? []).filter(
                          (row) => row.currency === a.currency,
                        ),
                      );
                      return (
                        <Card key={a.id}>
                          <CardContent className="space-y-4 py-5">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h3 className="font-semibold">{a.name}</h3>
                                <p className="text-xs text-muted-foreground">
                                  {a.firm} · {label(a.program, tEnum)}
                                  {a.sizeMinor !== null
                                    ? ` · ${money(a.sizeMinor, a.currency)} ${t("accounts.nominal")}`
                                    : ""}
                                </p>
                              </div>
                              <span className="rounded-md border px-2 py-1 text-xs">
                                {a.archived ? t("accounts.archivedPrefix") : ""}
                                {label(a.status, tEnum)}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-sm">
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  {t("breakdown.thNetSpend")}
                                </p>
                                {money(accountSummary.netSpend, a.currency)}
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  {t("breakdown.thPayoutCash")}
                                </p>
                                {money(accountSummary.received, a.currency)}
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  {t("breakdown.thNetReturn")}
                                </p>
                                {money(accountSummary.net, a.currency)}
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {t("accounts.opened", { date: a.openedOn })}
                              {a.closedOn ? t("accounts.resolvedSuffix", { date: a.closedOn }) : ""}
                              {a.parentId
                                ? t("accounts.followsSuffix", { name: name(a.parentId) })
                                : ""}
                              . {t("accounts.cashDatesNote")}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={readOnly}
                                onClick={() =>
                                  setModal({ kind: "detail", type: "account", id: a.id })
                                }
                              >
                                {t("actions.detailsReceipts")}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={readOnly}
                                onClick={() => setModal({ kind: "account", account: a })}
                              >
                                {t("actions.edit")}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={readOnly}
                                onClick={() => setModal({ kind: "account", parent: a })}
                              >
                                {t("actions.nextAttempt")}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={readOnly}
                                onClick={() =>
                                  setModal({
                                    kind: "change",
                                    action: "account.archive",
                                    id: a.id,
                                    revision: a.revision,
                                    value: !a.archived,
                                    name: a.archived
                                      ? t("actions.restoreAccount")
                                      : t("actions.archive"),
                                  })
                                }
                              >
                                {a.archived ? t("actions.restore") : t("actions.archive")}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
                {tab === "payouts" && (
                  <>
                    <p className="text-xs text-muted-foreground">{t("payouts.intro")}</p>
                    {slice(listedPayouts).map((row) => (
                      <Card key={row.entry.id}>
                        <CardContent className="space-y-4 py-5">
                          <div className="flex flex-wrap justify-between gap-3">
                            <div>
                              <h3 className="font-medium">
                                {row.entry.firm} · {name(row.entry.accountId)}
                              </h3>
                              <p className="text-xs text-muted-foreground">
                                {t("payouts.requestedPrefix", { date: row.entry.occurredOn })}
                                {row.entry.dueOn
                                  ? t("payouts.expectedSuffix", { date: row.entry.dueOn })
                                  : ""}
                              </p>
                            </div>
                            <span
                              className={`rounded-md border px-2 py-1 text-xs ${row.overdue ? "border-destructive text-destructive" : ""}`}
                            >
                              {row.overdue
                                ? t("payouts.overdueBadge")
                                : row.partial
                                  ? t("payouts.partialBadge")
                                  : ""}
                              {label(row.entry.status, tEnum)}
                            </span>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-4">
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {t("payouts.expectedNet")}
                              </p>
                              {money(row.expected, row.entry.currency)}
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {t("payouts.actualReceived")}
                              </p>
                              {money(row.actual, row.entry.currency)}
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {t("payouts.outstanding")}
                              </p>
                              {money(row.remaining, row.entry.currency)}
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {t("payouts.variance")}
                              </p>
                              {money(row.variance, row.entry.currency)}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={
                                readOnly || ["rejected", "cancelled"].includes(row.entry.status)
                              }
                              onClick={() => setModal({ kind: "receipt", payout: row.entry })}
                            >
                              {t("actions.recordReceipt")}
                            </Button>
                            {entryActions(row.entry)}
                          </div>
                          <details>
                            <summary className="cursor-pointer text-xs">
                              {t("payouts.movementsSummary", {
                                count: (receiptsById.get(row.entry.id) ?? []).length,
                              })}
                            </summary>
                            <div className="mt-2 space-y-2">
                              {(receiptsById.get(row.entry.id) ?? []).map((r) => (
                                <div
                                  key={r.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs"
                                >
                                  <span>
                                    {r.occurredOn} · {label(r.kind, tEnum)} ·{" "}
                                    {money(r.amountMinor, row.entry.currency)}
                                    {r.voided ? t("payouts.voidedSuffix") : ""}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={readOnly || row.entry.voided}
                                    onClick={() =>
                                      setModal({
                                        kind: "change",
                                        action: "receipt.void",
                                        id: r.id,
                                        payoutId: r.payoutId,
                                        revision: row.entry.revision,
                                        value: !r.voided,
                                        name: r.voided
                                          ? t("payouts.restoreMovement")
                                          : t("payouts.voidMovement"),
                                      })
                                    }
                                  >
                                    {r.voided ? t("actions.restore") : t("actions.void")}
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </details>
                        </CardContent>
                      </Card>
                    ))}
                  </>
                )}
                {tab === "ledger" && (
                  <Card>
                    <CardContent className="overflow-x-auto pt-4">
                      <p className="mb-3 text-xs text-muted-foreground">{t("ledger.intro")}</p>
                      <table className="w-full min-w-[740px] text-left text-sm">
                        <thead>
                          <tr className="border-b text-xs text-muted-foreground">
                            <th className="py-2">{t("ledger.thDate")}</th>
                            <th>{t("ledger.thFirmAccount")}</th>
                            <th>{t("ledger.thEntry")}</th>
                            <th>{t("ledger.thAmount")}</th>
                            <th>{t("ledger.thStatus")}</th>
                            <th>{t("ledger.thActions")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slice(entries).map((entry) => (
                            <tr
                              key={entry.id}
                              className={`border-b last:border-0 ${entry.voided ? "opacity-60" : ""}`}
                            >
                              <td className="py-3 pr-3">{entry.occurredOn}</td>
                              <td className="pr-3">
                                {entry.firm}
                                <p className="text-xs text-muted-foreground">
                                  {name(entry.accountId)}
                                </p>
                              </td>
                              <td className="pr-3">
                                {label(entry.kind, tEnum)}
                                <p className="text-xs text-muted-foreground">
                                  {entry.kind === "expense"
                                    ? label(entry.category, tEnum)
                                    : entry.reference}
                                </p>
                              </td>
                              <td className="pr-3 tabular-nums">
                                {money(
                                  entry.kind === "payout"
                                    ? (payoutById.get(entry.id)?.expected ?? 0)
                                    : entry.amountMinor,
                                  entry.currency,
                                )}
                                {entry.kind === "payout" && (
                                  <p className="text-xs text-muted-foreground">
                                    {t("payouts.expectedNet")}
                                  </p>
                                )}
                              </td>
                              <td>
                                {entry.voided ? t("ledger.voided") : label(entry.status, tEnum)}
                              </td>
                              <td>{entryActions(entry)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                )}
                {!rowCount && <Empty>{t("empty.noMatch")}</Empty>}
                {rowCount > PAGE_SIZE && (
                  <div className="flex items-center justify-between">
                    <Button
                      variant="outline"
                      disabled={safePage === 0}
                      onClick={() => setPage(safePage - 1)}
                    >
                      {t("actions.previous")}
                    </Button>
                    <span className="text-xs">
                      {t("pager.page", {
                        page: safePage + 1,
                        total: Math.ceil(rowCount / PAGE_SIZE),
                      })}
                    </span>
                    <Button
                      variant="outline"
                      disabled={(safePage + 1) * PAGE_SIZE >= rowCount}
                      onClick={() => setPage(safePage + 1)}
                    >
                      {t("actions.next")}
                    </Button>
                  </div>
                )}
              </div>
            )}
            <details className="rounded-xl border p-4 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium">{t("methodology.title")}</summary>
              <div className="mt-3 space-y-2">
                <p>{t("methodology.p1")}</p>
                <p>{t("methodology.p2")}</p>
                <p>{t("methodology.p3")}</p>
                <p>{t("methodology.p4")}</p>
              </div>
            </details>
          </>
        )}
        {modal && data && !readOnly && (
          <PropFirmModal modal={modal} data={data} close={() => setModal(null)} refresh={refresh} />
        )}
      </div>
    </div>
  );
}
function EXPENSE_ROWS(rows: CashMovement[]) {
  const groups = new Map<string, number>();
  for (const row of rows)
    if (row.kind === "expense")
      groups.set(row.category, (groups.get(row.category) ?? 0) + row.amountMinor);
  return [...groups]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}
