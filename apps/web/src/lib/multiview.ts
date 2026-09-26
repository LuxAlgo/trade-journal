import { isResolution, type Resolution } from "./market-data";
import { INDICATOR_LIBRARY } from "./indicator-library";

/**
 * Multiview: optional extra charts next to the main one, each with its own symbol,
 * candle size and indicators, kept in step with the main chart. Off unless you turn it on;
 * remembered per browser, since a layout that suits a wide screen rarely suits a phone.
 */
export type Arrangement = "column" | "row";

export interface CompanionPane {
  id: string;
  /** null follows the main chart's symbol. */
  symbol: string | null;
  /** null uses the main chart's candle size. */
  resolution: Resolution | null;
  /** Built-in indicator keys (see indicator-library). */
  indicators: string[];
}

export interface MultiviewState {
  enabled: boolean;
  arrangement: Arrangement;
  /** How many extra charts show (1 to 3); panes beyond it keep their settings. */
  count: number;
  panes: CompanionPane[];
  sync: {
    /** A crosshair on one chart shows the same moment on the others. */
    crosshair: boolean;
    /** Scrolling or zooming one chart shows the same time window on the others. */
    time: boolean;
  };
  /** Extra charts on the main chart's symbol show its drawings, read-only. */
  mirrorDrawings: boolean;
}

export const MAX_COMPANIONS = 3;

export const DEFAULT_MULTIVIEW: MultiviewState = {
  enabled: false,
  arrangement: "column",
  count: 2,
  panes: [
    { id: "pane-1", symbol: null, resolution: "4h", indicators: ["rsi"] },
    { id: "pane-2", symbol: null, resolution: "15m", indicators: ["macd"] },
    { id: "pane-3", symbol: null, resolution: "1d", indicators: [] },
  ],
  sync: { crosshair: true, time: false },
  mirrorDrawings: true,
};

const KEY = "journal-chart-multiview-v1";
const SYMBOL = /^[^\x00-\x1f]{1,100}$/;
const known = new Set(INDICATOR_LIBRARY.map((i) => i.key));

/** Stored state, with anything unknown replaced by the default. */
export function parseMultiview(raw: string | null): MultiviewState {
  if (!raw) return DEFAULT_MULTIVIEW;
  try {
    const v = JSON.parse(raw) as Partial<MultiviewState>;
    const panes = DEFAULT_MULTIVIEW.panes.map((fallback, i) => {
      const p = (Array.isArray(v.panes) ? v.panes[i] : undefined) as
        Partial<CompanionPane> | undefined;
      return {
        id: fallback.id,
        symbol: typeof p?.symbol === "string" && SYMBOL.test(p.symbol) ? p.symbol : null,
        resolution:
          p?.resolution === null
            ? null
            : isResolution(p?.resolution)
              ? p.resolution
              : fallback.resolution,
        indicators: Array.isArray(p?.indicators)
          ? p.indicators
              .filter((k): k is string => typeof k === "string" && known.has(k))
              .slice(0, 5)
          : fallback.indicators,
      };
    });
    return {
      enabled: v.enabled === true,
      arrangement: v.arrangement === "row" ? "row" : "column",
      count:
        typeof v.count === "number" && Number.isInteger(v.count)
          ? Math.min(MAX_COMPANIONS, Math.max(1, v.count))
          : DEFAULT_MULTIVIEW.count,
      panes,
      sync: {
        crosshair: v.sync?.crosshair !== false,
        time: v.sync?.time === true,
      },
      mirrorDrawings: v.mirrorDrawings !== false,
    };
  } catch {
    return DEFAULT_MULTIVIEW;
  }
}

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

/** The symbol and candle size an extra chart shows, given the main chart's. */
export const paneMarket = (
  pane: CompanionPane,
  main: { symbol: string; resolution: Resolution },
) => ({
  symbol: pane.symbol?.trim() || main.symbol,
  resolution: pane.resolution ?? main.resolution,
});
