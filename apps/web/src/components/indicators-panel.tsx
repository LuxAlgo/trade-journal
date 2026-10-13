"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Eye,
  EyeOff,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { INDICATOR_LIBRARY, type LibraryIndicator } from "@/lib/indicator-library";
import type { ChartScript, IndicatorRef } from "@/lib/chart-indicators";
import { cn } from "@/lib/utils";
import type { ChartIndicator } from "./chart-indicators-bridge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { HoverHint } from "./ui/tooltip";

const CATEGORIES: LibraryIndicator["category"][] = [
  "Trend",
  "Momentum",
  "Volatility",
  "Volume",
  "Signals",
];

/**
 * Indicators on the chart and the scripts they come from. Built-ins and your saved
 * scripts are Pine Script; the code button opens any of them in the editor.
 */
export function IndicatorsPanel({
  indicators,
  scripts,
  disabled,
  onAdd,
  onNew,
  onEditIndicator,
  onEditScript,
  onToggle,
  onSettings,
  onRemove,
}: {
  indicators: ChartIndicator[];
  scripts: ChartScript[];
  disabled: boolean;
  onAdd: (ref: IndicatorRef, source: string) => void;
  onNew: () => void;
  onEditIndicator: (indicator: ChartIndicator) => void;
  onEditScript: (script: ChartScript) => void;
  onToggle: (id: string, visible: boolean) => void;
  onSettings: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [showScripts, setShowScripts] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="outline" disabled={disabled}>
              <Plus /> Add indicator <ChevronDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] w-72 overflow-y-auto"
          >
            {CATEGORIES.map((category) => (
              <div key={category}>
                <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {category}
                </p>
                {INDICATOR_LIBRARY.filter((i) => i.category === category).map((item) => (
                  <DropdownMenuItem
                    key={item.key}
                    onSelect={() => onAdd({ kind: "library", key: item.key }, item.source)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{item.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
            <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              My indicators
            </p>
            {scripts.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">None saved yet.</p>
            )}
            {scripts.map((script) => (
              <DropdownMenuItem
                key={script.id}
                onSelect={() => onAdd({ kind: "script", id: script.id }, script.source)}
              >
                <Code2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{script.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={onNew}>
              <Plus className="size-3.5" /> New Pine indicator…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onNew}>
          <Code2 /> New
        </Button>
      </div>

      {indicators.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No indicators yet. Add a built-in one or write your own in Pine Script.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {indicators.map((indicator) => (
            <li key={indicator.id} className="rounded-md px-1 py-0.5 hover:bg-accent/40">
              <div
                className={cn(
                  "flex items-center gap-1 text-sm",
                  !indicator.visible && "opacity-60",
                )}
              >
                <span className="min-w-0 flex-1 truncate" title={indicator.title}>
                  {indicator.title}
                </span>
                <Tool
                  label={indicator.visible ? `Hide ${indicator.title}` : `Show ${indicator.title}`}
                  onClick={() => onToggle(indicator.id, !indicator.visible)}
                >
                  {indicator.visible ? <Eye /> : <EyeOff />}
                </Tool>
                <Tool
                  label={`${indicator.title} settings`}
                  onClick={() => onSettings(indicator.id)}
                >
                  <Settings2 />
                </Tool>
                <Tool
                  label={`Edit ${indicator.title} code`}
                  onClick={() => onEditIndicator(indicator)}
                >
                  <Code2 />
                </Tool>
                <Tool label={`Remove ${indicator.title}`} onClick={() => onRemove(indicator.id)}>
                  <Trash2 />
                </Tool>
              </div>
              {indicator.error && (
                <p role="alert" className="line-clamp-3 px-1 text-[11px] text-destructive">
                  {indicator.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {scripts.length > 0 && (
        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowScripts(!showScripts)}
          >
            {showScripts ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            My indicators ({scripts.length})
          </button>
          {showScripts && (
            <ul className="mt-1 space-y-0.5">
              {scripts.map((script) => (
                <li
                  key={script.id}
                  className="flex items-center gap-1 rounded px-1 text-xs hover:bg-accent/40"
                >
                  <span className="min-w-0 flex-1 truncate py-1">{script.name}</span>
                  <Tool
                    label={`Add ${script.name} to the chart`}
                    disabled={disabled}
                    onClick={() => onAdd({ kind: "script", id: script.id }, script.source)}
                  >
                    <Plus />
                  </Tool>
                  <Tool label={`Edit ${script.name}`} onClick={() => onEditScript(script)}>
                    <Code2 />
                  </Tool>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Indicators run on PineTS (AGPL-3.0). Settings on the chart legend or the gear edit their
        inputs; they save with this analysis.
      </p>
    </div>
  );
}

function Tool({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <HoverHint content={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 [&_svg]:size-3.5"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </Button>
    </HoverHint>
  );
}
