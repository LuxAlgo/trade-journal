import { cn, fmtMoney, pnlClass } from "@/lib/utils";
import { MonetaryValue } from "./privacy";

/** Signed P&L text — the sign carries polarity; color only reinforces it. */
export function Pnl({
  value,
  className,
  currency = "USD",
  locale,
}: {
  value: number;
  className?: string;
  currency?: string;
  /** Optional interface locale for number/currency rendering (defaults to en-US). */
  locale?: string;
}) {
  return (
    <span className={cn("tnum", pnlClass(value), className)}>
      <MonetaryValue>{fmtMoney(value, currency, locale)}</MonetaryValue>
    </span>
  );
}
