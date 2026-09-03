"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FlaskConical, WalletCards } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select";
import { postJson, useApi } from "@/lib/use-api";

interface AccountOption {
  id: string;
  name: string;
  broker: string;
  archivedAt: string | null;
}

/** Quick account switching; the full Filters panel still supports multiple accounts. */
export function AccountSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data, error, refresh } = useApi<{ accounts: AccountOption[] }>("/api/accounts?summary=1");
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [demoError, setDemoError] = useState("");
  const selected = params.get("accounts")?.split(",").filter(Boolean) ?? [];
  const accounts = data?.accounts.filter((a) => !a.archivedAt || selected.includes(a.id)) ?? [];
  const demo = accounts.find((a) => a.broker === "demo");
  const value = selected.length > 1 ? "multiple" : (selected[0] ?? "all");
  const label =
    selected.length > 1
      ? `${selected.length} accounts`
      : (accounts.find((a) => a.id === selected[0])?.name ??
        (selected.length ? "Selected account" : "All accounts"));

  function selectAccount(id: string) {
    const next = new URLSearchParams(params.toString());
    if (id === "all") next.delete("accounts");
    else next.set("accounts", id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  async function select(value: string) {
    setDemoError("");
    if (value !== "load-demo") return selectAccount(value);
    setLoadingDemo(true);
    try {
      const result = await postJson<{ accountId: string }>("/api/demo", {});
      refresh();
      selectAccount(result.accountId);
    } catch (cause) {
      setDemoError(cause instanceof Error ? cause.message : "Could not load demo data.");
    } finally {
      setLoadingDemo(false);
    }
  }

  return (
    <div className="relative min-w-0 max-w-full">
      <Select value={value} onValueChange={(value) => void select(value)} disabled={loadingDemo}>
        <SelectTrigger
          aria-label="Select account"
          className="h-8 w-44 max-w-full rounded-lg text-xs"
        >
          <WalletCards className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">
            {loadingDemo ? "Loading demo…" : label}
          </span>
        </SelectTrigger>
        <SelectContent className="rounded-2xl border-white/10 p-1 shadow-2xl" align="end">
          <SelectItem value="all" className="rounded-lg text-xs">
            All accounts
          </SelectItem>
          {selected.length > 1 && (
            <SelectItem value="multiple" disabled className="text-xs">
              {label}
            </SelectItem>
          )}
          {accounts
            .filter((a) => a.broker !== "demo")
            .map((account) => (
              <SelectItem key={account.id} value={account.id} className="rounded-lg text-xs">
                <span className="block max-w-64 truncate">
                  {account.name}
                  {account.archivedAt ? " (archived)" : ""}
                </span>
              </SelectItem>
            ))}
          <div className="my-1 border-t" />
          <SelectItem value={demo?.id ?? "load-demo"} className="rounded-lg text-xs">
            <span className="flex items-center gap-2">
              <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
              {demo?.name ?? "Load demo data"}
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      {(demoError || error) && (
        <p role="alert" className="max-w-64 pt-1 text-xs text-destructive">
          {demoError || error}
        </p>
      )}
    </div>
  );
}
