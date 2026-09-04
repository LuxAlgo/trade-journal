"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";
import { CircleHelp } from "lucide-react";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

function TooltipContent({
  className,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          "journal-hover-card z-[80] max-w-[min(19rem,calc(100vw-24px))] rounded-xl border bg-popover p-3.5 text-[13px] leading-relaxed text-popover-foreground",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/** Shared hover/focus help without an extra layout wrapper or native title bubble. */
export function HoverHint({
  children,
  content,
  heading,
  side = "top",
}: {
  children: React.ReactElement;
  content: React.ReactNode;
  heading?: string;
  side?: React.ComponentProps<typeof TooltipContent>["side"];
}) {
  if (!content) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>
        {heading && (
          <div className="mb-1 text-[13px] font-semibold text-popover-foreground">{heading}</div>
        )}
        <div className={heading ? "text-muted-foreground" : undefined}>{content}</div>
      </TooltipContent>
    </Tooltip>
  );
}

export function HelpHint({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <HoverHint heading={heading} content={children}>
      <button
        type="button"
        aria-label={`About ${heading}`}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CircleHelp aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </HoverHint>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
