"use client";
import { OptionSelect } from "@/components/ui/option-select";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslations } from "next-intl";

import type { AnalysisFilters, FilterKey } from "@luxalgo/journal-core";
import { useApi } from "@/lib/use-api";
import { MonetaryField } from "./privacy";
import { ChevronDown, CircleHelp } from "lucide-react";
import { HoverHint } from "./ui/tooltip";
import { DatePicker } from "./ui/date-picker";
export const fieldClass = "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";

/** Fields offering a help hint, by message key under `filters.hints`. */
const HINTED_FIELDS = new Set([
  "from",
  "to",
  "strategy",
  "symbols",
  "excludeSymbols",
  "requiredTags",
  "requiredMistakes",
  "reviewStatus",
  "r",
  "plannedR",
  "duration",
]);

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  /** Localized help text; when absent no help affordance is rendered. */
  hint?: React.ReactNode;
}) {
  const t = useTranslations("filters");
  return (
    <label className="journal-filter-field grid min-w-0 gap-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        {label}
        {hint && (
          <HoverHint heading={label} content={hint}>
            <span
              tabIndex={0}
              aria-label={t("aboutField", { field: label })}
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
  const t = useTranslations("filters");
  const tEnum = useTranslations("enums");
  const { data: accounts } = useApi<{
    accounts: { id: string; name: string; archivedAt: string | null }[];
  }>("/api/accounts");
  const { data: playbooks } = useApi<{ playbooks: { id: string; name: string }[] }>(
    "/api/playbooks",
  );
  const set = (key: FilterKey, v: string) => onChange({ ...value, [key]: v });
  const fieldLabel = (key: string) => t(`fields.${key}`);
  const hint = (key: string) => (HINTED_FIELDS.has(key) ? t(`hints.${key}`) : undefined);
  const boundedLabel = (
    key: "quantity" | "entry" | "exit" | "duration" | "r" | "plannedR" | "pnl" | "rating",
    bound: "min" | "max",
  ) => `${fieldLabel(key)} · ${t(`range.${bound}`)}`;
  const input = (key: FilterKey, label: string, type = "text", labelHint?: React.ReactNode) => (
    <Field key={key} label={label} hint={labelHint}>
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
  const select = (
    key: FilterKey,
    label: string,
    choices: [string, string][],
    labelHint?: React.ReactNode,
  ) => (
    <Field key={key} label={label} hint={labelHint}>
      <span className="journal-filter-select relative block min-w-0">
        <OptionSelect
          className={fieldClass}
          value={value[key] ?? ""}
          onValueChange={(next) => set(key, next)}
        >
          <option value="">{t("range.all")}</option>
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
        {input("from", fieldLabel("from"), "date", hint("from"))}
        {input("to", fieldLabel("to"), "date", hint("to"))}
        {select(
          "playbookId",
          fieldLabel("strategy"),
          (playbooks?.playbooks ?? []).map((p) => [p.id, p.name]),
          hint("strategy"),
        )}
        {input("symbol", fieldLabel("symbols"), "text", hint("symbols"))}
        {input("excludeSymbol", fieldLabel("excludeSymbols"), "text", hint("excludeSymbols"))}
        {input("tag", fieldLabel("requiredTags"), "text", hint("requiredTags"))}
        {input("mistake", fieldLabel("requiredMistakes"), "text", hint("requiredMistakes"))}
        {select("direction", fieldLabel("direction"), [
          ["long", tEnum("direction.long")],
          ["short", tEnum("direction.short")],
        ])}
        {select("status", fieldLabel("outcome"), [
          ["closed", t("fields.outcomeAllClosed")],
          ["open", tEnum("status.open")],
          ["win", tEnum("status.win")],
          ["loss", tEnum("status.loss")],
          ["breakeven", tEnum("status.breakeven")],
        ])}
        {select(
          "reviewed",
          fieldLabel("reviewStatus"),
          [
            ["yes", t("fields.reviewedYes")],
            ["no", t("fields.reviewedNo")],
          ],
          hint("reviewStatus"),
        )}
        {select("assetClass", fieldLabel("assetClass"), [
          ["equity", tEnum("assetClass.equity")],
          ["futures", tEnum("assetClass.futures")],
          ["forex", tEnum("assetClass.forex")],
          ["option", tEnum("assetClass.option")],
          ["crypto", tEnum("assetClass.crypto")],
          ["cfd", tEnum("assetClass.cfd")],
          ["other", tEnum("assetClass.other")],
        ])}
      </div>
      <fieldset className="journal-filter-accounts rounded-lg border p-3">
        <legend className="px-1 text-xs text-muted-foreground">
          {fieldLabel("accountsLegend")}
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
          <span>{fieldLabel("advanced")}</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        </summary>
        <div className="journal-filter-advanced-grid mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-4">
          {(
            [
              ["quantity", "quantity"],
              ["entry", "entry"],
              ["exit", "exit"],
              ["duration", "duration"],
              ["r", "r"],
              ["plannedR", "plannedR"],
              ["pnl", "pnl"],
              ["rating", "rating"],
            ] as const
          ).flatMap(([k, hintKey]) => [
            input(`${k}Min` as FilterKey, boundedLabel(k, "min"), "number", hint(hintKey)),
            input(`${k}Max` as FilterKey, boundedLabel(k, "max"), "number", hint(hintKey)),
          ])}
          {input("entryAfter", fieldLabel("entryAfter"), "time")}
          {input("entryBefore", fieldLabel("entryBefore"), "time")}
          {input("exitAfter", fieldLabel("exitAfter"), "time")}
          {input("exitBefore", fieldLabel("exitBefore"), "time")}
        </div>
        <div className="journal-filter-weekdays mt-3 flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4, 5, 6].map((day) => (
            <label key={day} className="journal-filter-choice flex items-center gap-2 text-xs">
              <Checkbox
                checked={(value.weekdays ?? "").split(",").includes(String(day))}
                onCheckedChange={(checked) => {
                  const days = new Set((value.weekdays ?? "").split(",").filter(Boolean));
                  if (checked === true) days.add(String(day));
                  else days.delete(String(day));
                  set("weekdays", [...days].join(","));
                }}
              />
              {t(`weekdayShort.${day}`)}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
