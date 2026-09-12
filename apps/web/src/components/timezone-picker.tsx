"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { timeZoneLabel, timeZoneOptions } from "@/lib/timezone-options";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TimeZonePicker({
  id,
  label,
  value,
  onValueChange,
  disabled = false,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (zone: string) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const options = useMemo(() => timeZoneOptions(value, query), [value, query]);
  const activeId = options[active] === undefined ? undefined : `${listId}-${active}`;

  useEffect(() => {
    if (open && activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [open, activeId, query]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const choose = (zone: string) => {
    if (zone !== value) onValueChange(zone);
    setOpen(false);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setActive(Math.max(0, timeZoneOptions(value).indexOf(value)));
        }
      }}
    >
      <Popover.Trigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="w-full min-w-0 justify-between font-normal"
          disabled={disabled}
          aria-label={`${label}: ${value || "Choose a timezone"}`}
          aria-describedby={describedBy}
        >
          <span className="truncate">{value ? timeZoneLabel(value) : "Choose a timezone"}</span>
          <ChevronsUpDown className="shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={`${label} options`}
          sideOffset={6}
          collisionPadding={12}
          className="journal-popup journal-menu-surface z-50 flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border bg-popover p-1.5 text-popover-foreground"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <div className="relative shrink-0">
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              ref={input}
              role="combobox"
              aria-label="Search timezones"
              aria-expanded={open}
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={activeId}
              placeholder="Search city or timezone…"
              className="pl-8"
              value={query}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (options.length)
                    setActive(
                      (index) =>
                        (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
                        options.length,
                    );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (options[active]) choose(options[active]);
                }
              }}
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label="Timezones"
            className="mt-1 min-h-0 overflow-y-auto overscroll-contain"
          >
            {options.map((zone, index) => (
              <div
                key={zone}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={zone === value}
                className={cn(
                  "flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  index === active && "bg-accent text-accent-foreground",
                )}
                onPointerMove={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(zone)}
              >
                <Check
                  className={cn("size-4 shrink-0", zone !== value && "invisible")}
                  aria-hidden="true"
                />
                <span className="min-w-0 break-words">{timeZoneLabel(zone)}</span>
              </div>
            ))}
          </div>
          <p role="status" className="shrink-0 px-2 pb-1 pt-2 text-xs text-muted-foreground">
            {options.length
              ? `${options.length} timezone${options.length === 1 ? "" : "s"}`
              : "No matching timezone. Try a city or a full timezone name."}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
