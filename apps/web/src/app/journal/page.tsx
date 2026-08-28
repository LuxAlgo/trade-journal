"use client";

import Link from "next/link";
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
  const { query } = useFilters();
  const { data } = useApi<{ days: JournalDay[] }>(`/api/journal?${query}`);

  return (
    <div>
      <FilterBar
        title="Daily journal"
        actions={
          <Link
            href={`/journal/${new Date().toISOString().slice(0, 10)}`}
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
          <Link key={day.date} href={`/journal/${day.date}`} className="block">
            <Card className="transition-colors hover:border-ring">
              <CardContent className="flex items-center gap-4 py-3">
                <div className="w-28 shrink-0">
                  <div className="text-sm font-medium">{day.date}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-US", {
                      weekday: "long",
                      timeZone: "UTC",
                    })}
                  </div>
                </div>
                {day.stats ? (
                  <div className="flex flex-1 items-center gap-6 text-sm">
                    <Pnl value={day.stats.netPnl} className="w-24 font-semibold" />
                    <span className="text-muted-foreground">
                      {day.stats.trades} trade{day.stats.trades === 1 ? "" : "s"}
                    </span>
                    <span className="text-muted-foreground">
                      {fmtPercent(
                        day.stats.wins + day.stats.losses > 0
                          ? day.stats.wins / (day.stats.wins + day.stats.losses)
                          : null,
                        0,
                      )}{" "}
                      win
                    </span>
                    <span className="hidden text-muted-foreground md:inline">
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
