"use client";

import { Suspense, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayKeyOf } from "@luxalgo/journal-core";
import { CurrencyNotice } from "@/components/currency-notice";
import { CalendarPnl } from "@/components/calendar-pnl";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatLocale, type Locale } from "@/i18n/config";
import { formatApiError } from "@/lib/api-error";
import { useApi } from "@/lib/use-api";
import { CalendarPerformance } from "@/components/calendar-insights";
import type { CalendarResponse } from "@/lib/calendar-insights";
import Loading from "@/app/loading";

const monthFormatters = new Map<string, Intl.DateTimeFormat>();
const monthLabel = (locale: string) => {
  let formatter = monthFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    monthFormatters.set(locale, formatter);
  }
  return formatter;
};

export default function CalendarPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CalendarView />
    </Suspense>
  );
}

function CalendarView() {
  const t = useTranslations("calendar");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const { query, timeZone } = useFilters();
  const [selection, setMonth] = useState<{ year: number; month: number } | null>(null);
  const { data, error, errorInfo, refresh } = useApi<CalendarResponse>(
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
        title={t("title")}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => shift(-1)}
              aria-label={t("previousMonth")}
            >
              <ChevronLeft />
            </Button>
            <span className="w-36 text-center text-sm font-medium">
              {monthLabel(tag).format(new Date(Date.UTC(month.year, month.month - 1)))}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => shift(1)}
              aria-label={t("nextMonth")}
            >
              <ChevronRight />
            </Button>
          </div>
        }
      />
      {data?.currencyScope && <CurrencyNotice scope={data.currencyScope} />}
      <div className="space-y-4 p-4">
        <Card>
          <CardContent className="pt-4">
            {error ? (
              <div role="alert" className="space-y-3 py-6 text-sm">
                <p className="text-destructive">{formatApiError(tErrors, errorInfo ?? error)}</p>
                <Button variant="outline" onClick={refresh}>
                  {t("tryAgain")}
                </Button>
              </div>
            ) : data?.currencyScope?.monetary === false ? (
              <div className="space-y-6">
                {data.currencyGroups?.map((group) => (
                  <div key={group.currency}>
                    <p className="mb-3 text-sm font-medium">
                      {t("groupAccounts", { currency: group.currency })}
                    </p>
                    <CalendarPnl calendar={group.calendar} currency={group.currency} />
                  </div>
                ))}
              </div>
            ) : data ? (
              <CalendarPnl
                calendar={data.calendar}
                currency={data.currencies[0] ?? "USD"}
                monetary={data.currencies.length <= 1}
                runningPnl={data.runningPnl}
              />
            ) : (
              <div role="status" aria-label={t("loadingCalendar")}>
                <Skeleton className="h-96" />
              </div>
            )}
          </CardContent>
        </Card>
        {data && data.currencyScope?.monetary !== false && (
          <CalendarPerformance
            key={`${data.calendar.year}-${data.calendar.month}-${query}`}
            data={data}
            query={query}
          />
        )}
        {!data && !error && (
          <div
            role="status"
            aria-label={t("loadingInsights")}
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
