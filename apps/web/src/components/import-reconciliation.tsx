"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ImportReview, ImportReviewOptions } from "@/lib/import-review";
import { reviewMessageKey } from "@/lib/import-review";
import { Button } from "@/components/ui/button";
import { fmtMoney } from "@/lib/utils";
import { formatLocale, type Locale } from "@/i18n/config";

export function ImportReconciliation({
  review,
  options,
  onChange,
  onReview,
  busy,
}: {
  review?: ImportReview;
  options: ImportReviewOptions;
  onChange: (next: ImportReviewOptions) => void;
  onReview: () => void;
  busy: boolean;
}) {
  const t = useTranslations("import");
  const tDiag = useTranslations("import-diagnostics");
  const locale = useLocale() as Locale;
  // docs/i18n.md §7: review messages are localized by their known display
  // mapping; unmatched strings keep the server's English original.
  const reviewText = (message: string): string => {
    const found = reviewMessageKey(message);
    if (!found) return message;
    return found.ns === "import"
      ? t(found.key, found.params)
      : tDiag.has(found.key)
        ? tDiag(found.key, found.params)
        : message;
  };
  const money = (value: number) => fmtMoney(value, review?.currency, formatLocale(locale));
  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-sm font-medium">{t("review.title")}</p>
      <p className="text-xs text-muted-foreground">{t("review.intro")}</p>
      {review && (
        <>
          {review.sources.map((source) => (
            <label key={source.key} className="block space-y-1 text-sm">
              <span>{source.label}</span>
              <select
                aria-label={t("review.sourceAria", { label: source.label })}
                disabled={busy || source.saved}
                className="block w-full rounded-md border bg-background p-2 text-sm"
                value={options.sourceMappings?.[source.key] ?? source.selected ?? ""}
                onChange={(event) =>
                  onChange({
                    ...options,
                    sourceMappings: { ...options.sourceMappings, [source.key]: event.target.value },
                  })
                }
              >
                <option value="">{t("review.chooseSource")}</option>
                {review.savedSources.map((saved) => (
                  <option key={saved.id} value={saved.id}>
                    {saved.name}
                  </option>
                ))}
                <option value="new">{t("review.createNew")}</option>
              </select>
            </label>
          ))}
          <p className="text-xs text-muted-foreground">{t("review.sourceHelp")}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm" role="status">
            <span>{t("review.newFills", { count: review.inserted })}</span>
            <span>{t("review.duplicateFills", { count: review.duplicates })}</span>
            <span>{t("review.feeCorrections", { count: review.corrections.length })}</span>
          </div>
          {review.multipliers.map((item) => (
            <p key={item.symbol} className="text-xs">
              {item.value === null
                ? t("review.multiplierMissing", { symbol: item.symbol })
                : t("review.multiplier", { symbol: item.symbol, value: item.value })}
            </p>
          ))}
          {review.multipliers.some((item) => item.value === null) && (
            <a className="text-sm underline" href="/settings" target="_blank" rel="noreferrer">
              {t("review.openSettings")}
            </a>
          )}
          {review.totals && (
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <p className="font-medium">
                {t("review.destinationTitle", { currency: review.currency })}
              </p>
              <p>
                {t("review.tradeCounts", {
                  closed: review.totals.closedTrades,
                  open: review.totals.openTrades,
                })}
              </p>
              <p>
                {t("review.netPnlLine", {
                  amount: money(review.totals.netPnl),
                  fees: money(review.totals.fees),
                })}
              </p>
            </div>
          )}
          {review.needsCompleteHistory && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!options.completeHistory}
                disabled={busy}
                onChange={(event) =>
                  onChange({ ...options, completeHistory: event.target.checked })
                }
              />
              <span>{t("review.completeHistoryLabel")}</span>
            </label>
          )}
          {!!review.corrections.length && (
            <div className="space-y-2">
              {review.corrections.slice(0, 10).map((correction, index) => (
                <p key={index} className="text-xs">
                  {t("review.correctionLine", {
                    symbol: correction.symbol,
                    time: correction.executedAt,
                    old: money(correction.oldFee),
                    new: money(correction.newFee),
                  })}
                </p>
              ))}
              {review.corrections.length > 10 && (
                <p className="text-xs">
                  {t("review.moreCorrections", { count: review.corrections.length - 10 })}
                </p>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!options.approveFeeCorrections}
                  disabled={busy}
                  onChange={(event) =>
                    onChange({ ...options, approveFeeCorrections: event.target.checked })
                  }
                />
                <span>{t("review.approveCorrectionsLabel")}</span>
              </label>
            </div>
          )}
          {review.warnings.map((message) => (
            <p key={message} className="text-xs text-muted-foreground">
              {reviewText(message)}
            </p>
          ))}
          {review.conflicts.map((message) => (
            <p key={message} role="alert" className="text-xs text-loss">
              {reviewText(message)}
            </p>
          ))}
        </>
      )}
      <Button variant="outline" disabled={busy} onClick={onReview}>
        {busy ? t("review.reviewing") : t("review.reviewImport")}
      </Button>
      {review?.token && <p className="text-xs text-muted-foreground">{t("review.reviewDone")}</p>}
    </div>
  );
}
