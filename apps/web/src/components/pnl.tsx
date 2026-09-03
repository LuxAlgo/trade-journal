import { cn, fmtMoney, pnlClass } from "@/lib/utils";
import { MonetaryValue } from "./privacy";

/** Signed P&L text — the sign carries polarity; color only reinforces it. */
export function Pnl({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("tnum", pnlClass(value), className)}>
      <MonetaryValue>{fmtMoney(value)}</MonetaryValue>
    </span>
  );
}
