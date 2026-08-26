import { headerKey, parseCsv } from "../csv";
import { parseTimestamp } from "../dates";
import { parseMoney, parseQuantity } from "../numbers";
import type { AssetClass } from "@luxalgo/journal-core";
import type { ImportFormat, ImportedExecution, ParsedImport } from "../types";

const ASSET_MAP: Record<string, AssetClass> = {
  stocks: "equity",
  equityandindexoptions: "option",
  futures: "futures",
  forex: "forex",
  cryptocurrency: "crypto",
  cfds: "cfd",
};

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
      const symbol = (row[col("symbol")] ?? "").trim().toUpperCase();
      const quantitySigned = parseMoney(row[col("quantity")]);
      const price = parseMoney(row[col("tprice")] ?? row[col("price")]);
      const executedAt = parseTimestamp(row[col("datetime")], options.timeZone);
      const fee = Math.abs(parseMoney(row[col("commfee")] ?? row[col("commission")]) || 0);
      const assetClass = ASSET_MAP[headerKey(row[col("assetcategory")] ?? "")];

      if (
        !symbol ||
        !executedAt ||
        !Number.isFinite(quantitySigned) ||
        quantitySigned === 0 ||
        !Number.isFinite(price)
      ) {
        skippedRows++;
        continue;
      }
      executions.push({
        symbol,
        side: quantitySigned > 0 ? "buy" : "sell",
        quantity: parseQuantity(String(Math.abs(quantitySigned))),
        price,
        fee: Number.isFinite(fee) ? fee : 0,
        executedAt,
        assetClass,
      });
    }

    return { format: "ibkr", executions, skippedRows, warnings: [] };
  },
};
