"use client";

import Link from "next/link";
import type { CalendarMonth } from "@luxalgo/journal-core";
import { cn, fmtMoney } from "@/lib/utils";
import { Pnl } from "./pnl";

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
    <div className="w-full overflow-x-auto">
      <div className="grid min-w-[640px] grid-cols-[repeat(7,1fr)_88px] gap-1 text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
          <div key={weekday} className="px-1 pb-1 text-muted-foreground">
            {weekday}
          </div>
        ))}
        <div className="px-1 pb-1 text-right text-muted-foreground">Week</div>
        {calendar.weeks.map((week, weekIndex) => (
          <CalendarWeekRow key={weekIndex} week={week} maxAbs={maxAbs} />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
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
  return (
    <>
      {week.days.map((day, dayIndex) => {
        if (!day) return <div key={dayIndex} className="min-h-16 rounded-md" />;
        const traded = day.trades > 0;
        const intensity = traded ? 0.08 + 0.3 * (Math.abs(day.netPnl) / maxAbs) : 0;
        return (
          <Link
            key={day.date}
            href={`/journal/${day.date}`}
            className={cn(
              "min-h-16 rounded-md border p-1.5 transition-colors hover:border-ring",
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
                <div className="tnum font-medium">{fmtMoney(day.netPnl)}</div>
                <div className="text-muted-foreground">
                  {day.trades} trade{day.trades === 1 ? "" : "s"}
                </div>
              </>
            )}
          </Link>
        );
      })}
      <div className="flex min-h-16 flex-col items-end justify-center rounded-md bg-muted/40 p-1.5">
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
