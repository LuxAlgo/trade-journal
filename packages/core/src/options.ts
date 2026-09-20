import type { AssetClass } from "./types";

/** Standard US equity/index option contract size. Override per symbol in settings. */
export const EQUITY_OPTION_MULTIPLIER = 100;

export type OptionRight = "C" | "P";

export interface OptionContract {
  underlying: string;
  /** Calendar date of expiry, `YYYY-MM-DD`. */
  expiry: string;
  strike: number;
  right: OptionRight;
}

export interface OptionInstrumentInput {
  symbol?: string;
  description?: string;
  underlying?: string;
  expiry?: string;
  strike?: string | number;
  right?: string;
  assetClass?: AssetClass;
}

export interface ResolvedInstrument {
  symbol: string;
  assetClass?: AssetClass;
  /** True when strike/expiry/right had to be composed onto the ticker. */
  composed: boolean;
  /** Option asset with no contract identity — will net with the underlying. */
  missingContract: boolean;
}

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

const MONTH_INDEX: Record<string, number> = Object.fromEntries(
  MONTHS.map((name, index) => [name, index]),
);

const OCC_SYMBOL = /^([A-Z0-9][A-Z0-9.\-]{0,9}?)\s+(\d{6})([CP])(\d{8})$/;
const IBKR_SYMBOL =
  /^([A-Z0-9][A-Z0-9.\-]{0,9}?)\s+(\d{1,2})([A-Z]{3})(\d{2})\s+(\d+(?:\.\d+)?)\s+(C|P|CALL|PUT)$/;

export const collapseSymbol = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toUpperCase();

const pad2 = (value: number): string => String(value).padStart(2, "0");

const formatStrike = (strike: number): string => {
  if (!Number.isFinite(strike) || strike <= 0) return "";
  const rounded = Math.round(strike * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

const expiryParts = (isoDate: string): { year: number; month: number; day: number } | null => {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
};

export const parseExpiry = (raw: string | undefined): string | null => {
  if (!raw) return null;
  const text = collapseSymbol(raw);
  let match = text.match(/^(\d{4})(\d{2})(\d{2})(?:[;,\s].*)?$/);
  if (match) {
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    return expiryParts(iso) ? iso : null;
  }
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    return expiryParts(iso) ? iso : null;
  }
  match = text.match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})$/);
  if (match) {
    const day = Number(match[1]);
    const month = (MONTH_INDEX[match[2]!] ?? -1) + 1;
    const year = 2000 + Number(match[3]);
    const iso = `${year}-${pad2(month)}-${pad2(day)}`;
    return expiryParts(iso) ? iso : null;
  }
  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (match) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    const yearRaw = Number(match[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const iso = `${year}-${pad2(month)}-${pad2(day)}`;
    return expiryParts(iso) ? iso : null;
  }
  return null;
};

export const parseOptionRight = (raw: string | undefined): OptionRight | null => {
  if (!raw) return null;
  const text = collapseSymbol(raw);
  if (text === "C" || text === "CALL") return "C";
  if (text === "P" || text === "PUT") return "P";
  return null;
};

const parseStrike = (raw: string | number | undefined): number | null => {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (!raw) return null;
  const value = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(value) && value > 0 ? value : null;
};

export const formatOptionSymbol = (contract: OptionContract): string => {
  const parts = expiryParts(contract.expiry);
  const strike = formatStrike(contract.strike);
  if (!parts || !strike) return collapseSymbol(contract.underlying);
  const month = MONTHS[parts.month - 1];
  return `${collapseSymbol(contract.underlying)} ${pad2(parts.day)}${month}${String(parts.year).slice(2)} ${strike} ${contract.right}`;
};

export const parseOptionSymbol = (symbol: string): OptionContract | null => {
  const text = collapseSymbol(symbol);
  const occ = text.match(OCC_SYMBOL);
  if (occ) {
    const yy = occ[2]!.slice(0, 2);
    const mm = occ[2]!.slice(2, 4);
    const dd = occ[2]!.slice(4, 6);
    const expiry = `20${yy}-${mm}-${dd}`;
    const strike = Number(occ[4]) / 1000;
    if (!expiryParts(expiry) || !Number.isFinite(strike) || strike <= 0) return null;
    return {
      underlying: occ[1]!,
      expiry,
      strike,
      right: occ[3] as OptionRight,
    };
  }
  const ibkr = text.match(IBKR_SYMBOL);
  if (ibkr) {
    const expiry = parseExpiry(`${ibkr[2]}${ibkr[3]}${ibkr[4]}`);
    const strike = Number(ibkr[5]);
    const right = parseOptionRight(ibkr[6]);
    if (!expiry || !right || !Number.isFinite(strike) || strike <= 0) return null;
    return { underlying: ibkr[1]!, expiry, strike, right };
  }
  return null;
};

const composeContract = (input: OptionInstrumentInput): OptionContract | null => {
  const fromSymbol = parseOptionSymbol(input.symbol ?? "");
  if (fromSymbol) return fromSymbol;
  const fromDescription = parseOptionSymbol(input.description ?? "");
  if (fromDescription) return fromDescription;
  const underlying = collapseSymbol(input.underlying || input.symbol || "");
  const expiry = parseExpiry(input.expiry);
  const strike = parseStrike(input.strike);
  const right = parseOptionRight(input.right);
  if (!underlying || parseOptionSymbol(underlying) || !expiry || strike == null || !right)
    return null;
  return { underlying, expiry, strike, right };
};

export const resolveOptionInstrument = (input: OptionInstrumentInput): ResolvedInstrument => {
  const collapsed = collapseSymbol(input.symbol ?? "");
  const optionAsset = input.assetClass === "option";
  const contract = composeContract(input);
  if (contract) {
    const formatted = formatOptionSymbol(contract);
    return {
      symbol: formatted,
      assetClass: "option",
      composed: formatted !== collapsed,
      missingContract: false,
    };
  }
  if (optionAsset) {
    return { symbol: collapsed, assetClass: "option", composed: false, missingContract: true };
  }
  return {
    symbol: collapsed,
    assetClass: input.assetClass,
    composed: false,
    missingContract: false,
  };
};

/**
 * Settings win. Equity/index options default to 100 so premium P&L is in
 * dollars, not dollars-per-share. Futures, forex and CFDs stay unset until
 * configured — guessing those point values is worse than leaving them blank.
 */
export const resolveContractMultiplier = (
  symbol: string,
  assetClass?: AssetClass,
  configured: Record<string, number> = {},
): number | undefined => {
  const listed = configured[symbol];
  if (typeof listed === "number" && Number.isFinite(listed) && listed > 0) return listed;
  if (assetClass === "futures" || assetClass === "forex" || assetClass === "cfd") return undefined;
  if (assetClass === "option" || parseOptionSymbol(symbol)) return EQUITY_OPTION_MULTIPLIER;
  return undefined;
};
