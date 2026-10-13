"use client";

import { useEffect, useState } from "react";
import { Crosshair, Plus, Trash2 } from "lucide-react";
import {
  MAX_SCENARIOS,
  scenarioWarning,
  type AnalysisPlan,
  type Bias,
  type PlanScenario,
} from "@/lib/analysis-plan";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

const BIASES: { value: Bias; label: string }[] = [
  { value: "long", label: "Long" },
  { value: "short", label: "Short" },
  { value: "neutral", label: "Neutral" },
];

const PRICES = [
  { key: "trigger", label: "Trigger" },
  { key: "target", label: "Target" },
  { key: "invalidation", label: "Invalid at" },
] as const;

const newScenarioId = () =>
  `sc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * The analysis's trading plan: a bias, a playbook and "if … then …" scenarios with their
 * trigger, target and invalidation prices. Each journal day grades the scenarios, so the
 * journal can count how often a read played out.
 */
export function PlanEditor({
  plan,
  onChange,
  playbooks,
  disabled,
  pickPrice,
}: {
  plan: AnalysisPlan;
  onChange: (next: AnalysisPlan) => void;
  playbooks: { id: string; name: string }[];
  disabled?: boolean;
  /** The price of the horizontal line last selected on the chart, if any. */
  pickPrice: () => number | null;
}) {
  const setScenario = (id: string, patch: Partial<PlanScenario>) =>
    onChange({
      ...plan,
      scenarios: plan.scenarios.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">Plan</legend>
      <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Bias">
        {BIASES.map((b) => (
          <button
            key={b.value}
            type="button"
            role="radio"
            aria-checked={plan.bias === b.value}
            onClick={() => onChange({ ...plan, bias: plan.bias === b.value ? null : b.value })}
            className={cn(
              "h-7 rounded-md border px-2 text-xs",
              plan.bias === b.value ? "border-primary bg-primary/15" : "hover:bg-accent",
            )}
          >
            {b.label}
          </button>
        ))}
        <select
          aria-label="Playbook"
          value={plan.playbookId ?? ""}
          onChange={(e) => onChange({ ...plan, playbookId: e.target.value || null })}
          className="ml-auto h-7 max-w-40 rounded-md border bg-background px-1 text-xs"
        >
          <option value="">No playbook</option>
          {playbooks.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {plan.scenarios.map((s, i) => (
        <div key={s.id} className="space-y-1.5 rounded-md border p-2">
          <div className="flex items-center gap-1">
            <input
              value={s.name}
              maxLength={80}
              placeholder={`Scenario ${i + 1}, e.g. "Breakout above the range"`}
              aria-label={`Scenario ${i + 1} name`}
              onChange={(e) => setScenario(s.id, { name: e.target.value })}
              className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
            />
            <select
              aria-label={`Scenario ${i + 1} direction`}
              value={s.direction}
              onChange={(e) =>
                setScenario(s.id, { direction: e.target.value as PlanScenario["direction"] })
              }
              className="h-7 rounded-md border bg-background px-1 text-xs"
            >
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
            <button
              type="button"
              aria-label={`Remove scenario ${i + 1}`}
              className="flex size-7 items-center justify-center rounded text-muted-foreground hover:text-destructive"
              onClick={() =>
                onChange({ ...plan, scenarios: plan.scenarios.filter((x) => x.id !== s.id) })
              }
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {PRICES.map(({ key, label }) => (
              <label key={key} className="space-y-0.5 text-[11px] text-muted-foreground">
                {label}
                <span className="flex items-center gap-0.5">
                  <PriceInput
                    value={s[key]}
                    label={`Scenario ${i + 1} ${label.toLowerCase()}`}
                    onValue={(price) => setScenario(s.id, { [key]: price })}
                  />
                  <button
                    type="button"
                    title="Use the price of the horizontal line you last selected on the chart"
                    aria-label={`Set scenario ${i + 1} ${label.toLowerCase()} from the last selected line`}
                    className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent"
                    onClick={() => {
                      const price = pickPrice();
                      if (price !== null) setScenario(s.id, { [key]: price });
                    }}
                  >
                    <Crosshair className="size-3" />
                  </button>
                </span>
              </label>
            ))}
          </div>
          {scenarioWarning(s) && (
            <p role="alert" className="text-[11px] text-destructive">
              {scenarioWarning(s)}
            </p>
          )}
          <input
            value={s.note}
            maxLength={1000}
            placeholder="Condition or note, e.g. after a retest on 15m"
            aria-label={`Scenario ${i + 1} note`}
            onChange={(e) => setScenario(s.id, { note: e.target.value })}
            className="h-7 w-full rounded-md border bg-background px-2 text-xs"
          />
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || plan.scenarios.length >= MAX_SCENARIOS}
        onClick={() =>
          onChange({
            ...plan,
            scenarios: [
              ...plan.scenarios,
              {
                id: newScenarioId(),
                name: "",
                direction: plan.bias === "short" ? "short" : "long",
                trigger: null,
                target: null,
                invalidation: null,
                note: "",
              },
            ],
          })
        }
      >
        <Plus /> Scenario
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Each journal day grades these: it suggests played out, invalidated or not triggered from the
        day&apos;s candles, and you confirm it there.
      </p>
    </fieldset>
  );
}

const parsePrice = (text: string) => (text.trim() === "" ? null : Number(text));

/**
 * A price field that keeps what you type ("84210." while typing a decimal) and reports a
 * number once it is one; a price set from outside (the selected line) replaces the text.
 */
function PriceInput({
  value,
  label,
  onValue,
}: {
  value: number | null;
  label: string;
  onValue: (price: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    setText((current) =>
      parsePrice(current) === value ? current : value === null ? "" : String(value),
    );
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      aria-label={label}
      onChange={(e) => {
        setText(e.target.value);
        const price = parsePrice(e.target.value);
        if (price === null || Number.isFinite(price)) onValue(price);
      }}
      className="tnum h-7 w-full min-w-0 rounded-md border bg-background px-1 text-xs text-foreground"
    />
  );
}
