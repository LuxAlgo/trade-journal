"use client";

import { Suspense, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayKeyOf } from "@luxalgo/journal-core";
import { CalendarPnl } from "@/components/calendar-pnl";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/use-api";
import { CalendarPerformance } from "@/components/calendar-insights";
import type { CalendarResponse } from "@/lib/calendar-insights";
import Loading from "@/app/loading";

export default function CalendarPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CalendarView />
    </Suspense>
  );
}

function CalendarView() {
  const { query, timeZone } = useFilters();
  const [selection, setMonth] = useState<{ year: number; month: number } | null>(null);
  const { data, error, refresh } = useApi<CalendarResponse>(
    `/api/calendar?${query}${selection ? `&calYear=${selection.year}&calMonth=${selection.month}` : ""}`,
  );
  const today = dayKeyOf(new Date().toISOString(), timeZone);
  const month = selection ??
    data?.calendar ?? { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };

  const shift = (delta: number) => {
    const next = new Date(Date.UTC(month.year, month.month - 1 + delta, 1));
    setMonth({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 });
  };

  return (
    <div>
      <FilterBar
        title="Calendar"
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => shift(-1)}
              aria-label="Previous month"
            >
              <ChevronLeft />
            </Button>
            <span className="w-36 text-center text-sm font-medium">
              {new Date(Date.UTC(month.year, month.month - 1)).toLocaleString("en-US", {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => shift(1)}
              aria-label="Next month"
            >
              <ChevronRight />
            </Button>
          </div>
        }
      />
      <div className="space-y-4 p-4">
        <Card>
          <CardContent className="pt-4">
            {error ? (
              <div role="alert" className="space-y-3 py-6 text-sm">
                <p className="text-destructive">{error}</p>
                <Button variant="outline" onClick={refresh}>
                  Try again
                </Button>
              </div>
            ) : data ? (
              <CalendarPnl
                calendar={data.calendar}
                currency={data.currencies[0] ?? "USD"}
                monetary={data.currencies.length <= 1}
              />
            ) : (
              <div role="status" aria-label="Loading calendar">
                <Skeleton className="h-96" />
              </div>
            )}
          </CardContent>
        </Card>
        {data && (
          <CalendarPerformance
            key={`${data.calendar.year}-${data.calendar.month}-${query}`}
            data={data}
            query={query}
          />
        )}
        {!data && !error && (
          <div
            role="status"
            aria-label="Loading performance insights"
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-28" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
