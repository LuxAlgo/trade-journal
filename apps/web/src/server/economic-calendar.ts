import { createHash } from "node:crypto";
import { and, asc, gte, lt, lte } from "drizzle-orm";
import { db, economicEvents } from "@/db";
import {
  IMPACTS,
  type CalendarState,
  type EconomicEvent,
  type EventImpact,
} from "@/lib/economic-calendar";
import { getSetting, setSetting, deleteSetting } from "./settings";
import { readJson } from "./market-data/http";
import { nowIso } from "./ids";

/** The public ForexFactory weekly feed: this week's releases, times with their UTC offset. */
const SOURCE = "forexfactory";
const FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const ENABLED = "economicCalendar:forexfactory";
const FETCHED = "economicCalendar:fetchedAt";
const LAST_ERROR = "economicCalendar:error";
const REFRESH_MS = 60 * 60_000;
const KEEP_MS = 3 * 365 * 86_400_000;

export const calendarEnabled = () => getSetting(ENABLED) === "enabled";

export function setCalendarEnabled(enabled: boolean) {
  if (enabled) setSetting(ENABLED, "enabled");
  else deleteSetting(ENABLED);
}

const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Validate the feed's rows; anything malformed is skipped rather than guessed at. */
export function parseFeed(value: unknown): Omit<EconomicEvent, "id">[] {
  if (!Array.isArray(value)) throw new Error("The calendar feed returned an unexpected response.");
  const events: Omit<EconomicEvent, "id">[] = [];
  for (const row of value.slice(0, 2000)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const time = Date.parse(text(r.date, 40));
    const currency = text(r.country, 3).toUpperCase();
    const impact = text(r.impact, 10) as EventImpact;
    const title = text(r.title);
    if (!Number.isFinite(time) || !/^[A-Z]{3}$/.test(currency) || !title) continue;
    if (!IMPACTS.includes(impact)) continue;
    events.push({
      title,
      currency,
      time,
      impact,
      forecast: text(r.forecast, 40),
      previous: text(r.previous, 40),
    });
  }
  return events;
}

const eventId = (e: Omit<EconomicEvent, "id">) =>
  createHash("sha256")
    .update(`${SOURCE}|${e.currency}|${e.title}|${e.time}`)
    .digest("hex")
    .slice(0, 24);

export function storeEvents(events: Omit<EconomicEvent, "id">[]) {
  const fetchedAt = nowIso();
  db.transaction((tx) => {
    for (const e of events)
      tx.insert(economicEvents)
        .values({ id: eventId(e), source: SOURCE, fetchedAt, ...e })
        .onConflictDoUpdate({
          target: economicEvents.id,
          set: { impact: e.impact, forecast: e.forecast, previous: e.previous, fetchedAt },
        })
        .run();
    tx.delete(economicEvents)
      .where(lt(economicEvents.time, Date.now() - KEEP_MS))
      .run();
  });
}

/**
 * Fetch this week's events when enabled and the last fetch is over an hour old (or when
 * forced). Failures are recorded, never thrown, so the chart still shows stored events.
 */
export async function refreshCalendar(force = false, signal?: AbortSignal) {
  if (!calendarEnabled()) return;
  const last = Date.parse(getSetting(FETCHED) ?? "");
  if (!force && Number.isFinite(last) && Date.now() - last < REFRESH_MS) return;
  setSetting(FETCHED, nowIso());
  try {
    storeEvents(parseFeed(await readJson(FEED, {}, signal, { cache: false, timeoutMs: 15_000 })));
    deleteSetting(LAST_ERROR);
  } catch (error) {
    setSetting(
      LAST_ERROR,
      error instanceof Error && error.message.startsWith("The calendar")
        ? error.message
        : "The economic calendar could not be refreshed. Stored events are shown.",
    );
  }
}

export function calendarState(from: number, to: number): CalendarState {
  const events = db
    .select()
    .from(economicEvents)
    .where(and(gte(economicEvents.time, from), lte(economicEvents.time, to)))
    .orderBy(asc(economicEvents.time))
    .limit(5000)
    .all()
    .map(({ source: _s, fetchedAt: _f, ...e }) => ({ ...e, impact: e.impact as EventImpact }));
  return {
    enabled: calendarEnabled(),
    fetchedAt: getSetting(FETCHED),
    error: getSetting(LAST_ERROR),
    events,
  };
}
