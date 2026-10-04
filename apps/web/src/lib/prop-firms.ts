/** Cash records are independent of journal trading P&L and nominal account size. */
export const PROP_PROGRAMS = [
  "evaluation",
  "verification",
  "funded",
  "instant_funded",
  "live",
] as const;
export const PROP_STATES = ["active", "passed", "breached", "closed"] as const;
export const PAYOUT_STATES = [
  "requested",
  "approved",
  "completed",
  "rejected",
  "cancelled",
] as const;
export const EXPENSE_CATEGORIES = [
  "evaluation",
  "reset",
  "activation",
  "subscription",
  "platform",
  "market_data",
  "transfer",
  "other",
] as const;
export type PropAccount = {
  id: string;
  firm: string;
  name: string;
  program: (typeof PROP_PROGRAMS)[number];
  status: (typeof PROP_STATES)[number];
  currency: string;
  sizeMinor: number | null;
  parentId: string | null;
  journalAccountId: string | null;
  openedOn: string;
  closedOn: string | null;
  renewalOn: string | null;
  renewalMinor: number | null;
  notes: string;
  archived: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type PropEntry = {
  id: string;
  accountId: string | null;
  firm: string;
  kind: "expense" | "refund" | "payout";
  category: string;
  currency: string;
  amountMinor: number;
  splitBps: number;
  feeMinor: number;
  occurredOn: string;
  dueOn: string | null;
  status: (typeof PAYOUT_STATES)[number];
  parentId: string | null;
  reference: string;
  notes: string;
  voided: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type PropReceipt = {
  id: string;
  payoutId: string;
  kind: "receipt" | "reversal";
  amountMinor: number;
  occurredOn: string;
  reference: string;
  notes: string;
  voided: boolean;
  createdAt: string;
};
export type PropAudit = {
  id: string;
  entityType: string;
  entityId: string;
  beforeJson: string | null;
  afterJson: string;
  reason: string;
  createdAt: string;
};
export type PropData = {
  accounts: PropAccount[];
  entries: PropEntry[];
  receipts: PropReceipt[];
  today: string;
};
const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));
const currencyFormats = new Map<string, Intl.NumberFormat>();

/**
 * Validation failures raised by the money parsers below. The English `message`
 * is the machine-stable `{error}` text: server/prop-firms.ts re-wraps it
 * verbatim and tests assert it, so the wording must not change (docs/i18n.md
 * §6). `key` names the client-side `prop-firms.validation.*` message and
 * `params` feeds its ICU placeholders; both are localization-only additions.
 */
export class PropValidationError extends Error {
  constructor(
    readonly key: string,
    message: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "PropValidationError";
  }
}

/** Canonical validation wordings — single source for both throwing and matching. */
const VALIDATION_TEXT = {
  currencyUnsupported: "Choose a supported three-letter currency code.",
  amountInvalid: "Enter a nonnegative decimal amount.",
  amountTooLarge: "Amount is too large.",
  currencyMixed: "Select one currency before combining cash amounts.",
} as const;
const decimalsText = (currency: string, digits: number) =>
  `${currency} accepts ${digits} decimal places.`;
const DECIMALS_PATTERN = /^(\S+) accepts (\d+) decimal places\.$/;

/**
 * Map a machine-stable validation message (possibly round-tripped through the
 * API, which preserves `{error}` but not the code) back to its
 * `prop-firms.validation.*` key. Lives next to the wordings above so the
 * messages and the matcher cannot drift apart; null falls back to the raw
 * English text without masking it.
 */
export const propValidation = (
  message: string,
): { key: string; params?: Record<string, string | number> } | null => {
  const exact = Object.entries(VALIDATION_TEXT).find(([, text]) => text === message);
  if (exact) return { key: exact[0] };
  const decimals = DECIMALS_PATTERN.exec(message);
  return decimals
    ? { key: "amountDecimals", params: { currency: decimals[1]!, digits: Number(decimals[2]) } }
    : null;
};

function currencyFormat(currency: string, locale = "en") {
  if (!supportedCurrencies.has(currency))
    throw new PropValidationError("currencyUnsupported", VALIDATION_TEXT.currencyUnsupported);
  const key = `${locale}|${currency}`;
  let format = currencyFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { style: "currency", currency });
    currencyFormats.set(key, format);
  }
  return format;
}
export function currencyDigits(currency: string) {
  if (!/^[A-Z]{3}$/.test(currency) || !supportedCurrencies.has(currency))
    throw new PropValidationError("currencyUnsupported", VALIDATION_TEXT.currencyUnsupported);
  return currencyFormat(currency).resolvedOptions().maximumFractionDigits ?? 2;
}
/** Parse decimal input directly into integer minor units; never silently round user input. */
export function toMinor(value: unknown, currency: string): number {
  const digits = currencyDigits(currency);
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim()))
    throw new PropValidationError("amountInvalid", VALIDATION_TEXT.amountInvalid);
  const [whole, fraction = ""] = value.trim().split(".");
  if (fraction.length > digits)
    throw new PropValidationError("amountDecimals", decimalsText(currency, digits), {
      currency,
      digits,
    });
  const result = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0"));
  if (!Number.isSafeInteger(result) || result > 10_000_000_000)
    throw new PropValidationError("amountTooLarge", VALIDATION_TEXT.amountTooLarge);
  return result;
}
export const fromMinor = (value: number, currency: string) =>
  (value / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency));
export const propMoney = (value: number, currency: string, locale = "en") =>
  currencyFormat(currency, locale).format(value / 10 ** currencyDigits(currency));

/**
 * English display text for the product-owned prop-firm enums (T15 lookup table,
 * replacing the old mechanical capitalize). Other languages resolve through the
 * `enums` namespace: pass next-intl's `useTranslations("enums")` bound `t`.
 * Unknown custom category values keep the previous mechanical fallback.
 */
const PROP_LABELS: Record<string, string> = {
  evaluation: "Evaluation",
  verification: "Verification",
  funded: "Funded",
  instant_funded: "Instant funded",
  live: "Live",
  active: "Active",
  passed: "Passed",
  breached: "Breached",
  closed: "Closed",
  requested: "Requested",
  approved: "Approved",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
  reset: "Reset",
  activation: "Activation",
  subscription: "Subscription",
  platform: "Platform",
  market_data: "Market data",
  transfer: "Transfer",
  other: "Other",
  expense: "Expense",
  refund: "Refund",
  payout: "Payout",
};
/** "instant_funded" → "instantFunded" so enum values map to camelCase message keys. */
const enumKey = (value: string) =>
  value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
export const label = (value: string, translate?: (key: string) => string) => {
  if (translate && Object.hasOwn(PROP_LABELS, value))
    return translate(`prop.values.${enumKey(value)}`);
  return PROP_LABELS[value] ?? value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
};
export const expectedPayout = (entry: PropEntry) =>
  Number((BigInt(entry.amountMinor) * BigInt(entry.splitBps) + 5000n) / 10000n) - entry.feeMinor;
export const receivedPayout = (id: string, receipts: PropReceipt[]) =>
  receipts.reduce(
    (sum, row) =>
      sum +
      (!row.voided && row.payoutId === id
        ? row.amountMinor * (row.kind === "reversal" ? -1 : 1)
        : 0),
    0,
  );
export type CashMovement = {
  id: string;
  entryId: string;
  accountId: string | null;
  firm: string;
  currency: string;
  date: string;
  kind: "expense" | "refund" | "receipt" | "reversal";
  amountMinor: number;
  category: string;
  reference: string;
};
export function cashMovements(entries: PropEntry[], receipts: PropReceipt[]): CashMovement[] {
  const byId = new Map(entries.filter((e) => !e.voided).map((e) => [e.id, e]));
  const direct = [...byId.values()]
    .filter((e) => e.kind !== "payout")
    .map((e) => ({
      id: e.id,
      entryId: e.id,
      accountId: e.accountId,
      firm: e.firm,
      currency: e.currency,
      date: e.occurredOn,
      kind: e.kind as "expense" | "refund",
      amountMinor: e.amountMinor,
      category: e.category,
      reference: e.reference,
    }));
  return [
    ...direct,
    ...receipts.flatMap((r) => {
      const entry = byId.get(r.payoutId);
      return !entry || r.voided
        ? []
        : [
            {
              id: r.id,
              entryId: entry.id,
              accountId: entry.accountId,
              firm: entry.firm,
              currency: entry.currency,
              date: r.occurredOn,
              kind: r.kind,
              amountMinor: r.amountMinor,
              category: "payout",
              reference: r.reference,
            },
          ];
    }),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
export function cashSummary(rows: CashMovement[]) {
  const currencies = [...new Set(rows.map((r) => r.currency))];
  if (currencies.length > 1)
    throw new PropValidationError("currencyMixed", VALIDATION_TEXT.currencyMixed);
  let spent = 0,
    refunds = 0,
    received = 0;
  for (const row of rows) {
    if (row.kind === "expense") spent += row.amountMinor;
    else if (row.kind === "refund") refunds += row.amountMinor;
    else received += row.amountMinor * (row.kind === "reversal" ? -1 : 1);
  }
  const netSpend = spent - refunds,
    net = received - netSpend;
  return { spent, refunds, netSpend, received, net, roi: netSpend > 0 ? net / netSpend : null };
}
export function cashTimeline(rows: CashMovement[]) {
  cashSummary(rows); // Fail closed on mixed currencies.
  const days = new Map<string, number>();
  for (const row of rows)
    days.set(
      row.date,
      (days.get(row.date) ?? 0) +
        row.amountMinor * (["expense", "reversal"].includes(row.kind) ? -1 : 1),
    );
  let net = 0;
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, net: (net += value) }));
}
export function payoutProgress(entries: PropEntry[], receipts: PropReceipt[], today: string) {
  const received = new Map<string, number>();
  for (const row of receipts)
    if (!row.voided)
      received.set(
        row.payoutId,
        (received.get(row.payoutId) ?? 0) + row.amountMinor * (row.kind === "reversal" ? -1 : 1),
      );
  return entries
    .filter((e) => e.kind === "payout" && !e.voided)
    .map((entry) => {
      const actual = received.get(entry.id) ?? 0,
        expected = expectedPayout(entry);
      const open = entry.status === "requested" || entry.status === "approved";
      return {
        entry,
        actual,
        expected,
        remaining: open ? Math.max(0, expected - actual) : 0,
        variance: actual - expected,
        partial: open && actual > 0 && actual < expected,
        overdue: open && Boolean(entry.dueOn && entry.dueOn < today) && actual < expected,
      };
    });
}
