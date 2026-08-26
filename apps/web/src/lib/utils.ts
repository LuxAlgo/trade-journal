import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const currencyFormatters = new Map<string, Intl.NumberFormat>();

/** Signed money — the sign is ALWAYS in the text; color never carries P&L alone. */
export const fmtMoney = (value: number, currency = "USD"): string => {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      signDisplay: "exceptZero",
    });
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(value);
};

export const fmtNumber = (value: number, digits = 2): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);

export const fmtPercent = (value: number | null, digits = 1): string =>
  value === null ? "–" : `${(value * 100).toFixed(digits)}%`;

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

export const pnlClass = (value: number): string =>
  value > 0 ? "text-profit" : value < 0 ? "text-loss" : "text-muted-foreground";
