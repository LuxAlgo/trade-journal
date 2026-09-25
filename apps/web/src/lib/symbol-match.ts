/**
 * Matching a chart symbol to journal symbols. Brokers and data sources spell the same
 * instrument differently (BTC/USD, BTC-USD, BTCUSDT, EUR_USD, NASDAQ:AAPL), so both sides
 * reduce to a key: no exchange prefix, letters and digits only, upper case. Dollar
 * stablecoins count as USD so a Binance chart finds trades journaled against USD.
 */
export const symbolKey = (symbol: string): string =>
  symbol
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_.]+:/, "")
    .replace(/[^A-Z0-9]/g, "");

const DOLLARS = ["USDT", "USDC", "BUSD", "USD"];

/** Every key a chart symbol should match, plus any symbols the user added by hand. */
export function matchKeys(chartSymbol: string, extra: readonly string[] = []): Set<string> {
  const keys = new Set<string>();
  for (const symbol of [chartSymbol, ...extra]) {
    const key = symbolKey(symbol);
    if (!key) continue;
    keys.add(key);
    const quote = DOLLARS.find((q) => key.length > q.length + 1 && key.endsWith(q));
    if (quote) for (const q of DOLLARS) keys.add(key.slice(0, -quote.length) + q);
  }
  return keys;
}

/** The journal symbols (as stored) that belong on a chart. */
export const matchingSymbols = (
  journalSymbols: readonly string[],
  chartSymbol: string,
  extra: readonly string[] = [],
): string[] => {
  const keys = matchKeys(chartSymbol, extra);
  return journalSymbols.filter((symbol) => keys.has(symbolKey(symbol)));
};
