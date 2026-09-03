/* Adapted from ChristopherDownie/prop-firm-sim, commit 2aedb92208ab34ef7a1d0e42c290b8b78bae081f.
 * Copyright (c) 2026 LuxAlgo. MIT license: packages/importers/LICENSE.
 * Journal adaptation keeps history parsing separate from existing fill importers. */

/*
  Tabular text parsing for untrusted uploads. RFC 4180-style tokenizer with
  delimiter sniffing (comma / semicolon / tab / pipe), quoted fields with
  embedded delimiters, quotes, and newlines, BOM stripping, and hard size
  caps. Pure and browser-safe: no Node APIs, no locale, no Date.
*/

import { issue, type ImportIssue } from "./model";

export interface CsvLimits {
  /** Reject inputs larger than this many UTF-16 code units (~bytes for ASCII). */
  maxChars?: number;
  /** Stop after this many records (a truncation warning is emitted). */
  maxRows?: number;
}

export const DEFAULT_MAX_CHARS = 20_000_000; // ~20 MB of ASCII
export const DEFAULT_MAX_ROWS = 200_000;

export interface CsvRecord {
  cells: string[];
  /** 1-based line number where the record starts in the source text. */
  line: number;
}

export interface CsvParseResult {
  delimiter: string;
  records: CsvRecord[];
  issues: ImportIssue[];
  truncated: boolean;
}

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * Repair text that was decoded with the wrong charset. MetaTrader saves its
 * HTML reports as UTF-16LE; read as UTF-8 they arrive as replacement chars
 * followed by NUL-interleaved ASCII ("��<\0!\0D\0O\0C…"). When that pattern
 * is unmistakable, strip the artifacts so detection and parsing see the real
 * characters (non-ASCII text in such files is already lost to the wrong
 * decode — the caller is told so it can warn).
 */
export function normalizeImportText(raw: string): { text: string; repairedUtf16: boolean } {
  let text = raw.replace(/^[\uFEFF\uFFFE]+/, "");
  const probe = text.slice(0, 4000);
  let nuls = 0;
  for (let i = 0; i < probe.length; i++) if (probe.charCodeAt(i) === 0) nuls++;
  const bomThenNuls = /^\uFFFD{1,4}[\s\S]\u0000/.test(text);
  if (bomThenNuls || (probe.length > 20 && nuls > probe.length / 5)) {
    text = text
      .replace(/^\uFFFD+/, "")
      .replaceAll("\u0000", "")
      .replace(/^[\uFEFF\uFFFE]+/, "");
    return { text, repairedUtf16: true };
  }
  return { text, repairedUtf16: false };
}

/**
 * Pick the delimiter that splits the first non-empty lines into the most
 * consistent column count (ties break in candidate order). Quotes are not
 * interpreted during sniffing; consistency across lines is what matters.
 */
export function sniffDelimiter(text: string): string {
  const lines = text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== "")
    .slice(0, 10);
  if (lines.length === 0) return ",";
  let best: string = ",";
  let bestScore = -1;
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = lines.map((line) => line.split(delimiter).length);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    if (max < 2) continue; // never splits: not this delimiter
    // Consistent column counts score high; inconsistent ones are penalized.
    const score = min * 1000 - (max - min) * 10 + max;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

/**
 * Tokenize delimiter-separated text. Handles quoted fields ("a,b", doubled
 * quotes), records spanning lines inside quotes, CRLF/CR/LF, and a UTF-8 BOM.
 * Never throws on malformed quoting: an unterminated quote closes at EOF with
 * a warning, so one bad cell cannot take down a whole import.
 */
export function parseCsv(text: string, limits: CsvLimits = {}, delimiter?: string): CsvParseResult {
  const issues: ImportIssue[] = [];
  const maxChars = limits.maxChars ?? DEFAULT_MAX_CHARS;
  const maxRows = limits.maxRows ?? DEFAULT_MAX_ROWS;

  let input = text;
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1); // UTF-8 BOM
  if (input.includes("\0")) {
    issues.push(
      issue(
        "warning",
        "malformed-csv",
        "The file contains NUL bytes (it may be UTF-16 or binary); they were removed. " +
          "If columns look garbled, re-export as UTF-8 CSV.",
      ),
    );
    input = input.replaceAll("\0", "");
  }
  let truncated = false;
  if (input.length > maxChars) {
    issues.push(
      issue(
        "warning",
        "input-truncated",
        `The input is larger than the ${Math.round(maxChars / 1_000_000)} MB limit; ` +
          "only the first part was read.",
      ),
    );
    input = input.slice(0, maxChars);
    truncated = true;
  }

  const delim = delimiter ?? sniffDelimiter(input);
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let sawUnterminatedQuote = false;

  const pushCell = (): void => {
    cells.push(cell);
    cell = "";
  };
  const pushRecord = (): boolean => {
    pushCell();
    // Skip records that are entirely empty (blank lines).
    if (cells.length > 1 || cells[0]!.trim() !== "") {
      records.push({ cells, line: recordLine });
      if (records.length >= maxRows) return false;
    }
    cells = [];
    return true;
  };

  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && input[i + 1] === "\n") i++;
        cell += "\n";
        line++;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      inQuotes = true;
      cell = ""; // discard any leading whitespace before the quote
      i++;
      continue;
    }
    if (ch === delim) {
      pushCell();
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      if (!pushRecord()) {
        issues.push(
          issue(
            "warning",
            "input-truncated",
            `The file has more than ${maxRows.toLocaleString("en-US")} rows; the rest were ignored.`,
          ),
        );
        truncated = true;
        cells = [];
        cell = "";
        line++;
        i++;
        return { delimiter: delim, records, issues, truncated };
      }
      line++;
      recordLine = line;
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (inQuotes) sawUnterminatedQuote = true;
  if (cell !== "" || cells.length > 0) pushRecord();

  if (sawUnterminatedQuote) {
    issues.push(
      issue(
        "warning",
        "malformed-csv",
        `A quoted field starting around line ${recordLine} is never closed; ` +
          "it was read to the end of the file. Check the export for a stray quote character.",
      ),
    );
  }
  return { delimiter: delim, records, issues, truncated };
}

const FORMULA_PREFIX = /^[=@]|^[+-]{2}|^\t/;

/**
 * Neutralize spreadsheet formula injection in a string that will be retained
 * (symbol, id, signal) and later shown or re-exported. Leading '=' / '@' /
 * doubled sign / tab are stripped; plain negative numbers are untouched.
 */
export function sanitizeRetainedText(raw: string): { value: string; wasFormulaLike: boolean } {
  let value = raw.trim();
  let wasFormulaLike = false;
  while (FORMULA_PREFIX.test(value)) {
    wasFormulaLike = true;
    value = value.replace(FORMULA_PREFIX, "").trim();
  }
  return { value, wasFormulaLike };
}

/**
 * Parse a numeric cell defensively. Accepts currency symbols ($ € £), spaces
 * and thousands separators, parentheses negatives "(123.45)", a trailing "%"
 * or "R", and European decimal commas when unambiguous. Returns NaN (never
 * Infinity) on anything else, including "NaN"/"Infinity" strings.
 */
export function parseNumericCell(raw: string): number {
  let s = raw.trim();
  if (s === "" || s === "—" || s === "-" || s === "–" || s === "−") return Number.NaN;
  s = s.replace(/−/gu, "-"); // Unicode minus (what &minus; decodes to)
  let negative = false;
  const paren = s.match(/^\((.*)\)$/);
  if (paren !== null) {
    negative = true;
    s = paren[1]!.trim();
  }
  s = s.replace(/^[$€£¥]\s*/u, "").replace(/\s*(USD|EUR|GBP|JPY|usd|eur|gbp|jpy)$/u, "");
  s = s.replace(/[%rR]$/u, "").trim();
  // Thousands separators: "1,234.56" / "1 234,56" / "1.234,56". A single
  // dot group ("217.131") is ambiguous with a plain 3-decimal price (FX JPY
  // pairs), so dots read as thousands only when unambiguous: two or more
  // groups, or a decimal comma present.
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replaceAll(",", "");
  else if (/^[+-]?\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(s) || /^[+-]?\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    s = s.replaceAll(".", "").replace(",", ".");
  } else if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  s = s.replaceAll(/\s/gu, "");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number.NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return Number.NaN;
  return negative ? -n : n;
}
