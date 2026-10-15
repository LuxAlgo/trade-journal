import type { AnnotatedTrade } from "@luxalgo/journal-core";
import { type CurrencyConversion, type CurrencyScope } from "@/lib/currencies";

export interface CurrencyAccount {
  id: string;
  currency: string;
  initialBalance: number;
}

/** A display projection only. Never persist converted prices, P&L or annotations. */
export function currencyProjection(
  trades: AnnotatedTrade[],
  accounts: CurrencyAccount[],
  settings: CurrencyConversion,
) {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const sourceCurrencies = [...new Set(accounts.map((account) => account.currency))].sort();
  const missingCurrencies = settings.enabled
    ? sourceCurrencies.filter(
        (code) => code !== settings.reportingCurrency && !settings.rates[code],
      )
    : [];
  const converted = settings.enabled && missingCurrencies.length === 0;
  const monetary = converted || sourceCurrencies.length <= 1;
  const currency = converted
    ? settings.reportingCurrency
    : sourceCurrencies.length === 1
      ? (sourceCurrencies[0] ?? null)
      : null;
  const scope: CurrencyScope = {
    currency,
    sourceCurrencies,
    converted,
    monetary,
    missingCurrencies,
  };
  const rateFor = (code: string): number => {
    if (!converted || code === settings.reportingCurrency) return 1;
    const rate = settings.rates[code];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0)
      throw new Error(`Enter a valid conversion rate for ${code} in Settings.`);
    return rate;
  };
  const scaled = (value: number, rate: number) => {
    const result = value * rate;
    if (!Number.isFinite(result))
      throw new Error(
        "The saved conversion rate produces an amount that is too large. Update it in Settings.",
      );
    return result;
  };
  const projected = monetary
    ? trades.map((trade) => {
        const account = byId.get(trade.accountId);
        if (!account) throw new Error("A trade's account could not be found.");
        const rate = rateFor(account.currency);
        return {
          ...trade,
          netPnl: scaled(trade.netPnl, rate),
          grossPnl: scaled(trade.grossPnl, rate),
          fees: scaled(trade.fees, rate),
          avgEntry: scaled(trade.avgEntry, rate),
          avgExit: trade.avgExit === undefined ? undefined : scaled(trade.avgExit, rate),
          exits: trade.exits.map((exit) => ({ ...exit, grossPnl: scaled(exit.grossPnl, rate) })),
          annotations: {
            ...trade.annotations,
            stopLoss:
              trade.annotations?.stopLoss === undefined
                ? undefined
                : scaled(trade.annotations.stopLoss, rate),
            profitTarget:
              trade.annotations?.profitTarget === undefined
                ? undefined
                : scaled(trade.annotations.profitTarget, rate),
          },
        };
      })
    : [];
  const initialBalance = monetary
    ? accounts.reduce(
        (sum, account) =>
          scaled(sum + scaled(account.initialBalance, rateFor(account.currency)), 1),
        0,
      )
    : 0;
  return { trades: projected, initialBalance, scope };
}
