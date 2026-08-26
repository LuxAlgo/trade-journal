import { desc } from "drizzle-orm";
import { dailyStats } from "@luxalgo/journal-core";
import { db, journalDays } from "@/db";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { queryTrades } from "@/server/trades-query";

/**
 * The journal chronology: every day that has trades OR a note, newest first.
 * Days with notes but no trades exist (planning days, review days).
 */
export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const timeZone = getTimeZone();
  const { trades } = queryTrades({
    accountIds: url.searchParams.get("accounts")?.split(",").filter(Boolean),
  });

  const tradeDays = new Map(dailyStats(trades, timeZone).map((day) => [day.date, day]));
  const noteRows = db.select().from(journalDays).orderBy(desc(journalDays.date)).all();
  const noteDays = new Map(noteRows.map((row) => [row.date, row]));

  const allDates = [...new Set([...tradeDays.keys(), ...noteDays.keys()])].sort().reverse();
  return ok({
    days: allDates.map((date) => ({
      date,
      stats: tradeDays.get(date) ?? null,
      hasNote: (noteDays.get(date)?.note ?? "") !== "",
      notePreview: (noteDays.get(date)?.note ?? "").slice(0, 200),
    })),
  });
});
