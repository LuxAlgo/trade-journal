/**
 * Regular trading hours of the major exchanges, in each exchange's own time zone so
 * daylight-saving changes land on the right UTC instant. Weekdays only; exchange
 * holidays are not modelled (the economic calendar lists bank holidays).
 */
export interface MarketSession {
  id: "sydney" | "tokyo" | "london" | "frankfurt" | "newyork";
  label: string;
  /** Two characters for the chart's event glyph. */
  letter: string;
  timeZone: string;
  open: string;
  close: string;
}

export const MARKET_SESSIONS: MarketSession[] = [
  {
    id: "sydney",
    label: "Sydney (ASX)",
    letter: "SY",
    timeZone: "Australia/Sydney",
    open: "10:00",
    close: "16:00",
  },
  {
    id: "tokyo",
    label: "Tokyo (TSE)",
    letter: "TK",
    timeZone: "Asia/Tokyo",
    open: "09:00",
    close: "15:00",
  },
  {
    id: "london",
    label: "London (LSE)",
    letter: "LN",
    timeZone: "Europe/London",
    open: "08:00",
    close: "16:30",
  },
  {
    id: "frankfurt",
    label: "Frankfurt (Xetra)",
    letter: "FR",
    timeZone: "Europe/Berlin",
    open: "09:00",
    close: "17:30",
  },
  {
    id: "newyork",
    label: "New York (NYSE)",
    letter: "NY",
    timeZone: "America/New_York",
    open: "09:30",
    close: "16:00",
  },
];

export interface SessionEvent {
  id: string;
  session: MarketSession["id"];
  kind: "open" | "close";
  time: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
const formatter = (timeZone: string) => {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    partsCache.set(timeZone, f);
  }
  return f;
};

/** Wall-clock fields of `time` in `timeZone`. */
function zoned(time: number, timeZone: string) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(time)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday as string,
  };
}

/** The UTC instant of a wall-clock time in `timeZone` (two passes settle DST offsets). */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall;
  for (let pass = 0; pass < 2; pass += 1) {
    const z = zoned(guess, timeZone);
    const seen = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute);
    guess += wall - seen;
  }
  return guess;
}

const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

/** Session opens and closes between `from` and `to` (epoch ms), in time order. */
export function sessionEvents(
  from: number,
  to: number,
  sessions: readonly MarketSession[] = MARKET_SESSIONS,
): SessionEvent[] {
  const events: SessionEvent[] = [];
  const DAY = 86_400_000;
  // Walk calendar days a little past both ends: a zone's local day can straddle UTC days.
  for (let t = Math.floor(from / DAY) * DAY - DAY; t <= to + DAY; t += DAY) {
    for (const session of sessions) {
      const local = zoned(t + DAY / 2, session.timeZone);
      if (!WEEKDAYS.has(local.weekday)) continue;
      for (const kind of ["open", "close"] as const) {
        const [h, m] = session[kind].split(":").map(Number) as [number, number];
        const time = zonedToUtc(local.year, local.month, local.day, h, m, session.timeZone);
        if (time >= from && time <= to)
          events.push({
            id: `${session.id}-${kind}-${local.year}-${local.month}-${local.day}`,
            session: session.id,
            kind,
            time,
          });
      }
    }
  }
  const unique = new Map(events.map((e) => [e.id, e]));
  return [...unique.values()].sort((a, b) => a.time - b.time);
}
