"use client";

import { Check, SlidersHorizontal } from "lucide-react";
import { RESOLUTIONS, type Resolution } from "@/lib/market-data";
import { toggleTimeframe } from "@/lib/chart-timeframes";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/** One-tap candle sizes; the menu picks which sizes the bar shows (saved per browser). */
export function TimeframeBar({
  value,
  shown,
  onChange,
  onShownChange,
}: {
  value: Resolution;
  shown: Resolution[];
  onChange: (resolution: Resolution) => void;
  onShownChange: (shown: Resolution[]) => void;
}) {
  // The current size stays reachable even if it was removed from the bar.
  const sizes = shown.includes(value) ? shown : [...shown, value];
  return (
    <div
      role="radiogroup"
      aria-label="Candle size"
      className="flex items-center rounded-md border p-0.5"
    >
      {(Object.keys(RESOLUTIONS) as Resolution[])
        .filter((r) => sizes.includes(r))
        .map((resolution) => (
          <Button
            key={resolution}
            type="button"
            role="radio"
            aria-checked={value === resolution}
            size="sm"
            variant={value === resolution ? "secondary" : "ghost"}
            className="h-7 px-2.5"
            onClick={() => value !== resolution && onChange(resolution)}
          >
            {resolution}
          </Button>
        ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Choose candle sizes"
          >
            <SlidersHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Show on the bar
          </p>
          {(Object.keys(RESOLUTIONS) as Resolution[]).map((resolution) => (
            <DropdownMenuItem
              key={resolution}
              role="menuitemcheckbox"
              aria-checked={shown.includes(resolution)}
              onSelect={(event) => {
                // Keep the menu open while ticking several sizes.
                event.preventDefault();
                onShownChange(toggleTimeframe(shown, resolution));
              }}
            >
              <Check className={shown.includes(resolution) ? "size-3.5" : "size-3.5 opacity-0"} />
              {resolution}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
