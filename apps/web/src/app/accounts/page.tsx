"use client";

import { Suspense, useState } from "react";
import { Archive, ArchiveRestore, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { AccountCreateForm } from "@/components/account-create-form";
import { FilterBar } from "@/components/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { postJson, useApi } from "@/lib/use-api";
import { formatApiError } from "@/lib/api-error";
import { fmtMoney } from "@/lib/utils";
import { formatLocale, type Locale } from "@/i18n/config";
import { MonetaryValue, MonetaryField } from "@/components/privacy";

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
  const t = useTranslations("accounts");
  const tEnums = useTranslations("enums");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const locale = useLocale();
  const { data, refresh } = useApi<{ accounts: AccountRow[] }>("/api/accounts");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const kindLabels: Record<AccountRow["kind"], string> = {
    sync: t("badgeSync"),
    import: t("badgeImport"),
    manual: t("badgeManual"),
  };

  const action = async <T = unknown,>(id: string, body: Record<string, unknown>) => {
    const result = await postJson<T>(`/api/accounts/${id}/actions`, body);
    refresh();
    return result;
  };

  const sync = async (id: string) => {
    setSyncing(id);
    try {
      const { sync: outcome } = await action<{
        sync: { inserted: number; skipped: number; skippedReasons: string[] };
      }>(id, { action: "sync" });
      if (outcome.skipped > 0)
        alert(
          t("syncResult", {
            inserted: outcome.inserted,
            count: outcome.skipped,
            reasons: outcome.skippedReasons.join(" "),
          }),
        );
    } catch (error) {
      alert(error instanceof Error ? formatApiError(tErrors, error) : t("syncFailed"));
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div>
      <FilterBar
        title={t("title")}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            {t("newAccount")}
          </Button>
        }
      />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("newAccount")}</DialogTitle>
            <DialogDescription>{t("newAccountDescription")}</DialogDescription>
          </DialogHeader>
          <AccountCreateForm
            showTitle={false}
            onCreated={() => {
              refresh();
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>
      <div className="grid gap-3 p-4 md:grid-cols-2">
        {data?.accounts.length === 0 && (
          <p className="col-span-full py-16 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        )}
        {data?.accounts.map((account) => (
          <Card key={account.id} className={account.archivedAt ? "opacity-60" : undefined}>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="min-w-0 flex-1 text-base font-semibold normal-case tracking-normal text-foreground">
                <span className="block break-words">{account.name}</span>
                <Badge variant="secondary" className="mt-1.5 mr-2">
                  {kindLabels[account.kind] ?? account.kind}
                </Badge>
                {account.broker && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {account.broker}
                  </span>
                )}
              </CardTitle>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                {account.kind === "sync" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={syncing === account.id}
                    onClick={() => void sync(account.id)}
                    title={t("syncNow")}
                  >
                    <RefreshCw className={syncing === account.id ? "animate-spin" : undefined} />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title={account.archivedAt ? t("unarchive") : t("archive")}
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
                  title={t("deleteAccount")}
                  onClick={async () => {
                    if (confirm(t("deleteConfirm", { name: account.name }))) {
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
                  {t("brokerEquity")}{" "}
                  <span className="tnum font-medium">
                    <MonetaryValue>
                      {fmtMoney(account.snapshot.equity, "USD", formatLocale(locale as Locale))}
                    </MonetaryValue>
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t("snapshotSummary", {
                      count: account.snapshot.positions.length,
                      time: account.lastSyncAt?.slice(0, 16).replace("T", " ") ?? "",
                    })}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {t("initialBalance")}
                  </label>
                  <MonetaryField>
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
                  </MonetaryField>
                </div>
                <div className="min-w-0">
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {t("profitCalculation")}
                  </label>
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
                      <SelectItem value="fifo">{tEnums("costBasis.fifo")}</SelectItem>
                      <SelectItem value="lifo">{tEnums("costBasis.lifo")}</SelectItem>
                      <SelectItem value="wavg">{tEnums("costBasis.wavg")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (confirm(t("clearConfirm", { name: account.name }))) {
                      await action(account.id, { action: "clear" });
                    }
                  }}
                >
                  {t("clearTrades")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const others = data.accounts.filter((candidate) => candidate.id !== account.id);
                    if (others.length === 0) return alert(t("noTransferTarget"));
                    const target = prompt(
                      t("transferPrompt", {
                        options: others
                          .map((candidate, index) => `${index + 1}. ${candidate.name}`)
                          .join("\n"),
                      }),
                    );
                    const chosen = others[Number(target) - 1];
                    if (chosen) {
                      try {
                        await action(account.id, { action: "transfer", toAccountId: chosen.id });
                      } catch (error) {
                        alert(
                          error instanceof Error
                            ? formatApiError(tErrors, error)
                            : t("transferFailed"),
                        );
                      }
                    }
                  }}
                >
                  {t("transferData")}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
