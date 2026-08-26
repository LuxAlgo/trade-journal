/** Timezone-aware bucketing helpers. All analytics accept an IANA timezone so a
 * trader's "day" matches their session, not the server's clock. */

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const partFormatters = new Map<string, Intl.DateTimeFormat>();

const dateFormatter = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter;
};

const partFormatter = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = partFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    });
    partFormatters.set(timeZone, formatter);
  }
  return formatter;
};

/** "YYYY-MM-DD" in the given timezone. */
export const dayKeyOf = (iso: string, timeZone = "UTC"): string =>
  dateFormatter(timeZone).format(new Date(iso));

/** "YYYY-MM" in the given timezone. */
export const monthKeyOf = (iso: string, timeZone = "UTC"): string =>
  dayKeyOf(iso, timeZone).slice(0, 7);

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const weekdayOf = (iso: string, timeZone = "UTC"): Weekday => {
  const parts = partFormatter(timeZone).formatToParts(new Date(iso));
  return (parts.find((p) => p.type === "weekday")?.value ?? "Sun") as Weekday;
};

/** Hour of day 0-23 in the given timezone. */
export const hourOf = (iso: string, timeZone = "UTC"): number => {
  const parts = partFormatter(timeZone).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return hour === 24 ? 0 : hour;
};
