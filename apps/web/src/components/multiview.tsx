"use client";

import { Bell, LayoutGrid, PanelTop, Rows2, X } from "lucide-react";
import { MAX_COMPANIONS, type Arrangement, type MultiviewState } from "@/lib/multiview";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const ARRANGEMENTS: { value: Arrangement; label: string; icon: typeof LayoutGrid }[] = [
  { value: "grid", label: "Grid, two per row", icon: LayoutGrid },
  { value: "focus", label: "First chart large, others below", icon: PanelTop },
  { value: "stack", label: "One below the other", icon: Rows2 },
];

/** Choose single chart or multiview, how the charts sit, and what stays in step. */
export function MultiviewMenu({
  state,
  onChange,
}: {
  state: MultiviewState;
  onChange: (next: MultiviewState) => void;
}) {
  const set = (patch: Partial<MultiviewState>) => onChange({ ...state, ...patch });
  const keepOpen = (event: Event) => event.preventDefault();
  const label = state.enabled ? `${state.count + 1} charts` : "Single chart";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={state.enabled ? "secondary" : "outline"}
          title="Show several charts at once"
        >
          <LayoutGrid /> {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Charts
        </p>
        <DropdownMenuItem
          role="menuitemradio"
          aria-checked={!state.enabled}
          onSelect={(e) => {
            keepOpen(e);
            set({ enabled: false });
          }}
        >
          <Dot on={!state.enabled} /> Single chart
        </DropdownMenuItem>
        {Array.from({ length: MAX_COMPANIONS }, (_, i) => i + 1).map((count) => {
          const on = state.enabled && state.count === count;
          return (
            <DropdownMenuItem
              key={count}
              role="menuitemradio"
              aria-checked={on}
              onSelect={(e) => {
                keepOpen(e);
                set({ enabled: true, count });
              }}
            >
              <Dot on={on} /> {count + 1} charts
            </DropdownMenuItem>
          );
        })}
        <p className="px-2 pb-1 text-xs text-muted-foreground">
          Each chart has its own symbol, candle size, drawings, indicators, zones and alerts. Click
          a chart to work on it.
        </p>
        <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Layout
        </p>
        {ARRANGEMENTS.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            role="menuitemradio"
            aria-checked={state.arrangement === value}
            disabled={!state.enabled}
            onSelect={(e) => {
              keepOpen(e);
              set({ arrangement: value });
            }}
          >
            <Dot on={state.arrangement === value} />
            <Icon className="size-3.5" /> {label}
          </DropdownMenuItem>
        ))}
        <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Keep in step
        </p>
        <Check
          label="Crosshair"
          on={state.sync.crosshair}
          disabled={!state.enabled}
          onToggle={() => set({ sync: { ...state.sync, crosshair: !state.sync.crosshair } })}
        />
        <Check
          label="Time window (scroll and zoom)"
          on={state.sync.time}
          disabled={!state.enabled}
          onToggle={() => set({ sync: { ...state.sync, time: !state.sync.time } })}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2.5 shrink-0 rounded-full border",
        on ? "border-primary bg-primary" : "border-muted-foreground",
      )}
    />
  );
}

function Check({
  label,
  on,
  disabled,
  onToggle,
}: {
  label: string;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <DropdownMenuItem
      role="menuitemcheckbox"
      aria-checked={on}
      disabled={disabled}
      onSelect={(e) => {
        e.preventDefault();
        onToggle();
      }}
    >
      <input type="checkbox" readOnly checked={on} className="pointer-events-none" />
      {label}
    </DropdownMenuItem>
  );
}

export interface ChartCellLayout {
  /** Classes for this chart's cell in the grid. */
  cell: string;
  /** A full-height chart, or a shorter one that fits several on screen. */
  size: "full" | "pane";
}

const FOCUS_COLUMNS: Record<number, string> = { 2: "md:grid-cols-2", 3: "md:grid-cols-3" };
const FOCUS_SPAN: Record<number, string> = { 2: "md:col-span-2", 3: "md:col-span-3" };

/**
 * Where the charts sit. The first chart keeps its place in the tree in every layout, so
 * turning multiview on or off never reloads it.
 */
export function multiviewLayout(state: MultiviewState) {
  const total = state.enabled ? state.count + 1 : 1;
  const others = total - 1;
  const container =
    total === 1
      ? ""
      : state.arrangement === "stack"
        ? "flex flex-col gap-3"
        : state.arrangement === "focus"
          ? cn("grid gap-3", FOCUS_COLUMNS[others])
          : "grid gap-3 lg:grid-cols-2";
  const cell = (index: number): ChartCellLayout => {
    if (total === 1) return { cell: "min-w-0", size: "full" };
    if (state.arrangement === "focus")
      return index === 0
        ? { cell: cn("min-w-0", FOCUS_SPAN[others]), size: "full" }
        : { cell: "min-w-0", size: "pane" };
    if (state.arrangement === "grid")
      // An odd chart out takes the whole last row.
      return {
        cell: cn("min-w-0", index === total - 1 && total % 2 === 1 && "lg:col-span-2"),
        size: "pane",
      };
    return { cell: "min-w-0", size: "pane" };
  };
  return { total, container, cell };
}

/** A chart's name strip in multiview: which chart it is, and whether it is the one you edit. */
export function PaneHeader({
  label,
  detail,
  color,
  price,
  active,
  alerts,
  onClose,
}: {
  label: string;
  detail: string;
  color?: string;
  price: string | null;
  active: boolean;
  /** Alerts this chart raised since you last worked on it. */
  alerts: number;
  onClose?: () => void;
}) {
  return (
    <div
      className={cn(
        "mb-1 flex min-h-8 items-center gap-2 rounded-md border px-2 text-sm",
        active ? "border-primary/60 bg-primary/10" : "bg-card",
      )}
    >
      {color && (
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="truncate font-medium">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>
      {price && <span className="tnum shrink-0 text-xs">{price}</span>}
      {alerts > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-xs" title="New alerts">
          <Bell aria-hidden="true" className="size-3" />
          <span className="tnum">{alerts}</span>
          <span className="sr-only">new alerts</span>
        </span>
      )}
      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
        {active ? "Editing" : "Click to edit"}
      </span>
      {onClose && (
        <button
          type="button"
          aria-label={`Close the ${label} chart`}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
