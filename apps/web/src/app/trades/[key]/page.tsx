"use client";
import { AiNotice } from "@/components/ai-notice";
import { Checkbox } from "@/components/ui/checkbox";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { MonetaryValue, MonetaryField } from "@/components/privacy";
import { TradeMarketData } from "@/components/trade-market-data";
import { TradeNavigation } from "@/components/trade-navigation";
import { TradeRating } from "@/components/trade-rating";
import { EquityArea } from "@/components/charts/equity-area";
import { VoiceNote } from "@/components/voice-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RichEditor, type RichEditorHandle } from "@/components/rich-editor";
import { Attachments } from "@/components/attachments";
import { ReviewExport } from "@/components/review-export";
import { RuleChecklist } from "@/components/rule-checklist";
import { formatApiError } from "@/lib/api-error";
import { formatAutosaveStatus, useAutosave } from "@/lib/use-autosave";
import { postJson, useApi } from "@/lib/use-api";
import { fmtDurationLocalized, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";
import { tradeKeyFromSegment } from "@/lib/trade-links";
import { formatTimestamp } from "@/lib/timezone";
import { formatLocale, type Locale } from "@/i18n/config";

interface TradeDetail {
  riskAmount: number | null;
  realizedR: number | null;
  plannedR: number | null;
  contractMultiplier: number | null;
  currency: string;
  key: string;
  accountId: string;
  symbol: string;
  assetClass: string | null;
  direction: "long" | "short";
  status: string;
  openedAt: string;
  closedAt: string | null;
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  grossPnl: number;
  fees: number;
  netPnl: number;
  durationMs: number | null;
  exitsJson: string;
  notes: string | null;
  tagsJson: string | null;
  mistakesJson: string | null;
  playbookId: string | null;
  rating: number | null;
  stopLoss: number | null;
  profitTarget: number | null;
  reviewedAt: string | null;
}

interface ExecutionRow {
  id: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  executedAt: string;
}

export default function TradePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const tradeKey = tradeKeyFromSegment(key);
  return <TradeView key={tradeKey} tradeKey={tradeKey} />;
}

function TradeView({ tradeKey }: { tradeKey: string }) {
  const t = useTranslations("trade-detail");
  const tEnums = useTranslations("enums");
  const tControls = useTranslations("controls");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const { data, error, errorInfo, refresh } = useApi<{
    trade: TradeDetail;
    executions: ExecutionRow[];
    timeZone: string;
  }>(`/api/trades/${encodeURIComponent(tradeKey)}`);
  const [aiBusy, setAiBusy] = useState(false);
  const [critique, setCritique] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  if (!data) {
    return (
      <div>
        <FilterBar title={t("title")} />
        <div className="p-4">
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {formatApiError(tErrors, errorInfo ?? error)}
            </p>
          ) : (
            <Skeleton className="h-96" />
          )}
        </div>
      </div>
    );
  }
  const { trade, executions, timeZone } = data;

  const patch = async (body: Record<string, unknown>) => {
    if (Object.keys(body).length)
      await postJson(`/api/trades/${encodeURIComponent(tradeKey)}`, body, "PATCH");
    refresh();
  };

  const runningPnl = (() => {
    const exits = JSON.parse(trade.exitsJson) as {
      executionId: string;
      grossPnl: number;
      quantity: number;
    }[];
    const times = new Map(executions.map((e) => [e.id, e.executedAt]));
    const totalExitQty = exits.reduce((total, exit) => total + exit.quantity, 0);
    let cum = 0;
    return exits
      .map((exit) => ({
        t: times.get(exit.executionId) ?? trade.openedAt,
        pnl: exit.grossPnl - (totalExitQty > 0 ? trade.fees * (exit.quantity / totalExitQty) : 0),
      }))
      .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
      .map((event) => ({
        t: formatTimestamp(event.t, timeZone).slice(11, 16),
        cumNetPnl: (cum += event.pnl),
      }));
  })();

  const askCritique = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      const result = await postJson<{ critique: string }>("/api/ai/critique", { key: tradeKey });
      setCritique(result.critique);
    } catch (error) {
      // Keep the server's original text: AiNotice classifies on the English
      // message and localizes via the `ai` namespace itself (docs/i18n.md §6/§9).
      setAiError(error instanceof Error ? error.message : "AI critique failed");
    } finally {
      setAiBusy(false);
    }
  };

  const riskAmount = trade.riskAmount;

  return (
    <div>
      <FilterBar title={`${trade.symbol} · ${tEnums(`direction.${trade.direction}`)}`} />
      <TradeNavigation tradeKey={tradeKey} />
      <div className="grid gap-3 p-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-3 xl:col-span-2">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
              <div>
                <div className="text-xs text-muted-foreground">{t("netPnl")}</div>
                <Pnl value={trade.netPnl} className="text-2xl font-semibold" />
              </div>
              <Badge
                variant={
                  trade.status === "win" ? "profit" : trade.status === "loss" ? "loss" : "secondary"
                }
                className="text-sm"
              >
                {tEnums(`status.${trade.status}`)}
              </Badge>
              <Meta label={t("gross")} value={fmtMoney(trade.grossPnl, undefined, tag)} monetary />
              <Meta label={t("fees")} value={fmtMoney(trade.fees, undefined, tag)} monetary />
              <Meta label={t("volume")} value={fmtNumber(trade.quantity, 4, tag)} />
              <Meta label={t("avgEntry")} value={fmtNumber(trade.avgEntry, 2, tag)} monetary />
              <Meta
                label={t("avgExit")}
                monetary
                value={trade.avgExit === null ? t("openExit") : fmtNumber(trade.avgExit, 2, tag)}
              />
              <Meta
                label={t("duration")}
                value={fmtDurationLocalized(trade.durationMs, tControls)}
              />
              <Meta
                label={t("netOverNotional")}
                value={fmtPercent(
                  trade.avgEntry * trade.quantity > 0 &&
                    (trade.contractMultiplier !== null ||
                      !["futures", "option", "forex", "cfd"].includes(trade.assetClass ?? ""))
                    ? trade.netPnl /
                        (Math.abs(trade.avgEntry) *
                          trade.quantity *
                          (trade.contractMultiplier ?? 1))
                    : null,
                  2,
                  tag,
                )}
              />
              <Meta
                label={t("plannedR")}
                value={trade.plannedR === null ? "–" : `${fmtNumber(trade.plannedR, 2, tag)}R`}
              />
              <Meta
                label={t("realizedR")}
                value={trade.realizedR === null ? "–" : `${fmtNumber(trade.realizedR, 2, tag)}R`}
              />
            </CardContent>
          </Card>

          <TradeMarketData trade={trade} executions={executions} />

          {runningPnl.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("runningPnl")}</CardTitle>
                <p className="text-xs text-muted-foreground">{t("timesIn", { timeZone })}</p>
              </CardHeader>
              <CardContent>
                <EquityArea data={runningPnl} height={180} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t("executions")}</CardTitle>
              <p className="text-xs text-muted-foreground">{t("timesIn", { timeZone })}</p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("time")}</TableHead>
                    <TableHead>{t("side")}</TableHead>
                    <TableHead>{t("quantity")}</TableHead>
                    <TableHead>{t("price")}</TableHead>
                    <TableHead>{t("fee")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executions
                    .sort((a, b) => a.executedAt.localeCompare(b.executedAt))
                    .map((execution) => (
                      <TableRow key={execution.id}>
                        <TableCell className="text-muted-foreground">
                          {formatTimestamp(execution.executedAt, timeZone)}
                        </TableCell>
                        <TableCell>
                          <span className={execution.side === "buy" ? "text-profit" : "text-loss"}>
                            {execution.side === "buy" ? `▲ ${t("sideBuy")}` : `▼ ${t("sideSell")}`}
                          </span>
                        </TableCell>
                        <TableCell className="tnum">
                          {fmtNumber(execution.quantity, 4, tag)}
                        </TableCell>
                        <TableCell className="tnum">
                          <MonetaryValue>{fmtNumber(execution.price, 2, tag)}</MonetaryValue>
                        </TableCell>
                        <TableCell className="tnum text-muted-foreground">
                          <MonetaryValue>{fmtMoney(execution.fee, undefined, tag)}</MonetaryValue>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-3">
          <AnnotationsCard key={trade.key} trade={trade} onPatch={patch} />
          <RuleChecklist tradeKey={trade.key} playbookId={trade.playbookId} />
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t("aiReview")}</CardTitle>
              <Button variant="outline" size="sm" onClick={askCritique} disabled={aiBusy}>
                <Sparkles />
                {aiBusy ? t("thinking") : t("critique")}
              </Button>
            </CardHeader>
            {aiError && (
              <CardContent>
                <AiNotice
                  error={aiError}
                  onRetry={() => void askCritique()}
                  onDismiss={() => setAiError(null)}
                />
              </CardContent>
            )}
            {critique && (
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{critique}</p>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Meta({
  label,
  value,
  monetary = false,
}: {
  label: string;
  value: string;
  monetary?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tnum text-sm font-medium">
        {monetary ? <MonetaryValue>{value}</MonetaryValue> : value}
      </div>
    </div>
  );
}

function AnnotationsCard({
  trade,
  onPatch,
}: {
  trade: TradeDetail;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
}) {
  const t = useTranslations("trade-detail");
  const tEnums = useTranslations("enums");
  const tControls = useTranslations("controls");
  const tErrors = useTranslations();
  const [notes, setNotes] = useState(trade.notes ?? "");
  const noteEditor = useRef<RichEditorHandle>(null);
  const [tags, setTags] = useState((JSON.parse(trade.tagsJson ?? "[]") as string[]).join(", "));
  const [mistakes, setMistakes] = useState(
    (JSON.parse(trade.mistakesJson ?? "[]") as string[]).join(", "),
  );
  const [stopLoss, setStopLoss] = useState(trade.stopLoss?.toString() ?? "");
  const [profitTarget, setProfitTarget] = useState(trade.profitTarget?.toString() ?? "");
  const { data: playbookData } = useApi<{ playbooks: { id: string; name: string }[] }>(
    "/api/playbooks",
  );
  const {
    save: debounced,
    status: saveStatus,
    saveState,
    flush,
  } = useAutosave(`/api/trades/${encodeURIComponent(trade.key)}`, "PATCH", () => void onPatch({}));

  const parseList = (value: string) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("journalThisTrade")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <TradeRating value={trade.rating} onChange={(rating) => onPatch({ rating })} />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={trade.reviewedAt !== null}
              onCheckedChange={(checked) => void onPatch({ reviewed: checked === true })}
            />
            {t("reviewed")}
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">{t("stopLoss")}</label>
            <MonetaryField>
              <Input
                value={stopLoss}
                onChange={(event) => {
                  setStopLoss(event.target.value);
                  debounced({
                    stopLoss: event.target.value === "" ? null : Number(event.target.value),
                  });
                }}
                placeholder={t("plannedStop")}
                inputMode="decimal"
              />
            </MonetaryField>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t("profitTarget")}</label>
            <MonetaryField>
              <Input
                value={profitTarget}
                onChange={(event) => {
                  setProfitTarget(event.target.value);
                  debounced({
                    profitTarget: event.target.value === "" ? null : Number(event.target.value),
                  });
                }}
                placeholder={t("plannedTarget")}
                inputMode="decimal"
              />
            </MonetaryField>
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">{t("playbook")}</label>
          <Select
            value={trade.playbookId ?? "none"}
            onValueChange={(value) => void onPatch({ playbookId: value === "none" ? null : value })}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("noPlaybook")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("noPlaybook")}</SelectItem>
              {playbookData?.playbooks.map((playbook) => (
                <SelectItem key={playbook.id} value={playbook.id}>
                  {playbook.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">{t("tags")}</label>
          <Input
            value={tags}
            onChange={(event) => {
              setTags(event.target.value);
              debounced({ tags: parseList(event.target.value) });
            }}
            placeholder={t("tagsPlaceholder")}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">{t("mistakes")}</label>
          <Input
            value={mistakes}
            onChange={(event) => {
              setMistakes(event.target.value);
              debounced({ mistakes: parseList(event.target.value) });
            }}
            placeholder={t("mistakesPlaceholder")}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-muted-foreground">{t("notes")}</label>
            <VoiceNote
              onPrepare={() => noteEditor.current?.focus()}
              onText={(text) => {
                const next = notes ? `${notes} ${text}` : text;
                setNotes(next);
                debounced({ notes: next });
              }}
            />
          </div>
          <RichEditor
            editorRef={noteEditor}
            value={notes}
            onChange={(value) => {
              setNotes(value);
              debounced({ notes: value });
            }}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span role="status">
              {formatAutosaveStatus(tControls, tErrors, saveState, saveStatus)}
            </span>
            <Button variant="ghost" size="sm" onClick={() => void flush()}>
              {t("saveNow")}
            </Button>
          </div>
          <ReviewExport
            containsFinancialData
            document={{
              title: t("reviewTitle", {
                symbol: trade.symbol,
                direction: tEnums(`direction.${trade.direction}`),
              }),
              subtitle: `${trade.openedAt} · ${trade.currency}`,
              lines: [
                t("exportStatusLine", {
                  status: tEnums(`status.${trade.status}`),
                  quantity: trade.quantity,
                }),
                t("exportEntryLine", {
                  entry: trade.avgEntry,
                  exit: trade.avgExit ?? t("openExitLabel"),
                }),
                t("exportPnlLine", { net: trade.netPnl.toFixed(2), fees: trade.fees.toFixed(2) }),
                t("exportStopLine", {
                  stop: stopLoss || t("unspecified"),
                  target: profitTarget || t("unspecified"),
                }),
                t("exportTagsLine", {
                  tags: tags || t("none"),
                  mistakes: mistakes || t("none"),
                }),
                "",
                notes,
              ],
            }}
          />
          <Attachments type="trade" id={trade.key} />
        </div>
      </CardContent>
    </Card>
  );
}
