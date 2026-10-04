import type { Resolution } from "./market-data";

export interface CredentialField {
  key: string;
  label: string;
  environmentKey: string;
  options?: { value: string; label: string }[];
  defaultValue?: string;
}
export interface ProviderInfo {
  id: string;
  name: string;
  mode: "credentials" | "public" | "csv";
  description: string;
  symbolHint: string;
  fields: CredentialField[];
  datasets?: { value: string; label: string }[];
  resolutions?: Resolution[];
}
export const MARKET_PROVIDERS: ProviderInfo[] = [
  {
    id: "london-strategic-edge",
    name: "London Strategic Edge",
    mode: "credentials",
    description:
      "Historical candles. Stock and ETF prices are split adjusted; coverage depends on your plan.",
    symbolHint: "Use the exact provider symbol, including the futures contract or currency pair.",
    fields: [{ key: "apiKey", label: "API key", environmentKey: "LSE_API_KEY" }],
  },
  {
    id: "alpaca",
    name: "Alpaca",
    mode: "credentials",
    description:
      "US stocks and crypto. Choose a stock or crypto feed; SIP requires appropriate data access. Stock prices are unadjusted.",
    symbolHint: "Stocks: AAPL. Crypto: BTC/USD; choose the Crypto dataset.",
    fields: [
      { key: "apiKey", label: "Key ID", environmentKey: "ALPACA_API_KEY" },
      { key: "secretKey", label: "Secret key", environmentKey: "ALPACA_SECRET_KEY" },
    ],
    datasets: [
      { value: "", label: "Choose a data feed" },
      { value: "iex", label: "IEX stocks" },
      { value: "sip", label: "SIP stocks" },
      { value: "crypto", label: "Crypto (US)" },
    ],
  },
  {
    id: "binance",
    name: "Binance",
    mode: "public",
    description:
      "Public Binance spot candles. No API key required. Availability depends on your region and the listed pair.",
    symbolHint:
      "Spot pairs use BTCUSDT or ETHUSDT. USDT is not USD; account and quote currencies must match for estimates.",
    fields: [],
  },
  {
    id: "coinbase",
    name: "Coinbase",
    mode: "public",
    description:
      "Public Coinbase Exchange spot candles. No API key required; intervals without trades may have no candle.",
    symbolHint: "Use a Coinbase Exchange product such as BTC-USD or ETH-USD.",
    fields: [],
  },
  {
    id: "oanda",
    name: "OANDA",
    mode: "credentials",
    description:
      "Forex and CFD candles from your v20 account. Midpoint prices, UTC-aligned bars and tick-count volume; no spread or FX conversion is included.",
    symbolHint:
      "Use an OANDA instrument such as EUR_USD. Set the contract multiplier in Settings to match the units in your fills.",
    fields: [
      { key: "apiKey", label: "Access token", environmentKey: "OANDA_API_TOKEN" },
      { key: "accountId", label: "v20 account ID", environmentKey: "OANDA_ACCOUNT_ID" },
      {
        key: "environment",
        label: "Environment",
        environmentKey: "OANDA_ENVIRONMENT",
        defaultValue: "practice",
        options: [
          { value: "practice", label: "Practice" },
          { value: "live", label: "Live" },
        ],
      },
    ],
  },
  {
    id: "market-csv",
    name: "Market data CSV",
    mode: "csv",
    description:
      "Local OHLCV candle files. Upload market prices separately from your trade executions.",
    symbolHint:
      "Use the exact symbol and resolution recorded for the uploaded file. Select a dataset when files overlap.",
    fields: [],
  },
];
export const providerInfo = (id: string) => MARKET_PROVIDERS.find((item) => item.id === id);

/**
 * Display-only message keys for the Settings UI (docs/i18n.md §5/§7 pattern):
 * the English strings in `MARKET_PROVIDERS` stay the data of record because
 * the server's validation errors (connections.ts) and page group C components
 * read them verbatim. Settings resolves these keys in the `settings`
 * namespace (`marketData.providers.*`) instead; anything without an entry
 * falls back to the original English field label.
 */
export interface ProviderDisplayKeys {
  /** Key for the provider description, under `settings` → `marketData.providers`. */
  description: string;
  fieldLabels: Record<string, string>;
  /** Option labels per credential field key, keyed by option value. */
  fieldOptionLabels: Record<string, Record<string, string>>;
}

export const providerDisplayKeys: Record<string, ProviderDisplayKeys> = {
  "london-strategic-edge": {
    description: "lseDescription",
    fieldLabels: { apiKey: "lseApiKey" },
    fieldOptionLabels: {},
  },
  alpaca: {
    description: "alpacaDescription",
    fieldLabels: { apiKey: "alpacaKeyId", secretKey: "alpacaSecretKey" },
    fieldOptionLabels: {},
  },
  binance: {
    description: "binanceDescription",
    fieldLabels: {},
    fieldOptionLabels: {},
  },
  coinbase: {
    description: "coinbaseDescription",
    fieldLabels: {},
    fieldOptionLabels: {},
  },
  oanda: {
    description: "oandaDescription",
    fieldLabels: {
      apiKey: "oandaToken",
      accountId: "oandaAccountId",
      environment: "oandaEnvironment",
    },
    fieldOptionLabels: { environment: { practice: "oandaPractice", live: "oandaLive" } },
  },
  "market-csv": {
    description: "csvDescription",
    fieldLabels: {},
    fieldOptionLabels: {},
  },
};
