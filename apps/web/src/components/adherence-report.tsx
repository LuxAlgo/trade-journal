"use client";
import { useLocale, useTranslations } from "next-intl";
import { formatLocale, type Locale } from "@/i18n/config";
import { fmtNumber, fmtPercent } from "@/lib/utils";
import { formatApiError } from "@/lib/api-error";
import { useApi } from "@/lib/use-api";
import { useFilters } from "@/components/filter-bar";
import { MonetaryValue } from "./privacy";
import type { GroupSummary } from "@luxalgo/journal-core";
interface Adherence {
  id: string;
  total: number;
  evaluated: number;
  possible: number;
  rate: number | null;
  currencies: string[];
  followed: GroupSummary;
  broken: GroupSummary;
  unassessed: number;
  rules: {
    rule: string;
    evaluated: number;
    rate: number | null;
    followed: GroupSummary;
    broken: GroupSummary;
  }[];
}
export function AdherenceReport({ bookId }: { bookId: string }) {
  const t = useTranslations("playbooks");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const locale = useLocale() as Locale;
  const fmtLocale = formatLocale(locale);
  const pct = (n: number | null) => (n === null ? "-" : fmtPercent(n, 0, fmtLocale));
  const { query } = useFilters();
  const { data, error, errorInfo } = useApi<{ books: Adherence[] }>(`/api/adherence?${query}`);
  const b = data?.books.find((b) => b.id === bookId);
  if (error)
    return (
      <p role="alert" className="text-xs text-destructive">
        {formatApiError(tErrors, errorInfo ?? error)}
      </p>
    );
  if (!b) return null;
  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t("adherence.ruleAdherence")}</span>
        <strong className="text-lg">{pct(b.rate)}</strong>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("adherence.assessments", {
          evaluated: b.evaluated,
          possible: b.possible,
          total: b.total,
        })}{" "}
        {t("adherence.unassessed", { count: b.unassessed })}
      </p>
      <div className="grid grid-cols-2 gap-3 text-xs">
        {(
          [
            ["allFollowed", b.followed],
            ["oneBroken", b.broken],
          ] as const
        ).map(([messageKey, stats]) => {
          const s = stats as GroupSummary;
          return (
            <div key={messageKey} className="rounded-md bg-muted/40 p-2">
              <p className="mb-1 font-medium">{t(`adherence.${messageKey}`)}</p>
              <p>{t("adherence.tradesWin", { count: s.trades, win: pct(s.winRate) })}</p>
              {b.currencies.length <= 1 && (
                <p className={s.netPnl >= 0 ? "text-profit" : "text-loss"}>
                  <MonetaryValue>
                    {fmtNumber(s.netPnl, 2, fmtLocale)} {b.currencies[0] ?? ""}
                  </MonetaryValue>
                </p>
              )}
            </div>
          );
        })}
      </div>
      {b.currencies.length > 1 && (
        <p className="text-xs text-muted-foreground">{t("adherence.mixedCurrencies")}</p>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          {t("adherence.performanceByRule")}
        </summary>
        <div className="mt-2 space-y-3">
          {b.rules.map((r) => (
            <div key={r.rule} className="border-t pt-2">
              <p className="font-medium">{r.rule}</p>
              <p className="text-muted-foreground">
                {t("adherence.ruleRate", { rate: pct(r.rate), count: r.evaluated })}
              </p>
              <p>
                {t("adherence.ruleFollowedBroken", {
                  followedTrades: r.followed.trades,
                  followedWin: pct(r.followed.winRate),
                  brokenTrades: r.broken.trades,
                  brokenWin: pct(r.broken.winRate),
                })}
              </p>
              {b.currencies.length <= 1 && (
                <p>
                  {t.rich("adherence.ruleNetPnl", {
                    followedValue: fmtNumber(r.followed.netPnl, 2, fmtLocale),
                    brokenValue: fmtNumber(r.broken.netPnl, 2, fmtLocale),
                    currency: b.currencies[0] ?? "",
                    followed: (chunks) => <MonetaryValue>{chunks}</MonetaryValue>,
                    broken: (chunks) => <MonetaryValue>{chunks}</MonetaryValue>,
                  })}
                </p>
              )}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
