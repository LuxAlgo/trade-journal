/** Timestamp parsing for broker exports. Exports rarely carry offsets, so
 * naive timestamps are interpreted in the caller's chosen IANA timezone. */

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

const offsetFormatter = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    offsetFormatters.set(timeZone, formatter);
  }
  return formatter;
};

/** What the wall clock in `timeZone` reads at the given UTC instant, as a UTC-ms value. */
const wallClockAsUtc = (utcMs: number, timeZone: string): number => {
  const parts = offsetFormatter(timeZone).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const hour = get("hour") === 24 ? 0 : get("hour");
  return Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
};

/** Interpret a naive wall-clock timestamp (UTC-ms encoding) as a moment in `timeZone`. */
const naiveToUtc = (naiveUtcMs: number, timeZone: string): number => {
  // Two-pass: guess offset at the naive instant, then re-check at the corrected instant
  // so DST boundaries land right.
  let guess = naiveUtcMs - (wallClockAsUtc(naiveUtcMs, timeZone) - naiveUtcMs);
  guess = naiveUtcMs - (wallClockAsUtc(guess, timeZone) - guess);
  return guess;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

interface NaiveParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const toNaive = (value: string): NaiveParts | null => {
  const text = value.trim();

  // IBKR Flex Query: "20260105;093100"
  let flexMatch = text.match(/^(\d{4})(\d{2})(\d{2})[;,](\d{2})(\d{2})(\d{2})$/);
  if (flexMatch) {
    return {
      year: Number(flexMatch[1]),
      month: Number(flexMatch[2]),
      day: Number(flexMatch[3]),
      hour: Number(flexMatch[4]),
      minute: Number(flexMatch[5]),
      second: Number(flexMatch[6]),
    };
  }

  // ISO-ish: 2026-01-05 14:30:00 / 2026.01.05 14:30 / 2026-01-05T14:30:00
  let match = text.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4] ?? 0),
      minute: Number(match[5] ?? 0),
      second: Number(match[6] ?? 0),
    };
  }

  // US: 01/05/2026 2:30:00 PM  (also 1/5/26)
  match = text.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:[, ]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?)?/,
  );
  if (match) {
    let hour = Number(match[4] ?? 0);
    const meridiem = match[7]?.toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    const year = Number(match[3]!.length === 2 ? `20${match[3]}` : match[3]);
    return {
      year,
      month: Number(match[1]),
      day: Number(match[2]),
      hour,
      minute: Number(match[5] ?? 0),
      second: Number(match[6] ?? 0),
    };
  }

  // "Jan 5, 2026 14:30"
  match = text.match(
    /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})(?:[, ]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?)?/,
  );
  if (match) {
    const month = MONTHS[match[1]!.slice(0, 3).toLowerCase()];
    if (!month) return null;
    let hour = Number(match[4] ?? 0);
    const meridiem = match[7]?.toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    return {
      year: Number(match[3]),
      month,
      day: Number(match[2]),
      hour,
      minute: Number(match[5] ?? 0),
      second: Number(match[6] ?? 0),
    };
  }

  return null;
};

/**
 * Parse a broker-export timestamp to ISO 8601 UTC.
 * A trailing offset/Z is honored; otherwise the timestamp is interpreted in `timeZone`.
 * Returns null when the value cannot be parsed.
 */
export const parseTimestamp = (value: string | undefined, timeZone = "UTC"): string | null => {
  if (!value) return null;
  // Some journal exports (TradeZella) append a timezone abbreviation to time
  // fields ("09:31:00 EST"). Abbreviations are ambiguous, so we strip them and
  // interpret the wall clock in the caller's timezone — documented behavior.
  const text = value.trim().replace(/\s+(E[SD]T|C[SD]T|M[SD]T|P[SD]T|UTC|GMT)$/i, "");
  if (text === "") return null;

  if (/(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const ms = Date.parse(text);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }

  const naive = toNaive(text);
  if (!naive) return null;
  const naiveUtcMs = Date.UTC(
    naive.year,
    naive.month - 1,
    naive.day,
    naive.hour,
    naive.minute,
    naive.second,
  );
  if (Number.isNaN(naiveUtcMs)) return null;
  const utcMs = timeZone === "UTC" ? naiveUtcMs : naiveToUtc(naiveUtcMs, timeZone);
  return new Date(utcMs).toISOString();
};

/** Combine separate date and time columns ("1/5/2026" + "14:30:05"). */
export const parseDateAndTime = (
  date: string | undefined,
  time: string | undefined,
  timeZone = "UTC",
): string | null => parseTimestamp([date, time].filter(Boolean).join(" "), timeZone);
