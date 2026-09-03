"use client";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { dayKeyOf, FILTER_KEYS, readFilters, type AnalysisFilters } from "@luxalgo/journal-core";
import { useApi } from "@/lib/use-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilterFields } from "./filter-fields";
import { SlidersHorizontal } from "lucide-react";
import { AccountSelector } from "./account-selector";
export const useFilters = () => {
  const params = useSearchParams();
  const { data } = useApi<{ timeZone: string }>("/api/settings");
  const range = params.get("range") ?? "all",
    timeZone = data?.timeZone ?? "UTC";
  return useMemo(() => {
    const f = readFilters(new URLSearchParams(params.toString()));
    const today = dayKeyOf(new Date().toISOString(), timeZone);
    if (range === "ytd") {
      f.from = `${today.slice(0, 4)}-01-01`;
      f.to = today;
    } else if (["7d", "30d", "90d"].includes(range)) {
      const d = new Date(today + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - Number(range.slice(0, -1)) + 1);
      f.from = d.toISOString().slice(0, 10);
      f.to = today;
    }
    return {
      accounts: f.accounts ?? null,
      from: f.from ?? null,
      to: f.to ?? null,
      range,
      timeZone,
      values: f,
      query: new URLSearchParams(Object.entries(f).filter(([, v]) => Boolean(v))).toString(),
    };
  }, [params, range, timeZone]);
};
export type Filters = ReturnType<typeof useFilters>;
export function FilterBar({ title, actions }: { title: string; actions?: React.ReactNode }) {
  const router = useRouter(),
    pathname = usePathname(),
    params = useSearchParams();
  const filters = useFilters();
  const showFilters =
    ["/", "/reports", "/trades", "/calendar", "/journal", "/playbooks"].includes(pathname) ||
    pathname.startsWith("/journal/");
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<AnalysisFilters>({});
  const count = Object.keys(filters.values).filter((k) => !["from", "to"].includes(k)).length;
  const apply = () => {
    const next = new URLSearchParams(params.toString());
    FILTER_KEYS.forEach((k) => next.delete(k));
    next.set("range", "custom");
    for (const [k, v] of Object.entries(draft)) if (v) next.set(k, v);
    router.replace(`${pathname}?${next}`);
    setOpen(false);
  };
  return (
    <>
      <div className="journal-filter-bar sticky z-10 flex min-h-14 min-w-0 flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <h1 className="mr-auto min-w-0 text-base font-semibold tracking-tight">{title}</h1>
        {showFilters && (
          <>
            <AccountSelector />
            <div className="flex max-w-full shrink-0 items-center rounded-md border p-0.5">
              {["7d", "30d", "90d", "ytd", "all"].map((range) => (
                <Button
                  key={range}
                  variant={filters.range === range ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    const next = new URLSearchParams(params.toString());
                    next.set("range", range);
                    next.delete("from");
                    next.delete("to");
                    router.replace(`${pathname}?${next}`);
                  }}
                >
                  {range === "all" ? "All" : range.toUpperCase()}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(filters.values);
                setOpen(true);
              }}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters{count > 0 ? ` · ${count}` : ""}
            </Button>
          </>
        )}
        {actions && (
          <div className="journal-header-actions flex min-w-0 max-w-full flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Filter your journal</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Times use {filters.timeZone}. Dates use the closing day, or opening day for open trades.
            All selected conditions must match.
          </p>
          <FilterFields value={draft} onChange={setDraft} />
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setDraft({})}>
              Clear filters
            </Button>
            <Button onClick={apply}>Apply filters</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
