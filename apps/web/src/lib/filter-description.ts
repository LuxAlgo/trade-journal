import type { AnalysisFilters } from "@luxalgo/journal-core";

/** English baseline (also the fallback when no translator is passed, e.g. AI prompts). */
const NAMES: Record<string, string> = {
  accounts: "Accounts",
  from: "From",
  to: "To",
  symbol: "Symbols",
  excludeSymbol: "Exclude symbols",
  tag: "Required tags",
  mistake: "Required mistakes",
  playbookId: "Strategy",
  direction: "Direction",
  status: "Outcome",
  assetClass: "Asset class",
  reviewed: "Reviewed",
  ratingMin: "Minimum rating",
  ratingMax: "Maximum rating",
  quantityMin: "Minimum quantity",
  quantityMax: "Maximum quantity",
  entryMin: "Minimum entry price",
  entryMax: "Maximum entry price",
  exitMin: "Minimum exit price",
  exitMax: "Maximum exit price",
  durationMin: "Minimum minutes held",
  durationMax: "Maximum minutes held",
  rMin: "Minimum realized R",
  rMax: "Maximum realized R",
  plannedRMin: "Minimum planned R",
  plannedRMax: "Maximum planned R",
  pnlMin: "Minimum P&L",
  pnlMax: "Maximum P&L",
  weekdays: "Entry weekdays",
  entryAfter: "Entry after",
  entryBefore: "Entry before",
  exitAfter: "Exit after",
  exitBefore: "Exit before",
};
const DESCRIBE_KEYS = new Set(Object.keys(NAMES));
const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Translator shape satisfied by next-intl's `t` from `useTranslations("filters")`. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

export function describeFilters(
  filters: AnalysisFilters,
  accounts: { id: string; name: string }[] = [],
  playbooks: { id: string; name: string }[] = [],
  privateMode = false,
  translate?: Translate,
) {
  const field = (k: string) =>
    translate && DESCRIBE_KEYS.has(k) ? translate(`describe.${k}`) : (NAMES[k] ?? k);
  const weekday = (d: string) =>
    translate && /^[0-6]$/.test(d) ? translate(`weekdayShort.${d}`) : (EN_WEEKDAYS[Number(d)] ?? d);
  const line = (name: string, value: string) =>
    translate ? translate("entry", { field: name, value }) : `${name}: ${value}`;
  return (
    Object.entries(filters)
      .filter(([, v]) => v)
      .map(([k, v]) => {
        let value = v;
        if (k === "accounts")
          value = v
            .split(",")
            .map(
              (id) =>
                accounts.find((a) => a.id === id)?.name ??
                (translate ? translate("selectedAccount") : "Selected account"),
            )
            .join(", ");
        if (k === "playbookId")
          value =
            playbooks.find((p) => p.id === v)?.name ??
            (translate ? translate("selectedStrategy") : "Selected strategy");
        if (k === "weekdays") value = v.split(",").map(weekday).join(", ");
        if (privateMode && /^(entry|exit|pnl)(Min|Max)$/.test(k)) value = "••••";
        return line(field(k), value);
      })
      .join(" · ") || (translate ? translate("allTrades") : "All trades")
  );
}
