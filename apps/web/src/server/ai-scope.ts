import {
  FILTER_KEYS,
  computeMetrics,
  type AnalysisFilters,
  type AnnotatedTrade,
} from "@luxalgo/journal-core";
import { db, accounts, playbooks } from "@/db";
import { describeFilters } from "@/lib/filter-description";
import { requireValue } from "./api";
import { getTimeZone } from "./settings";

export function isDay(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

/** Require an explicit filter snapshot; malformed scopes must never fall back to all trades. */
export function readAiRequest(value: unknown, field: "question" | "date") {
  requireValue(value && typeof value === "object" && !Array.isArray(value), "Invalid AI request");
  const body = value as Record<string, unknown>;
  requireValue(
    Object.keys(body).every((key) => [field, "filters", "timeZone"].includes(key)),
    "Unknown AI request field",
  );
  requireValue(
    body.filters && typeof body.filters === "object" && !Array.isArray(body.filters),
    "filters is required (use {} for all trades)",
  );
  const filters: AnalysisFilters = {};
  for (const [key, raw] of Object.entries(body.filters)) {
    requireValue(
      FILTER_KEYS.includes(key as (typeof FILTER_KEYS)[number]),
      "Unknown journal filter",
    );
    requireValue(
      typeof raw === "string" && raw.trim().length > 0 && raw.length <= 4096,
      `Invalid ${key} filter`,
    );
    const v = raw.trim();
    if (["accounts", "symbol", "excludeSymbol", "tag", "mistake", "weekdays"].includes(key)) {
      requireValue(
        v.split(",").every((part) => part.trim().length > 0),
        `Invalid ${key} filter`,
      );
    }
    if (key === "from" || key === "to") requireValue(isDay(v), `Invalid ${key} date`);
    if (/^(entry|exit)(After|Before)$/.test(key))
      requireValue(/^([01]\d|2[0-3]):[0-5]\d$/.test(v), `Invalid ${key} time`);
    if (/(Min|Max)$/.test(key))
      requireValue(
        /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v) && Number.isFinite(Number(v)),
        `Invalid ${key} number`,
      );
    const choices: Record<string, string[]> = {
      direction: ["long", "short"],
      status: ["closed", "open", "win", "loss", "breakeven"],
      reviewed: ["yes", "no"],
      assetClass: ["equity", "futures", "forex", "option", "crypto", "cfd", "other"],
    };
    if (choices[key]) requireValue(choices[key].includes(v), `Invalid ${key} filter`);
    if (key === "weekdays")
      requireValue(
        v.split(",").every((d) => /^[0-6]$/.test(d.trim())),
        "Invalid weekdays filter",
      );
    filters[key as keyof AnalysisFilters] = v;
  }
  requireValue(
    !filters.from || !filters.to || filters.from <= filters.to,
    "From date must not be after To date",
  );
  for (const key of FILTER_KEYS.filter((k) => k.endsWith("Min"))) {
    const max = filters[key.replace(/Min$/, "Max") as keyof AnalysisFilters];
    requireValue(
      !filters[key] || !max || Number(filters[key]) <= Number(max),
      `Invalid ${key} range`,
    );
  }
  const timeZone = getTimeZone();
  requireValue(
    body.timeZone === undefined || body.timeZone === timeZone,
    "Journal timezone changed. Refresh and try again.",
  );
  const allAccounts = db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .all();
  const ids = filters.accounts?.split(",").map((id) => id.trim());
  requireValue(
    !ids || ids.every((id) => allAccounts.some((a) => a.id === id)),
    "A selected account no longer exists. Update your filters.",
  );
  if (ids) filters.accounts = [...new Set(ids)].join(",");
  const selectedAccounts = ids ? allAccounts.filter((a) => ids.includes(a.id)) : allAccounts;
  const strategies = db.select({ id: playbooks.id, name: playbooks.name }).from(playbooks).all();
  const date = field === "date" ? body.date : undefined;
  if (field === "date") requireValue(isDay(date), "date (YYYY-MM-DD) is required");
  if (field === "question")
    requireValue(
      typeof body.question === "string" &&
        body.question.trim().length > 0 &&
        body.question.length <= 10000,
      "question is required (maximum 10000 characters)",
    );
  const label = (privateMode: boolean) =>
    [
      date,
      !ids ? "All accounts" : "",
      describeFilters(filters, selectedAccounts, strategies, privateMode),
      timeZone,
    ]
      .filter(Boolean)
      .join(" · ");
  return {
    filters,
    timeZone,
    accounts: selectedAccounts,
    question: typeof body.question === "string" ? body.question.trim() : "",
    date: date as string | undefined,
    scope: { label: label(true), timeZone },
    context: `Journal scope: ${label(false)}. Only the filtered data below is available. Do not infer results for excluded accounts or dates.`,
  };
}

export function accountContext(trades: AnnotatedTrade[], scope: ReturnType<typeof readAiRequest>) {
  return (
    "By account (amounts in each account's currency; no currency conversion):\n" +
    scope.accounts
      .map((account) => {
        const m = computeMetrics(
          trades.filter((t) => t.accountId === account.id),
          { timeZone: scope.timeZone },
        );
        return `${JSON.stringify(account.name)} (${account.currency}): ${m.closedTrades} closed trades, net ${m.netPnl.toFixed(2)}, fees ${m.fees.toFixed(2)}`;
      })
      .join("\n") +
    (new Set(scope.accounts.map((a) => a.currency)).size > 1
      ? "\nAccounts use different currencies. Combined amounts below are unconverted sums, not a common-currency portfolio return. Do not compare monetary performance across currencies."
      : "")
  );
}
