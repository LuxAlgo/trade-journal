import { handler, ok, requireValue } from "@/server/api";
import { calendarState, refreshCalendar, setCalendarEnabled } from "@/server/economic-calendar";

const DAY = 86_400_000;

/** Stored events in a window (default: the last 30 days and the next 7), refreshed hourly. */
export const GET = handler(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const from = Number(params.get("from") ?? Date.now() - 30 * DAY);
  const to = Number(params.get("to") ?? Date.now() + 7 * DAY);
  requireValue(
    Number.isSafeInteger(from) && Number.isSafeInteger(to) && from < to,
    "Invalid range.",
  );
  requireValue(to - from <= 3 * 366 * DAY, "Choose a range of at most three years.");
  await refreshCalendar(false, request.signal);
  return ok(calendarState(from, to));
});

/** Enable or disable the public feed (an explicit choice), or refresh it now. */
export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as { action?: unknown };
  requireValue(
    ["enable", "disable", "refresh"].includes(body.action as string),
    "Choose an action.",
  );
  if (body.action === "enable") setCalendarEnabled(true);
  if (body.action === "disable") setCalendarEnabled(false);
  if (body.action !== "disable") await refreshCalendar(true, request.signal);
  return ok(calendarState(Date.now() - 30 * DAY, Date.now() + 7 * DAY));
});
