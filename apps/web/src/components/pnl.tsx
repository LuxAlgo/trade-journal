import { cn, fmtMoney, pnlClass } from "@/lib/utils";

/** Signed P&L text — the sign carries polarity; color only reinforces it. */
export function Pnl({ value, className }: { value: number; className?: string }) {
  return <span className={cn("tnum", pnlClass(value), className)}>{fmtMoney(value)}</span>;
}
