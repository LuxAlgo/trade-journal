import { RequestError, requireValue } from "../api";
import { providerFor } from "./connections";
import type { MarketDataProvider } from "./provider";

/**
 * Checks shared by the chart routes that take a market (provider, symbol, feed): history,
 * the live stream and saved analyses answer the same inputs with the same messages.
 */

/** The provider, or a 400 when it is unknown or not available. */
export function requireProvider(id: unknown): MarketDataProvider {
  requireValue(typeof id === "string", "Choose a market data provider.");
  try {
    return providerFor(id);
  } catch {
    throw new RequestError("Choose an available market data provider.");
  }
}

/** A provider's instrument symbol, trimmed, or a 400. */
export function requireSymbol(value: unknown): string {
  requireValue(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= 100 &&
      !/[\x00-\x1f]/.test(value),
    "Enter the provider's exact instrument symbol.",
  );
  return value.trim();
}

/** A feed or CSV dataset id (null or absent for none), or a 400. */
export function requireDataset(value: unknown): string | null {
  requireValue(
    value === undefined ||
      value === null ||
      (typeof value === "string" && /^[a-zA-Z0-9_-]{0,80}$/.test(value)),
    "Invalid dataset.",
  );
  return value ? value : null;
}
