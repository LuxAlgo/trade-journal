import { isResolution, type Resolution } from "./market-data";

/**
 * Multiview: optional extra charts next to the first one. Every chart is a full chart with
 * its own symbol, candle size and analysis (drawings, layers, indicators, zones, alerts);
 * crosshair and time window can be kept in step. Off unless you turn it on; remembered per
 * browser, since a layout that suits a wide screen rarely suits a phone.
 */
export type Arrangement = "grid" | "focus" | "stack";

/** What an extra chart opens with; it updates as you change that chart. */
export interface PaneTarget {
  id: string;
  /** null follows the first chart's source (and feed). */
  provider: string | null;
  dataset: string | null;
  /** null follows the first chart's symbol. */
  symbol: string | null;
  /** null uses the default candle size. */
  resolution: Resolution | null;
  /** The analysis it had open, reopened unless another chart has it. */
  analysisId: string | null;
}

export interface MultiviewState {
  enabled: boolean;
  arrangement: Arrangement;
  /** How many extra charts show (1 to 3); panes beyond it keep their settings. */
  count: number;
  panes: PaneTarget[];
  sync: {
    /** A crosshair on one chart shows the same moment on the others. */
    crosshair: boolean;
    /** Scrolling or zooming one chart shows the same time window on the others. */
    time: boolean;
  };
}

export const MAX_COMPANIONS = 3;
/** The first chart's id; the others use their pane ids. */
export const MAIN_CHART = "main";

const pane = (id: string, resolution: Resolution): PaneTarget => ({
  id,
  provider: null,
  dataset: null,
  symbol: null,
  resolution,
  analysisId: null,
});

export const DEFAULT_MULTIVIEW: MultiviewState = {
  enabled: false,
  arrangement: "grid",
  count: 1,
  panes: [pane("pane-1", "4h"), pane("pane-2", "15m"), pane("pane-3", "1d")],
  sync: { crosshair: true, time: false },
};

const KEY = "journal-chart-multiview-v1";
const TEXT = /^[^\x00-\x1f]{1,100}$/;
const text = (value: unknown) =>
  typeof value === "string" && TEXT.test(value.trim()) ? value.trim() : null;

/** Stored state, with anything unknown replaced by the default. */
export function parseMultiview(raw: string | null): MultiviewState {
  if (!raw) return DEFAULT_MULTIVIEW;
  try {
    const v = JSON.parse(raw) as Omit<Partial<MultiviewState>, "arrangement"> & {
      arrangement?: unknown;
    };
    const stored = (Array.isArray(v.panes) ? v.panes : []) as (Partial<PaneTarget> | null)[];
    const panes = DEFAULT_MULTIVIEW.panes.map((fallback, i) => {
      // Panes keep their id when reordered (closing one moves it to the end).
      const p =
        stored.find((s) => s?.id === fallback.id) ?? (stored[i]?.id ? undefined : stored[i]);
      return {
        id: fallback.id,
        provider: text(p?.provider),
        dataset: text(p?.dataset),
        symbol: text(p?.symbol),
        resolution:
          p?.resolution === null
            ? null
            : isResolution(p?.resolution)
              ? p.resolution
              : fallback.resolution,
        analysisId: text(p?.analysisId),
      };
    });
    // Order as stored, so a closed pane stays last.
    const order = stored.map((s) => s?.id);
    panes.sort((a, b) => rank(order, a.id) - rank(order, b.id));
    return {
      enabled: v.enabled === true,
      // Earlier layouts: extra charts beside the first (now a grid) or below it.
      arrangement:
        v.arrangement === "stack"
          ? "stack"
          : v.arrangement === "focus" || v.arrangement === "row"
            ? "focus"
            : "grid",
      count:
        typeof v.count === "number" && Number.isInteger(v.count)
          ? Math.min(MAX_COMPANIONS, Math.max(1, v.count))
          : DEFAULT_MULTIVIEW.count,
      panes,
      sync: {
        crosshair: v.sync?.crosshair !== false,
        time: v.sync?.time === true,
      },
    };
  } catch {
    return DEFAULT_MULTIVIEW;
  }
}

const rank = (order: unknown[], id: string) => {
  const at = order.indexOf(id);
  return at < 0 ? order.length : at;
};

export const multiviewPreference = {
  read(): MultiviewState {
    try {
      return parseMultiview(localStorage.getItem(KEY));
    } catch {
      return DEFAULT_MULTIVIEW;
    }
  },
  write(value: MultiviewState) {
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      // Remembered for this page only.
    }
  },
};

/** What the first chart shows, which extra charts follow until you change them. */
export interface MainMarket {
  provider: string;
  dataset: string | null;
  symbol: string;
}

/**
 * What an extra chart opens: its own market if it has one, otherwise the first chart's, at
 * its own candle size. Null while there is nothing to follow yet.
 */
export function paneStart(
  target: PaneTarget,
  main: MainMarket | null,
  defaultResolution: Resolution,
) {
  const own = target.symbol && (target.provider ?? main?.provider);
  const market: MainMarket | null = own
    ? {
        provider: target.provider ?? main!.provider,
        dataset: target.provider ? target.dataset : (main?.dataset ?? null),
        symbol: target.symbol!,
      }
    : main;
  if (!market) return null;
  return {
    ...market,
    resolution: target.resolution ?? defaultResolution,
    analysisId: target.analysisId,
  };
}
