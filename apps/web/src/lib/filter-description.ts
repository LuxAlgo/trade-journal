import type { AnalysisFilters } from "@luxalgo/journal-core";
const names: Record<string, string> = {
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
export function describeFilters(
  filters: AnalysisFilters,
  accounts: { id: string; name: string }[] = [],
  playbooks: { id: string; name: string }[] = [],
  privateMode = false,
) {
  return (
    Object.entries(filters)
      .filter(([, v]) => v)
      .map(([k, v]) => {
        let value = v;
        if (k === "accounts")
          value = v
            .split(",")
            .map((id) => accounts.find((a) => a.id === id)?.name ?? "Selected account")
            .join(", ");
        if (k === "playbookId")
          value = playbooks.find((p) => p.id === v)?.name ?? "Selected strategy";
        if (k === "weekdays")
          value = v
            .split(",")
            .map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][Number(d)] ?? d)
            .join(", ");
        if (privateMode && /^(entry|exit|pnl)(Min|Max)$/.test(k)) value = "••••";
        return `${names[k] ?? k}: ${value}`;
      })
      .join(" · ") || "All trades"
  );
}
