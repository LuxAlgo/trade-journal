import { headerKey, parseCsv } from "@luxalgo/journal-importers";
import { RESOLUTIONS, type Resolution, type MarketBar } from "./market-data";
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_BARS = 50_000;
// The English throw texts below are machine-stable validation identifiers
// shared with the server (docs/i18n.md §5): the API's 400 body and the parser
// regression tests read them verbatim, so they are never translated and the
// rejection rules never change. The Settings UI localizes its own client-side
// copies via the `settings` namespace, and API failures via the `errors`
// codes (csv_too_large / invalid_market_csv) — see market-csv-settings.tsx.
export function parseMarketCsv(
  content: string,
  symbol: string,
  resolution: Resolution,
): MarketBar[] {
  if (new TextEncoder().encode(content).byteLength > MAX_CSV_BYTES)
    throw new Error("Use a CSV smaller than 5 MB.");
  if ((content.match(/"/g)?.length ?? 0) % 2 !== 0)
    throw new Error("CSV contains an unterminated quoted field.");
  const [header, ...rows] = parseCsv(content);
  if (!header || !rows.length || rows.length > MAX_CSV_BARS)
    throw new Error("CSV must contain 1–50,000 candle rows.");
  const aliases: Record<string, string[]> = {
    time: ["time", "timestamp", "datetime", "date"],
    open: ["open", "o"],
    high: ["high", "h"],
    low: ["low", "l"],
    close: ["close", "c"],
    volume: ["volume", "v"],
    symbol: ["symbol", "ticker"],
  };
  const columns: Record<string, number> = {};
  for (const [name, keys] of Object.entries(aliases)) {
    const matches = header
      .map((cell, index) => (keys.includes(headerKey(cell)) ? index : -1))
      .filter((index) => index >= 0);
    if (matches.length > 1) throw new Error(`Ambiguous ${name} columns. Include only one.`);
    if (!matches.length && !["symbol", "volume"].includes(name))
      throw new Error(`Missing ${name} column.`);
    columns[name] = matches[0] ?? -1;
  }
  const bars = rows
    .map((row, index): MarketBar => {
      const fail = (message: string): never => {
        throw new Error(`Row ${index + 2}: ${message}`);
      };
      if (row.length !== header.length) fail("column count does not match the header.");
      if (columns.symbol! >= 0 && row[columns.symbol!]!.trim() !== symbol)
        fail("symbol does not match this dataset.");
      const rawTime = row[columns.time!]!.trim();
      if (/^\d{4}-\d{2}-\d{2}T/.test(rawTime)) {
        const [year, month, day] = rawTime.slice(0, 10).split("-").map(Number);
        if (!month || month > 12 || !day || day > new Date(Date.UTC(year!, month!, 0)).getUTCDate())
          fail("invalid calendar date.");
      }
      const time = /^\d{10}$/.test(rawTime)
        ? Number(rawTime) * 1000
        : /^\d{13}$/.test(rawTime)
          ? Number(rawTime)
          : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.test(
                rawTime,
              )
            ? Date.parse(rawTime)
            : NaN;
      if (!Number.isSafeInteger(time) || time < 0)
        fail(
          "use ISO-8601 with a timezone, or Unix seconds (10 digits) / milliseconds (13 digits).",
        );
      const numeric = (name: string) => {
        if (name === "volume" && columns.volume === -1) return 0;
        const value = row[columns[name]!]!.trim();
        if (
          !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ||
          !Number.isFinite(Number(value))
        )
          fail(`invalid ${name}.`);
        return Number(value);
      };
      const bar = {
        time,
        open: numeric("open"),
        high: numeric("high"),
        low: numeric("low"),
        close: numeric("close"),
        volume: numeric("volume"),
      };
      if (
        bar.low > Math.min(bar.open, bar.close) ||
        bar.high < Math.max(bar.open, bar.close) ||
        bar.low > bar.high ||
        bar.volume < 0
      )
        fail("invalid OHLC range or negative volume.");
      if (bar.time + RESOLUTIONS[resolution] > Date.now())
        fail("only completed historical candles can be imported.");
      return bar;
    })
    .sort((a, b) => a.time - b.time);
  const step = RESOLUTIONS[resolution];
  const phase = resolution === "1d" ? 0 : bars[0]!.time % step;
  bars.forEach((bar, index) => {
    if (bar.time % step !== phase)
      throw new Error(
        "Candle timestamps do not align to the selected resolution. Daily candles must start at 00:00 UTC.",
      );
    if (index && bar.time === bars[index - 1]!.time)
      throw new Error("Duplicate candle timestamps. Remove duplicates before importing.");
  });
  return bars;
}
export interface MarketCsvDataset {
  id: string;
  name: string;
  symbol: string;
  resolution: Resolution;
  currency: string;
  priceBasis: string;
  count: number;
  from: string;
  to: string;
  importedAt: string;
}
