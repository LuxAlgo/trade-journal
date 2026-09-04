"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer group/checkbox size-4 shrink-0 rounded-[5px] border border-muted-foreground/50 bg-background shadow-xs transition-[background-color,border-color,box-shadow] duration-150 hover:border-foreground/70 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground aria-invalid:border-destructive motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="size-3 group-data-[state=indeterminate]/checkbox:hidden"
        />
        <Minus
          aria-hidden="true"
          strokeWidth={3}
          className="hidden size-3 group-data-[state=indeterminate]/checkbox:block"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
