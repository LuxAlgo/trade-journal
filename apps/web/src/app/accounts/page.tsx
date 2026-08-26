"use client";

import { Suspense, useState } from "react";
import { Archive, ArchiveRestore, RefreshCw, Trash2 } from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { postJson, useApi } from "@/lib/use-api";
import { fmtMoney } from "@/lib/utils";

interface AccountRow {
  id: string;
  name: string;
  broker: string;
  kind: "sync" | "import" | "manual";
  currency: string;
  initialBalance: number;
  profitCalcMethod: "fifo" | "lifo" | "wavg";
  autoSync: boolean;
  lastSyncAt: string | null;
  archivedAt: string | null;
  connected: boolean;
  snapshot: { equity: number; positions: unknown[] } | null;
}

export default function AccountsPage() {
  return (
    <Suspense>
      <Accounts />
    </Suspense>
  );
}

function Accounts() {
  const { data, refresh } = useApi<{ accounts: AccountRow[] }>("/api/accounts");
  const [syncing, setSyncing] = useState<string | null>(null);

  const action = async (id: string, body: Record<string, unknown>) => {
    await postJson(`/api/accounts/${id}/actions`, body);
    refresh();
  };

  const sync = async (id: string) => {
    setSyncing(id);
    try {
      await action(id, { action: "sync" });
    } catch (error) {
      alert(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div>
      <FilterBar title="Accounts" />
      <div className="grid gap-3 p-4 md:grid-cols-2">
        {data?.accounts.length === 0 && (
          <p className="col-span-full py-16 text-center text-sm text-muted-foreground">
            No accounts yet — create one on the Import page.
          </p>
        )}
        {data?.accounts.map((account) => (
          <Card key={account.id} className={account.archivedAt ? "opacity-60" : undefined}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
                {account.name}
                <Badge variant="secondary">{account.kind}</Badge>
                {account.broker && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {account.broker}
                  </span>
                )}
              </CardTitle>
              <div className="flex items-center gap-1">
                {account.kind === "sync" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={syncing === account.id}
                    onClick={() => void sync(account.id)}
                    title="Sync now"
                  >
                    <RefreshCw className={syncing === account.id ? "animate-spin" : undefined} />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title={account.archivedAt ? "Unarchive" : "Archive"}
                  onClick={() =>
                    void action(account.id, {
                      action: account.archivedAt ? "unarchive" : "archive",
                    })
                  }
                >
                  {account.archivedAt ? <ArchiveRestore /> : <Archive />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  title="Delete account"
                  onClick={async () => {
                    if (
                      confirm(`Delete "${account.name}" and ALL its trades? This cannot be undone.`)
                    ) {
                      await postJson(`/api/accounts/${account.id}`, undefined, "DELETE");
                      refresh();
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {account.snapshot && (
                <div className="text-sm">
                  Broker equity:{" "}
                  <span className="tnum font-medium">{fmtMoney(account.snapshot.equity)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {account.snapshot.positions.length} open positions · synced{" "}
                    {account.lastSyncAt?.slice(0, 16).replace("T", " ")}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">
                    Initial balance (anchors drawdown %)
                  </label>
                  <Input
                    defaultValue={account.initialBalance || ""}
                    placeholder="0"
                    inputMode="decimal"
                    onBlur={async (event) => {
                      const value = Number(event.target.value || 0);
                      if (value !== account.initialBalance) {
                        await postJson(
                          `/api/accounts/${account.id}`,
                          { initialBalance: value },
                          "PATCH",
                        );
                        refresh();
                      }
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Profit calculation</label>
                  <Select
                    value={account.profitCalcMethod}
                    onValueChange={async (value) => {
                      await postJson(
                        `/api/accounts/${account.id}`,
                        { profitCalcMethod: value },
                        "PATCH",
                      );
                      refresh();
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fifo">FIFO</SelectItem>
                      <SelectItem value="lifo">LIFO</SelectItem>
                      <SelectItem value="wavg">Weighted average</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (confirm(`Clear ALL trades from "${account.name}"? The account stays.`)) {
                      await action(account.id, { action: "clear" });
                    }
                  }}
                >
                  Clear trades
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const others = data.accounts.filter((candidate) => candidate.id !== account.id);
                    if (others.length === 0) return alert("No other account to transfer into.");
                    const target = prompt(
                      `Transfer all data into which account?\n${others.map((candidate, index) => `${index + 1}. ${candidate.name}`).join("\n")}\n\nEnter a number:`,
                    );
                    const chosen = others[Number(target) - 1];
                    if (chosen)
                      await action(account.id, { action: "transfer", toAccountId: chosen.id });
                  }}
                >
                  Transfer data
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
