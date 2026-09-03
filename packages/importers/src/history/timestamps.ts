/* Adapted from prop-firm-sim 2aedb922: epoch, ISO, MetaTrader, compact and
 * file-wide slash-date handling. Copyright (c) 2026 LuxAlgo, MIT.
 * Uses the journal's timezone conversion for timestamps without offsets and
 * falls back to the journal's parser for every other layout it accepts. */
import { parseTimestamp as journalTimestamp } from "../dates";

export type SlashDateOrder = "MDY" | "DMY";
const SLASH_DATE =
  /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;

/**
 * Timezone abbreviations some journal exports append ("09:31:00 EST") are
 * ambiguous; like the journal parser, strip them and read the wall clock in
 * the caller's timezone.
 */
const TZ_ABBREVIATION = /\s+(E[SD]T|C[SD]T|M[SD]T|P[SD]T|UTC|GMT)$/i;

export function detectSlashDateOrder(samples: readonly string[]): {
  order: SlashDateOrder | null;
  proven: boolean;
} {
  let sawSlash = false;
  for (const raw of samples) {
    const match = raw.trim().replace(TZ_ABBREVIATION, "").match(SLASH_DATE);
    if (!match) continue;
    sawSlash = true;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12 && second <= 12) return { order: "DMY", proven: true };
    if (second > 12 && first <= 12) return { order: "MDY", proven: true };
  }
  return sawSlash ? { order: "MDY", proven: false } : { order: null, proven: false };
}

/** Parse a history timestamp to epoch milliseconds UTC; NaN when unparseable. */
export function parseImportTimestamp(
  raw: string,
  slashOrder: SlashDateOrder = "MDY",
  timeZone = "UTC",
): number {
  const value = raw.trim().replace(/^"|"$/g, "").trim().replace(TZ_ABBREVIATION, "");
  if (/^\d{10}(\.\d+)?$/.test(value)) return Math.trunc(Number(value) * 1000);
  if (/^\d{13}$/.test(value)) return Number(value);
  let parts: number[];
  let offset: string | undefined;
  const iso = value.match(
    /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/i,
  );
  const slash = value.match(SLASH_DATE);
  const compact = value.match(/^(\d{4})(\d{2})(\d{2});(\d{2})(\d{2})(\d{2})$/);
  if (iso) {
    parts = [
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      Number(iso[4] ?? 0),
      Number(iso[5] ?? 0),
      Number(iso[6] ?? 0),
      Number((iso[7] ?? "").padEnd(3, "0").slice(0, 3)),
    ];
    offset = iso[8];
  } else if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const dmy = slashOrder === "DMY";
    let year = Number(slash[3]);
    // Same two-digit-year rule as the journal parser (src/dates.ts): 20xx.
    if (slash[3]!.length === 2) year += 2000;
    let hour = Number(slash[4] ?? 0);
    if (slash[7]) {
      if (hour < 1 || hour > 12) return NaN;
      hour = (hour % 12) + (slash[7].toLowerCase() === "pm" ? 12 : 0);
    }
    parts = [
      year,
      dmy ? second : first,
      dmy ? first : second,
      hour,
      Number(slash[5] ?? 0),
      Number(slash[6] ?? 0),
      0,
    ];
  } else if (compact) {
    parts = compact.slice(1).map(Number).concat(0);
  } else {
    // Anything else ("Jan 5, 2026 14:30", ...) goes to the journal parser so
    // the history path accepts every layout the legacy importers accept.
    const fallback = journalTimestamp(value, timeZone);
    return fallback ? Date.parse(fallback) : NaN;
  }
  const [year, month, day, hour, minute, second, millisecond] = parts as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return NaN;
  if (offset) {
    if (offset.toUpperCase() === "Z") return utc;
    const digits = offset.slice(1).replace(":", "");
    const hours = Number(digits.slice(0, 2));
    const minutes = Number(digits.slice(2));
    if (hours > 23 || minutes > 59) return NaN;
    return utc - (offset[0] === "-" ? -1 : 1) * (hours * 60 + minutes) * 60_000;
  }
  const converted = journalTimestamp(check.toISOString().slice(0, 19), timeZone);
  return converted ? Date.parse(converted) + millisecond : NaN;
}
