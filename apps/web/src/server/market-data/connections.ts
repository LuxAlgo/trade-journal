import { decryptJson, encryptJson } from "@/server/crypto";
import { deleteSetting, getSetting, setSetting } from "@/server/settings";
import type { MarketConnection } from "@/lib/market-data";
import { providerInfo } from "@/lib/market-providers";
import { londonStrategicEdge } from "./london-strategic-edge";
import { alpaca } from "./alpaca";
import { binance, coinbase } from "./public-crypto";
import { oanda } from "./oanda";
import { csvDatasets, marketCsv } from "./csv";
import { MarketDataError, type MarketDataProvider } from "./provider";
import { withAggregation } from "./aggregate";
const providers: MarketDataProvider[] = [
  londonStrategicEdge,
  alpaca,
  // Binance klines for these sizes open on UTC multiples, so they are fetched directly.
  withAggregation(binance, ["3m", "30m", "2h", "4h"]),
  coinbase,
  oanda,
  marketCsv,
]
  .map((provider) => (provider.id === "binance" ? provider : withAggregation(provider)))
  .sort((a, b) => a.name.localeCompare(b.name));
export const providerFor = (id: string) => {
  const provider = providers.find((entry) => entry.id === id);
  if (!provider) throw new MarketDataError("Choose an available market data provider.");
  return provider;
};
const settingKey = (id: string) => `marketData:${id}:keyEnc`;
const environment = (id: string) => {
  const fields = providerInfo(id)!.fields;
  const managed = fields.some((field) => process.env[field.environmentKey]?.trim());
  const values = Object.fromEntries(
    fields.map((field) => [
      field.key,
      process.env[field.environmentKey]?.trim() || field.defaultValue || "",
    ]),
  );
  return { managed, values, complete: fields.every((field) => Boolean(values[field.key])) };
};
export const connections = (): MarketConnection[] =>
  providers.map((provider) => {
    const info = providerInfo(provider.id)!;
    if (info.mode === "csv") {
      const configured = csvDatasets().length > 0;
      return {
        id: provider.id,
        name: provider.name,
        configured,
        source: configured ? "uploaded" : null,
      };
    }
    if (info.mode === "public") {
      const configured = getSetting(settingKey(provider.id)) === "enabled";
      return {
        id: provider.id,
        name: provider.name,
        configured,
        source: configured ? "public" : null,
      };
    }
    const env = environment(provider.id);
    const source = env.managed
      ? "environment"
      : getSetting(settingKey(provider.id))
        ? "saved"
        : null;
    return {
      id: provider.id,
      name: provider.name,
      configured: env.managed ? env.complete : source !== null,
      source,
    };
  });
export function connectionKey(id: string): string {
  providerFor(id);
  const info = providerInfo(id)!;
  if (info.mode === "csv") return "";
  if (info.mode === "public") {
    if (getSetting(settingKey(id)) !== "enabled")
      throw new MarketDataError("Enable this public market data source in Settings first.");
    return "";
  }
  const env = environment(id);
  if (env.managed) {
    if (!env.complete)
      throw new MarketDataError("Complete all market data credentials in the server environment.");
    return id === "london-strategic-edge" ? env.values.apiKey! : JSON.stringify(env.values);
  }
  const saved = getSetting(settingKey(id));
  if (!saved) throw new MarketDataError("Add a market data API key in Settings first.");
  try {
    return decryptJson<string>(saved);
  } catch {
    throw new MarketDataError(
      "Could not unlock the saved market data key. Save it again in Settings.",
    );
  }
}
export function saveConnection(id: string, key: string | null) {
  providerFor(id);
  const info = providerInfo(id)!;
  if (info.mode === "csv")
    throw new MarketDataError("Manage CSV files in the market data upload section.");
  if (environment(id).managed)
    throw new MarketDataError(
      "This connection is managed by the server environment. Update it there.",
    );
  if (key === null) deleteSetting(settingKey(id));
  else setSetting(settingKey(id), info.mode === "public" ? "enabled" : encryptJson(key));
}
export function validateCredentials(id: string, input: unknown): string {
  const info = providerInfo(id)!;
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new MarketDataError("Enter the required connection fields.");
  const values: Record<string, string> = {};
  for (const field of info.fields) {
    const value = (input as Record<string, unknown>)[field.key] ?? field.defaultValue;
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 4096 ||
      /[\x00-\x1f]/.test(value) ||
      (field.options && !field.options.some((option) => option.value === value))
    )
      throw new MarketDataError(`Enter a valid ${field.label.toLowerCase()}.`);
    values[field.key] = value.trim();
  }
  if (id === "oanda" && !/^[0-9-]{3,80}$/.test(values.accountId!))
    throw new MarketDataError("Enter your OANDA v20 account ID.");
  return id === "london-strategic-edge" ? values.apiKey! : JSON.stringify(values);
}
