"use client";

import { useState } from "react";
import { postJson, useApi } from "@/lib/use-api";
import { fmtNumber } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

/**
 * Log a setup you saw but did not take, at the chart point you clicked. It is saved to
 * Missed trades (kept out of your trading metrics) and drawn on the chart as a violet
 * diamond, apart from real trades.
 */
export function MissedTradeDialog({
  point,
  symbol,
  onClose,
  onSaved,
}: {
  point: { time: number; price: number } | null;
  symbol: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={point !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {point && (
          <Form
            key={point.time}
            point={point}
            symbol={symbol}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Form({
  point,
  symbol,
  onClose,
  onSaved,
}: {
  point: { time: number; price: number };
  symbol: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data } = useApi<{ playbooks: { id: string; name: string }[] }>("/api/playbooks");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entry, setEntry] = useState(String(Number(point.price.toPrecision(8))));
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [playbookId, setPlaybookId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const price = (value: string) => (value.trim() ? Number(value) : null);
  const save = async () => {
    const values = { entry: price(entry), stop: price(stop), target: price(target) };
    if (Object.values(values).some((v) => v !== null && !Number.isFinite(v)))
      return setError("Prices must be numbers.");
    setSaving(true);
    setError("");
    try {
      await postJson("/api/workspace/missed", {
        symbol,
        direction,
        observedAt: new Date(point.time).toISOString(),
        playbookId: playbookId || undefined,
        ...values,
        notes,
      });
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the missed trade.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <DialogTitle>Missed trade</DialogTitle>
      <DialogDescription>
        {symbol} at {new Date(point.time).toLocaleString()} · {fmtNumber(point.price)}. Kept out of
        your trading stats.
      </DialogDescription>
      <div role="radiogroup" aria-label="Direction" className="flex gap-1">
        {(["long", "short"] as const).map((d) => (
          <Button
            key={d}
            type="button"
            role="radio"
            aria-checked={direction === d}
            variant={direction === d ? "secondary" : "outline"}
            size="sm"
            onClick={() => setDirection(d)}
          >
            {d === "long" ? "Long" : "Short"}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field id="missed-entry" label="Entry" value={entry} onChange={setEntry} />
        <Field id="missed-stop" label="Stop" value={stop} onChange={setStop} />
        <Field id="missed-target" label="Target" value={target} onChange={setTarget} />
      </div>
      {data && data.playbooks.length > 0 && (
        <div className="space-y-1">
          <Label htmlFor="missed-playbook">Playbook</Label>
          <select
            id="missed-playbook"
            value={playbookId}
            onChange={(e) => setPlaybookId(e.target.value)}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">None</option>
            {data.playbooks.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="missed-notes">Why you passed</Label>
        <Textarea
          id="missed-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save missed trade"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        placeholder="optional"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
