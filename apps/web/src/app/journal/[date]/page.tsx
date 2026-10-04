"use client";
import { AiRecap } from "@/components/ai-recap";

import Link from "next/link";
import { Suspense, use, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { IntradayPoint, TradeMetrics } from "@luxalgo/journal-core";
import { EquityArea } from "@/components/charts/equity-area";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { MonetaryValue } from "@/components/privacy";
import { VoiceNote } from "@/components/voice-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RichEditor, type RichEditorHandle } from "@/components/rich-editor";
import { Attachments } from "@/components/attachments";
import { ReviewExport } from "@/components/review-export";
import { formatApiError } from "@/lib/api-error";
import { formatAutosaveStatus, useAutosave } from "@/lib/use-autosave";
import { useApi } from "@/lib/use-api";
import { fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";
import { formatLocale, type Locale } from "@/i18n/config";

interface TradeRowLite {
  key: string;
  symbol: string;
  direction: string;
  status: string;
  netPnl: number;
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  fees: number;
}

interface DayPayload {
  date: string;
  metrics: TradeMetrics;
  trades: TradeRowLite[];
  intraday: IntradayPoint[];
  note: string;
}

export default function JournalDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  return (
    <Suspense>
      <JournalDay key={date} date={date} />
    </Suspense>
  );
}

function JournalDay({ date }: { date: string }) {
  const t = useTranslations("journal");
  const tEnums = useTranslations("enums");
  const tControls = useTranslations("controls");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const locale = useLocale();
  const { query, values: filters, timeZone } = useFilters();
  const { data, error, errorInfo } = useApi<DayPayload>(`/api/journal/${date}?${query}`);
  const [note, setNote] = useState<string | null>(null);
  const noteEditor = useRef<RichEditorHandle>(null);
  const { save, status: saving, saveState, flush } = useAutosave(`/api/journal/${date}`, "PUT");
  const noteValue = note ?? data?.note ?? "";
  const latestNote = useRef(noteValue);
  latestNote.current = noteValue;
  const scheduleSave = (value: string) => {
    latestNote.current = value;
    setNote(value);
    save({ note: value });
  };

  // The route parameter and stored key stay YYYY-MM-DD; only the rendered
  // title follows the interface language.
  const longDate = useMemo(
    () =>
      new Intl.DateTimeFormat(formatLocale(locale as Locale), {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${date}T00:00:00Z`)),
    [locale, date],
  );

  const m = data?.metrics;
  return (
    <div>
      <FilterBar title={t("dayTitle", { date: longDate })} />
      <div className="grid gap-3 p-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-3 xl:col-span-2">
          {m && m.closedTrades > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("dayStats")}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 2xl:grid-cols-5">
                <Stat label={t("statNetPnl")}>
                  <Pnl value={m.netPnl} className="font-semibold" />
                </Stat>
                <Stat label={t("statTrades")}>{m.closedTrades}</Stat>
                <Stat label={t("statWinrate")}>
                  {fmtPercent(m.winRate, 1, formatLocale(locale as Locale))}
                </Stat>
                <Stat label={t("statWinners")}>{m.wins}</Stat>
                <Stat label={t("statLosers")}>{m.losses}</Stat>
                <Stat label={t("statGross")}>
                  <MonetaryValue>
                    {fmtMoney(m.grossPnl, "USD", formatLocale(locale as Locale))}
                  </MonetaryValue>
                </Stat>
                <Stat label={t("statFees")}>
                  <MonetaryValue>
                    {fmtMoney(m.fees, "USD", formatLocale(locale as Locale))}
                  </MonetaryValue>
                </Stat>
                <Stat label={t("statVolume")}>
                  {fmtNumber(m.totalVolume, 0, formatLocale(locale as Locale))}
                </Stat>
                <Stat label={t("statProfitFactor")}>
                  {m.profitFactorIsInfinite
                    ? "∞"
                    : m.profitFactor === null
                      ? "–"
                      : fmtNumber(m.profitFactor, 2, formatLocale(locale as Locale))}
                </Stat>
                <Stat label={t("statExpectancy")}>
                  <MonetaryValue>
                    {m.expectancy === null
                      ? "–"
                      : fmtMoney(m.expectancy, "USD", formatLocale(locale as Locale))}
                  </MonetaryValue>
                </Stat>
              </CardContent>
            </Card>
          ) : (
            m && (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  {t("noClosedTrades")}
                </CardContent>
              </Card>
            )
          )}

          {data && data.intraday.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("intradayTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <EquityArea
                  data={data.intraday.map((p) => ({
                    t: p.t.slice(11, 16),
                    cumNetPnl: p.cumNetPnl,
                  }))}
                  height={200}
                />
              </CardContent>
            </Card>
          )}

          {data && data.trades.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("trades")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.trades.map((trade) => (
                  <Link
                    key={trade.key}
                    href={`/trades/${encodeURIComponent(trade.key)}?${query}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60"
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
                        {tEnums.has(`status.${trade.status}`)
                          ? tEnums(`status.${trade.status}`)
                          : trade.status.toUpperCase()}
                      </Badge>
                      <span className="font-medium">{trade.symbol}</span>
                      <span className="text-xs text-muted-foreground">
                        {tEnums.has(`direction.${trade.direction}`)
                          ? tEnums(`direction.${trade.direction}`)
                          : trade.direction}
                      </span>
                    </span>
                    <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                      <span className="tnum text-xs text-muted-foreground">
                        {fmtNumber(trade.quantity, 4, formatLocale(locale as Locale))} @{" "}
                        <MonetaryValue>
                          {fmtNumber(trade.avgEntry, 2, formatLocale(locale as Locale))}
                        </MonetaryValue>
                        {trade.avgExit !== null && (
                          <>
                            {" "}
                            →{" "}
                            <MonetaryValue>
                              {fmtNumber(trade.avgExit, 2, formatLocale(locale as Locale))}
                            </MonetaryValue>
                          </>
                        )}
                      </span>
                      <Pnl value={trade.netPnl} />
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
          {!data && <Skeleton className="h-64" />}
        </div>

        <Card className="h-fit">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("dayNote")}</CardTitle>
            <div className="flex items-center gap-2">
              <VoiceNote
                onPrepare={() => noteEditor.current?.focus()}
                onText={(text) =>
                  scheduleSave(
                    noteValue ? `${noteValue}${noteValue.endsWith(" ") ? "" : " "}${text}` : text,
                  )
                }
              />
            </div>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">{t("sharedNoteHint")}</p>
            <div className="mb-3">
              <AiRecap
                key={`${date}:${timeZone}:${query}`}
                date={date}
                filters={filters}
                timeZone={timeZone}
                disabled={!data || !m?.closedTrades}
                onRecap={({ recap, scope }) => {
                  // Append to the current draft, including edits made while AI was running.
                  const section = `## AI recap\n\n${scope.label.replace(/[\\`*_{}\[\]<>#]/g, "").replace(/[\r\n]+/g, " ")}\n\n${recap}`;
                  scheduleSave(
                    latestNote.current ? `${latestNote.current}\n\n---\n\n${section}` : section,
                  );
                }}
              />
            </div>
            {data ? (
              <RichEditor editorRef={noteEditor} value={noteValue} onChange={scheduleSave} />
            ) : error ? (
              <p role="alert" className="text-sm text-destructive">
                {formatApiError(tErrors, errorInfo ?? error)}
              </p>
            ) : (
              <Skeleton className="h-48" />
            )}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span role="status">
                {formatAutosaveStatus(tControls, tErrors, saveState, saving)}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void flush()}>
                {t("saveNow")}
              </Button>
            </div>
            <ReviewExport
              containsFinancialData
              document={{
                title: t("reviewTitle", { date }),
                subtitle: query
                  ? t("reviewSubtitleFilters", { filters: query })
                  : t("reviewSubtitleAllAccounts"),
                lines: [
                  `Closed trades: ${m?.closedTrades ?? 0} | Net P&L: ${m?.netPnl.toFixed(2) ?? "0.00"}`,
                  "",
                  noteValue,
                ],
              }}
            />
            <Attachments type="day" id={date} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tnum">{children}</div>
    </div>
  );
}
