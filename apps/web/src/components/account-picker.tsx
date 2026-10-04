"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { formatApiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/lib/use-api";
import { AccountCreateForm } from "./account-create-form";

interface AccountRow {
  id: string;
  name: string;
  kind: string;
  archivedAt: string | null;
}

/** Account picker used by every method; offers creating a new one inline. */
export function AccountPicker({
  value,
  onChange,
  kind,
}: {
  value: string;
  onChange: (id: string) => void;
  kind: "import" | "manual";
}) {
  const t = useTranslations("accounts");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const {
    data,
    refresh,
    error: accountError,
    errorInfo: accountErrorInfo,
  } = useApi<{ accounts: AccountRow[] }>("/api/accounts");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<AccountRow[]>([]);
  const fieldId = useId();
  const accounts = [
    ...(data?.accounts ?? []),
    ...created.filter((item) => !data?.accounts.some((row) => row.id === item.id)),
  ].filter((account) => !account.archivedAt);
  return (
    <div className="flex min-w-0 flex-wrap items-end gap-2">
      <div className="min-w-0 flex-[1_1_180px]">
        <Label htmlFor={`${fieldId}-account`} className="mb-1 block text-xs text-muted-foreground">
          {t("intoAccount")}
        </Label>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={`${fieldId}-account`}>
            <SelectValue placeholder={t("chooseAccount")} />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        variant="outline"
        aria-expanded={creating}
        disabled={saving}
        onClick={() => setCreating(!creating)}
      >
        {creating ? t("cancelNewAccount") : t("newAccount")}
      </Button>
      {accountError && (
        <p role="alert" className="w-full text-sm text-destructive">
          {formatApiError(tErrors, accountErrorInfo ?? accountError)}
        </p>
      )}
      {creating && (
        <AccountCreateForm
          kind={kind}
          onSavingChange={setSaving}
          className="w-full space-y-3 rounded-lg border p-4"
          onCreated={(account) => {
            setCreated((current) => [...current, account]);
            onChange(account.id);
            refresh();
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
