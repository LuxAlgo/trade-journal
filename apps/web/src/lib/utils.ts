import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const currencyFormatters = new Map<string, Intl.NumberFormat>();

/** Signed money — the sign is ALWAYS in the text; color never carries P&L alone. */
export const fmtMoney = (value: number, currency = "USD", locale = "en-US"): string => {
  const key = `${locale}|${currency}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      signDisplay: "exceptZero",
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter.format(value);
};

const numberFormatters = new Map<string, Intl.NumberFormat>();
export const fmtNumber = (value: number, digits = 2, locale = "en-US"): string => {
  const key = `${locale}|${digits}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: digits });
    numberFormatters.set(key, formatter);
  }
  return formatter.format(value);
};

const percentFormatters = new Map<string, Intl.NumberFormat>();
export const fmtPercent = (value: number | null, digits = 1, locale = "en-US"): string => {
  if (value === null) return "–";
  const key = `${locale}|${digits}`;
  let formatter = percentFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "percent",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    percentFormatters.set(key, formatter);
  }
  return formatter.format(value);
};

/** Compact duration for chart axes; UI text uses `fmtDurationLocalized` instead. */
export const fmtDuration = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return "–";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "< 1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};

/** Translator shape satisfied by next-intl's `t` from `useTranslations("controls")`. */
export type Translator = (key: string, values?: Record<string, string | number>) => string;

/** Localized duration for UI text; units come from the `controls.duration` messages. */
export const fmtDurationLocalized = (ms: number | null | undefined, t: Translator): string => {
  if (ms === null || ms === undefined) return "–";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return t("duration.belowMinute");
  if (minutes < 60) return t("duration.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("duration.hoursMinutes", { hours, minutes: minutes % 60 });
  const days = Math.floor(hours / 24);
  return t("duration.daysHours", { days, hours: hours % 24 });
};

export const pnlClass = (value: number): string =>
  value > 0 ? "text-profit" : value < 0 ? "text-loss" : "text-muted-foreground";
