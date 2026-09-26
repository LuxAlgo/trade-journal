"use client";

import { Columns2, LayoutGrid, Rows2 } from "lucide-react";
import { MAX_COMPANIONS, type MultiviewState } from "@/lib/multiview";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/** Choose single chart or multiview, how the extra charts sit, and what stays in step. */
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
          title="Show more charts beside the main one"
        >
          <LayoutGrid /> {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
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
              <Dot on={on} /> Main + {count} more
            </DropdownMenuItem>
          );
        })}
        <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Place the extra charts
        </p>
        <DropdownMenuItem
          role="menuitemradio"
          aria-checked={state.arrangement === "column"}
          disabled={!state.enabled}
          onSelect={(e) => {
            keepOpen(e);
            set({ arrangement: "column" });
          }}
        >
          <Dot on={state.arrangement === "column"} />
          <Columns2 className="size-3.5" /> Beside the main chart (wide screens)
        </DropdownMenuItem>
        <DropdownMenuItem
          role="menuitemradio"
          aria-checked={state.arrangement === "row"}
          disabled={!state.enabled}
          onSelect={(e) => {
            keepOpen(e);
            set({ arrangement: "row" });
          }}
        >
          <Dot on={state.arrangement === "row"} />
          <Rows2 className="size-3.5" /> Below the main chart
        </DropdownMenuItem>
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
        <Check
          label="Main chart's drawings on the others"
          on={state.mirrorDrawings}
          disabled={!state.enabled}
          onToggle={() => set({ mirrorDrawings: !state.mirrorDrawings })}
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

/**
 * The main chart and, in multiview, the extra charts beside or below it. The main chart
 * keeps its place in the tree either way, so switching layouts never reloads it.
 */
export function MultiviewGrid({
  state,
  main,
  companions,
}: {
  state: MultiviewState;
  main: React.ReactNode;
  companions: React.ReactNode[];
}) {
  const on = state.enabled && companions.length > 0;
  // Beside the main chart only where the screen is wide enough for both; below otherwise.
  const column = state.arrangement === "column";
  return (
    <div
      className={cn(
        on && "space-y-2",
        on &&
          column &&
          "2xl:grid 2xl:grid-cols-[minmax(0,1fr)_minmax(320px,34%)] 2xl:gap-2 2xl:space-y-0",
      )}
    >
      <div className="min-w-0">{main}</div>
      {on && (
        <div
          className={cn(
            "grid gap-2",
            companions.length === 2 && "md:grid-cols-2",
            companions.length === 3 && "md:grid-cols-3",
            column && "2xl:flex 2xl:h-[min(76vh,760px)] 2xl:flex-col",
          )}
        >
          {companions.map((companion, i) => (
            <div key={i} className={cn("h-80 min-h-0", column && "2xl:h-auto 2xl:flex-1")}>
              {companion}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
