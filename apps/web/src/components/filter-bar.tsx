"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useApi } from "@/lib/use-api";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface AccountOption {
  id: string;
  name: string;
  archivedAt: string | null;
}

const RANGES = [
  { key: "7d", label: "7D", days: 7 },
  { key: "30d", label: "30D", days: 30 },
  { key: "90d", label: "90D", days: 90 },
  { key: "ytd", label: "YTD", days: null },
  { key: "all", label: "All", days: null },
] as const;

export interface Filters {
  accounts: string | null;
  from: string | null;
  to: string | null;
  range: string;
}

export const useFilters = (): Filters & { query: string } => {
  const params = useSearchParams();
  const accounts = params.get("accounts");
  const range = params.get("range") ?? "all";
  const { from, to } = useMemo(() => rangeToDates(range), [range]);
  const query = useMemo(() => {
    const search = new URLSearchParams();
    if (accounts) search.set("accounts", accounts);
    if (from) search.set("from", from);
    if (to) search.set("to", to);
    return search.toString();
  }, [accounts, from, to]);
  return { accounts, from, to, range, query };
};

const rangeToDates = (range: string): { from: string | null; to: string | null } => {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (range === "ytd") return { from: `${today.getUTCFullYear()}-01-01`, to: null };
  const preset = RANGES.find((r) => r.key === range);
  if (!preset?.days) return { from: null, to: null };
  const start = new Date(today.getTime() - preset.days * 86_400_000);
  return { from: iso(start), to: null };
};

/** One filter row above the content: account picker + date-range presets. */
export function FilterBar({ title, actions }: { title: string; actions?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data } = useApi<{ accounts: AccountOption[] }>("/api/accounts");
  const accounts = data?.accounts.filter((a) => !a.archivedAt) ?? [];

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
      router.replace(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const range = params.get("range") ?? "all";
  return (
    <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
      <h1 className="text-base font-semibold tracking-tight">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        {accounts.length > 0 && (
          <Select
            value={params.get("accounts") ?? "all"}
            onValueChange={(value) => setParam("accounts", value)}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="All accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center rounded-md border p-0.5">
          {RANGES.map((preset) => (
            <Button
              key={preset.key}
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 px-2.5 text-xs",
                range === preset.key && "bg-accent font-semibold",
              )}
              onClick={() => setParam("range", preset.key)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        {actions}
      </div>
    </div>
  );
}
