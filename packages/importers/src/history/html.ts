/* Adapted from ChristopherDownie/prop-firm-sim, commit 2aedb92208ab34ef7a1d0e42c290b8b78bae081f.
 * Copyright (c) 2026 LuxAlgo. MIT license: packages/importers/LICENSE.
 * Journal adaptation keeps history parsing separate from existing fill importers. */

/*
  HTML statement support. MetaTrader's own "Save as Report" produces HTML (no
  CSV button exists in the terminal), and other broker portals hand out HTML
  statements too. This module extracts <table> rows from such documents so the
  ordinary pipeline - header location, adapter signatures, reconstruction -
  runs unchanged on top.

  Deliberately NOT a general HTML parser: statement files are machine-emitted
  from templates, so a small deterministic tag walker is safer than a real DOM
  and keeps the core dependency-free and browser/Node portable. Security
  stance: the document is untrusted - nothing is executed or resolved,
  <script>/<style> content is discarded wholesale, tags are stripped to text,
  and the same size caps as the CSV path apply.
*/

import { DEFAULT_MAX_CHARS, DEFAULT_MAX_ROWS, type CsvLimits, type CsvRecord } from "./csv";
import { issue, type ImportIssue } from "./model";

/**
 * Cheap, deterministic check: an HTML document rather than delimited text.
 * Requires markup at the very start (statements begin with <!DOCTYPE/<html/
 * <table…) plus a table element, so a CSV merely containing "<table" in some
 * cell never routes here.
 */
export function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 4096).replace(/^﻿/, "").trimStart().toLowerCase();
  if (!head.startsWith("<")) return false;
  if (!/^<(!doctype\s+html|html|head|body|meta|table|div)[\s>]/.test(head)) return false;
  return /<table[\s>]/i.test(text) && /<\/table>/i.test(text);
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  minus: "−",
  ndash: "–",
  mdash: "-",
};

/** Decode the entity set statement templates actually use; unknown entities pass through. */
export function decodeEntities(raw: string): string {
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export interface HtmlTable {
  /** Rows of decoded cell text; colspans are padded with empty cells to keep columns aligned. */
  records: CsvRecord[];
}

const TAG = /<(\/)?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)\/?>|<!--[\s\S]*?-->/g;

function colspanOf(attrs: string): number {
  const m = attrs.match(/colspan\s*=\s*["']?(\d+)/i);
  const n = m !== null ? Number(m[1]) : 1;
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : 1;
}

/**
 * MT5 reports embed collapsible detail cells/rows marked class="hidden"
 * (e.g. an 8-column-wide comment cell inside every position row). They are
 * not part of the visible table, and keeping them shifts every later column,
 * so they are dropped entirely - cell padding included.
 */
function isHidden(attrs: string): boolean {
  const m = attrs.match(/class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const value = m === null ? "" : (m[1] ?? m[2] ?? m[3] ?? "");
  return /\bhidden\b/i.test(value);
}

/**
 * Walk the document's tags and collect every table's rows. Nested tables (rare
 * in statements) collect into their own table, not the parent. Cell text is
 * entity-decoded and whitespace-collapsed; each row remembers the 1-based
 * source line its <tr> started on, so downstream diagnostics stay clickable.
 */
export function extractHtmlTables(
  text: string,
  limits: CsvLimits = {},
): {
  tables: HtmlTable[];
  issues: ImportIssue[];
} {
  const issues: ImportIssue[] = [];
  const maxChars = limits.maxChars ?? DEFAULT_MAX_CHARS;
  const maxRows = limits.maxRows ?? DEFAULT_MAX_ROWS;

  let input = text;
  if (input.includes("\0")) {
    issues.push(
      issue(
        "warning",
        "malformed-csv",
        "The HTML file contains NUL bytes (it may be UTF-16); they were removed. " +
          "If values look garbled, re-save the report as UTF-8.",
      ),
    );
    input = input.replaceAll("\0", "");
  }
  if (input.length > maxChars) {
    issues.push(
      issue(
        "warning",
        "input-truncated",
        `The file is larger than the ${Math.round(maxChars / 1_000_000)} MB limit; only the first part was read.`,
      ),
    );
    input = input.slice(0, maxChars);
  }

  const tables: HtmlTable[] = [];
  const stack: { records: CsvRecord[]; row: string[] | null; rowLine: number }[] = [];
  let cellBuffer: string[] | null = null; // text fragments of the currently open cell
  let pendingSpan = 1; // colspan of that cell, applied when it closes
  let skipRow = false; // inside a class="hidden" row
  let skipCell = false; // inside a class="hidden" cell
  let totalRows = 0;
  let line = 1;
  let cursor = 0;

  const advanceLines = (upTo: number): void => {
    for (let i = cursor; i < upTo; i++) if (input.charCodeAt(i) === 10) line++;
    cursor = upTo;
  };
  const flushText = (upTo: number): void => {
    if (cellBuffer !== null && upTo > cursor) cellBuffer.push(input.slice(cursor, upTo));
    advanceLines(upTo);
  };
  const closeCell = (): void => {
    const table = stack[stack.length - 1];
    if (table === undefined || table.row === null || cellBuffer === null) {
      cellBuffer = null;
      return;
    }
    const value = decodeEntities(cellBuffer.join(" ")).replace(/\s+/g, " ").trim();
    table.row.push(value);
    cellBuffer = null;
  };
  const closeRow = (): void => {
    closeCell();
    const table = stack[stack.length - 1];
    if (table === undefined || table.row === null) return;
    if (table.row.some((c) => c !== "")) {
      table.records.push({ cells: table.row, line: table.rowLine });
      totalRows++;
    }
    table.row = null;
  };

  TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG.exec(input)) !== null && totalRows < maxRows) {
    flushText(match.index);
    advanceLines(TAG.lastIndex);
    if (match[0].startsWith("<!--")) continue;
    const closing = match[1] === "/";
    const name = match[2]!.toLowerCase();
    const attrs = match[3] ?? "";

    if (!closing && (name === "script" || name === "style")) {
      // Discard the element's entire content: skip to its close tag.
      const end = input.toLowerCase().indexOf(`</${name}`, TAG.lastIndex);
      const resume = end === -1 ? input.length : input.indexOf(">", end) + 1;
      advanceLines(resume === 0 ? input.length : resume);
      TAG.lastIndex = cursor;
      continue;
    }
    if (name === "br") {
      if (cellBuffer !== null) cellBuffer.push(" ");
      continue;
    }
    if (name === "table") {
      if (!closing) {
        stack.push({ records: [], row: null, rowLine: line });
      } else {
        closeRow();
        const done = stack.pop();
        if (done !== undefined && done.records.length > 0) tables.push({ records: done.records });
      }
      continue;
    }
    const table = stack[stack.length - 1];
    if (table === undefined) continue; // markup outside any table
    if (name === "tr") {
      closeRow(); // also recovers from an unclosed previous <tr>
      skipRow = !closing && isHidden(attrs);
      if (!closing && !skipRow) {
        table.row = [];
        table.rowLine = line;
      }
      continue;
    }
    if (name === "td" || name === "th") {
      if (skipRow) continue;
      if (!closing) {
        closeCell(); // recover from an unclosed previous cell
        if (isHidden(attrs)) {
          skipCell = true;
          cellBuffer = null;
          continue;
        }
        skipCell = false;
        if (table.row === null) {
          table.row = []; // row-less cell: tolerate sloppy markup
          table.rowLine = line;
        }
        cellBuffer = [];
        pendingSpan = colspanOf(attrs);
      } else if (skipCell) {
        skipCell = false;
      } else {
        // The value lands in the first spanned column; padding keeps the
        // indices of every later column intact.
        closeCell();
        if (table.row !== null) for (let i = 1; i < pendingSpan; i++) table.row.push("");
        pendingSpan = 1;
      }
      continue;
    }
    // Any other tag inside a cell separates text fragments.
    if (cellBuffer !== null) cellBuffer.push(" ");
  }
  if (totalRows >= maxRows) {
    issues.push(
      issue(
        "warning",
        "input-truncated",
        `The document has more than ${maxRows.toLocaleString("en-US")} table rows; the rest were ignored.`,
      ),
    );
  }
  // Close anything left open by truncated/malformed markup, keeping any text
  // the document ended in the middle of.
  flushText(input.length);
  while (stack.length > 0) {
    closeRow();
    const done = stack.pop();
    if (done !== undefined && done.records.length > 0) tables.push({ records: done.records });
  }
  if (tables.length === 0) {
    issues.push(
      issue(
        "error",
        "unsupported-format",
        "The file looks like HTML, but no table rows could be extracted from it. " +
          "Export the statement again, or save it as CSV.",
      ),
    );
  }
  return { tables, issues };
}

/**
 * True for rows like "Open Trades:" / "Orders" / "Closed P/L: 123.45" - a
 * section title or summary line, not trade data. Two shapes: a near-empty
 * all-text row (a title), or a mostly-empty row whose first value is a label
 * ending in ":" (a summary). Trade and balance rows carry ids/amounts across
 * many cells, so neither shape matches them.
 */
function isSectionTitleRow(cells: readonly string[]): boolean {
  const nonEmpty = cells.map((c) => c.trim()).filter((c) => c !== "");
  if (nonEmpty.length === 0) return false;
  if (nonEmpty.length <= 2 && nonEmpty.every((c) => !/\d/.test(c))) return true;
  return nonEmpty.length <= 4 && /[a-zA-Z]/.test(nonEmpty[0]!) && nonEmpty[0]!.endsWith(":");
}

/**
 * Multi-section statements (MetaTrader: Closed Transactions → Open Trades →
 * Working Orders → Summary) repeat header rows and interleave title/summary
 * lines. Given the data rows that follow the located header, cut at the first
 * row that starts a new section, so open trades and pending orders are never
 * imported as closed trades. `isHeaderLike` is the same alias scoring the
 * header locator uses.
 */
export function truncateAtSectionBoundary(
  records: readonly CsvRecord[],
  isHeaderLike: (cells: readonly string[]) => boolean,
): { records: CsvRecord[]; truncatedAt: number | null } {
  for (let i = 0; i < records.length; i++) {
    const cells = records[i]!.cells;
    if (isSectionTitleRow(cells) || isHeaderLike(cells)) {
      return { records: records.slice(0, i), truncatedAt: records[i]!.line };
    }
  }
  return { records: [...records], truncatedAt: null };
}
