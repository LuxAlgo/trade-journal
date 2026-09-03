"use client";
import type { AnalysisFilters, FilterKey } from "@luxalgo/journal-core";
import { useApi } from "@/lib/use-api";
import { MonetaryField } from "./privacy";
export const fieldClass = "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
      {label}
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
        <input
          className={fieldClass}
          aria-label={label}
          type={type}
          step={type === "number" ? "any" : undefined}
          value={value[key] ?? ""}
          onChange={(e) => set(key, e.target.value)}
        />
      </MonetaryField>
    </Field>
  );
  const select = (key: FilterKey, label: string, choices: [string, string][]) => (
    <Field key={key} label={label}>
      <select
        className={fieldClass}
        value={value[key] ?? ""}
        onChange={(e) => set(key, e.target.value)}
      >
        <option value="">All</option>
        {choices.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <div className="space-y-4">
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
      <fieldset className="rounded-md border p-3">
        <legend className="px-1 text-xs text-muted-foreground">
          Accounts · none selected means all
        </legend>
        <div className="flex flex-wrap gap-3">
          {accounts?.accounts
            .filter((a) => !a.archivedAt)
            .map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={(value.accounts ?? "").split(",").includes(a.id)}
                  onChange={(e) => {
                    const ids = new Set((value.accounts ?? "").split(",").filter(Boolean));
                    if (e.target.checked) ids.add(a.id);
                    else ids.delete(a.id);
                    set("accounts", [...ids].join(","));
                  }}
                />
                {a.name}
              </label>
            ))}
        </div>
      </fieldset>
      <details>
        <summary className="cursor-pointer text-sm">Size, price, risk and time</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-4">
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
        <div className="mt-3 flex flex-wrap gap-3">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
            <label key={day} className="flex gap-1 text-xs">
              <input
                type="checkbox"
                checked={(value.weekdays ?? "").split(",").includes(String(i))}
                onChange={(e) => {
                  const days = new Set((value.weekdays ?? "").split(",").filter(Boolean));
                  if (e.target.checked) days.add(String(i));
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
