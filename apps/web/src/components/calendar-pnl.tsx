"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { CalendarMonth } from "@luxalgo/journal-core";
import { cn, fmtMoney } from "@/lib/utils";
import { Pnl } from "./pnl";
import { MonetaryValue, usePrivacy } from "./privacy";

const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/**
 * The P&L calendar — an HTML grid, not a chart. Each traded day prints its
 * signed P&L and trade count; the background tint scales with magnitude
 * (lightness carries magnitude, which survives CVD; the number carries sign).
 */
export function CalendarPnl({ calendar }: { calendar: CalendarMonth }) {
  const maxAbs = Math.max(
    1,
    ...calendar.weeks.flatMap((week) => week.days.map((day) => Math.abs(day?.netPnl ?? 0))),
  );
  return (
    <div className="journal-calendar min-w-0 w-full">
      <div className="journal-calendar-grid grid gap-1 text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
          <div key={weekday} className="px-1 pb-1 text-muted-foreground">
            {weekday}
          </div>
        ))}
        <div className="journal-calendar-week-heading px-1 pb-1 text-right text-muted-foreground">
          Week
        </div>
        {calendar.weeks.map((week, weekIndex) => (
          <CalendarWeekRow key={weekIndex} week={week} maxAbs={maxAbs} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs sm:text-sm">
        <span className="text-muted-foreground">
          {calendar.tradingDays} trading days · {calendar.winningDays} green
        </span>
        <span>
          Month: <Pnl value={calendar.monthNetPnl} className="font-semibold" />
        </span>
      </div>
    </div>
  );
}

function CalendarWeekRow({
  week,
  maxAbs,
}: {
  week: CalendarMonth["weeks"][number];
  maxAbs: number;
}) {
  const search = useSearchParams();
  const privacy = usePrivacy();
  return (
    <>
      {week.days.map((day, dayIndex) => {
        if (!day) return <div key={dayIndex} className="journal-calendar-day rounded-md" />;
        const traded = day.trades > 0;
        const intensity = traded ? 0.1 + 0.38 * (Math.abs(day.netPnl) / maxAbs) : 0;
        return (
          <Link
            key={day.date}
            href={`/journal/${day.date}?${search}`}
            title={`${day.date} · ${privacy ? "P&L hidden" : fmtMoney(day.netPnl)} · ${day.trades} trades`}
            aria-label={`${day.date}, ${privacy ? "P&L hidden" : fmtMoney(day.netPnl)}, ${day.trades} trades`}
            className={cn(
              "journal-calendar-day min-w-0 rounded-md border transition-colors hover:border-ring focus-visible:outline focus-visible:outline-ring",
              !traded && "border-transparent bg-muted/30",
            )}
            style={
              traded
                ? {
                    backgroundColor: `color-mix(in oklab, ${
                      day.netPnl >= 0 ? "var(--profit-fill)" : "var(--loss)"
                    } ${Math.round(intensity * 100)}%, var(--card))`,
                  }
                : undefined
            }
          >
            <div className="text-muted-foreground">{Number(day.date.slice(8))}</div>
            {traded && (
              <>
                <div className="journal-calendar-full tnum font-medium">
                  <MonetaryValue>{fmtMoney(day.netPnl)}</MonetaryValue>
                </div>
                <div className="journal-calendar-compact tnum font-medium">
                  <MonetaryValue>{compactMoney.format(day.netPnl)}</MonetaryValue>
                </div>
                <div className="journal-calendar-trades text-muted-foreground">
                  {day.trades} trade{day.trades === 1 ? "" : "s"}
                </div>
              </>
            )}
          </Link>
        );
      })}
      <div className="journal-calendar-week flex rounded-md bg-muted/40 p-1.5">
        <span className="journal-calendar-week-label text-muted-foreground">Week total</span>
        {week.weekTrades > 0 ? (
          <>
            <Pnl value={week.weekNetPnl} className="font-medium" />
            <span className="text-muted-foreground">{week.weekTrades} trades</span>
          </>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </div>
    </>
  );
}
