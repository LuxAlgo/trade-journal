"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Star } from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { MonetaryValue, MonetaryField } from "@/components/privacy";
import { TradeChart } from "@/components/trade-chart";
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
import { useAutosave } from "@/lib/use-autosave";
import { postJson, useApi } from "@/lib/use-api";
import { fmtDuration, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";
import { tradeKeyFromSegment } from "@/lib/trade-links";

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
  const { data, error, refresh } = useApi<{ trade: TradeDetail; executions: ExecutionRow[] }>(
    `/api/trades/${encodeURIComponent(tradeKey)}`,
  );
  const [aiBusy, setAiBusy] = useState(false);
  const [critique, setCritique] = useState<string | null>(null);

  if (!data) {
    return (
      <div>
        <FilterBar title="Trade" />
        <div className="p-4">
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : (
            <Skeleton className="h-96" />
          )}
        </div>
      </div>
    );
  }
  const { trade, executions } = data;

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
      .map((event) => ({ t: event.t.slice(11, 16), cumNetPnl: (cum += event.pnl) }));
  })();

  const askCritique = async () => {
    setAiBusy(true);
    try {
      const result = await postJson<{ critique: string }>("/api/ai/critique", { key: tradeKey });
      setCritique(result.critique);
    } catch (error) {
      alert(error instanceof Error ? error.message : "AI critique failed");
    } finally {
      setAiBusy(false);
    }
  };

  const riskAmount = trade.riskAmount;

  return (
    <div>
      <FilterBar title={`${trade.symbol} · ${trade.direction.toUpperCase()}`} />
      <div className="grid gap-3 p-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-3 xl:col-span-2">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
              <div>
                <div className="text-xs text-muted-foreground">Net P&L</div>
                <Pnl value={trade.netPnl} className="text-2xl font-semibold" />
              </div>
              <Badge
                variant={
                  trade.status === "win" ? "profit" : trade.status === "loss" ? "loss" : "secondary"
                }
                className="text-sm"
              >
                {trade.status.toUpperCase()}
              </Badge>
              <Meta label="Gross" value={fmtMoney(trade.grossPnl)} monetary />
              <Meta label="Fees" value={fmtMoney(trade.fees)} monetary />
              <Meta label="Volume" value={fmtNumber(trade.quantity, 4)} />
              <Meta label="Avg entry" value={fmtNumber(trade.avgEntry)} monetary />
              <Meta
                label="Avg exit"
                monetary
                value={trade.avgExit === null ? "open" : fmtNumber(trade.avgExit)}
              />
              <Meta label="Duration" value={fmtDuration(trade.durationMs)} />
              <Meta
                label="Net / entry notional"
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
                )}
              />
              <Meta
                label="Planned R"
                value={trade.plannedR === null ? "–" : `${fmtNumber(trade.plannedR)}R`}
              />
              <Meta
                label="Realized R"
                value={trade.realizedR === null ? "–" : `${fmtNumber(trade.realizedR)}R`}
              />
            </CardContent>
          </Card>

          <TradeChart trade={trade} executions={executions} />

          {runningPnl.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Running P&L</CardTitle>
              </CardHeader>
              <CardContent>
                <EquityArea data={runningPnl} height={180} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Executions</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Fee</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executions
                    .sort((a, b) => a.executedAt.localeCompare(b.executedAt))
                    .map((execution) => (
                      <TableRow key={execution.id}>
                        <TableCell className="text-muted-foreground">
                          {execution.executedAt.replace("T", " ").slice(0, 19)}
                        </TableCell>
                        <TableCell>
                          <span className={execution.side === "buy" ? "text-profit" : "text-loss"}>
                            {execution.side === "buy" ? "▲ BUY" : "▼ SELL"}
                          </span>
                        </TableCell>
                        <TableCell className="tnum">{fmtNumber(execution.quantity, 4)}</TableCell>
                        <TableCell className="tnum">
                          <MonetaryValue>{fmtNumber(execution.price)}</MonetaryValue>
                        </TableCell>
                        <TableCell className="tnum text-muted-foreground">
                          <MonetaryValue>{fmtMoney(execution.fee)}</MonetaryValue>
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
              <CardTitle>AI review</CardTitle>
              <Button variant="outline" size="sm" onClick={askCritique} disabled={aiBusy}>
                <Sparkles />
                {aiBusy ? "Thinking…" : "Critique this trade"}
              </Button>
            </CardHeader>
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
        <CardTitle>Journal this trade</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => void onPatch({ rating: trade.rating === star ? null : star })}
                aria-label={`Rate ${star} stars`}
              >
                <Star
                  className={`h-4 w-4 ${trade.rating !== null && star <= trade.rating ? "fill-current text-series-4 text-yellow-600" : "text-muted-foreground"}`}
                />
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={trade.reviewedAt !== null}
              onChange={(event) => void onPatch({ reviewed: event.target.checked })}
            />
            Reviewed
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Stop loss</label>
            <MonetaryField>
              <Input
                value={stopLoss}
                onChange={(event) => {
                  setStopLoss(event.target.value);
                  debounced({
                    stopLoss: event.target.value === "" ? null : Number(event.target.value),
                  });
                }}
                placeholder="planned stop"
                inputMode="decimal"
              />
            </MonetaryField>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Profit target</label>
            <MonetaryField>
              <Input
                value={profitTarget}
                onChange={(event) => {
                  setProfitTarget(event.target.value);
                  debounced({
                    profitTarget: event.target.value === "" ? null : Number(event.target.value),
                  });
                }}
                placeholder="planned target"
                inputMode="decimal"
              />
            </MonetaryField>
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Playbook</label>
          <Select
            value={trade.playbookId ?? "none"}
            onValueChange={(value) => void onPatch({ playbookId: value === "none" ? null : value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="No playbook" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No playbook</SelectItem>
              {playbookData?.playbooks.map((playbook) => (
                <SelectItem key={playbook.id} value={playbook.id}>
                  {playbook.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Tags (comma-separated)</label>
          <Input
            value={tags}
            onChange={(event) => {
              setTags(event.target.value);
              debounced({ tags: parseList(event.target.value) });
            }}
            placeholder="breakout, A+ setup"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Mistakes</label>
          <Input
            value={mistakes}
            onChange={(event) => {
              setMistakes(event.target.value);
              debounced({ mistakes: parseList(event.target.value) });
            }}
            placeholder="chased entry, moved stop"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-muted-foreground">Notes</label>
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
            <span role="status">{saveStatus}</span>
            <Button variant="ghost" size="sm" onClick={() => void flush()}>
              Save now
            </Button>
          </div>
          <ReviewExport
            containsFinancialData
            document={{
              title: `${trade.symbol} · ${trade.direction} review`,
              subtitle: `${trade.openedAt} · ${trade.currency}`,
              lines: [
                `Status: ${trade.status} | Quantity: ${trade.quantity}`,
                `Entry: ${trade.avgEntry} | Exit: ${trade.avgExit ?? "Open"}`,
                `Net P&L: ${trade.netPnl.toFixed(2)} | Fees: ${trade.fees.toFixed(2)}`,
                `Stop: ${stopLoss || "Unspecified"} | Target: ${profitTarget || "Unspecified"}`,
                `Tags: ${tags || "None"} | Mistakes: ${mistakes || "None"}`,
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
