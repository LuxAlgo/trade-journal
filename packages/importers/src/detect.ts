import { parseCsv } from "./csv";
import { ibkr } from "./formats/ibkr";
import { metatrader } from "./formats/metatrader";
import {
  dastrader,
  ibkrFlex,
  ninjatrader,
  topstepx,
  tradervue,
  tradingview,
  tradovate,
  webull,
} from "./formats/simple";
import { thinkorswim } from "./formats/thinkorswim";
import { tradezella } from "./formats/tradezella";
import { historyFormat, parseHistory } from "./formats/history";
import type { ImportFormat, ImportOptions, ParsedImport } from "./types";

/**
 * Detection order matters: content-signature formats (multi-section statements,
 * HTML) go first, then header-signature CSVs from most to least specific.
 */
const LEGACY_FORMATS: ImportFormat[] = [
  metatrader,
  ibkr,
  ibkrFlex,
  thinkorswim,
  tradezella,
  tradervue,
  topstepx,
  tradingview,
  ninjatrader,
  tradovate,
  webull,
  dastrader,
];

export const FORMATS: ImportFormat[] = [...LEGACY_FORMATS, historyFormat];

export const detectFormat = (content: string): ImportFormat | null => {
  const headers = parseCsv(content)[0] ?? [];
  return FORMATS.find((format) => format.detect(headers, content)) ?? null;
};

/** Detect and parse in one step; null when no known format matches (offer the column mapper). */
export const parseAuto = (content: string, options: ImportOptions = {}): ParsedImport | null => {
  const headers = parseCsv(content)[0] ?? [];
  const format = LEGACY_FORMATS.find((candidate) => candidate.detect(headers, content));
  const legacy = format?.parse(content, options);
  // Successful existing imports keep precisely their original interpretation.
  // The history adapter also covers newer variants that an old broad signature
  // recognizes but cannot parse (for example MT5 Deals versus MT4 statements).
  if (legacy?.executions.length) return legacy;
  return parseHistory(content, options) ?? legacy ?? null;
};
