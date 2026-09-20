import { headerKey, parseCsv } from "../csv";
import { parseTimestamp } from "../dates";
import { ibkrAssetClass } from "../ibkr-assets";
import { parseMoney, parseQuantity } from "../numbers";
import { resolveOptionInstrument } from "@luxalgo/journal-core";
import type { ImportFormat, ImportedExecution, ParsedImport } from "../types";

/**
 * Interactive Brokers activity statement CSV. Multi-section file where every
 * row is prefixed by its section name; fills live in rows shaped
 * `Trades,Data,Order,<Asset Category>,<Currency>,<Symbol>,<Date/Time>,<Quantity>,<T. Price>,...,<Comm/Fee>,...`
 * with a `Trades,Header,...` row defining the columns.
 */
export const ibkr: ImportFormat = {
  id: "ibkr",
  label: "Interactive Brokers (activity statement)",
  detect: (_headers, content) =>
    /^Trades,Header/m.test(content) || /"?Trades"?,"?Header"?/.test(content),
  parse: (content, options): ParsedImport => {
    const rows = parseCsv(content, ",");
    const headerRow = rows.find((row) => row[0] === "Trades" && row[1] === "Header");
    if (!headerRow) {
      return {
        format: "ibkr",
        executions: [],
        skippedRows: 0,
        warnings: ["No Trades section found."],
      };
    }
    const keys = headerRow.map(headerKey);
    const cell = (row: string[], name: string) => {
      const index = keys.indexOf(name);
      return index >= 0 ? row[index] : undefined;
    };
    const col = (name: string) => keys.indexOf(name);

    const executions: ImportedExecution[] = [];
    let skippedRows = 0;

    for (const row of rows) {
      if (row[0] !== "Trades" || row[1] !== "Data") continue;
      // DataDiscriminator "Order" rows are the fills; "ClosedLot"/"Total" rows are not.
      const discriminator = row[col("datadiscriminator")] ?? "";
      if (!/^order$/i.test(discriminator)) {
        skippedRows++;
        continue;
      }
      const symbolRaw = (row[col("symbol")] ?? "").trim();
      const quantitySigned = parseMoney(row[col("quantity")]);
      const price = parseMoney(row[col("tprice")] ?? row[col("price")]);
      const executedAt = parseTimestamp(row[col("datetime")], options.timeZone);
      // Older ISO-ish parsing stopped at the comma and stored local midnight.
      const legacyDate = row[col("datetime")]?.match(/^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}),/);
      const legacyExecutedAt = legacyDate ? parseTimestamp(legacyDate[1], options.timeZone) : null;
      const fee = Math.abs(parseMoney(row[col("commfee")] ?? row[col("commission")]) || 0);
      const instrument = resolveOptionInstrument({
        symbol: symbolRaw,
        description: cell(row, "description"),
        underlying: cell(row, "underlyingsymbol") ?? cell(row, "underlying"),
        expiry: cell(row, "expiry") ?? cell(row, "lasttradingday"),
        strike: cell(row, "strike") ?? cell(row, "strikeprice"),
        right: cell(row, "putcall"),
        assetClass: ibkrAssetClass(cell(row, "assetcategory") ?? cell(row, "assetclass")),
      });

      if (
        !instrument.symbol ||
        !executedAt ||
        !Number.isFinite(quantitySigned) ||
        quantitySigned === 0 ||
        !Number.isFinite(price)
      ) {
        skippedRows++;
        continue;
      }
      executions.push({
        symbol: instrument.symbol,
        side: quantitySigned > 0 ? "buy" : "sell",
        quantity: parseQuantity(String(Math.abs(quantitySigned))),
        price,
        fee: Number.isFinite(fee) ? fee : 0,
        executedAt,
        ...(legacyExecutedAt && legacyExecutedAt !== executedAt ? { legacyExecutedAt } : {}),
        assetClass: instrument.assetClass,
      });
    }

    return { format: "ibkr", executions, skippedRows, warnings: [] };
  },
};
