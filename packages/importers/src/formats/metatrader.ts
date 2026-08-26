import { parseTimestamp } from "../dates";
import { parseMoney, parseQuantity } from "../numbers";
import {
  tradeToExecutions,
  type ImportFormat,
  type ImportedTrade,
  type ParsedImport,
} from "../types";

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();

const rowCells = (rowHtml: string): string[] =>
  [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]!));

/**
 * MetaTrader 4/5 statement (.htm/.html). Closed-trade rows carry
 * ticket, open time, type (buy/sell), size, item/symbol, open price,
 * close time, close price, commission, swap, profit. Trade-level, so each row
 * becomes a reconstructed entry + exit execution pair.
 */
export const metatrader: ImportFormat = {
  id: "metatrader",
  label: "MetaTrader 4/5 (HTML statement)",
  detect: (_headers, content) =>
    /<html/i.test(content) &&
    /(MetaTrader|MetaQuotes|Closed Transactions|Strategy Tester)/i.test(content),
  parse: (content, options): ParsedImport => {
    const rows = [...content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => rowCells(m[1]!));
    const executions: ParsedImport["executions"] = [];
    let skippedRows = 0;

    for (const cells of rows) {
      // MT4 closed-transaction shape: Ticket, Open Time, Type, Size, Item, Price, S/L, T/P, Close Time, Price, Commission, Taxes, Swap, Profit
      if (cells.length < 10) continue;
      const type = (cells[2] ?? "").toLowerCase();
      if (type !== "buy" && type !== "sell") continue;

      const openedAt = parseTimestamp(cells[1], options.timeZone);
      const quantity = parseQuantity(cells[3]);
      const symbol = (cells[4] ?? "").trim().toUpperCase();
      const entryPrice = parseMoney(cells[5]);

      // Find the close-time cell: first parseable timestamp after the entry price.
      let closeIndex = -1;
      for (let i = 6; i < cells.length; i++) {
        if (parseTimestamp(cells[i], options.timeZone)) {
          closeIndex = i;
          break;
        }
      }
      if (
        !openedAt ||
        closeIndex === -1 ||
        !symbol ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(entryPrice)
      ) {
        skippedRows++;
        continue;
      }
      const closedAt = parseTimestamp(cells[closeIndex], options.timeZone)!;
      const exitPrice = parseMoney(cells[closeIndex + 1]);
      if (!Number.isFinite(exitPrice)) {
        skippedRows++;
        continue;
      }
      const commission = Math.abs(parseMoney(cells[closeIndex + 2]) || 0);
      const swap = Math.abs(parseMoney(cells[closeIndex + 4] ?? cells[closeIndex + 3]) || 0);

      const trade: ImportedTrade = {
        symbol,
        direction: type === "buy" ? "long" : "short",
        quantity,
        entryPrice,
        exitPrice,
        openedAt,
        closedAt,
        fees: (Number.isFinite(commission) ? commission : 0) + (Number.isFinite(swap) ? swap : 0),
        assetClass: "forex",
      };
      executions.push(...tradeToExecutions(trade));
    }

    return {
      format: "metatrader",
      executions,
      skippedRows,
      warnings:
        executions.length > 0
          ? [
              "MetaTrader statements are trade-level; entry/exit executions were reconstructed at the reported prices. Swap was folded into fees.",
            ]
          : [],
    };
  },
};
