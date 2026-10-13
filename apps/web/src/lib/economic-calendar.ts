export type EventImpact = "High" | "Medium" | "Low" | "Holiday";

export interface EconomicEvent {
  id: string;
  title: string;
  /** The currency the release moves (USD, EUR…). */
  currency: string;
  time: number;
  impact: EventImpact;
  forecast: string;
  previous: string;
}

export interface CalendarState {
  enabled: boolean;
  fetchedAt: string | null;
  error: string | null;
  events: EconomicEvent[];
}

export const IMPACTS: EventImpact[] = ["High", "Medium", "Low", "Holiday"];

/**
 * Currencies that move a chart symbol, for the default event filter: both legs of a
 * currency pair, USD for dollar-quoted crypto and US stocks.
 */
export function currenciesFor(symbol: string): string[] {
  const key = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  const known = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY"];
  const pair = key.length === 6 ? [key.slice(0, 3), key.slice(3)] : [];
  if (pair.length && pair.every((c) => known.includes(c))) return pair;
  const quote = known.find((c) => key.endsWith(c)) ?? (/(USDT|USDC)$/.test(key) ? "USD" : null);
  return quote ? [quote] : ["USD"];
}

/** A one-line description for tooltips and lists. */
export const eventSummary = (e: EconomicEvent) =>
  [
    `${e.currency} · ${e.title}`,
    e.impact === "Holiday" ? "Bank holiday" : `${e.impact} impact`,
    e.forecast ? `Forecast ${e.forecast}` : "",
    e.previous ? `Previous ${e.previous}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
