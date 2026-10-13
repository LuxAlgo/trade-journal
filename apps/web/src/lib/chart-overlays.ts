/** Journal records drawn on a chart: your trades with their fills, and missed trades. */
export interface ChartTrade {
  key: string;
  account: string;
  symbol: string;
  direction: "long" | "short";
  status: "open" | "win" | "loss" | "breakeven";
  openedAt: string;
  closedAt: string | null;
  quantity: number;
  openQuantity: number;
  avgEntry: number;
  avgExit: number | null;
  netPnl: number;
  currency: string;
  stopLoss: number | null;
  profitTarget: number | null;
  fills: { time: number; side: "buy" | "sell"; quantity: number; price: number }[];
}

export interface ChartMissedTrade {
  id: string;
  symbol: string;
  direction: "long" | "short";
  observedAt: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  notes: string;
}

export interface ChartOverlayData {
  /** Journal symbols matched to the chart symbol. */
  symbols: string[];
  trades: ChartTrade[];
  missed: ChartMissedTrade[];
}

/** What to draw; each switch hides its records without losing them. */
export interface OverlayOptions {
  trades: boolean;
  closedTrades: boolean;
  missed: boolean;
  zones: boolean;
  sessions: boolean;
  economic: boolean;
  economicImpact: ("High" | "Medium" | "Low" | "Holiday")[];
  /** Currencies whose events show; empty = all. */
  economicCurrencies: string[];
}

export const DEFAULT_OVERLAYS: OverlayOptions = {
  trades: true,
  closedTrades: true,
  missed: true,
  zones: true,
  sessions: true,
  economic: true,
  economicImpact: ["High", "Holiday"],
  economicCurrencies: [],
};

const KEY = "journal-chart-overlays-v1";
const IMPACTS = new Set(["High", "Medium", "Low", "Holiday"]);

export function parseOverlayOptions(raw: string | null): OverlayOptions {
  if (!raw) return DEFAULT_OVERLAYS;
  try {
    const v = JSON.parse(raw) as Partial<OverlayOptions>;
    const flag = (key: keyof OverlayOptions) =>
      typeof v[key] === "boolean" ? (v[key] as boolean) : (DEFAULT_OVERLAYS[key] as boolean);
    return {
      trades: flag("trades"),
      closedTrades: flag("closedTrades"),
      missed: flag("missed"),
      zones: flag("zones"),
      sessions: flag("sessions"),
      economic: flag("economic"),
      economicImpact: Array.isArray(v.economicImpact)
        ? (v.economicImpact.filter((i) => IMPACTS.has(i)) as OverlayOptions["economicImpact"])
        : DEFAULT_OVERLAYS.economicImpact,
      economicCurrencies: Array.isArray(v.economicCurrencies)
        ? v.economicCurrencies.filter((c) => typeof c === "string" && /^[A-Z]{3}$/.test(c))
        : [],
    };
  } catch {
    return DEFAULT_OVERLAYS;
  }
}

export const overlayPreference = {
  read(): OverlayOptions {
    try {
      return parseOverlayOptions(localStorage.getItem(KEY));
    } catch {
      return DEFAULT_OVERLAYS;
    }
  },
  write(value: OverlayOptions) {
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      // Per-page only.
    }
  },
};

/** The trades a chart shows under the current switches. */
export const visibleTrades = (trades: readonly ChartTrade[], options: OverlayOptions) =>
  options.trades ? trades.filter((t) => options.closedTrades || t.status === "open") : [];
