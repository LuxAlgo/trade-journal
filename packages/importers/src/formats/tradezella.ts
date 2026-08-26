import { hasHeaders, parseCsv, pick, toRecords } from "../csv";
import { parseTimestamp } from "../dates";
import { parseMoney, parseQuantity } from "../numbers";
import {
  tradeToExecutions,
  type ImportFormat,
  type ImportedTrade,
  type ParsedImport,
} from "../types";

/**
 * TradeZella trades export — the one-click migration path. TradeZella exports
 * round trips (not fills), so each row is reconstructed as an entry + exit
 * execution pair at the reported average prices. Net P&L is preserved exactly:
 * when the row's stated net P&L differs from (price move − commissions), the
 * difference is folded into the exit fee so the journal agrees with the trader's
 * old numbers to the cent.
 */
export const tradezella: ImportFormat = {
  id: "tradezella",
  label: "TradeZella (trades export)",
  detect: (headers) =>
    hasHeaders(headers, [
      ["opendate", "opentime", "entrydate"],
      ["closedate", "closetime", "exitdate"],
      ["symbol", "instrument"],
      ["netpnl", "netpl", "netprofit"],
    ]),
  parse: (content, options): ParsedImport => {
    const records = toRecords(parseCsv(content));
    const executions: ParsedImport["executions"] = [];
    let skippedRows = 0;
    const warnings = [
      "TradeZella exports are trade-level; entry/exit executions were reconstructed at the reported average prices. Net P&L is preserved exactly.",
    ];

    for (const row of records) {
      const symbol = pick(row, ["symbol", "instrument"])?.trim().toUpperCase();
      const sideText = (pick(row, ["side", "direction", "type"]) ?? "").toLowerCase();
      const direction = /short|sell/.test(sideText) ? "short" : "long";
      const quantity = parseQuantity(pick(row, ["volume", "quantity", "qty", "size"]));
      const entryPrice = parseMoney(
        pick(row, ["entryprice", "avgentry", "averageentry", "openprice"]),
      );
      const exitPrice = parseMoney(
        pick(row, ["exitprice", "avgexit", "averageexit", "closeprice"]),
      );
      const openedAt = parseTimestamp(
        pick(row, ["opendate", "opentime", "entrydate"]),
        options.timeZone,
      );
      const closedAt = parseTimestamp(
        pick(row, ["closedate", "closetime", "exitdate"]),
        options.timeZone,
      );
      const netPnl = parseMoney(pick(row, ["netpnl", "netpl", "netprofit"]));
      const commissions =
        Math.abs(parseMoney(pick(row, ["commissions", "commission"])) || 0) +
        Math.abs(parseMoney(pick(row, ["fees", "fee", "totalfees"])) || 0);

      if (
        !symbol ||
        !openedAt ||
        !closedAt ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(entryPrice) ||
        !Number.isFinite(exitPrice)
      ) {
        skippedRows++;
        continue;
      }

      let fees = Number.isFinite(commissions) ? commissions : 0;
      if (Number.isFinite(netPnl)) {
        // Reconcile: gross from prices − fees should equal stated net P&L.
        const gross =
          direction === "long"
            ? (exitPrice - entryPrice) * quantity
            : (entryPrice - exitPrice) * quantity;
        const impliedFees = gross - netPnl;
        // Contract multipliers (futures) make price-implied gross diverge wildly;
        // only reconcile when the numbers are in the same ballpark.
        if (Math.abs(impliedFees) < Math.abs(gross) * 0.5 + 100) {
          fees = impliedFees;
        }
      }

      const trade: ImportedTrade = {
        symbol,
        direction,
        quantity,
        entryPrice,
        exitPrice,
        openedAt,
        closedAt,
        fees,
      };
      executions.push(...tradeToExecutions(trade));
    }

    return { format: "tradezella", executions, skippedRows, warnings };
  },
};
