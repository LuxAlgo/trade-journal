import Link from "next/link";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import type { CurrencyScope } from "@/lib/currencies";
import { Button } from "@/components/ui/button";

export function CurrencyNotice({ scope }: { scope: CurrencyScope }) {
  const t = useTranslations("controls");
  if (scope.converted)
    return (
      <p className="px-4 py-2 text-xs text-muted-foreground">
        {t("notice.converted", { currency: scope.currency ?? "" })}{" "}
        <Link className="underline" href="/settings#currency-conversion">
          {t("notice.editRates")}
        </Link>
      </p>
    );
  if (scope.monetary && !scope.missingCurrencies.length) return null;
  return (
    <div
      role="status"
      className="mx-4 my-3 flex flex-col gap-4 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30 lg:flex-row lg:items-center lg:justify-between"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div className="space-y-1">
          <p className="font-semibold text-amber-950 dark:text-amber-100">
            {t("notice.setupTitle")}
          </p>
          <p className="text-sm text-amber-900 dark:text-amber-200">
            {scope.missingCurrencies.length
              ? t("notice.missing", {
                  currencies: scope.missingCurrencies.join(", "),
                })
              : t("notice.sources", {
                  currencies: scope.sourceCurrencies.join(", "),
                })}
          </p>
        </div>
      </div>
      <Button asChild className="shrink-0 self-start lg:self-auto">
        <Link href="/settings#currency-conversion">{t("notice.setupCta")}</Link>
      </Button>
    </div>
  );
}
