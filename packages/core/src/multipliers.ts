/**
 * Contract multiplier lookup shared by the round-trip builder and the trade
 * reader, so the two can never disagree about what a symbol is worth.
 *
 * The configured table wins. Without an entry, an OCC equity-option symbol
 * (`CRDO  261030P00170000`: root padded to six, YYMMDD, C/P, strike x 1000)
 * is the standard 100-share contract; booking it at x1 understates every
 * option P&L a hundredfold. Futures options are not OCC-formatted and their
 * contract sizes vary, so they still need a table entry.
 */
const OCC_OPTION = /^[A-Z][A-Z0-9.]{0,5} *\d{6}[CP]\d{8}$/;

export const EQUITY_OPTION_MULTIPLIER = 100;

export const isOccOptionSymbol = (symbol: string) => OCC_OPTION.test(symbol.trim().toUpperCase());

export function resolveMultiplier(
  symbol: string,
  multipliers?: Record<string, number>,
): number | undefined {
  const configured = multipliers?.[symbol];
  if (configured != null) return configured;
  return isOccOptionSymbol(symbol) ? EQUITY_OPTION_MULTIPLIER : undefined;
}
