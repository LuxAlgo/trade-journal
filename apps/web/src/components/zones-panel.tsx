"use client";

import { Crosshair, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { zoneSummary, type SrZone, type ZoneKind, type ZoneStats } from "@/lib/sr-zones";
import { cn, fmtNumber } from "@/lib/utils";
import { Button } from "./ui/button";

/**
 * Support/resistance zones on this chart. Role, touches and status come from the candles;
 * "Auto" follows price (above = support, below = resistance, flipping after a break).
 */
export function ZonesPanel({
  zones,
  stats,
  capturing,
  pending,
  disabled,
  onAdd,
  onCancel,
  onChange,
  onReveal,
}: {
  zones: SrZone[];
  stats: Record<string, ZoneStats>;
  capturing: boolean;
  pending: boolean;
  disabled: boolean;
  onAdd: () => void;
  onCancel: () => void;
  onChange: (zones: SrZone[]) => void;
  onReveal: (zone: SrZone) => void;
}) {
  const update = (id: string, patch: Partial<SrZone>) =>
    onChange(zones.map((z) => (z.id === id ? { ...z, ...patch } : z)));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {capturing ? (
          <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onAdd}>
            <Plus /> Add zone
          </Button>
        )}
        {capturing && (
          <span role="status" className="text-xs text-muted-foreground">
            {pending ? "Click the zone's other edge." : "Click one edge of the zone on the chart."}
          </span>
        )}
      </div>
      {zones.length === 0 && !capturing && (
        <p className="text-xs text-muted-foreground">
          Mark a price range where price reacts. It extends to the present and tracks touches and
          breaks.
        </p>
      )}
      <ul className="space-y-2">
        {zones.map((zone) => {
          const s = stats[zone.id];
          return (
            <li
              key={zone.id}
              className={cn("space-y-1 rounded-md border p-2", !zone.visible && "opacity-60")}
            >
              <div className="flex items-center gap-1">
                <input
                  aria-label="Zone label"
                  value={zone.label}
                  placeholder={s ? (s.role === "support" ? "Support" : "Resistance") : "Zone"}
                  maxLength={80}
                  onChange={(e) => update(zone.id, { label: e.target.value })}
                  className="h-7 min-w-0 flex-1 rounded border bg-background px-1.5 text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Show the zone on the chart"
                  onClick={() => onReveal(zone)}
                >
                  <Crosshair className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={zone.visible ? "Hide zone" : "Show zone"}
                  onClick={() => update(zone.id, { visible: !zone.visible })}
                >
                  {zone.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Delete zone"
                  onClick={() => onChange(zones.filter((z) => z.id !== zone.id))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                <PriceField
                  label="Low"
                  value={zone.low}
                  onCommit={(low) => low < zone.high && update(zone.id, { low })}
                />
                <PriceField
                  label="High"
                  value={zone.high}
                  onCommit={(high) => high > zone.low && update(zone.id, { high })}
                />
                <select
                  aria-label="Zone kind"
                  value={zone.kind}
                  onChange={(e) => update(zone.id, { kind: e.target.value as ZoneKind })}
                  className="h-7 rounded border bg-background px-1 text-xs"
                >
                  <option value="auto">Auto</option>
                  <option value="support">Support</option>
                  <option value="resistance">Resistance</option>
                </select>
              </div>
              {s && (
                <p className="text-[11px] text-muted-foreground">
                  {zoneSummary({ ...zone, label: "" }, s, (n) => fmtNumber(n))}
                  {s.breaks > 0 ? ` · ${s.breaks} break${s.breaks === 1 ? "" : "s"}` : ""}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PriceField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  return (
    <input
      aria-label={`Zone ${label.toLowerCase()}`}
      title={label}
      defaultValue={String(Number(value.toPrecision(10)))}
      key={value}
      inputMode="decimal"
      onBlur={(e) => {
        const next = Number(e.target.value);
        if (Number.isFinite(next) && next !== value) onCommit(next);
        else e.target.value = String(Number(value.toPrecision(10)));
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="h-7 min-w-0 rounded border bg-background px-1.5 text-xs tabular-nums"
    />
  );
}
