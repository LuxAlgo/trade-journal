import { hasHeaders, parseCsv, pick, toRecords } from "../csv";
import { parseTimestamp } from "../dates";
import { ibkrAssetClass } from "../ibkr-assets";
import { parseMoney, parseQuantity } from "../numbers";
import { parseSide } from "./fills";
import { resolveOptionInstrument } from "@luxalgo/journal-core";
import type { ImportFormat, ImportedExecution, ParsedImport } from "../types";

/**
 * Interactive Brokers Flex Query export (distinct from the activity statement):
 * ClientAccountID, Symbol, Date/Time ("YYYYMMDD;HHmmss"), Buy/Sell, Quantity,
 * Price, Commission (negative), AssetClass, plus optional option fields
 * (Strike, Expiry, Put/Call, UnderlyingSymbol, Description).
 */
export const ibkrFlex: ImportFormat = {
  id: "ibkr-flex",
  label: "Interactive Brokers (Flex Query)",
  detect: (headers) => hasHeaders(headers, [["clientaccountid"], ["datetime"], ["buysell"]]),
  parse: (content, options): ParsedImport => {
    const records = toRecords(parseCsv(content));
    const executions: ImportedExecution[] = [];
    let skippedRows = 0;
    let missingContract = 0;

    for (const row of records) {
      const side = parseSide(pick(row, ["buysell", "side"]));
      const quantity = parseQuantity(pick(row, ["quantity", "qty"]));
      const price = parseMoney(pick(row, ["price", "tradeprice"]));
      const executedAt = parseTimestamp(pick(row, ["datetime"]), options.timeZone);
      const fee = Math.abs(parseMoney(pick(row, ["commission", "ibcommission"])) || 0);
      const instrument = resolveOptionInstrument({
        symbol: pick(row, ["symbol"]),
        description: pick(row, ["description"]),
        underlying: pick(row, ["underlyingsymbol", "underlying"]),
        expiry: pick(row, ["expiry", "expiredate", "lasttradingday", "lasttradedate"]),
        strike: pick(row, ["strike", "strikeprice"]),
        right: pick(row, ["putcall", "right"]),
        assetClass: ibkrAssetClass(pick(row, ["assetclass", "assetcategory"])),
      });

      if (
        !instrument.symbol ||
        !side ||
        !executedAt ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(price)
      ) {
        skippedRows++;
        continue;
      }
      if (instrument.missingContract) missingContract++;

      executions.push({
        symbol: instrument.symbol,
        side,
        quantity,
        price,
        fee: Number.isFinite(fee) ? fee : 0,
        executedAt,
        assetClass: instrument.assetClass,
      });
    }

    const warnings: string[] = [];
    if (missingContract > 0) {
      warnings.push(
        `${missingContract} option fill(s) used the underlying ticker because the Flex Query did not include Strike, Expiry and Put/Call. Add those fields so contracts stay separate from stock.`,
      );
    }

    return { format: "ibkr-flex", executions, skippedRows, warnings };
  },
};
