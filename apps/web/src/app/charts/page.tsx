"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { BookOpenText, CandlestickChart, Trash2 } from "lucide-react";
import { dayKeyOf } from "@luxalgo/journal-core";
import { AnalysisChart, type AnalysisChartHandle } from "@/components/analysis-chart";
import { FilterBar } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import {
  analysisImagePath,
  analysisLabel,
  defaultLookbackMs,
  drawingsProblem,
  MAX_SNAPSHOT_BYTES,
  EMPTY_DRAWINGS,
  isDayKey,
  maxSpanMs,
  utcDay,
  utcDayRange,
  type ChartAnalysis,
  type ChartAnalysisSummary,
  type DrawingsDocument,
} from "@/lib/chart-analysis";
import {
  RESOLUTIONS,
  type MarketConnection,
  type MarketHistory,
  type Resolution,
} from "@/lib/market-data";
import type { MarketCsvDataset } from "@/lib/market-csv";
import { providerInfo } from "@/lib/market-providers";
import { postJson, useApi } from "@/lib/use-api";

export default function ChartsPage() {
  return (
    <Suspense>
      <ChartLab />
    </Suspense>
  );
}

/**
 * Remount the workspace only when the user opens another analysis, not when saving a
 * new one writes its id into the URL (that would drop the live chart).
 */
function ChartLab() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");
  const day = params.get("day");
  const symbol = params.get("symbol");
  const shown = useRef(id);
  const [mount, setMount] = useState({ id, n: 0 });
  useEffect(() => {
    if (id === shown.current) return;
    shown.current = id;
    setMount((current) => ({ id, n: current.n + 1 }));
  }, [id]);
  return (
    <ChartWorkspace
      key={mount.n}
      id={mount.id}
      initialDay={isDayKey(day) ? day : null}
      initialSymbol={symbol ?? ""}
      onSaved={(saved) => {
        shown.current = saved;
        router.replace(`/charts?id=${encodeURIComponent(saved)}`, { scroll: false });
      }}
    />
  );
}

interface Loaded {
  history: MarketHistory;
  provider: string;
  dataset: string;
  from: number;
  to: number;
}

function ChartWorkspace({
  id,
  initialDay,
  initialSymbol,
  onSaved,
}: {
  id: string | null;
  initialDay: string | null;
  initialSymbol: string;
  onSaved: (id: string) => void;
}) {
  const { data: settings } = useApi<{ timeZone: string }>("/api/settings");
  const today = dayKeyOf(new Date().toISOString(), settings?.timeZone ?? "UTC");
  const { data: connections, error: connectionError } = useApi<{
    connections: MarketConnection[];
  }>("/api/market-data/connections");
  const available = connections?.connections.filter((c) => c.configured) ?? [];
  const { data: saved, error: savedError } = useApi<{ analysis: ChartAnalysis }>(
    id ? `/api/analyses/${encodeURIComponent(id)}` : null,
  );
  const { data: list, refresh: refreshList } = useApi<{ analyses: ChartAnalysisSummary[] }>(
    "/api/analyses",
  );

  const [provider, setProvider] = useState("");
  const [symbol, setSymbol] = useState(initialSymbol);
  const [dataset, setDataset] = useState("");
  const [resolution, setResolution] = useState<Resolution>("5m");
  const [fromDay, setFromDay] = useState(() => utcDay(Date.now() - defaultLookbackMs("5m")));
  const [toDay, setToDay] = useState(() => utcDay(Date.now()));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const [analysisId, setAnalysisId] = useState(id);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dayDate, setDayDate] = useState(initialDay ?? "");
  const [seed, setSeed] = useState<{
    drawings: DrawingsDocument;
    visible: { from: number; to: number } | null;
  }>({ drawings: EMPTY_DRAWINGS, visible: null });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [saveError, setSaveError] = useState("");
  const [journalDay, setJournalDay] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");
  const chart = useRef<AnalysisChartHandle>(null);

  const info = providerInfo(provider);
  const { data: csv } = useApi<{ datasets: MarketCsvDataset[] }>(
    info?.mode === "csv" ? "/api/market-data/csv" : null,
  );
  const resolutions = (info?.resolutions ?? (Object.keys(RESOLUTIONS) as Resolution[])).filter(
    (value): value is Resolution => value in RESOLUTIONS,
  );

  // Pick the only connection, or the saved analysis's source, once connections load.
  useEffect(() => {
    if (provider || !available.length || id) return;
    setProvider(available[0]!.id);
  }, [available, provider, id]);

  const initialized = useRef(false);
  useEffect(() => {
    const analysis = saved?.analysis;
    if (!analysis || initialized.current) return;
    initialized.current = true;
    setProvider(analysis.provider);
    setSymbol(analysis.symbol);
    setDataset(analysis.dataset ?? "");
    setResolution(analysis.resolution);
    setFromDay(utcDay(analysis.rangeFrom));
    setToDay(utcDay(analysis.rangeTo - 1));
    setTitle(analysis.title);
    setNotes(analysis.notes);
    setDayDate(analysis.dayDate ?? "");
    setUpdatedAt(analysis.updatedAt);
    setSeed({
      drawings: analysis.drawings,
      visible:
        analysis.visibleFrom !== null && analysis.visibleTo !== null
          ? { from: analysis.visibleFrom, to: analysis.visibleTo }
          : null,
    });
  }, [saved]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    // In-app links (sidebar, saved analyses, New analysis) navigate without unloading the
    // page; ask before they drop unsaved drawings. Capture runs before Next's Link handler.
    const guard = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank") return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;
      if (confirm("Leave without saving this chart analysis? Unsaved drawings will be lost."))
        return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guard, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guard, true);
    };
  }, [dirty]);

  const range = utcDayRange(fromDay, toDay);
  const rangeProblem = !range
    ? "Choose a start date on or before the end date, not in the future."
    : range.to - range.from > maxSpanMs(resolution)
      ? "That range holds more than 20,000 candles. Shorten it or choose a coarser resolution."
      : "";
  const connected = available.some((item) => item.id === provider);
  const canLoad =
    connected && symbol.trim() && !rangeProblem && !(info?.datasets && !dataset) && !loading;

  const load = async () => {
    if (!canLoad || !range) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/market-data/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          symbol: symbol.trim(),
          dataset: dataset || undefined,
          resolution,
          from: range.from,
          to: range.to,
        }),
        signal: controller.signal,
      });
      const body = (await response.json()) as MarketHistory & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "History request failed.");
      if (!body.bars.length)
        throw new Error("No candles in that range. Check the symbol, dates and resolution.");
      if (!controller.signal.aborted) {
        // Reloading another source, range or resolution changes what a save would store.
        if (
          loaded &&
          (loaded.provider !== provider ||
            loaded.history.symbol !== body.symbol ||
            loaded.history.resolution !== body.resolution ||
            loaded.from !== range.from ||
            loaded.to !== range.to)
        )
          setDirty(true);
        setLoaded({ history: body, provider, dataset, from: range.from, to: range.to });
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setLoadError(cause instanceof Error ? cause.message : "History request failed.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const save = async (addToJournal: boolean) => {
    const handle = chart.current;
    if (!handle || !loaded) return;
    if (addToJournal && !dayDate) {
      setSaveError("Choose the journal day to add this analysis to.");
      return;
    }
    setSaving(true);
    setSaveError("");
    setStatus("");
    try {
      const visible = handle.visibleRange();
      const drawings = handle.drawings();
      const problem = drawingsProblem(drawings);
      if (problem) throw new Error(problem);
      const image = await fitSnapshot(handle.screenshot());
      const body = {
        title,
        notes,
        dayDate: dayDate || null,
        symbol: loaded.history.symbol,
        provider: loaded.provider,
        // Pin the dataset the source resolved, so reopening never becomes ambiguous.
        dataset: loaded.dataset || loaded.history.datasetId || null,
        resolution: loaded.history.resolution,
        rangeFrom: loaded.from,
        rangeTo: loaded.to,
        visibleFrom: visible ? Math.round(visible.from) : null,
        visibleTo: visible ? Math.round(visible.to) : null,
        drawings,
        // Without a fresh snapshot, clear the old one rather than embed outdated drawings.
        image,
        addToJournal,
      };
      const { analysis } = analysisId
        ? await postJson<{ analysis: ChartAnalysis }>(
            `/api/analyses/${encodeURIComponent(analysisId)}`,
            body,
            "PATCH",
          )
        : await postJson<{ analysis: ChartAnalysis }>("/api/analyses", body);
      setDirty(false);
      setUpdatedAt(analysis.updatedAt);
      setJournalDay(addToJournal ? analysis.dayDate : null);
      setStatus(
        addToJournal
          ? `Saved and added to the ${analysis.dayDate} journal.`
          : image
            ? "Saved."
            : "Saved without a snapshot; the chart image could not be exported.",
      );
      refreshList();
      if (!analysisId) {
        setAnalysisId(analysis.id);
        onSaved(analysis.id);
      }
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save the analysis.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (target: ChartAnalysisSummary) => {
    if (!confirm(`Delete "${analysisLabel(target)}"? Journal notes keep a placeholder.`)) return;
    try {
      await postJson(`/api/analyses/${encodeURIComponent(target.id)}`, undefined, "DELETE");
      refreshList();
      if (target.id === analysisId) window.location.assign("/charts");
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not delete the analysis.");
    }
  };

  const invalidateSource = () => setLoadError("");
  const openedSaved = saved?.analysis;
  return (
    <div>
      <FilterBar
        title={analysisId ? `Charts · ${analysisLabel({ title, symbol, resolution })}` : "Charts"}
        actions={
          <Link
            href="/charts"
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            New analysis
          </Link>
        }
      />
      <div className="grid gap-3 p-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          <Card>
            <CardContent className="space-y-3 pt-4">
              {(connectionError || savedError) && (
                <p role="alert" className="text-sm text-destructive">
                  {connectionError || savedError}
                </p>
              )}
              {connections && !available.length && (
                <p className="text-sm text-muted-foreground">
                  Charts load candles from a market data source you choose.{" "}
                  <Link className="underline" href="/settings#market-data">
                    Connect a provider or upload a candle CSV in Settings
                  </Link>
                  . Binance and Coinbase need no key; enable them there first.
                </p>
              )}
              {available.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  <div className="space-y-1 lg:col-span-2">
                    <Label htmlFor="chart-provider">Data source</Label>
                    <OptionSelect
                      id="chart-provider"
                      value={provider}
                      onValueChange={(value) => {
                        invalidateSource();
                        setProvider(value);
                        setDataset("");
                      }}
                    >
                      <option value="" disabled>
                        Choose a data source
                      </option>
                      {available.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </OptionSelect>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="chart-symbol">Symbol</Label>
                    <Input
                      id="chart-symbol"
                      value={symbol}
                      placeholder="AAPL"
                      autoCapitalize="characters"
                      onChange={(event) => {
                        invalidateSource();
                        setSymbol(event.target.value);
                      }}
                      onKeyDown={(event) => event.key === "Enter" && void load()}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="chart-resolution">Resolution</Label>
                    <OptionSelect
                      id="chart-resolution"
                      value={resolution}
                      onValueChange={(value) => {
                        invalidateSource();
                        const next = value as Resolution;
                        setResolution(next);
                        // Keep the end date; widen or narrow the start to a sensible window.
                        setFromDay(
                          utcDay(Date.parse(`${toDay}T00:00:00Z`) - defaultLookbackMs(next)),
                        );
                      }}
                    >
                      {resolutions.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </OptionSelect>
                  </div>
                  <div className="space-y-1">
                    <Label>From (UTC)</Label>
                    <DatePicker
                      label="History start date"
                      value={fromDay}
                      max={toDay}
                      onValueChange={(value) => {
                        invalidateSource();
                        setFromDay(value);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>To (UTC)</Label>
                    <DatePicker
                      label="History end date"
                      value={toDay}
                      min={fromDay}
                      max={utcDay(Date.now())}
                      onValueChange={(value) => {
                        invalidateSource();
                        setToDay(value);
                      }}
                    />
                  </div>
                  {(info?.datasets || info?.mode === "csv") && (
                    <div className="space-y-1 lg:col-span-2">
                      <Label htmlFor="chart-dataset">Data feed / dataset</Label>
                      <OptionSelect
                        id="chart-dataset"
                        value={dataset}
                        onValueChange={(value) => {
                          invalidateSource();
                          setDataset(value);
                        }}
                      >
                        {(
                          info.datasets ?? [
                            { value: "", label: "Automatic matching file" },
                            ...(csv?.datasets ?? []).map((item) => ({
                              value: item.id,
                              label: `${item.name} · ${item.symbol} · ${item.resolution}`,
                            })),
                          ]
                        ).map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </OptionSelect>
                    </div>
                  )}
                  {info?.id === "london-strategic-edge" && (
                    <div className="space-y-1 lg:col-span-2">
                      <Label htmlFor="chart-dataset">Dataset (optional)</Label>
                      <Input
                        id="chart-dataset"
                        value={dataset}
                        placeholder="Leave blank for automatic selection"
                        onChange={(event) => {
                          invalidateSource();
                          setDataset(event.target.value);
                        }}
                      />
                    </div>
                  )}
                  <div className="flex items-end gap-2 lg:col-span-2">
                    <Button disabled={!canLoad} onClick={() => void load()} className="w-full">
                      <CandlestickChart />
                      {loading ? "Loading candles…" : loaded ? "Reload chart" : "Load chart"}
                    </Button>
                    {loading && (
                      <Button variant="outline" onClick={() => request.current?.abort()}>
                        Stop
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {available.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {info?.symbolHint} Loading makes a request to the selected source and uses your
                  plan&apos;s allowance. Candles are shown, not stored; drawings stay anchored to
                  time and price when you change the range or resolution.
                </p>
              )}
              {(rangeProblem || loadError) && (
                <p role="alert" className="text-sm text-destructive">
                  {loadError || rangeProblem}
                </p>
              )}
              {openedSaved && !loaded && connections && !connected && (
                <p role="alert" className="text-sm text-destructive">
                  This analysis used{" "}
                  {providerInfo(openedSaved.provider)?.name ?? openedSaved.provider}, which is not
                  connected. Connect it in Settings, or choose another source to redraw on.
                </p>
              )}
              {loaded && (loaded.history.warnings.length > 0 || loaded.history.truncated) && (
                <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  {loaded.history.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                  {loaded.history.truncated && (
                    <li>History was truncated. Shorten the range for complete coverage.</li>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>

          {loaded ? (
            <AnalysisChart
              history={loaded.history}
              initialDrawings={seed.drawings}
              initialVisible={seed.visible}
              onChange={() => setDirty(true)}
              chartRef={chart}
            />
          ) : openedSaved ? (
            <Card>
              <CardContent className="space-y-3 pt-4">
                {openedSaved.hasImage && (
                  <img
                    src={`${analysisImagePath(openedSaved.id)}?v=${encodeURIComponent(updatedAt)}`}
                    alt={`${analysisLabel(openedSaved)} saved snapshot`}
                    className="max-h-[60vh] w-full rounded-md border object-contain"
                  />
                )}
                <p className="text-sm text-muted-foreground">
                  Saved snapshot with {openedSaved.drawingCount} drawing
                  {openedSaved.drawingCount === 1 ? "" : "s"}. Load the chart to keep editing; the
                  candles are requested again from{" "}
                  {providerInfo(openedSaved.provider)?.name ?? openedSaved.provider}.
                </p>
              </CardContent>
            </Card>
          ) : (
            available.length > 0 && (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  Choose a symbol and load the chart to start drawing.
                </CardContent>
              </Card>
            )
          )}
        </div>

        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Save analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="analysis-title">Title</Label>
                <Input
                  id="analysis-title"
                  value={title}
                  maxLength={200}
                  placeholder={
                    loaded
                      ? `${loaded.history.symbol} · ${loaded.history.resolution}`
                      : "Opening range levels"
                  }
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setDirty(true);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="analysis-notes">Notes</Label>
                <Textarea
                  id="analysis-notes"
                  value={notes}
                  rows={3}
                  placeholder="Thesis, levels to watch, invalidation…"
                  onChange={(event) => {
                    setNotes(event.target.value);
                    setDirty(true);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>Journal day</Label>
                <DatePicker
                  label="Journal day"
                  value={dayDate}
                  onValueChange={(value) => {
                    setDayDate(value);
                    setDirty(true);
                  }}
                />
                {!dayDate && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => {
                      setDayDate(today);
                      setDirty(true);
                    }}
                  >
                    Use today ({today})
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!loaded || saving} onClick={() => void save(false)}>
                  {saving ? "Saving…" : analysisId ? "Save changes" : "Save analysis"}
                </Button>
                <Button
                  variant="outline"
                  disabled={!loaded || saving}
                  onClick={() => void save(true)}
                >
                  <BookOpenText />
                  Save &amp; add to journal
                </Button>
              </div>
              {!loaded && (
                <p className="text-xs text-muted-foreground">Load the chart to save drawings.</p>
              )}
              {dirty && loaded && <p className="text-xs text-muted-foreground">Unsaved changes.</p>}
              {status && (
                <p role="status" className="text-xs text-muted-foreground">
                  {status}{" "}
                  {journalDay && (
                    <Link className="underline" href={`/journal/${journalDay}`}>
                      Open journal day
                    </Link>
                  )}
                </p>
              )}
              {saveError && (
                <p role="alert" className="text-xs text-destructive">
                  {saveError}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                The journal shows the saved snapshot. Saving again updates every note that embeds
                it.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Saved analyses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {list?.analyses.length === 0 && (
                <p className="text-sm text-muted-foreground">No saved analyses yet.</p>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-1">
                {list?.analyses.map((item) => (
                  <div
                    key={item.id}
                    className={`min-w-0 rounded-md border p-2 ${item.id === analysisId ? "ring-1 ring-primary" : ""}`}
                  >
                    <Link href={`/charts?id=${encodeURIComponent(item.id)}`} className="block">
                      {item.hasImage ? (
                        <img
                          src={`${analysisImagePath(item.id)}?v=${encodeURIComponent(item.updatedAt)}`}
                          alt=""
                          loading="lazy"
                          className="mb-1.5 aspect-video w-full rounded object-cover"
                        />
                      ) : (
                        <div className="mb-1.5 flex aspect-video items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                          No snapshot
                        </div>
                      )}
                      <span className="block truncate text-xs font-medium">
                        {analysisLabel(item)}
                      </span>
                    </Link>
                    <div className="mt-0.5 flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
                      <span className="truncate">
                        {item.symbol} · {item.resolution}
                        {item.dayDate ? ` · ${item.dayDate}` : ""}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0"
                        aria-label={`Delete ${analysisLabel(item)}`}
                        onClick={() => void remove(item)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * Keep a snapshot within the save limit: high-density tablet screens can export large
 * PNGs, so halve the pixel area until it fits. Null when there is nothing to save.
 */
async function fitSnapshot(dataUrl: string | null): Promise<string | null> {
  const bytes = (url: string) => Math.floor(((url.length - url.indexOf(",") - 1) * 3) / 4);
  if (!dataUrl || bytes(dataUrl) <= MAX_SNAPSHOT_BYTES) return dataUrl;
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  let scale = 1;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    scale *= Math.SQRT1_2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const next = canvas.toDataURL("image/png");
    if (bytes(next) <= MAX_SNAPSHOT_BYTES) return next;
  }
  return null;
}
