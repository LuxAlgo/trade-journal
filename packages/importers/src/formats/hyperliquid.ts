import { hasHeaders, parseCsv, toRecords } from "../csv";
import type { ImportFormat, ImportedExecution } from "../types";
import { rowsToFills, type FillsColumnMap } from "./fills";

export const HYPERLIQUID_FORMAT_ID = "hyperliquid";

const columns: FillsColumnMap = {
  symbol: ["coin"],
  side: ["dir"],
  quantity: ["sz"],
  price: ["px"],
  fees: [["fee"]],
  timestamp: ["time"],
};

/**
 * Perpetuals are one-way: each coin has a single net position, so every
 * direction is a buy or a sell, and a flip ("Long > Short") is one fill
 * through flat, which round-trip building already splits.
 */
const PERP_SIDES: Record<string, "buy" | "sell"> = {
  "open long": "buy",
  "close short": "buy",
  "short > long": "buy",
  "open short": "sell",
  "close long": "sell",
  "long > short": "sell",
};

/**
 * Broker sync reads the API's coin names, so symbols must match them exactly:
 * HIP-3 markets read "ANTH (io)" here but "io:ANTH" there, and coins such as
 * kPEPE are case-sensitive.
 */
const apiCoin = (coin: string): string => {
  const hip3 = coin.trim().match(/^(\S+)\s+\(([^()\s]+)\)$/);
  return hip3 ? `${hip3[2]}:${hip3[1]}` : coin.trim();
};

/**
 * Hyperliquid trade history export (Trade History → Export as CSV): time, coin,
 * dir, px, sz, ntl, fee, closedPnl, one row per fill. Rows carry no fill ID, so
 * identical fills are numbered like NinjaTrader's: the same or a later export
 * imports once. Fills net with synced fills of the same coin (no import group).
 */
export const hyperliquid: ImportFormat = {
  id: HYPERLIQUID_FORMAT_ID,
  label: "Hyperliquid (trade history)",
  detect: (headers) =>
    hasHeaders(headers, [["time"], ["coin"], ["dir"], ["px"], ["sz"], ["closedpnl"]]),
  parse: (content, options) => {
    const executions: ImportedExecution[] = [];
    const copies = new Map<string, number>();
    const unknown = new Set<string>();
    let spot = 0;
    let unknownRows = 0;
    let unreadable = 0;
    for (const row of toRecords(parseCsv(content))) {
      // Annotations such as "(Price Improved)" don't change the direction.
      const direction = (row.dir ?? "")
        .replace(/\s*\([^()]*\)$/, "")
        .trim()
        .toLowerCase();
      const side = PERP_SIDES[direction];
      if (!side) {
        if (direction === "buy" || direction === "sell") spot++;
        else {
          unknown.add(row.dir || "(blank)");
          unknownRows++;
        }
        continue;
      }
      const fill = rowsToFills([{ ...row, dir: side }], columns, options, {
        normalizeSymbol: apiCoin,
      }).executions[0];
      if (!fill) {
        unreadable++;
        continue;
      }
      const signature = JSON.stringify([
        fill.symbol,
        fill.side,
        fill.quantity,
        fill.price,
        fill.executedAt,
      ]);
      const occurrence = copies.get(signature) ?? 0;
      copies.set(signature, occurrence + 1);
      // Export row order is not execution order, so no tie-break is claimed.
      fill.importMetadata = { id: `fill:${signature}:${occurrence}`, order: 0, preserveFee: true };
      executions.push(fill);
    }

    const errors: string[] = [];
    if (unknown.size)
      errors.push(
        `Unrecognized Hyperliquid direction: ${[...unknown].map((dir) => `"${dir}"`).join(", ")}. Nothing was imported, because skipping these fills would leave positions wrong. Please send an anonymized sample so they can be supported.`,
      );
    if (unreadable)
      errors.push(
        `${unreadable} perpetual fill(s) are missing a readable time, coin, size or price. Nothing was imported, because skipping them would leave positions wrong.`,
      );
    const warnings = [
      "Hyperliquid writes times in the timezone of the browser the file was exported from. Set the statement timezone to that timezone and check the preview times.",
    ];
    if (spot)
      warnings.push(
        `${spot} spot fill(s) were skipped. The export does not say which token paid a spot fee, so only perpetual fills are imported.`,
      );
    return {
      format: HYPERLIQUID_FORMAT_ID,
      executions,
      skippedRows: spot + unknownRows + unreadable,
      warnings,
      ...(errors.length ? { errors } : {}),
    };
  },
};
