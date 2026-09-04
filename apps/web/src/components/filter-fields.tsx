"use client";
import { OptionSelect } from "@/components/ui/option-select";
import { Checkbox } from "@/components/ui/checkbox";

import type { AnalysisFilters, FilterKey } from "@luxalgo/journal-core";
import { useApi } from "@/lib/use-api";
import { MonetaryField } from "./privacy";
import { ChevronDown, CircleHelp } from "lucide-react";
import { HoverHint } from "./ui/tooltip";
import { DatePicker } from "./ui/date-picker";
const FIELD_HINTS: Record<string, string> = {
  From: "First included date. Closed trades use their closing day; open trades use their opening day.",
  To: "Last included date. Dates follow the journal time zone.",
  Strategy: "Include trades assigned to this playbook. All includes trades without a playbook.",
  "Symbols (comma-separated)":
    "Include these symbols. Separate multiple symbols with commas, for example AAPL, NVDA.",
  "Exclude symbols": "Hide these symbols from the results. Separate multiple symbols with commas.",
  "Required tags (comma-separated)":
    "Filter by tags recorded on your trades. Separate multiple tags with commas.",
  "Required mistakes":
    "Filter by recorded trading mistakes. Separate multiple mistakes with commas.",
  "Review status": "Find trades you have marked reviewed, or those still awaiting review.",
  "Realized R": "Trade profit or loss expressed as a multiple of the trade's initial risk.",
  "Planned R": "The planned reward relative to the trade's initial risk.",
  "Minutes held": "Time between opening and closing a trade, measured in minutes.",
};
export const fieldClass = "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="journal-filter-field grid min-w-0 gap-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        {label}
        {FIELD_HINTS[label.split(" · ")[0]!] && (
          <HoverHint heading={label} content={FIELD_HINTS[label.split(" · ")[0]!]}>
            <span
              tabIndex={0}
              aria-label={`About ${label}`}
              className="inline-flex cursor-help rounded-sm text-muted-foreground/70 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CircleHelp aria-hidden="true" className="h-3 w-3" />
            </span>
          </HoverHint>
        )}
      </span>
      {children}
    </label>
  );
}
export function FilterFields({
  value,
  onChange,
}: {
  value: AnalysisFilters;
  onChange: (v: AnalysisFilters) => void;
}) {
  const { data: accounts } = useApi<{
    accounts: { id: string; name: string; archivedAt: string | null }[];
  }>("/api/accounts");
  const { data: playbooks } = useApi<{ playbooks: { id: string; name: string }[] }>(
    "/api/playbooks",
  );
  const set = (key: FilterKey, v: string) => onChange({ ...value, [key]: v });
  const input = (key: FilterKey, label: string, type = "text") => (
    <Field key={key} label={label}>
      <MonetaryField sensitive={/^(entry|exit|pnl)(Min|Max)$/.test(key)}>
        {type === "date" ? (
          <DatePicker
            value={value[key] ?? ""}
            onValueChange={(next) => set(key, next)}
            label={label}
          />
        ) : (
          <input
            className={fieldClass}
            aria-label={label}
            type={type}
            step={type === "number" ? "any" : undefined}
            value={value[key] ?? ""}
            onChange={(e) => set(key, e.target.value)}
          />
        )}
      </MonetaryField>
    </Field>
  );
  const select = (key: FilterKey, label: string, choices: [string, string][]) => (
    <Field key={key} label={label}>
      <span className="journal-filter-select relative block min-w-0">
        <OptionSelect
          className={fieldClass}
          value={value[key] ?? ""}
          onValueChange={(next) => set(key, next)}
        >
          <option value="">All</option>
          {choices.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </OptionSelect>
      </span>
    </Field>
  );
  return (
    <div className="journal-filter-fields space-y-5">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3">
        {input("from", "From", "date")}
        {input("to", "To", "date")}
        {select(
          "playbookId",
          "Strategy",
          (playbooks?.playbooks ?? []).map((p) => [p.id, p.name]),
        )}
        {input("symbol", "Symbols (comma-separated)")}
        {input("excludeSymbol", "Exclude symbols")}
        {input("tag", "Required tags (comma-separated)")}
        {input("mistake", "Required mistakes")}
        {select("direction", "Direction", [
          ["long", "Long"],
          ["short", "Short"],
        ])}
        {select("status", "Outcome", [
          ["closed", "All closed"],
          ["open", "Open"],
          ["win", "Win"],
          ["loss", "Loss"],
          ["breakeven", "Breakeven"],
        ])}
        {select("reviewed", "Review status", [
          ["yes", "Reviewed"],
          ["no", "Unreviewed"],
        ])}
        {select(
          "assetClass",
          "Asset class",
          ["equity", "futures", "forex", "option", "crypto", "cfd", "other"].map((v) => [v, v]),
        )}
      </div>
      <fieldset className="journal-filter-accounts rounded-lg border p-3">
        <legend className="px-1 text-xs text-muted-foreground">
          Accounts · none selected means all
        </legend>
        <div className="flex flex-wrap gap-3">
          {accounts?.accounts
            .filter((a) => !a.archivedAt)
            .map((a) => (
              <label key={a.id} className="journal-filter-choice flex items-center gap-2 text-xs">
                <Checkbox
                  checked={(value.accounts ?? "").split(",").includes(a.id)}
                  onCheckedChange={(checked) => {
                    const ids = new Set((value.accounts ?? "").split(",").filter(Boolean));
                    if (checked === true) ids.add(a.id);
                    else ids.delete(a.id);
                    set("accounts", [...ids].join(","));
                  }}
                />
                {a.name}
              </label>
            ))}
        </div>
      </fieldset>
      <details className="journal-filter-advanced">
        <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span>Size, price, risk and time</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        </summary>
        <div className="journal-filter-advanced-grid mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-4">
          {(
            [
              ["quantity", "Total entry quantity"],
              ["entry", "Entry price"],
              ["exit", "Exit price"],
              ["duration", "Minutes held"],
              ["r", "Realized R"],
              ["plannedR", "Planned R"],
              ["pnl", "Net P&L"],
              ["rating", "Rating"],
            ] as const
          ).flatMap(([k, l]) => [
            input(`${k}Min` as FilterKey, `${l} · min`, "number"),
            input(`${k}Max` as FilterKey, `${l} · max`, "number"),
          ])}
          {input("entryAfter", "Entry after", "time")}
          {input("entryBefore", "Entry before", "time")}
          {input("exitAfter", "Exit after", "time")}
          {input("exitBefore", "Exit before", "time")}
        </div>
        <div className="journal-filter-weekdays mt-3 flex flex-wrap gap-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
            <label key={day} className="journal-filter-choice flex items-center gap-2 text-xs">
              <Checkbox
                checked={(value.weekdays ?? "").split(",").includes(String(i))}
                onCheckedChange={(checked) => {
                  const days = new Set((value.weekdays ?? "").split(",").filter(Boolean));
                  if (checked === true) days.add(String(i));
                  else days.delete(String(i));
                  set("weekdays", [...days].join(","));
                }}
              />
              {day}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
