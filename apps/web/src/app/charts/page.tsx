"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  BellOff,
  Palette,
  Star,
  History,
  Diamond,
  Rows3,
  BookOpenText,
  ChevronDown,
  Crosshair,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { dayKeyOf } from "@luxalgo/journal-core";
import {
  AnalysisChart,
  type AnalysisChartHandle,
  type ChartDrawing,
} from "@/components/analysis-chart";
import { FilterBar } from "@/components/filter-bar";
import { LayersPanel } from "@/components/layers-panel";
import { ChartAppearance } from "@/components/chart-appearance";
import {
  DEFAULT_PREFERENCES,
  JOURNAL_TIME_ZONE,
  effectiveStyle,
  mergeStyle,
  styleDiff,
  symbolPrefsKey,
  type ChartPreferences,
  type StyleDiff,
} from "@/lib/chart-preferences";
import type {
  ChartAppearance as ChartAppearanceProps,
  DrawingPrefsPatch,
} from "@/components/analysis-chart";
import { IndicatorsPanel } from "@/components/indicators-panel";
import { PineEditor, type EditorDraft } from "@/components/pine-editor";
import type { ChartIndicator, IndicatorAlert } from "@/components/chart-indicators-bridge";
import {
  resolveSource,
  type ChartScript,
  type IndicatorRef,
  type StoredIndicator,
} from "@/lib/chart-indicators";
import { NEW_INDICATOR_TEMPLATE } from "@/lib/indicator-library";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/section-card";
import { DatePicker } from "@/components/ui/date-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import {
  analysisImagePath,
  analysisEditPath,
  analysisLabel,
  drawingLabel,
  drawingsProblem,
  isDayKey,
  MAX_SNAPSHOT_BYTES,
  snapshotViewPath,
  type AnalysisSnapshot,
  type AnalysisSnapshotSummary,
  type ChartAnalysis,
  type ChartAnalysisSummary,
  type DrawingsDocument,
} from "@/lib/chart-analysis";
import {
  defaultLayers,
  drawingName,
  effectiveLayer,
  layerOf,
  placeNewDrawing,
  syncAssignments,
  type LayersDocument,
} from "@/lib/chart-layers";
import { INITIAL_BARS, type LatestBar, type LiveStatus } from "@/lib/live-market";
import {
  RESOLUTIONS,
  isResolution,
  type MarketConnection,
  type Resolution,
} from "@/lib/market-data";
import type { MarketCsvDataset } from "@/lib/market-csv";
import { providerInfo } from "@/lib/market-providers";
import { lineCrossings } from "@/lib/price-alerts";
import { recentSymbols, type RecentSymbol } from "@/lib/recent-symbols";
import { postJson, useApi } from "@/lib/use-api";
import { cn, fmtNumber } from "@/lib/utils";
import { BackgroundAlerts } from "@/components/background-alerts";
import { MultiviewMenu, PaneHeader, multiviewLayout } from "@/components/multiview";
import { createChartSync, type ChartSync } from "@/lib/chart-sync";
import {
  DEFAULT_MULTIVIEW,
  MAIN_CHART,
  multiviewPreference,
  paneStart,
  type MainMarket,
  type MultiviewState,
} from "@/lib/multiview";
import { TimeframeBar } from "@/components/timeframe-bar";
import { OverlaysPanel } from "@/components/overlays-panel";
import { ZonesPanel } from "@/components/zones-panel";
import { MissedTradeDialog } from "@/components/missed-trade-dialog";
import { usePrivacy } from "@/components/privacy";
import type { OverlayState } from "@/components/chart-overlays";
import { DEFAULT_TIMEFRAMES, timeframePreference } from "@/lib/chart-timeframes";
import {
  DEFAULT_OVERLAYS,
  overlayPreference,
  type ChartOverlayData,
  type OverlayOptions,
} from "@/lib/chart-overlays";
import type { CalendarState } from "@/lib/economic-calendar";
import { zoneEvents, zoneFromClicks, type SrZone, type ZoneStats } from "@/lib/sr-zones";

export default function ChartsPage() {
  return (
    <Suspense>
      <ChartLab />
    </Suspense>
  );
}

interface Board {
  /** Remounts the chart: another source, symbol or analysis. */
  key: number;
  provider: string;
  dataset: string | null;
  symbol: string;
  analysis: ChartAnalysis | null;
  /** Saved indicators with their current code (library or My indicators). */
  indicators: StoredIndicator[];
}

const EXTRA_SYMBOLS_KEY = "journal-chart-extra-symbols-v1";

/** Journal symbols the user also wants on a chart (e.g. MES trades on an ES chart), per chart. */
function extraSymbolsFor(chartKey: string): string {
  try {
    const map = JSON.parse(localStorage.getItem(EXTRA_SYMBOLS_KEY) ?? "{}") as Record<
      string,
      unknown
    >;
    const value = map[chartKey];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function saveExtraSymbols(chartKey: string, value: string) {
  try {
    const map = JSON.parse(localStorage.getItem(EXTRA_SYMBOLS_KEY) ?? "{}") as Record<
      string,
      unknown
    >;
    if (value.trim()) map[chartKey] = value;
    else delete map[chartKey];
    localStorage.setItem(EXTRA_SYMBOLS_KEY, JSON.stringify(map));
  } catch {
    // Remembered for this page only.
  }
}

const newZoneId = () => `zone-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** One entry in the alerts log: a line crossing, a zone event or an indicator's `alert()`. */
interface AlertEntry {
  key: string;
  label: string;
  at: number;
  drawingId?: string;
  direction?: "up" | "down";
}

type SaveState =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "saving" }
  | { state: "saved"; at: number }
  | { state: "error"; message: string };

const SAVE_DELAY_MS = 1200;
/** Snapshots are heavier than drawings; refresh the journal image at most this often. */
const SNAPSHOT_EVERY_MS = 15_000;
const ALERT_COOLDOWN_MS = 60_000;
const ALERTS_KEY = "journal-chart-alerts-v1";

/** What a save needs from the chart, kept after each edit so a save still works once the
 *  chart has unmounted (navigating away within the save delay). */
interface ChartCapture {
  drawings: DrawingsDocument;
  visible: { from: number; to: number } | null;
  loaded: { from: number; to: number } | null;
}

/** What opening a chart asks for: a symbol, a saved analysis, or a day's version of one. */
interface OpenTarget {
  provider?: string;
  dataset?: string | null;
  symbol?: string;
  analysisId?: string;
  /** Open this day's version of the analysis, read-only. */
  snapshotDay?: string;
  fresh?: boolean;
  /** The candle size for a symbol that opens without a saved analysis. */
  resolution?: Resolution;
  /** An analysis that is gone or open in another chart opens the symbol instead. */
  fallback?: boolean;
}

/** Where the chart you are working on shows its controls: header, top card, below, sidebar. */
interface Slots {
  header: HTMLElement;
  top: HTMLElement;
  below: HTMLElement;
  side: HTMLElement;
}

/** What a chart tells the page about itself, and what the page can ask of it. */
interface BoardReport extends MainMarket {
  resolution: Resolution;
  analysisId: string | null;
}
interface BoardApi {
  open: (target: OpenTarget) => Promise<void>;
  current: () => { analysisId: string | null; viewing: string | null; opening: boolean };
  started: () => boolean;
}

/** Stable page services every chart uses. */
interface Shell {
  prefs: () => ChartPreferences;
  sync: ChartSync;
  activate: (paneId: string) => void;
  /** The other chart that has this analysis open, if any. */
  heldBy: (analysisId: string, except: string) => string | null;
  hold: (paneId: string, analysisId: string | null) => void;
  report: (paneId: string, info: BoardReport | null) => void;
  register: (paneId: string, api: BoardApi) => () => void;
  closePane: (paneId: string) => void;
  addRecent: (item: RecentSymbol) => void;
}

/** Page data and per-browser choices every chart shares. */
interface Shared {
  settings: { timeZone: string } | null;
  connections: { connections: MarketConnection[] } | null;
  connectionError: string | null;
  available: MarketConnection[];
  allAnalyses: { analyses: ChartAnalysisSummary[] } | null;
  refreshAll: () => void;
  scripts: ChartScript[];
  refreshScripts: () => void;
  calendar: CalendarState | null;
  calendarAction: (action: "enable" | "disable" | "refresh") => Promise<void>;
  prefs: ChartPreferences;
  prefsReady: boolean;
  savePrefs: (next: ChartPreferences) => void;
  recent: RecentSymbol[];
  shownTimeframes: Resolution[];
  changeShownTimeframes: (next: Resolution[]) => void;
  overlayOptions: OverlayOptions;
  changeOverlays: (next: OverlayOptions) => void;
  alertsOn: boolean;
  toggleAlerts: () => Promise<void>;
  multiview: MultiviewState;
  changeMultiview: (next: MultiviewState) => void;
}

/**
 * The charts page: one chart, or several in multiview. Every chart is a full ChartBoard
 * with its own analysis; the one you work on (the active chart) shows its controls in the
 * page's header, top card, sidebar and below the charts.
 */
function ChartLab() {
  const params = useSearchParams();
  const { data: settings } = useApi<{ timeZone: string }>("/api/settings");
  const { data: connections, error: connectionError } = useApi<{
    connections: MarketConnection[];
  }>("/api/market-data/connections");
  const available = useMemo(
    () => connections?.connections.filter((c) => c.configured) ?? [],
    [connections],
  );
  const { data: allAnalyses, refresh: refreshAll } = useApi<{ analyses: ChartAnalysisSummary[] }>(
    "/api/analyses",
  );
  const { data: scriptData, refresh: refreshScripts } = useApi<{ scripts: ChartScript[] }>(
    "/api/chart-scripts",
  );
  const scripts = useMemo(() => scriptData?.scripts ?? [], [scriptData]);

  // ── Chart preferences (looks, symbols, drawing defaults), saved on the server ──
  const { data: prefsData } = useApi<{ preferences: ChartPreferences }>("/api/chart-preferences");
  const [prefs, setPrefs] = useState<ChartPreferences>(DEFAULT_PREFERENCES);
  const [prefsReady, setPrefsReady] = useState(false);
  const [prefsError, setPrefsError] = useState("");
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  useEffect(() => {
    if (!prefsData || prefsReady) return;
    setPrefs(prefsData.preferences);
    prefsRef.current = prefsData.preferences;
    setPrefsReady(true);
  }, [prefsData, prefsReady]);
  const prefsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePrefs = useCallback((next: ChartPreferences) => {
    prefsRef.current = next;
    setPrefs(next);
    if (prefsTimer.current) clearTimeout(prefsTimer.current);
    prefsTimer.current = setTimeout(() => {
      postJson("/api/chart-preferences", prefsRef.current, "PUT")
        .then(() => setPrefsError(""))
        .catch((cause) =>
          setPrefsError(cause instanceof Error ? cause.message : "Could not save chart settings."),
        );
    }, 400);
  }, []);

  // ── Per-browser choices every chart shares ──
  const [recent, setRecent] = useState<RecentSymbol[]>([]);
  const [shownTimeframes, setShownTimeframes] = useState(DEFAULT_TIMEFRAMES);
  const [overlayOptions, setOverlayOptions] = useState<OverlayOptions>(DEFAULT_OVERLAYS);
  const overlaysRef = useRef(overlayOptions);
  overlaysRef.current = overlayOptions;
  const [alertsOn, setAlertsOn] = useState(false);
  useEffect(() => {
    setRecent(recentSymbols.read());
    setShownTimeframes(timeframePreference.read());
    setOverlayOptions(overlayPreference.read());
    try {
      setAlertsOn(localStorage.getItem(ALERTS_KEY) === "on");
    } catch {
      // Stays off.
    }
  }, []);
  const changeShownTimeframes = useCallback((next: Resolution[]) => {
    setShownTimeframes(next);
    timeframePreference.write(next);
  }, []);
  const changeOverlays = useCallback((next: OverlayOptions) => {
    setOverlayOptions(next);
    overlayPreference.write(next);
  }, []);
  const toggleAlerts = useCallback(async () => {
    const next = !alertsOn;
    setAlertsOn(next);
    try {
      localStorage.setItem(ALERTS_KEY, next ? "on" : "off");
    } catch {
      // Per-page only.
    }
    if (next && typeof Notification !== "undefined" && Notification.permission === "default")
      await Notification.requestPermission().catch(() => "denied");
  }, [alertsOn]);

  // A year back (events accumulate from when the feed was enabled) and two weeks ahead.
  const [calendarWindow] = useState(() => {
    const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    return `from=${hour - 366 * 86_400_000}&to=${hour + 14 * 86_400_000}`;
  });
  const { data: calendar, refresh: refreshCalendar } = useApi<CalendarState>(
    `/api/economic-events?${calendarWindow}`,
  );
  useEffect(() => {
    // The server refetches the feed at most hourly; this re-reads what it stored.
    const timer = setInterval(refreshCalendar, 30 * 60_000);
    return () => clearInterval(timer);
  }, [refreshCalendar]);
  const calendarAction = useCallback(
    async (action: "enable" | "disable" | "refresh") => {
      await postJson("/api/economic-events", { action });
      if (action === "enable") changeOverlays({ ...overlaysRef.current, economic: true });
      refreshCalendar();
    },
    [changeOverlays, refreshCalendar],
  );

  // ── Multiview: optional extra charts, each a full chart ──
  const [multiview, setMultiview] = useState<MultiviewState>(DEFAULT_MULTIVIEW);
  const multiviewRef = useRef(multiview);
  multiviewRef.current = multiview;
  useEffect(() => setMultiview(multiviewPreference.read()), []);
  const changeMultiview = useCallback((next: MultiviewState) => {
    multiviewRef.current = next;
    setMultiview(next);
    multiviewPreference.write(next);
  }, []);
  const [chartSync] = useState(() => createChartSync(DEFAULT_MULTIVIEW.sync));
  useEffect(() => chartSync.setOptions(multiview.sync), [chartSync, multiview.sync]);
  const shown = multiview.enabled ? multiview.panes.slice(0, multiview.count) : [];
  const [active, setActive] = useState(MAIN_CHART);
  // Back to the first chart when the one you worked on closes.
  const activeId = shown.some((p) => p.id === active) ? active : MAIN_CHART;

  /** Which analysis each chart has open: one analysis is only ever open in one chart. */
  const held = useRef(new Map<string, string | null>());
  const boards = useRef(new Map<string, BoardApi>());
  const [mainMarket, setMainMarket] = useState<MainMarket | null>(null);
  const shell = useMemo<Shell>(
    () => ({
      prefs: () => prefsRef.current,
      sync: chartSync,
      activate: setActive,
      heldBy: (analysisId, except) => {
        for (const [id, value] of held.current)
          if (id !== except && value === analysisId && boards.current.has(id)) return id;
        return null;
      },
      // A chart that closed (saving on its way out) holds nothing.
      hold: (paneId, analysisId) => {
        if (boards.current.has(paneId)) held.current.set(paneId, analysisId);
      },
      report: (paneId, info) => {
        if (!info) return;
        if (paneId === MAIN_CHART) {
          setMainMarket((prev) =>
            prev &&
            prev.provider === info.provider &&
            prev.dataset === info.dataset &&
            prev.symbol === info.symbol
              ? prev
              : { provider: info.provider, dataset: info.dataset, symbol: info.symbol },
          );
          return;
        }
        // An extra chart remembers what it shows, to reopen it next time.
        const current = multiviewRef.current;
        const pane = current.panes.find((p) => p.id === paneId);
        if (!pane) return;
        const next = {
          id: pane.id,
          provider: info.provider,
          dataset: info.dataset,
          symbol: info.symbol,
          resolution: info.resolution,
          analysisId: info.analysisId,
        };
        if (JSON.stringify(next) === JSON.stringify(pane)) return;
        changeMultiview({
          ...current,
          panes: current.panes.map((p) => (p.id === paneId ? next : p)),
        });
      },
      register: (paneId, api) => {
        boards.current.set(paneId, api);
        return () => void boards.current.delete(paneId);
      },
      closePane: (paneId) => {
        const current = multiviewRef.current;
        const pane = current.panes.find((p) => p.id === paneId);
        if (!pane) return;
        changeMultiview(
          current.count > 1
            ? {
                ...current,
                count: current.count - 1,
                // Its settings wait at the end for the next time you add a chart.
                panes: [...current.panes.filter((p) => p.id !== paneId), pane],
              }
            : { ...current, enabled: false },
        );
      },
      addRecent: (item) => setRecent(recentSymbols.add(item)),
    }),
    [chartSync, changeMultiview],
  );

  // Links to an analysis (journal embeds, day versions, shared URLs) open it in the chart
  // that has it, or in the first chart. The first chart opens the page's own link itself.
  const linkedId = params.get("id");
  const linkedSnapshot = params.get("snapshot");
  const linkedDay = isDayKey(linkedSnapshot) ? linkedSnapshot : null;
  useEffect(() => {
    if (!linkedId || !boards.current.get(MAIN_CHART)?.started()) return;
    const holder = shell.heldBy(linkedId, "") ?? MAIN_CHART;
    const board = boards.current.get(holder);
    const now = board?.current();
    if (!board || !now || now.opening) return;
    if (now.analysisId === linkedId && now.viewing === linkedDay) return;
    void board.open({ analysisId: linkedId, snapshotDay: linkedDay ?? undefined });
    setActive(holder);
  }, [linkedId, linkedDay, shell]);

  const defaultResolution = prefs.defaults.resolution;
  const starts = useMemo(
    () => new Map(multiview.panes.map((p) => [p.id, paneStart(p, mainMarket, defaultResolution)])),
    [multiview.panes, mainMarket, defaultResolution],
  );

  const [header, setHeader] = useState<HTMLElement | null>(null);
  const [top, setTop] = useState<HTMLElement | null>(null);
  const [below, setBelow] = useState<HTMLElement | null>(null);
  const [side, setSide] = useState<HTMLElement | null>(null);
  const slots = useMemo<Slots | null>(
    () => (header && top && below && side ? { header, top, below, side } : null),
    [header, top, below, side],
  );

  const shared = useMemo<Shared>(
    () => ({
      settings,
      connections,
      connectionError,
      available,
      allAnalyses,
      refreshAll,
      scripts,
      refreshScripts,
      calendar,
      calendarAction,
      prefs,
      prefsReady,
      savePrefs,
      recent,
      shownTimeframes,
      changeShownTimeframes,
      overlayOptions,
      changeOverlays,
      alertsOn,
      toggleAlerts,
      multiview,
      changeMultiview,
    }),
    [
      settings,
      connections,
      connectionError,
      available,
      allAnalyses,
      refreshAll,
      scripts,
      refreshScripts,
      calendar,
      calendarAction,
      prefs,
      prefsReady,
      savePrefs,
      recent,
      shownTimeframes,
      changeShownTimeframes,
      overlayOptions,
      changeOverlays,
      alertsOn,
      toggleAlerts,
      multiview,
      changeMultiview,
    ],
  );

  const layout = multiviewLayout(multiview);
  const ids = [MAIN_CHART, ...shown.map((p) => p.id)];
  return (
    <div>
      <div ref={setHeader} className="contents" />
      <div className="grid gap-3 p-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div ref={setTop} className="contents" />
          <div className={layout.container}>
            {ids.map((id, index) => {
              const cell = layout.cell(index);
              return (
                <ChartBoard
                  key={id}
                  paneId={id}
                  active={id === activeId}
                  multi={layout.total > 1}
                  cellClass={cell.cell}
                  size={cell.size}
                  start={id === MAIN_CHART ? null : (starts.get(id) ?? null)}
                  slots={slots}
                  shared={shared}
                  shell={shell}
                />
              );
            })}
          </div>
          <div ref={setBelow} className="contents" />
          {prefsError && (
            <p role="alert" className="text-sm text-destructive">
              {prefsError}
            </p>
          )}
        </div>
        <div ref={setSide} className="space-y-3" />
      </div>
    </div>
  );
}

type PaneStart = NonNullable<ReturnType<typeof paneStart>>;

const ChartBoard = memo(function ChartBoard({
  paneId,
  active,
  multi,
  cellClass,
  size,
  start,
  slots,
  shared,
  shell,
}: {
  paneId: string;
  /** The chart you work on: its controls show in the page's slots. */
  active: boolean;
  /** Multiview is on. */
  multi: boolean;
  cellClass: string;
  size: "full" | "pane";
  /** What an extra chart opens first; the first chart follows the URL instead. */
  start: PaneStart | null;
  slots: Slots | null;
  shared: Shared;
  shell: Shell;
}) {
  const main = paneId === MAIN_CHART;
  const params = useSearchParams();
  const router = useRouter();
  const {
    settings,
    connections,
    connectionError,
    available,
    allAnalyses,
    refreshAll,
    scripts,
    refreshScripts,
    calendar,
    calendarAction,
    prefs,
    prefsReady,
    savePrefs,
    recent,
    shownTimeframes,
    overlayOptions,
    changeOverlays,
    alertsOn,
  } = shared;
  const today = dayKeyOf(new Date().toISOString(), settings?.timeZone ?? "UTC");

  // ── Selection ──
  const [provider, setProvider] = useState(
    () => (main ? params.get("provider") : start?.provider) ?? "",
  );
  const [dataset, setDataset] = useState<string>(
    () => (main ? params.get("dataset") : start?.dataset) ?? "",
  );
  const [symbolDraft, setSymbolDraft] = useState(
    () => (main ? params.get("symbol") : start?.symbol) ?? "",
  );
  const tfParam = main ? params.get("tf") : (start?.resolution ?? null);
  const [resolution, setResolution] = useState<Resolution>(isResolution(tfParam) ? tfParam : "5m");
  const [live, setLive] = useState(true);

  // ── Chart preferences: shared by every chart ──
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const prefsApplied = useRef(false);
  useEffect(() => {
    if (!prefsReady || prefsApplied.current) return;
    prefsApplied.current = true;
    // Defaults for this visit, unless a link chose them.
    if (main && !isResolution(params.get("tf")) && !state.current.board)
      setResolution(prefs.defaults.resolution);
    setLive(prefs.defaults.live);
  }, [prefsReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const [board, setBoard] = useState<Board | null>(null);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const [openError, setOpenError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const privacy = usePrivacy();
  const [extraSymbols, setExtraSymbols] = useState("");
  const [zones, setZones] = useState<SrZone[]>([]);
  const [zoneStats, setZoneStats] = useState<Record<string, ZoneStats>>({});
  /** A click-to-place mode waiting for a chart click. */
  const [placing, setPlacing] = useState<"missed" | "zone" | null>(null);
  const [zoneEdge, setZoneEdge] = useState<{ time: number; price: number } | null>(null);
  const [missedPoint, setMissedPoint] = useState<{ time: number; price: number } | null>(null);
  const zoneOrigins = useRef(new Map<string, "above" | "below">());

  // ── The open analysis ──
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const dayParam = params.get("day");
  const [journalDay, setJournalDay] = useState(isDayKey(dayParam) ? dayParam : "");
  const [layers, setLayers] = useState<LayersDocument>(defaultLayers);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveState>({ state: "idle" });
  const [journalStatus, setJournalStatus] = useState<{ day: string } | { error: string } | null>(
    null,
  );
  /** A day's frozen version shown read-only, or null for the live analysis. */
  const [viewing, setViewing] = useState<string | null>(null);
  const { data: snapshotDays, refresh: refreshSnapshotDays } = useApi<{
    snapshots: AnalysisSnapshotSummary[];
  }>(analysisId ? `/api/analyses/${encodeURIComponent(analysisId)}/snapshots` : null);
  const chart = useRef<AnalysisChartHandle>(null);

  // ── Multiview: crosshair and time window in step with the other charts ──
  const sync = useMemo(() => ({ bus: shell.sync, id: paneId }), [shell.sync, paneId]);
  const activeRef = useRef(active);
  activeRef.current = active;
  /** Alerts raised while you worked on another chart, shown on this chart's header. */
  const [unseenAlerts, setUnseenAlerts] = useState(0);
  useEffect(() => {
    if (active) setUnseenAlerts(0);
  }, [active]);
  const { data: symbolAnalyses, refresh: refreshSymbolAnalyses } = useApi<{
    analyses: ChartAnalysisSummary[];
  }>(
    board
      ? `/api/analyses?provider=${encodeURIComponent(board.provider)}&symbol=${encodeURIComponent(board.symbol)}`
      : null,
  );

  // ── Live market ──
  const [status, setStatus] = useState<LiveStatus>({ state: "idle" });
  const [latest, setLatest] = useState<LatestBar | null>(null);
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [indicators, setIndicators] = useState<ChartIndicator[]>([]);
  const [indicatorError, setIndicatorError] = useState("");
  const [editor, setEditor] = useState<{ key: number; draft: EditorDraft } | null>(null);
  const pushAlert = useCallback((entry: AlertEntry) => {
    setAlerts((current) => [entry, ...current].slice(0, 20));
    if (!activeRef.current) setUnseenAlerts((n) => n + 1);
  }, []);
  const lastClose = useRef<{ time: number; close: number } | null>(null);
  const alertedAt = useRef(new Map<string, number>());

  // Latest values for async work (autosave, alerts) without re-subscribing.
  const state = useRef({
    analysisId,
    title,
    notes,
    layers,
    board,
    resolution,
    drawings,
    alertsOn,
    indicators,
    zones,
    viewing,
  });
  state.current = {
    analysisId,
    title,
    notes,
    layers,
    board,
    resolution,
    drawings,
    alertsOn,
    indicators,
    zones,
    viewing,
  };

  // ── Autosave ──
  const saver = useRef({
    timer: null as ReturnType<typeof setTimeout> | null,
    dirty: false,
    running: null as Promise<void> | null,
    again: false,
    imageAt: 0,
    capture: null as ChartCapture | null,
  });
  const capture = (): ChartCapture | null => {
    const handle = chart.current;
    if (!handle) return saver.current.capture;
    saver.current.capture = {
      drawings: handle.drawings(),
      visible: handle.visibleRange(),
      loaded: handle.loadedRange(),
    };
    return saver.current.capture;
  };

  const flush = useCallback(
    async (options: { final?: boolean; create?: boolean } = {}): Promise<string | null> => {
      const s = saver.current;
      if (s.timer) clearTimeout(s.timer);
      s.timer = null;
      if (s.running) {
        s.again = true;
        await s.running;
        return state.current.analysisId;
      }
      const current = state.current;
      // A day's version is read-only: nothing on the chart is saved while viewing it.
      if (!current.board || current.viewing) return current.analysisId;
      const refreshSnapshot =
        Boolean(current.analysisId) && options.final && Date.now() - s.imageAt >= SNAPSHOT_EVERY_MS;
      if (!s.dirty && !options.create && !refreshSnapshot) return current.analysisId;
      const handle = chart.current;
      const captured = capture();
      if (!captured) return current.analysisId;
      // Viewing a chart creates nothing; the first drawing, title or note does.
      const worth =
        captured.drawings.drawings.length > 0 ||
        current.indicators.length > 0 ||
        current.zones.length > 0 ||
        current.title.trim() ||
        current.notes.trim();
      if (!current.analysisId && !worth && !options.create) {
        s.dirty = false;
        setSaveState({ state: "idle" });
        return null;
      }
      const board = current.board;
      const run = (async () => {
        s.dirty = false;
        setSaveState({ state: "saving" });
        try {
          const problem = drawingsProblem(captured.drawings);
          if (problem) throw new Error(problem);
          const step = RESOLUTIONS[current.resolution];
          const now = Date.now();
          const rangeFrom = Math.round(captured.loaded?.from ?? now - INITIAL_BARS * step);
          const rangeTo = Math.max(Math.round(captured.loaded?.to ?? now), rangeFrom + 1);
          const visible =
            captured.visible && captured.visible.to > captured.visible.from
              ? captured.visible
              : null;
          const body: Record<string, unknown> = {
            title: current.title,
            notes: current.notes,
            symbol: board.symbol,
            provider: board.provider,
            dataset: board.dataset,
            resolution: current.resolution,
            rangeFrom,
            rangeTo,
            visibleFrom: visible ? Math.round(visible.from) : null,
            visibleTo: visible ? Math.round(visible.to) : null,
            drawings: captured.drawings,
            layers: syncAssignments(
              current.layers,
              captured.drawings.drawings.map((d) => d.id),
            ),
            // The chart's errors are shown, not saved.
            indicators: current.indicators.map(({ error: _error, ...indicator }) => indicator),
            zones: current.zones,
          };
          if (
            handle &&
            (options.final || !current.analysisId || now - s.imageAt >= SNAPSHOT_EVERY_MS)
          ) {
            // A missing snapshot clears the old one rather than showing outdated drawings.
            body.image = await fitSnapshot(handle.screenshot());
            s.imageAt = now;
          }
          const result = current.analysisId
            ? await postJson<{ analysis: ChartAnalysis }>(
                `/api/analyses/${encodeURIComponent(current.analysisId)}`,
                body,
                "PATCH",
              )
            : await postJson<{ analysis: ChartAnalysis }>("/api/analyses", body);
          // A board switched mid-save must not adopt this id.
          if (!current.analysisId && state.current.board === board) {
            state.current.analysisId = result.analysis.id;
            shell.hold(paneId, result.analysis.id);
            setAnalysisId(result.analysis.id);
            refreshSymbolAnalyses();
          }
          refreshAll();
          refreshSnapshotDays();
          if (state.current.board === board) setSaveState({ state: "saved", at: Date.now() });
        } catch (cause) {
          if (state.current.board !== board) return;
          s.dirty = true;
          setSaveState({
            state: "error",
            message: cause instanceof Error ? cause.message : "Could not save.",
          });
        }
      })();
      s.running = run;
      await run;
      s.running = null;
      if (s.again) {
        s.again = false;
        if (s.dirty) await flush();
      }
      return state.current.analysisId;
    },
    [refreshAll, refreshSymbolAnalyses, refreshSnapshotDays, shell, paneId],
  );

  const schedule = useCallback(() => {
    if (state.current.viewing) return;
    const s = saver.current;
    s.dirty = true;
    capture();
    setSaveState({ state: "pending" });
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  // Save when the tab is hidden or closed, and on leaving the page.
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") void flush({ final: true });
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (saver.current.dirty || saver.current.running) {
        void flush({ final: true });
        event.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("beforeunload", unload);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", unload);
      void flush({ final: true });
    };
  }, [flush]);

  // Keep the URL shareable, with the analysis id once it exists.
  useEffect(() => {
    // The first chart's; extra charts remember theirs in the multiview settings.
    if (!main || !board) return;
    const next = new URLSearchParams();
    next.set("provider", board.provider);
    if (board.dataset) next.set("dataset", board.dataset);
    next.set("symbol", board.symbol);
    next.set("tf", resolution);
    if (analysisId) next.set("id", analysisId);
    if (analysisId && viewing) next.set("snapshot", viewing);
    const url = `/charts?${next}`;
    if (`${window.location.pathname}${window.location.search}` !== url)
      router.replace(url, { scroll: false });
  }, [main, board, analysisId, resolution, router, viewing]);

  // ── Appearance of the open chart ──
  const journalZone = settings?.timeZone ?? "UTC";
  const boardPrefsKey = board ? symbolPrefsKey(board.provider, board.symbol) : null;
  const appearance = useMemo<ChartAppearanceProps>(() => {
    const d = prefs.defaults;
    return {
      style: effectiveStyle(prefs, boardPrefsKey),
      timeZone: d.timeZone === JOURNAL_TIME_ZONE ? journalZone : d.timeZone,
      decimals: boardPrefsKey ? prefs.symbols[boardPrefsKey]?.decimals : undefined,
      volume: d.volume,
      magnet: d.magnet,
      stayInDrawingMode: d.stayInDrawingMode,
      tools: prefs.tools,
      rememberToolStyles: d.rememberToolStyles,
      palette: prefs.palette,
      favoriteTools: prefs.favoriteTools,
    };
  }, [prefs, boardPrefsKey, journalZone]);
  /** A change in Vela's own settings dialog, saved to the look being used. */
  const onLookEdited = useCallback(
    (edit: { style: StyleDiff; base: unknown; timeZone: string | null }) => {
      const current = shell.prefs();
      const key = state.current.board
        ? symbolPrefsKey(state.current.board.provider, state.current.board.symbol)
        : null;
      let next = current;
      const own = key ? current.symbols[key] : undefined;
      if (key && own?.style) {
        const base = mergeStyle((edit.base ?? {}) as StyleDiff, current.style);
        const style = styleDiff(base, mergeStyle((edit.base ?? {}) as StyleDiff, edit.style));
        if (JSON.stringify(style) !== JSON.stringify(own.style))
          next = { ...next, symbols: { ...next.symbols, [key]: { ...own, style } } };
      } else if (JSON.stringify(edit.style) !== JSON.stringify(current.style)) {
        next = { ...next, style: edit.style };
      }
      if (edit.timeZone)
        next = {
          ...next,
          defaults: {
            ...next.defaults,
            timeZone: edit.timeZone === journalZone ? JOURNAL_TIME_ZONE : edit.timeZone,
          },
        };
      if (next !== current) savePrefs(next);
    },
    [savePrefs, journalZone, shell],
  );
  const onDrawingPrefs = useCallback(
    (patch: DrawingPrefsPatch) => {
      const current = shell.prefs();
      savePrefs({
        ...current,
        ...(patch.palette ? { palette: patch.palette } : {}),
        ...(patch.favoriteTools ? { favoriteTools: patch.favoriteTools } : {}),
        defaults: {
          ...current.defaults,
          ...(patch.magnet ? { magnet: patch.magnet } : {}),
          ...(patch.stayInDrawingMode !== undefined
            ? { stayInDrawingMode: patch.stayInDrawingMode }
            : {}),
        },
      });
    },
    [savePrefs, shell],
  );
  const onToolStyle = useCallback(
    (type: string, style: ChartPreferences["tools"][string]) => {
      const current = shell.prefs();
      savePrefs({ ...current, tools: { ...current.tools, [type]: style } });
    },
    [savePrefs, shell],
  );
  const watchlist = Object.entries(prefs.symbols)
    .filter(([, s]) => s.favorite)
    .map(([key, s]) => {
      const [provider = "", symbol = ""] = key.split("|");
      return { key, provider, symbol, label: s.label, color: s.color };
    });
  const symbolLabel = (provider: string, symbol: string) =>
    prefs.symbols[symbolPrefsKey(provider, symbol)]?.label || symbol;

  // ── Opening a chart ──
  const boardKey = useRef(0);
  const openBoard = useCallback(
    async (target: OpenTarget) => {
      // An analysis open in another chart is worked on there.
      const elsewhere = target.analysisId ? shell.heldBy(target.analysisId, paneId) : null;
      if (elsewhere && !target.fallback) {
        shell.activate(elsewhere);
        return;
      }
      const wanted = target.analysisId && !elsewhere ? target.analysisId : null;
      const snapshotDay = wanted && target.snapshotDay ? target.snapshotDay : null;
      // Claimed before loading, so two charts opening at once never pick the same one.
      if (wanted) shell.hold(paneId, wanted);
      openingRef.current = true;
      setOpening(true);
      setOpenError("");
      try {
        await flush({ final: true });
        const read = async <T,>(url: string): Promise<T> => {
          const response = await fetch(url);
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "Request failed.");
          return body as T;
        };
        let analysis: ChartAnalysis | null = null;
        const saved = await read<{ scripts: ChartScript[] }>("/api/chart-scripts");
        // Saving the chart it had may have claimed that one's new id.
        if (wanted) shell.hold(paneId, wanted);
        try {
          if (wanted && snapshotDay) {
            analysis = (
              await read<{ snapshot: AnalysisSnapshot }>(
                `/api/analyses/${encodeURIComponent(wanted)}/snapshots/${snapshotDay}`,
              )
            ).snapshot;
          } else if (wanted) {
            analysis = (
              await read<{ analysis: ChartAnalysis }>(`/api/analyses/${encodeURIComponent(wanted)}`)
            ).analysis;
          }
        } catch (cause) {
          if (!target.fallback) throw cause;
        }
        if (!analysis && !target.fresh && target.provider && target.symbol) {
          // Each symbol reopens its latest analysis, drawings included, unless another
          // chart has it open.
          const list = await read<{ analyses: ChartAnalysisSummary[] }>(
            `/api/analyses?provider=${encodeURIComponent(target.provider)}&symbol=${encodeURIComponent(target.symbol.trim())}`,
          );
          const newest = list.analyses.find((a) => !shell.heldBy(a.id, paneId));
          if (newest) {
            shell.hold(paneId, newest.id);
            analysis = (
              await read<{ analysis: ChartAnalysis }>(
                `/api/analyses/${encodeURIComponent(newest.id)}`,
              )
            ).analysis;
          }
        }
        shell.hold(paneId, analysis?.id ?? null);
        const nextProvider = analysis?.provider ?? target.provider!;
        const nextSymbol = analysis?.symbol ?? target.symbol!.trim();
        const nextDataset = analysis ? analysis.dataset : (target.dataset ?? null);
        boardKey.current += 1;
        saver.current = {
          timer: null,
          dirty: false,
          running: null,
          again: false,
          imageAt: analysis ? Date.now() : 0,
          capture: null,
        };
        lastClose.current = null;
        alertedAt.current.clear();
        setLatest(null);
        setStatus({ state: "loading" });
        setProvider(nextProvider);
        setDataset(nextDataset ?? "");
        setSymbolDraft(nextSymbol);
        state.current.analysisId = analysis?.id ?? null;
        setAnalysisId(analysis?.id ?? null);
        state.current.viewing = snapshotDay;
        setViewing(snapshotDay);
        setTitle(analysis?.title ?? "");
        setNotes(analysis?.notes ?? "");
        setLayers(analysis?.layers ?? defaultLayers());
        const restored = (analysis?.indicators ?? []).map((indicator) => ({
          ...indicator,
          source: resolveSource(indicator, saved.scripts),
        }));
        setIndicators(restored);
        state.current.indicators = restored;
        setIndicatorError("");
        setZones(analysis?.zones ?? []);
        state.current.zones = analysis?.zones ?? [];
        setZoneStats({});
        zoneOrigins.current.clear();
        setPlacing(null);
        setZoneEdge(null);
        setEditor(null);
        setDrawings([]);
        setSelectedIds([]);
        setJournalStatus(null);
        if (snapshotDay) setJournalDay(snapshotDay);
        else if (analysis?.dayDate) setJournalDay(analysis.dayDate);
        if (analysis) setResolution(analysis.resolution);
        else if (target.resolution) setResolution(target.resolution);
        else {
          const own = shell.prefs().symbols[symbolPrefsKey(nextProvider, nextSymbol)];
          if (own?.resolution) setResolution(own.resolution);
        }
        setSaveState(
          analysis && !snapshotDay
            ? { state: "saved", at: Date.parse(analysis.updatedAt) }
            : { state: "idle" },
        );
        const next: Board = {
          key: boardKey.current,
          provider: nextProvider,
          dataset: nextDataset,
          symbol: nextSymbol,
          analysis,
          indicators: restored,
        };
        state.current.board = next;
        setBoard(next);
        shell.addRecent({ provider: nextProvider, dataset: nextDataset, symbol: nextSymbol });
      } catch (cause) {
        shell.hold(paneId, state.current.analysisId);
        setOpenError(cause instanceof Error ? cause.message : "Could not open the chart.");
      } finally {
        openingRef.current = false;
        setOpening(false);
      }
    },
    [flush, shell, paneId],
  );

  // The page routes links to the chart that has the analysis, and follows what each shows.
  // Registered before the first open, so that open's claim counts.
  const started = useRef(false);
  const openRef = useRef(openBoard);
  openRef.current = openBoard;
  useEffect(
    () =>
      shell.register(paneId, {
        open: (target) => openRef.current(target),
        current: () => ({
          analysisId: state.current.analysisId,
          viewing: state.current.viewing,
          opening: openingRef.current,
        }),
        started: () => started.current,
      }),
    [shell, paneId],
  );
  // First open. The first chart: the linked analysis, the linked symbol, or the last symbol
  // you watched. An extra chart: what it showed last time, or the first chart's symbol.
  useEffect(() => {
    if (started.current || !connections) return;
    const connected = (id: string) => available.some((a) => a.id === id);
    if (!main) {
      if (start && connected(start.provider)) {
        started.current = true;
        void openBoard({
          provider: start.provider,
          dataset: start.dataset,
          symbol: start.symbol,
          resolution: start.resolution,
          analysisId: start.analysisId ?? undefined,
          fallback: true,
        });
      } else if (available.length && !connected(provider)) setProvider(available[0]!.id);
      return;
    }
    started.current = true;
    const id = params.get("id");
    const symbol = params.get("symbol");
    const fromUrl = params.get("provider");
    const last = recentSymbols.read().find((r) => connected(r.provider));
    const day = params.get("snapshot");
    if (id) void openBoard({ analysisId: id, snapshotDay: isDayKey(day) ? day : undefined });
    else if (symbol && fromUrl && connected(fromUrl))
      void openBoard({ provider: fromUrl, dataset: params.get("dataset"), symbol });
    else if (last) void openBoard(last);
    else if (available.length && !connected(provider)) setProvider(available[0]!.id);
  }, [main, start, connections, available, params, openBoard, provider]);

  useEffect(() => {
    shell.report(
      paneId,
      board
        ? {
            provider: board.provider,
            dataset: board.dataset,
            symbol: board.symbol,
            resolution,
            analysisId,
          }
        : null,
    );
  }, [shell, paneId, board, resolution, analysisId]);

  const info = providerInfo(provider);
  const { data: csv } = useApi<{ datasets: MarketCsvDataset[] }>(
    info?.mode === "csv" ? "/api/market-data/csv" : null,
  );
  const resolutions = (info?.resolutions ?? (Object.keys(RESOLUTIONS) as Resolution[])).filter(
    (value): value is Resolution => value in RESOLUTIONS,
  );
  const needsDataset = Boolean(info?.datasets);
  const canOpen =
    available.some((a) => a.id === provider) &&
    symbolDraft.trim().length > 0 &&
    !(needsDataset && !dataset) &&
    !opening;
  const openTyped = () => {
    if (!canOpen) return;
    const symbol = symbolDraft.trim();
    if (
      board &&
      board.provider === provider &&
      board.symbol === symbol &&
      (board.dataset ?? "") === dataset
    )
      return;
    void openBoard({ provider, dataset: dataset || null, symbol });
  };

  // ── Chart callbacks ──
  // Into the active layer, or inside the drawing you chose to draw into (or the focus).
  const onDrawingCreated = useCallback((id: string) => {
    setLayers((doc) => placeNewDrawing(doc, id));
  }, []);
  const onDrawingsChange = useCallback((next: ChartDrawing[]) => {
    setDrawings(next);
    setLayers((doc) =>
      syncAssignments(
        doc,
        next.map((d) => d.id),
      ),
    );
  }, []);
  const changeLayers = (next: LayersDocument) => {
    setLayers(next);
    state.current.layers = next;
    schedule();
  };

  const onLatest = useCallback(
    (update: LatestBar) => {
      setLatest(update);
      const bar = { time: update.bar.time, close: update.bar.close };
      const previous = lastClose.current;
      lastClose.current = bar;
      if (!previous || !state.current.alertsOn || bar.time < previous.time) return;
      const now = Date.now();
      const zoneSymbol = state.current.board?.symbol ?? "";
      const zoneHits = zoneEvents(
        state.current.zones,
        previous.close,
        bar.close,
        zoneOrigins.current,
      );
      for (const event of zoneHits) {
        const zone = state.current.zones.find((z) => z.id === event.zoneId);
        const key = `zone-${event.zoneId}-${event.kind}`;
        if (!zone || now - (alertedAt.current.get(key) ?? 0) < ALERT_COOLDOWN_MS) continue;
        alertedAt.current.set(key, now);
        const range = `${zone.label ? `${zone.label} ` : ""}${fmtNumber(zone.low)} to ${fmtNumber(zone.high)}`;
        const label =
          event.kind === "enter"
            ? `${zoneSymbol} entered the zone ${range}`
            : `${zoneSymbol} broke ${event.direction === "up" ? "above" : "below"} the zone ${range}`;
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted")
            new Notification("Zone alert", { body: label, tag: `${zoneSymbol}-${key}` });
        } catch {
          // The in-page log still shows it.
        }
        pushAlert({ key: `${key}-${now}`, label, at: now, direction: event.direction });
      }
      const hits = lineCrossings(
        state.current.drawings.filter((d) => layerVisible(state.current.layers, d.id)),
        previous,
        bar,
      ).filter((hit) => now - (alertedAt.current.get(hit.drawingId) ?? 0) > ALERT_COOLDOWN_MS);
      if (!hits.length) return;
      const symbol = state.current.board?.symbol ?? "";
      for (const hit of hits) {
        alertedAt.current.set(hit.drawingId, now);
        const drawing = state.current.drawings.find((d) => d.id === hit.drawingId);
        const label =
          drawingName(state.current.layers, hit.drawingId) ?? drawingLabel(hit.type, drawing?.text);
        const message = `${symbol} crossed ${hit.direction === "up" ? "above" : "below"} ${label} at ${fmtNumber(hit.price)}`;
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted")
            new Notification("Chart alert", { body: message, tag: `${symbol}-${hit.drawingId}` });
        } catch {
          // The in-page log still shows it.
        }
        pushAlert({
          key: `${hit.drawingId}-${now}`,
          label: message,
          at: now,
          drawingId: hit.drawingId,
          direction: hit.direction,
        });
      }
    },
    [pushAlert],
  );

  // ── Journal overlays: trades, missed trades, zones, sessions, economic events ──
  const extraKey = board ? `${board.provider}|${board.symbol}` : "";
  useEffect(() => {
    if (!extraKey) return;
    setExtraSymbols(extraSymbolsFor(extraKey));
  }, [extraKey]);
  const changeExtraSymbols = (value: string) => {
    setExtraSymbols(value);
    saveExtraSymbols(extraKey, value);
  };
  const { data: overlayData, refresh: refreshOverlays } = useApi<ChartOverlayData>(
    board
      ? `/api/chart-overlays?symbol=${encodeURIComponent(board.symbol)}&extra=${encodeURIComponent(extraSymbols)}`
      : null,
  );
  const changeZones = useCallback(
    (next: SrZone[]) => {
      setZones(next);
      state.current.zones = next;
      schedule();
    },
    [schedule],
  );
  const overlay = useMemo<OverlayState>(
    () => ({
      data: overlayData ?? { symbols: [], trades: [], missed: [] },
      options: {
        ...overlayOptions,
        economic: overlayOptions.economic && Boolean(calendar?.enabled),
      },
      zones,
      events: calendar?.events ?? [],
      privacy,
      pendingZone: zoneEdge?.price ?? null,
    }),
    [overlayData, overlayOptions, zones, calendar, privacy, zoneEdge],
  );
  const captureState = useRef({ placing, zoneEdge });
  captureState.current = { placing, zoneEdge };
  const overlayHooks = useMemo(
    () => ({
      onOpenTrade: (key: string) => router.push(`/trades/${encodeURIComponent(key)}`),
      onOpenMissed: () => router.push("/missed"),
      onZoneStats: (stats: Record<string, ZoneStats>) =>
        setZoneStats((current) =>
          JSON.stringify(current) === JSON.stringify(stats) ? current : stats,
        ),
      onChartClick: (point: { time: number; price: number }) => {
        const { placing: mode, zoneEdge: first } = captureState.current;
        if (mode === "missed") {
          setPlacing(null);
          setMissedPoint(point);
          return true;
        }
        if (mode !== "zone") return false;
        if (!first) {
          setZoneEdge(point);
          captureState.current.zoneEdge = point;
          return true;
        }
        setZoneEdge(null);
        setPlacing(null);
        captureState.current = { placing: null, zoneEdge: null };
        changeZones([...state.current.zones, zoneFromClicks(newZoneId(), first, point)]);
        return true;
      },
    }),
    [router, changeZones],
  );
  const cancelCapture = () => {
    setPlacing(null);
    setZoneEdge(null);
  };
  useEffect(() => {
    if (!placing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelCapture();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing]);

  // ── Indicators ──
  const onIndicatorsChange = useCallback(
    (list: ChartIndicator[], edited: boolean) => {
      setIndicators(list);
      state.current.indicators = list;
      if (edited) schedule();
    },
    [schedule],
  );
  const indicatorAlertAt = useRef(new Map<string, number>());
  const onIndicatorAlert = useCallback(
    (alert: IndicatorAlert) => {
      if (!state.current.alertsOn) return;
      const now = Date.now();
      const key = `${alert.indicator}|${alert.message}`;
      // A script can alert on every tick of a bar; one notice per message per 30 s.
      if (now - (indicatorAlertAt.current.get(key) ?? 0) < 30_000) return;
      indicatorAlertAt.current.set(key, now);
      const symbol = state.current.board?.symbol ?? "";
      const label = `${symbol} · ${alert.indicator}: ${alert.message}`;
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted")
          new Notification("Indicator alert", { body: label, tag: key });
      } catch {
        // The in-page log still shows it.
      }
      pushAlert({ key: `${key}-${now}`, label, at: now });
    },
    [pushAlert],
  );
  const bridge = () => chart.current?.indicators() ?? null;
  const addIndicator = async (ref: IndicatorRef, source: string) => {
    setIndicatorError("");
    const target = bridge();
    if (!target) return setIndicatorError("Open a chart first.");
    const result = await target.add(ref, source);
    if (!result.ok) setIndicatorError(result.error);
  };
  const runDraft = async (draft: EditorDraft) => {
    const target = bridge();
    if (!target) return { error: "Open a chart first." };
    const ref: IndicatorRef = draft.scriptId
      ? { kind: "script", id: draft.scriptId }
      : { kind: "inline" };
    const result = draft.chartIndicatorId
      ? await target.replace(draft.chartIndicatorId, ref, draft.source)
      : await target.add(ref, draft.source);
    if (!result.ok) return { error: result.error };
    // Keep the editor attached to what it now runs as.
    setEditor((current) =>
      current ? { ...current, draft: { ...draft, chartIndicatorId: result.id } } : current,
    );
    return { chartIndicatorId: result.id };
  };
  const saveDraft = async (draft: EditorDraft) => {
    try {
      const { script } = draft.scriptId
        ? await postJson<{ script: ChartScript }>(
            `/api/chart-scripts/${encodeURIComponent(draft.scriptId)}`,
            { name: draft.name, source: draft.source },
            "PATCH",
          )
        : await postJson<{ script: ChartScript }>("/api/chart-scripts", {
            name: draft.name,
            source: draft.source,
          });
      refreshScripts();
      const target = bridge();
      if (target) {
        if (draft.chartIndicatorId)
          target.relink(draft.chartIndicatorId, { kind: "script", id: script.id });
        // Other charts pick up the new code when opened; this one updates in place.
        for (const indicator of state.current.indicators)
          if (
            indicator.ref.kind === "script" &&
            indicator.ref.id === script.id &&
            indicator.id !== draft.chartIndicatorId &&
            indicator.source !== script.source
          )
            await target.replace(indicator.id, indicator.ref, script.source);
      }
      setEditor((current) =>
        current ? { ...current, draft: { ...draft, scriptId: script.id } } : current,
      );
      return { scriptId: script.id };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : "Could not save the indicator." };
    }
  };
  const deleteScript = async (id: string) => {
    await postJson(`/api/chart-scripts/${encodeURIComponent(id)}`, undefined, "DELETE");
    refreshScripts();
    const target = bridge();
    // Indicators from it keep running their saved copy, now as their own code.
    for (const indicator of state.current.indicators)
      if (indicator.ref.kind === "script" && indicator.ref.id === id)
        target?.relink(indicator.id, { kind: "inline" });
  };
  const openEditor = (draft: EditorDraft) =>
    setEditor((current) => ({ key: (current?.key ?? 0) + 1, draft }));

  const addToJournal = async () => {
    const day = journalDay || today;
    setJournalDay(day);
    setJournalStatus(null);
    try {
      const id = await flush({ final: true, create: true });
      if (!id) throw new Error("Open a chart first.");
      await postJson(
        `/api/analyses/${encodeURIComponent(id)}`,
        { dayDate: day, addToJournal: true },
        "PATCH",
      );
      setJournalStatus({ day });
      refreshAll();
    } catch (cause) {
      setJournalStatus({
        error: cause instanceof Error ? cause.message : "Could not add to the journal.",
      });
    }
  };

  const restoreVersion = async () => {
    const id = state.current.analysisId;
    const day = state.current.viewing;
    if (!id || !day) return;
    if (
      !confirm(
        `Replace the live analysis with its ${day} version? Today's version records the change; other days are kept.`,
      )
    )
      return;
    try {
      await postJson(`/api/analyses/${encodeURIComponent(id)}/snapshots/${day}`, {
        action: "restore",
      });
      refreshAll();
      router.replace(analysisEditPath(id));
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : "Could not restore that version.");
    }
  };

  const deleteAnalysis = async (target: ChartAnalysisSummary) => {
    if (
      !confirm(
        `Delete "${analysisLabel(target)}" and its saved day versions? Journal notes keep a placeholder.`,
      )
    )
      return;
    try {
      if (target.id === analysisId) {
        // Stop the pending save from recreating it.
        if (saver.current.timer) clearTimeout(saver.current.timer);
        saver.current.dirty = false;
        await saver.current.running;
      }
      await postJson(`/api/analyses/${encodeURIComponent(target.id)}`, undefined, "DELETE");
      refreshAll();
      refreshSymbolAnalyses();
      if (target.id === analysisId && board) {
        state.current.analysisId = null;
        setAnalysisId(null);
        void openBoard({
          provider: board.provider,
          dataset: board.dataset,
          symbol: board.symbol,
          fresh: true,
        });
      }
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : "Could not delete the analysis.");
    }
  };

  const change = latest && latest.previousClose ? latest.bar.close - latest.previousClose : null;
  const changePct = change !== null && latest?.previousClose ? change / latest.previousClose : null;
  const symbolPrefs = board
    ? prefs.symbols[symbolPrefsKey(board.provider, board.symbol)]
    : undefined;
  /** What "On the chart" shows, for its folded title bar. */
  const overlaySummary = [
    overlayOptions.trades && "trades",
    overlayOptions.missed && "missed",
    overlayOptions.zones && "zones",
    overlayOptions.sessions && "sessions",
    overlayOptions.economic && calendar?.enabled && "calendar",
  ]
    .filter(Boolean)
    .join(", ");
  const topCard = (
    <Card>
      <CardContent className="space-y-3 pt-4">
        {connectionError && (
          <p role="alert" className="text-sm text-destructive">
            {connectionError}
          </p>
        )}
        {connections && !available.length && (
          <p className="text-sm text-muted-foreground">
            Charts stream candles from a market data source you choose.{" "}
            <Link className="underline" href="/settings#market-data">
              Connect a provider or upload a candle CSV in Settings
            </Link>
            . Binance and Coinbase need no key; enable them there first.
          </p>
        )}
        {available.length > 0 && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              openTyped();
            }}
          >
            <div className="w-44 space-y-1">
              <Label htmlFor="chart-provider">Source</Label>
              <OptionSelect
                id="chart-provider"
                value={provider}
                onValueChange={(value) => {
                  setProvider(value);
                  setDataset("");
                }}
              >
                <option value="" disabled>
                  Choose a source
                </option>
                {available.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </OptionSelect>
            </div>
            {(needsDataset || info?.mode === "csv") && (
              <div className="w-48 space-y-1">
                <Label htmlFor="chart-dataset">Feed / file</Label>
                <OptionSelect id="chart-dataset" value={dataset} onValueChange={setDataset}>
                  {(
                    info?.datasets ?? [
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
            <div className="w-36 space-y-1">
              <Label htmlFor="chart-symbol">Symbol</Label>
              <Input
                id="chart-symbol"
                value={symbolDraft}
                placeholder="AAPL"
                autoCapitalize="characters"
                autoComplete="off"
                onChange={(event) => setSymbolDraft(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={!canOpen}>
              {opening ? "Opening…" : "Open"}
            </Button>
            <TimeframeBar
              value={resolution}
              shown={shownTimeframes}
              onChange={(value) => {
                setResolution(value);
                lastClose.current = null;
                if (state.current.analysisId) schedule();
              }}
              onShownChange={shared.changeShownTimeframes}
            />
            <Button
              type="button"
              variant="outline"
              aria-pressed={!live}
              onClick={() => setLive(!live)}
            >
              {live ? <Pause /> : <Play />}
              {live ? "Pause" : "Go live"}
            </Button>
            {board && <MultiviewMenu state={shared.multiview} onChange={shared.changeMultiview} />}
          </form>
        )}
        {watchlist.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" aria-label="Watchlist">
            <Star aria-hidden="true" className="size-3.5 text-muted-foreground" />
            {watchlist.map((item) => {
              const current = board?.provider === item.provider && board.symbol === item.symbol;
              return (
                <Button
                  key={item.key}
                  type="button"
                  size="sm"
                  variant={current ? "secondary" : "outline"}
                  className="h-7 gap-1.5 px-2"
                  disabled={!available.some((a) => a.id === item.provider) || opening}
                  title={`${item.symbol} on ${providerInfo(item.provider)?.name ?? item.provider}`}
                  onClick={() => {
                    if (!current) void openBoard({ provider: item.provider, symbol: item.symbol });
                  }}
                >
                  {item.color && (
                    <span
                      aria-hidden="true"
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                  )}
                  <span className="font-medium">{item.label || item.symbol}</span>
                </Button>
              );
            })}
          </div>
        )}
        {recent.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" aria-label="Recent symbols">
            {recent.map((item) => {
              const current =
                board?.provider === item.provider &&
                board.symbol === item.symbol &&
                (board.dataset ?? null) === (item.dataset ?? null);
              const name = providerInfo(item.provider)?.name ?? item.provider;
              return (
                <Button
                  key={`${item.provider}|${item.dataset ?? ""}|${item.symbol}`}
                  type="button"
                  size="sm"
                  variant={current ? "secondary" : "ghost"}
                  className="h-7 gap-1 px-2"
                  disabled={!available.some((a) => a.id === item.provider) || opening}
                  title={`${item.symbol} on ${name}`}
                  onClick={() => {
                    if (!current) void openBoard(item);
                  }}
                >
                  <span className="font-medium">{symbolLabel(item.provider, item.symbol)}</span>
                  <span className="text-[11px] text-muted-foreground">{name}</span>
                </Button>
              );
            })}
          </div>
        )}
        {openError && (
          <p role="alert" className="text-sm text-destructive">
            {openError}
          </p>
        )}
        {board && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              {prefs.symbols[symbolPrefsKey(board.provider, board.symbol)]?.color && (
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full"
                  style={{
                    backgroundColor:
                      prefs.symbols[symbolPrefsKey(board.provider, board.symbol)]!.color,
                  }}
                />
              )}
              {symbolLabel(board.provider, board.symbol)}
              {symbolLabel(board.provider, board.symbol) !== board.symbol && (
                <span className="text-sm font-normal text-muted-foreground">{board.symbol}</span>
              )}
              <button
                type="button"
                aria-label={
                  prefs.symbols[symbolPrefsKey(board.provider, board.symbol)]?.favorite
                    ? `Remove ${board.symbol} from the watchlist`
                    : `Add ${board.symbol} to the watchlist`
                }
                aria-pressed={Boolean(
                  prefs.symbols[symbolPrefsKey(board.provider, board.symbol)]?.favorite,
                )}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  const key = symbolPrefsKey(board.provider, board.symbol);
                  const own = { ...prefs.symbols[key] };
                  if (own.favorite) delete own.favorite;
                  else own.favorite = true;
                  const symbols = { ...prefs.symbols };
                  if (Object.keys(own).length) symbols[key] = own;
                  else delete symbols[key];
                  savePrefs({ ...prefs, symbols });
                }}
              >
                <Star
                  className={cn(
                    "size-4",
                    prefs.symbols[symbolPrefsKey(board.provider, board.symbol)]?.favorite &&
                      "fill-current text-amber-500",
                  )}
                />
              </button>
            </span>
            {latest ? (
              <>
                <span className="tnum text-lg font-semibold">{fmtNumber(latest.bar.close)}</span>
                {change !== null && changePct !== null && (
                  <span className="tnum text-sm text-muted-foreground">
                    {change >= 0 ? "+" : "−"}
                    {fmtNumber(Math.abs(change))} ({change >= 0 ? "+" : "−"}
                    {(Math.abs(changePct) * 100).toFixed(2)}%) vs previous candle
                  </span>
                )}
              </>
            ) : (
              status.state !== "error" && (
                <span className="text-sm text-muted-foreground">Loading candles…</span>
              )
            )}
            {status.state !== "error" && status.updatedAt && (
              <span className="text-xs text-muted-foreground">
                Updated {new Date(status.updatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        )}
        {status.state === "error" && status.message && (
          <p role="alert" className="text-sm text-destructive">
            {status.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
  const empty = available.length > 0 && (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        {multi && !active
          ? "Click this chart, then type a symbol and press Open."
          : "Type a symbol and press Open. The chart loads the latest candles and keeps updating; your drawings save automatically."}
      </CardContent>
    </Card>
  );
  const activate = active ? undefined : () => shell.activate(paneId);
  return (
    <>
      <div
        className={cn(
          cellClass,
          multi && "rounded-lg",
          multi && active && "ring-2 ring-primary/50 ring-offset-2 ring-offset-background",
        )}
        onPointerDownCapture={activate}
        onFocusCapture={activate}
      >
        {multi && (
          <PaneHeader
            label={board ? symbolLabel(board.provider, board.symbol) : "Empty chart"}
            detail={board ? resolution : ""}
            color={symbolPrefs?.color}
            price={latest ? fmtNumber(latest.bar.close) : null}
            active={active}
            alerts={unseenAlerts}
            onClose={main ? undefined : () => shell.closePane(paneId)}
          />
        )}
        {board ? (
          <AnalysisChart
            key={board.key}
            source={{ provider: board.provider, dataset: board.dataset }}
            symbol={board.symbol}
            resolution={resolution}
            live={live}
            initialDrawings={board.analysis?.drawings ?? { version: 1, drawings: [] }}
            initialVisible={
              board.analysis?.visibleFrom != null && board.analysis.visibleTo != null
                ? { from: board.analysis.visibleFrom, to: board.analysis.visibleTo }
                : null
            }
            initialIndicators={board.indicators}
            onIndicatorsChange={onIndicatorsChange}
            onIndicatorAlert={onIndicatorAlert}
            overlay={overlay}
            overlayHooks={overlayHooks}
            capturing={placing !== null}
            toolbarExtras={
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  title="Colours, chart type, formats, symbol and drawing defaults"
                  onClick={() => setAppearanceOpen(true)}
                >
                  <Palette /> Appearance
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={placing === "missed" ? "secondary" : "ghost"}
                  aria-pressed={placing === "missed"}
                  title="Log a setup you did not take: click the chart where you saw it"
                  onClick={() => {
                    setZoneEdge(null);
                    setPlacing(placing === "missed" ? null : "missed");
                  }}
                >
                  <Diamond className="text-violet-500" /> Missed trade
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={placing === "zone" ? "secondary" : "ghost"}
                  aria-pressed={placing === "zone"}
                  title="Add a support or resistance zone: click its two edges"
                  onClick={() => {
                    setZoneEdge(null);
                    setPlacing(placing === "zone" ? null : "zone");
                  }}
                >
                  <Rows3 /> Zone
                </Button>
              </>
            }
            layers={layers}
            onDrawingCreated={onDrawingCreated}
            onDrawingsChange={onDrawingsChange}
            onEdit={schedule}
            onStatus={setStatus}
            onLatest={onLatest}
            onSelect={(_id, ids) => setSelectedIds(ids)}
            appearance={appearance}
            onLookEdited={onLookEdited}
            onDrawingPrefs={onDrawingPrefs}
            onToolStyle={onToolStyle}
            sidePanel={{
              title: "Layers",
              count: drawings.length,
              content: (
                <LayersPanel
                  key={board.key}
                  layers={layers}
                  drawings={drawings}
                  selectedIds={selectedIds}
                  onChange={changeLayers}
                  onRevealDrawings={(ids) => chart.current?.reveal(ids)}
                  onSelectDrawing={(id) => chart.current?.select(id)}
                  onSelectMany={(ids) => chart.current?.selectMany(ids)}
                  onDeleteDrawings={(ids) => chart.current?.remove(ids)}
                  onUpdateDrawings={(patches) => chart.current?.updateDrawings(patches)}
                  onDuplicate={(ids) => chart.current?.duplicate(ids) ?? []}
                  onFront={(ids) => chart.current?.bringToFront(ids)}
                  onBack={(ids) => chart.current?.sendToBack(ids)}
                  onEditDrawing={(id) => chart.current?.editDrawing(id)}
                />
              ),
            }}
            chartRef={chart}
            sync={sync}
            size={size}
          />
        ) : (
          empty
        )}
      </div>
      {active &&
        slots &&
        createPortal(
          <FilterBar
            title={board ? `Charts · ${board.symbol}` : "Charts"}
            actions={<LiveBadge status={status} live={live} />}
          />,
          slots.header,
        )}
      {active && slots && createPortal(topCard, slots.top)}
      {active &&
        slots &&
        createPortal(
          <>
            {viewing && board && (
              <div
                role="status"
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
              >
                <History aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  Your analysis as of <strong>{viewing}</strong>, over today&apos;s candles.
                  Read-only: changes here are not saved.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => analysisId && router.replace(analysisEditPath(analysisId))}
                >
                  Back to the live analysis
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void restoreVersion()}
                >
                  Make this the live version
                </Button>
              </div>
            )}
            {placing && (
              <p
                role="status"
                className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm"
              >
                {placing === "missed"
                  ? "Click the chart where you saw the missed setup. Esc cancels."
                  : zoneEdge
                    ? "Now click the zone's other edge. Esc cancels."
                    : "Click one edge of the support or resistance zone. Esc cancels."}
              </p>
            )}
            {board && editor && (
              <PineEditor
                key={`editor-${editor.key}`}
                draft={editor.draft}
                onRun={runDraft}
                onSave={saveDraft}
                onDelete={deleteScript}
                onClose={() => setEditor(null)}
              />
            )}
          </>,
          slots.below,
        )}
      {active &&
        slots &&
        createPortal(
          <>
            <SectionCard
              id="chart-analysis"
              title="Analysis"
              summary={
                board
                  ? analysisId
                    ? analysisLabel({ title, symbol: board.symbol, resolution })
                    : `New ${board.symbol} analysis`
                  : undefined
              }
              actions={<SaveIndicator state={saveState} onRetry={() => void flush()} />}
              contentClassName="space-y-3"
            >
              {board && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-between"
                    >
                      <span className="truncate">
                        {analysisId
                          ? analysisLabel({ title, symbol: board.symbol, resolution })
                          : `New ${board.symbol} analysis`}
                      </span>
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72">
                    <DropdownMenuItem
                      onSelect={() =>
                        void openBoard({
                          provider: board.provider,
                          dataset: board.dataset,
                          symbol: board.symbol,
                          fresh: true,
                        })
                      }
                    >
                      <Plus className="size-3.5" /> New {board.symbol} analysis
                    </DropdownMenuItem>
                    {symbolAnalyses?.analyses.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        disabled={item.id === analysisId}
                        onSelect={() => void openBoard({ analysisId: item.id })}
                      >
                        <span className="min-w-0 flex-1 truncate">{analysisLabel(item)}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {item.drawingCount} · {item.updatedAt.slice(0, 10)}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <div className="space-y-1">
                <Label htmlFor="analysis-title">Title</Label>
                <Input
                  id="analysis-title"
                  value={title}
                  maxLength={200}
                  disabled={!board}
                  placeholder={board ? `${board.symbol} · ${resolution}` : "Opening range levels"}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    state.current.title = event.target.value;
                    schedule();
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="analysis-notes">Notes</Label>
                <Textarea
                  id="analysis-notes"
                  value={notes}
                  rows={3}
                  disabled={!board}
                  placeholder="Thesis, levels to watch, invalidation…"
                  onChange={(event) => {
                    setNotes(event.target.value);
                    state.current.notes = event.target.value;
                    schedule();
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>Add to journal</Label>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <DatePicker
                      label="Journal day"
                      value={journalDay || today}
                      onValueChange={setJournalDay}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!board || Boolean(viewing)}
                    onClick={() => void addToJournal()}
                  >
                    <BookOpenText /> Add
                  </Button>
                </div>
                {journalStatus && "day" in journalStatus && (
                  <p role="status" className="text-xs text-muted-foreground">
                    Added to the {journalStatus.day} journal.{" "}
                    <Link className="underline" href={`/journal/${journalStatus.day}`}>
                      Open journal day
                    </Link>
                  </p>
                )}
                {journalStatus && "error" in journalStatus && (
                  <p role="alert" className="text-xs text-destructive">
                    {journalStatus.error}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Each day you work on this analysis keeps its own version in that day&apos;s
                  journal, frozen when the day ends. <strong>Add</strong> saves the analysis as it
                  is now as that day&apos;s version and puts it in the day note.
                </p>
              </div>
              {analysisId && (snapshotDays?.snapshots.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <Label>Versions by day</Label>
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
                    {snapshotDays!.snapshots.map((snap) => (
                      <li key={snap.day} className="flex items-center justify-between gap-2">
                        <Link
                          href={snapshotViewPath(snap.analysisId, snap.day)}
                          className={cn(
                            "underline-offset-2 hover:underline",
                            viewing === snap.day && "font-semibold",
                          )}
                          aria-current={viewing === snap.day ? "page" : undefined}
                        >
                          {snap.day === today ? `${snap.day} (today, updating)` : snap.day}
                        </Link>
                        <span className="flex items-center gap-2 text-muted-foreground">
                          {snap.drawingCount} drawing{snap.drawingCount === 1 ? "" : "s"}
                          <Link href={`/journal/${snap.day}`} className="underline">
                            Journal
                          </Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analysisId && symbolAnalyses && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => {
                    const current = symbolAnalyses.analyses.find((a) => a.id === analysisId);
                    if (current) void deleteAnalysis(current);
                  }}
                >
                  <Trash2 /> Delete this analysis
                </Button>
              )}
            </SectionCard>

            <SectionCard
              id="chart-overlays"
              title="On the chart"
              summary={board ? `${overlaySummary || "nothing"} shown` : undefined}
            >
              {board ? (
                <OverlaysPanel
                  options={overlayOptions}
                  onChange={changeOverlays}
                  data={overlayData}
                  extraSymbols={extraSymbols}
                  onExtraSymbols={changeExtraSymbols}
                  calendar={calendar}
                  onCalendar={calendarAction}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Open a chart to see your trades on it.
                </p>
              )}
            </SectionCard>

            <SectionCard
              id="chart-zones"
              title="Support and resistance"
              summary={`${zones.length} zone${zones.length === 1 ? "" : "s"}`}
            >
              <ZonesPanel
                zones={zones}
                stats={zoneStats}
                capturing={placing === "zone"}
                pending={zoneEdge !== null}
                disabled={!board}
                onAdd={() => {
                  setZoneEdge(null);
                  setPlacing("zone");
                }}
                onCancel={cancelCapture}
                onChange={changeZones}
                onReveal={(zone) => chart.current?.showTime(zone.start)}
              />
            </SectionCard>

            <SectionCard
              id="chart-indicators"
              title="Indicators"
              summary={`${indicators.length} on the chart`}
              contentClassName="space-y-2"
            >
              <IndicatorsPanel
                indicators={indicators}
                scripts={scripts}
                disabled={!board}
                onAdd={(ref, source) => void addIndicator(ref, source)}
                onNew={() =>
                  openEditor({
                    name: "",
                    source: NEW_INDICATOR_TEMPLATE,
                    scriptId: null,
                    chartIndicatorId: null,
                  })
                }
                onEditIndicator={(indicator) =>
                  openEditor({
                    name: indicator.title,
                    source: indicator.source,
                    scriptId: indicator.ref.kind === "script" ? indicator.ref.id : null,
                    chartIndicatorId: indicator.id,
                  })
                }
                onEditScript={(script) =>
                  openEditor({
                    name: script.name,
                    source: script.source,
                    scriptId: script.id,
                    chartIndicatorId: null,
                  })
                }
                onToggle={(id, visible) => bridge()?.setVisible(id, visible)}
                onSettings={(id) => bridge()?.openSettings(id)}
                onRemove={(id) => bridge()?.remove(id)}
              />
              {indicatorError && (
                <p role="alert" className="whitespace-pre-wrap text-xs text-destructive">
                  {indicatorError}
                </p>
              )}
            </SectionCard>

            <SectionCard
              id="chart-alerts"
              title="Alerts"
              summary={alertsOn ? `${alerts.length} recent` : "Off"}
              actions={
                <Button
                  type="button"
                  size="sm"
                  variant={alertsOn ? "secondary" : "outline"}
                  aria-pressed={alertsOn}
                  onClick={() => void shared.toggleAlerts()}
                >
                  {alertsOn ? <Bell /> : <BellOff />}
                  {alertsOn ? "On" : "Off"}
                </Button>
              }
              contentClassName="space-y-2"
            >
              <p className="text-xs text-muted-foreground">
                While this page is open and live, get an alert when the price crosses a visible
                horizontal line, ray or trend line, enters or breaks a support/resistance zone, or
                when an indicator calls <code>alert()</code>.
              </p>
              {alerts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No alerts yet.</p>
              ) : (
                <ul className="space-y-1">
                  {alerts.map((alert) => (
                    <li key={alert.key} className="flex items-start gap-2 text-xs">
                      {alert.drawingId ? (
                        <button
                          type="button"
                          aria-label="Show the line on the chart"
                          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => chart.current?.reveal([alert.drawingId!])}
                        >
                          <Crosshair className="size-3.5" />
                        </button>
                      ) : (
                        <Bell
                          aria-hidden="true"
                          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        {alert.direction && (
                          <span className="font-medium">
                            {alert.direction === "up" ? "▲ Above " : "▼ Below "}
                          </span>
                        )}
                        {alert.label}
                        <span className="block text-muted-foreground">
                          {new Date(alert.at).toLocaleTimeString()}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <BackgroundAlerts
                analysisId={analysisId}
                disabledReason={
                  viewing ? "A day's version is read-only; open the live analysis." : undefined
                }
                ensureAnalysis={() => flush({ create: true })}
              />
            </SectionCard>

            <SectionCard
              id="chart-all-analyses"
              title="All analyses"
              summary={`${allAnalyses?.analyses.length ?? 0} saved`}
              contentClassName="space-y-2"
            >
              {allAnalyses?.analyses.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nothing saved yet. Draw on a chart and it saves itself.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-2">
                {allAnalyses?.analyses.slice(0, showAll ? undefined : 8).map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "min-w-0 rounded-md border p-1.5",
                      item.id === analysisId && "ring-1 ring-primary",
                    )}
                  >
                    <button
                      type="button"
                      className="block w-full text-left"
                      disabled={opening}
                      onClick={() => {
                        if (item.id !== analysisId) void openBoard({ analysisId: item.id });
                      }}
                    >
                      {item.hasImage ? (
                        <img
                          src={`${analysisImagePath(item.id)}?v=${encodeURIComponent(item.updatedAt)}`}
                          alt=""
                          loading="lazy"
                          className="mb-1 aspect-video w-full rounded object-cover"
                        />
                      ) : (
                        <div className="mb-1 flex aspect-video items-center justify-center rounded bg-muted text-[11px] text-muted-foreground">
                          No snapshot
                        </div>
                      )}
                      <span className="block truncate text-xs font-medium">
                        {analysisLabel(item)}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {item.symbol} · {item.drawingCount} drawing
                        {item.drawingCount === 1 ? "" : "s"}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
              {(allAnalyses?.analyses.length ?? 0) > 8 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? "Show fewer" : `Show all ${allAnalyses!.analyses.length}`}
                </Button>
              )}
            </SectionCard>
          </>,
          slots.side,
        )}
      <ChartAppearance
        open={appearanceOpen}
        onOpenChange={setAppearanceOpen}
        prefs={prefs}
        onChange={savePrefs}
        symbolKey={boardPrefsKey}
        symbol={board?.symbol ?? null}
        base={appearanceOpen ? (chart.current?.themeBase() ?? null) : null}
        journalTimeZone={journalZone}
        onOpenVelaSettings={() => {
          setAppearanceOpen(false);
          chart.current?.openSettings();
        }}
      />
      <MissedTradeDialog
        point={missedPoint}
        symbol={board?.symbol ?? ""}
        onClose={() => setMissedPoint(null)}
        onSaved={refreshOverlays}
      />
    </>
  );
});

const layerVisible = (doc: LayersDocument, drawingId: string) =>
  effectiveLayer(doc, layerOf(doc, drawingId)).visible;

function LiveBadge({ status, live }: { status: LiveStatus; live: boolean }) {
  const label =
    status.state === "error"
      ? "Data error"
      : status.state === "idle"
        ? "No chart"
        : status.state === "loading"
          ? "Loading"
          : !live || status.state === "paused"
            ? "Paused"
            : status.realtime
              ? "Real time"
              : "Live";
  const on = label === "Live" || label === "Real time";
  return (
    <span
      role="status"
      title={
        label === "Real time"
          ? "Prices stream from the exchange as trades happen"
          : label === "Live"
            ? "New candles are fetched periodically"
            : undefined
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        on && "border-primary/50",
        label === "Data error" && "border-destructive/60 text-destructive",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          on ? "animate-pulse bg-primary" : "bg-muted-foreground",
        )}
      />
      {label}
    </span>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.state === "error")
    return (
      <span role="alert" className="flex items-center gap-2 text-xs text-destructive">
        Not saved: {state.message}
        <Button type="button" size="sm" variant="ghost" className="h-6 px-2" onClick={onRetry}>
          Retry
        </Button>
      </span>
    );
  const text =
    state.state === "saving" || state.state === "pending"
      ? "Saving…"
      : state.state === "saved"
        ? `Saved ${new Date(state.at).toLocaleTimeString()}`
        : "Saves automatically";
  return (
    <span role="status" className="text-xs text-muted-foreground">
      {text}
    </span>
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
