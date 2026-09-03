export interface FeeRule {
  id: string;
  accountId: string;
  symbol: string;
  amount: number;
  mode: "execution" | "unit";
}
export interface RiskRule {
  id: string;
  accountId: string;
  symbol: string;
  stop: number;
  target: number;
  mode: "price" | "percent";
}
export interface JournalDefaults {
  breakeven: number;
  breakevenMode: "money" | "percent";
  feeRules: FeeRule[];
  riskRules: RiskRule[];
}
export const EMPTY_DEFAULTS: JournalDefaults = {
  breakeven: 0,
  breakevenMode: "money",
  feeRules: [],
  riskRules: [],
};
export const matchesRule = (
  rule: { accountId: string; symbol: string },
  accountId: string,
  symbol: string,
) =>
  (!rule.accountId || rule.accountId === accountId) &&
  (!rule.symbol || rule.symbol.toUpperCase() === symbol.toUpperCase());
/** Explicitly opted-in zero-fee defaults; original source fill hashes are retained for deduplication. */
export function defaultFee(
  fee: number,
  quantity: number,
  accountId: string,
  symbol: string,
  defaults: JournalDefaults,
) {
  if (fee !== 0) return fee;
  const rule = defaults.feeRules.find((r) => matchesRule(r, accountId, symbol));
  return rule ? rule.amount * (rule.mode === "unit" ? quantity : 1) : fee;
}
export function defaultRisk(
  entry: number,
  direction: string,
  accountId: string,
  symbol: string,
  defaults: JournalDefaults,
) {
  const r = defaults.riskRules.find((rule) => matchesRule(rule, accountId, symbol));
  if (!r) return {};
  const unit = r.mode === "percent" ? Math.abs(entry) / 100 : 1;
  const sign = direction === "long" ? 1 : -1;
  return { stopLoss: entry - sign * r.stop * unit, profitTarget: entry + sign * r.target * unit };
}
