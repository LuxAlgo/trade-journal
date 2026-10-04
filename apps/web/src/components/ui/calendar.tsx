"use client";

import { DayPicker, type DayPickerProps } from "react-day-picker";
import type { Locale as DateFnsLocale } from "date-fns";
import { enUS, es, fr, ja, ko, zhCN, zhTW } from "date-fns/locale";
import { useLocale } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";

const DATE_FNS_LOCALES: Record<string, DateFnsLocale> = {
  en: enUS,
  "zh-CN": zhCN,
  ja,
  ko,
  "zh-TW": zhTW,
  es,
  fr,
};

/** Map an interface locale code to the matching date-fns locale for react-day-picker. */
export const dateFnsLocale = (locale: string): DateFnsLocale => DATE_FNS_LOCALES[locale] ?? enUS;

export function Calendar(props: DayPickerProps) {
  const { locale: propsLocale, ...rest } = props;
  const locale = useLocale();
  // The interface locale drives month/weekday names and the displayed week start;
  // stored dates, filters and financial week statistics stay locale-independent.
  return (
    <DayPicker
      locale={propsLocale ?? dateFnsLocale(locale)}
      showOutsideDays
      fixedWeeks
      className="journal-date-calendar"
      classNames={{
        months: "relative",
        month_caption: "flex h-9 items-center justify-center px-10 mb-3",
        caption_label: "text-sm font-medium tracking-tight",
        nav: "absolute inset-x-0 top-0 flex justify-between",
        button_previous: "journal-calendar-nav",
        button_next: "journal-calendar-nav",
        month_grid: "w-full table-fixed border-collapse",
        weekday: "h-8 text-center text-[11px] font-medium text-muted-foreground",
        day: "p-0.5 text-center",
        day_button: "journal-calendar-date",
        selected: "journal-date-selected",
        today: "journal-date-today",
        outside: "journal-date-outside",
        disabled: "opacity-30",
        hidden: "invisible",
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          ),
      }}
      {...rest}
    />
  );
}
