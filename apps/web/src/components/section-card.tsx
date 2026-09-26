"use client";

import { useId } from "react";
import { ChevronRight } from "lucide-react";
import { useCollapsed } from "@/lib/collapsed-sections";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "./ui/card";

/**
 * A card you can fold to its title bar, remembered per browser. `summary` shows beside the
 * title while folded; `actions` (a save state, an on/off switch) stay usable either way.
 */
export function SectionCard({
  id,
  title,
  summary,
  actions,
  contentClassName,
  children,
}: {
  /** Stable key for remembering the folded state. */
  id: string;
  title: string;
  summary?: string;
  actions?: React.ReactNode;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  const [collapsed, toggle] = useCollapsed(id);
  const contentId = useId();
  return (
    <Card>
      <CardHeader
        className={cn("flex-row items-center justify-between gap-2 space-y-0", collapsed && "pb-4")}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : contentId}
          onClick={toggle}
          className="-m-1 flex min-w-0 flex-1 items-center gap-1.5 rounded p-1 text-left hover:bg-accent/40"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              !collapsed && "rotate-90",
            )}
          />
          <span className="min-w-0 break-words text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {title}
          </span>
          {collapsed && summary && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">{summary}</span>
          )}
        </button>
        {actions}
      </CardHeader>
      {!collapsed && (
        <CardContent id={contentId} className={contentClassName}>
          {children}
        </CardContent>
      )}
    </Card>
  );
}

/** A foldable block inside a card, such as the economic calendar settings. */
export function Section({
  id,
  title,
  actions,
  className,
  children,
}: {
  id: string;
  title: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [collapsed, toggle] = useCollapsed(id);
  const contentId = useId();
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : contentId}
          onClick={toggle}
          className="-m-1 flex min-w-0 flex-1 items-center gap-1.5 rounded p-1 text-left text-sm font-medium hover:bg-accent/40"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              !collapsed && "rotate-90",
            )}
          />
          {title}
        </button>
        {actions}
      </div>
      {!collapsed && (
        <div id={contentId} className="space-y-2">
          {children}
        </div>
      )}
    </div>
  );
}
