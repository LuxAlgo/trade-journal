"use client";

import { Suspense, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarMonth, TradeMetrics } from "@luxalgo/journal-core";
import { CalendarPnl } from "@/components/calendar-pnl";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/use-api";

export default function CalendarPage() {
  return (
    <Suspense>
      <CalendarView />
    </Suspense>
  );
}

function CalendarView() {
  const { query } = useFilters();
  const now = new Date();
  const [month, setMonth] = useState({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
  const { data } = useApi<{ calendar: CalendarMonth; metrics: TradeMetrics }>(
    `/api/stats?${query}&calYear=${month.year}&calMonth=${month.month}`,
  );

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
      <div className="p-4">
        <Card>
          <CardContent className="pt-4">
            {data ? <CalendarPnl calendar={data.calendar} /> : <Skeleton className="h-96" />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
