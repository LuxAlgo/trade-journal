"use client";

import Link from "next/link";
import { dayKeyOf } from "@luxalgo/journal-core";
import { Suspense } from "react";
import { NotebookPen } from "lucide-react";
import type { DayStats } from "@luxalgo/journal-core";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/use-api";
import { fmtPercent } from "@/lib/utils";

interface JournalDay {
  date: string;
  stats: DayStats | null;
  hasNote: boolean;
  notePreview: string;
}

export default function JournalPage() {
  return (
    <Suspense>
      <Journal />
    </Suspense>
  );
}

function Journal() {
  const { query, timeZone } = useFilters();
  const { data } = useApi<{ days: JournalDay[] }>(`/api/journal?${query}`);

  return (
    <div>
      <FilterBar
        title="Daily journal"
        actions={
          <Link
            href={`/journal/${dayKeyOf(new Date().toISOString(), timeZone)}?${query}`}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            View my day
          </Link>
        }
      />
      <div className="space-y-2 p-4">
        {!data && <Skeleton className="h-48" />}
        {data?.days.length === 0 && (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No trading days yet — import trades or write your first day note.
          </p>
        )}
        {data?.days.map((day) => (
          <Link key={day.date} href={`/journal/${day.date}?${query}`} className="block">
            <Card className="transition-colors hover:border-ring">
              <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3">
                <div className="w-full shrink-0 sm:w-28">
                  <div className="text-sm font-medium">{day.date}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-US", {
                      weekday: "long",
                      timeZone: "UTC",
                    })}
                  </div>
                </div>
                {day.stats ? (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                    <Pnl value={day.stats.netPnl} className="w-24 font-semibold" />
                    <span className="text-muted-foreground">
                      {day.stats.trades} trade{day.stats.trades === 1 ? "" : "s"}
                    </span>
                    <span className="text-muted-foreground">
                      {fmtPercent(
                        day.stats.trades > 0 ? day.stats.wins / day.stats.trades : null,
                        0,
                      )}{" "}
                      win
                    </span>
                    <span className="text-muted-foreground">
                      {day.stats.wins}W / {day.stats.losses}L
                    </span>
                  </div>
                ) : (
                  <div className="flex-1 text-sm text-muted-foreground">No trades</div>
                )}
                {day.hasNote && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <NotebookPen className="h-3.5 w-3.5" />
                    note
                  </span>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
