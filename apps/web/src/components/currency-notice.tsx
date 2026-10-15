import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { CurrencyScope } from "@/lib/currencies";
import { Button } from "@/components/ui/button";

export function CurrencyNotice({ scope }: { scope: CurrencyScope }) {
  if (scope.converted)
    return (
      <p className="px-4 py-2 text-xs text-muted-foreground">
        Trading P&amp;L in {scope.currency} · saved baseline conversion rates.{" "}
        <Link className="underline" href="/settings#currency-conversion">
          Edit rates
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
            Set up conversion to see your combined dashboard
          </p>
          <p className="text-sm text-amber-900 dark:text-amber-200">
            {scope.missingCurrencies.length
              ? `Save conversion rates for ${scope.missingCurrencies.join(", ")} to use the reporting currency. Amounts below remain in their original currencies.`
              : `These accounts use ${scope.sourceCurrencies.join(", ")}. Set your conversion rates to combine their performance.`}
          </p>
        </div>
      </div>
      <Button asChild className="shrink-0 self-start lg:self-auto">
        <Link href="/settings#currency-conversion">Set up currency conversion</Link>
      </Button>
    </div>
  );
}
