import { hasHeaders, parseCsv, pick, toRecords } from "../csv";
import type { ImportFormat, ImportedExecution } from "../types";
import { rowsToFills, type FillsColumnMap } from "./fills";
import { parseMoney } from "../numbers";

const columns: FillsColumnMap = {
  symbol: ["instrument"],
  side: ["action"],
  quantity: ["quantity", "qty"],
  price: ["price"],
  fees: [["commission"]],
  timestamp: ["time"],
};

/**
 * Grid exports can round timestamps and contain identical, genuine partial fills.
 * Preserve their multiplicity, independently for each source account/contract.
 * Occurrence numbers identify a multiset, not CSV row positions: reordered exports
 * have the same identities. Without execution IDs, partial overlapping multisets
 * cannot always distinguish a new fill from an already imported fill.
 */
export const ninjatrader: ImportFormat = {
  id: "ninjatrader",
  label: "NinjaTrader (executions export)",
  detect: (headers) => hasHeaders(headers, [["instrument"], ["action"], ["price"]]),
  parse: (content, options) => {
    const executions: ImportedExecution[] = [];
    const occurrences = new Map<string, number>();
    const identities = new Map<string, string>();
    const sourceAccounts = new Set<string>();
    const futures = new Set<string>();
    const errors = new Set<string>();
    let skippedRows = 0;
    let withoutId = false;
    let withoutAccount = false;
    for (const row of toRecords(parseCsv(content))) {
      const commission = pick(row, ["commission"]);
      if (
        commission !== undefined &&
        (!/^(?:[+-]?[\d.,]+|\([\d.,]+\))$/.test(commission.replace(/[$€£\s]/g, "")) ||
          !/\d/.test(commission) ||
          !Number.isFinite(parseMoney(commission)))
      ) {
        errors.add(
          "An execution has an invalid commission. Correct the value or leave an unavailable commission blank; it will not be treated as zero.",
        );
        skippedRows++;
        continue;
      }
      const parsed = rowsToFills([row], columns, options, {
        // Preserve the existing display/multiplier symbol convention.
        normalizeSymbol: (symbol) => symbol.split(" ")[0]!.trim().toUpperCase(),
      });
      skippedRows += parsed.skippedRows;
      const fill = parsed.executions[0];
      if (!fill) continue;
      const instrument = row.instrument!.trim().replace(/\s+/g, " ").toUpperCase();
      const account = pick(row, ["account", "accountname", "accountdisplayname"]) ?? "";
      const connection = pick(row, ["connection", "connectionname"]) ?? "";
      // NinjaTrader's Executions grid calls this column "ID", distinct from "Order ID".
      const executionId = pick(row, ["executionid", "id"]);
      const effectText = pick(row, ["ex", "entryexit"])?.toLowerCase();
      const effect =
        effectText === "entry"
          ? "entry"
          : effectText === "exit"
            ? "exit"
            : ["reverse", "entry/exit", "exit/entry"].includes(effectText ?? "")
              ? "reverse"
              : undefined;
      if (effectText && !effect)
        errors.add(
          "Unrecognized NinjaTrader entry/exit value. Export Entry, Exit or Reverse values.",
        );
      const sequenceText = pick(row, ["sequence", "executionsequence"]);
      const sequence = sequenceText === undefined ? undefined : Number(sequenceText);
      if (sequence !== undefined && (!Number.isSafeInteger(sequence) || sequence < 0))
        errors.add("Execution sequence must be a non-negative integer.");
      if (account) sourceAccounts.add(account);
      else withoutAccount = true;
      // Keep full contracts separate even when their displayed root is identical.
      const group = `ninjatrader:${JSON.stringify([connection, account, instrument])}`;
      const signature = JSON.stringify([
        fill.symbol,
        fill.side,
        fill.quantity,
        fill.price,
        fill.executedAt,
      ]);
      const occurrenceKey = JSON.stringify([group, signature]);
      const occurrence = occurrences.get(occurrenceKey) ?? 0;
      occurrences.set(occurrenceKey, occurrence + 1);
      const id = executionId ? `execution:${executionId}` : `fill:${signature}:${occurrence}`;
      withoutId ||= !executionId;
      if (executionId) {
        const key = JSON.stringify([group, id]);
        const previous = identities.get(key);
        if (previous && previous !== signature)
          errors.add(
            "One NinjaTrader execution ID describes different fills. Export a consistent execution history before importing.",
          );
        identities.set(key, signature);
      }
      if (
        / \d{2}-\d{2,4}$/.test(instrument) ||
        /^[A-Z][A-Z0-9]*[FGHJKMNQUVXZ]\d{1,4}$/.test(instrument)
      ) {
        fill.assetClass = "futures";
        futures.add(fill.symbol);
      }
      fill.importMetadata = {
        id,
        group,
        order: executions.length,
        preserveFee: pick(row, ["commission"]) !== undefined,
      };
      fill.ninjaTrader = {
        sourceKey: JSON.stringify([connection, account]),
        account,
        connection,
        instrument,
        executionId,
        effect,
        sequence,
        reportedFee: pick(row, ["commission"]) === undefined ? undefined : fill.fee,
      };
      executions.push(fill);
    }
    const warnings: string[] = [];
    if (sourceAccounts.size > 1)
      warnings.push(
        `${sourceAccounts.size} source accounts found. Their positions stay separate within the selected journal account.`,
      );
    if (withoutAccount)
      warnings.push(
        "Some rows have no source account. Import only one source account into this journal account, and keep the account and connection columns consistent on re-export.",
      );
    if (withoutId)
      warnings.push(
        "No execution ID is available for some fills. Repeated rows are preserved and the same or reordered export imports once. Overlapping exports that split identical fills cannot be reliably reconciled; use complete exports covering those fills, or include execution IDs consistently.",
      );
    if (futures.size)
      warnings.push(
        `Futures P&L requires the correct contract multiplier in Settings for each imported symbol: ${[...futures].join(", ")}.`,
      );
    return { format: "ninjatrader", executions, skippedRows, warnings, errors: [...errors] };
  },
};
