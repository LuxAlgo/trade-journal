"use client";

import Link from "next/link";
import { Suspense, use, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { IntradayPoint, TradeMetrics } from "@luxalgo/journal-core";
import { EquityArea } from "@/components/charts/equity-area";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { VoiceNote } from "@/components/voice-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { postJson, useApi } from "@/lib/use-api";
import { fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";

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
      <JournalDay date={date} />
    </Suspense>
  );
}

function JournalDay({ date }: { date: string }) {
  const { query } = useFilters();
  const { data, refresh } = useApi<DayPayload>(`/api/journal/${date}?${query}`);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [aiBusy, setAiBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const noteValue = note ?? data?.note ?? "";

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const scheduleSave = (value: string) => {
    setNote(value);
    setSaving("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void postJson(`/api/journal/${date}`, { note: value }, "PUT").then(() => setSaving("saved"));
    }, 600);
  };

  const generateRecap = async () => {
    setAiBusy(true);
    try {
      const result = await postJson<{ recap: string }>(`/api/ai/recap`, { date });
      const merged = noteValue ? `${noteValue}\n\n---\n\n${result.recap}` : result.recap;
      scheduleSave(merged);
    } catch (error) {
      alert(error instanceof Error ? error.message : "AI recap failed");
    } finally {
      setAiBusy(false);
    }
  };

  const m = data?.metrics;
  return (
    <div>
      <FilterBar title={`Journal · ${date}`} />
      <div className="grid gap-3 p-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {m && m.closedTrades > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Day stats</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm md:grid-cols-5">
                <Stat label="Net P&L">
                  <Pnl value={m.netPnl} className="font-semibold" />
                </Stat>
                <Stat label="Trades">{m.closedTrades}</Stat>
                <Stat label="Winrate">{fmtPercent(m.winRate)}</Stat>
                <Stat label="Winners">{m.wins}</Stat>
                <Stat label="Losers">{m.losses}</Stat>
                <Stat label="Gross">{fmtMoney(m.grossPnl)}</Stat>
                <Stat label="Fees">{fmtMoney(m.fees)}</Stat>
                <Stat label="Volume">{fmtNumber(m.totalVolume, 0)}</Stat>
                <Stat label="Profit factor">
                  {m.profitFactorIsInfinite
                    ? "∞"
                    : m.profitFactor === null
                      ? "–"
                      : fmtNumber(m.profitFactor)}
                </Stat>
                <Stat label="Expectancy">
                  {m.expectancy === null ? "–" : fmtMoney(m.expectancy)}
                </Stat>
              </CardContent>
            </Card>
          ) : (
            m && (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No closed trades this day.
                </CardContent>
              </Card>
            )
          )}

          {data && data.intraday.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Intraday cumulative net P&L</CardTitle>
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
                <CardTitle>Trades</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.trades.map((trade) => (
                  <Link
                    key={trade.key}
                    href={`/trades/${encodeURIComponent(trade.key)}`}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent/60"
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
                        {trade.status.toUpperCase()}
                      </Badge>
                      <span className="font-medium">{trade.symbol}</span>
                      <span className="text-xs text-muted-foreground">{trade.direction}</span>
                    </span>
                    <span className="flex items-center gap-4">
                      <span className="tnum text-xs text-muted-foreground">
                        {fmtNumber(trade.quantity, 4)} @ {fmtNumber(trade.avgEntry)}
                        {trade.avgExit !== null && ` → ${fmtNumber(trade.avgExit)}`}
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
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Day note</CardTitle>
            <div className="flex items-center gap-2">
              <VoiceNote
                onText={(text) =>
                  scheduleSave(
                    noteValue ? `${noteValue}${noteValue.endsWith(" ") ? "" : " "}${text}` : text,
                  )
                }
              />
              <Button variant="outline" size="sm" onClick={generateRecap} disabled={aiBusy}>
                <Sparkles />
                {aiBusy ? "Writing…" : "AI recap"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Textarea
              value={noteValue}
              onChange={(event) => scheduleSave(event.target.value)}
              placeholder="What was the plan? What actually happened? What do you keep, what do you fix? (Markdown, or hit Dictate and talk.)"
              className="min-h-72 font-mono text-[13px]"
            />
            <div className="mt-1 h-4 text-right text-xs text-muted-foreground">
              {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : ""}
            </div>
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
