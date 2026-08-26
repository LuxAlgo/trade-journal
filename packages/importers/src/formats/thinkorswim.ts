import { parseCsv, toRecords } from "../csv";
import { rowsToFills } from "./fills";
import type { ImportFormat, ParsedImport } from "../types";

/**
 * ThinkorSwim (Charles Schwab) account statement. The file is a multi-section
 * report; only the "Account Trade History" section carries fills. We scan for
 * that section's header row and parse until the next blank/section boundary.
 */
export const thinkorswim: ImportFormat = {
  id: "thinkorswim",
  label: "ThinkorSwim / Charles Schwab (account statement)",
  detect: (_headers, content) => /Account Trade History/i.test(content),
  parse: (content, options): ParsedImport => {
    const lines = content.split(/\r?\n/);
    const start = lines.findIndex((line) => /Account Trade History/i.test(line));
    if (start === -1) {
      return {
        format: "thinkorswim",
        executions: [],
        skippedRows: 0,
        warnings: ["No 'Account Trade History' section found."],
      };
    }

    const section: string[] = [];
    let headerSeen = false;
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (!headerSeen) {
        if (/exec time/i.test(line)) {
          headerSeen = true;
          section.push(line);
        }
        continue;
      }
      // Sections are separated by blank lines or a new section title row (real
      // statements follow trade history with Options / Futures / Equities /
      // Profits and Losses — cross-checked against TradeNote's parser).
      const firstCell = (line.split(",")[0] ?? "").trim();
      if (
        line.trim() === "" ||
        /^([A-Za-z ]+History|Profits and Losses|Account Summary|Options|Futures( Statements)?|Equities|Forex)$/i.test(
          firstCell,
        )
      )
        break;
      section.push(line);
    }

    const records = toRecords(parseCsv(section.join("\n")));
    const { executions, skippedRows } = rowsToFills(
      records,
      {
        symbol: ["symbol"],
        side: ["side"],
        quantity: ["qty", "quantity"],
        price: ["price"],
        timestamp: ["exectime"],
      },
      options,
    );
    const warnings =
      executions.length > 0
        ? [
            "ThinkorSwim statements report commissions in a separate section; fees were not attached to fills.",
          ]
        : [];
    return { format: "thinkorswim", executions, skippedRows, warnings };
  },
};
