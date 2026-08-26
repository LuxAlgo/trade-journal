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
import type { ImportFormat, ImportOptions, ParsedImport } from "./types";

/**
 * Detection order matters: content-signature formats (multi-section statements,
 * HTML) go first, then header-signature CSVs from most to least specific.
 */
export const FORMATS: ImportFormat[] = [
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

export const detectFormat = (content: string): ImportFormat | null => {
  const headers = parseCsv(content)[0] ?? [];
  return FORMATS.find((format) => format.detect(headers, content)) ?? null;
};

/** Detect and parse in one step; null when no known format matches (offer the column mapper). */
export const parseAuto = (content: string, options: ImportOptions = {}): ParsedImport | null => {
  const format = detectFormat(content);
  return format ? format.parse(content, options) : null;
};
