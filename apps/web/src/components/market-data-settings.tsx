"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useApi, postJson } from "@/lib/use-api";
import { formatApiError } from "@/lib/api-error";
import type { MarketConnection } from "@/lib/market-data";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { OptionSelect } from "./ui/option-select";
import { providerDisplayKeys, providerInfo } from "@/lib/market-providers";
import { MarketCsvSettings } from "./market-csv-settings";

export function MarketDataSettings() {
  const t = useTranslations("settings.marketData");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const { data, error, errorInfo, refresh } = useApi<{ connections: MarketConnection[] }>(
    "/api/market-data/connections",
  );
  return (
    <Card id="market-data" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {formatApiError(tErrors, errorInfo ?? error)}
          </p>
        )}
        {!data && !error && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
        {data?.connections
          .filter((connection) => connection.id !== "market-csv")
          .map((connection) => (
            <Connection key={connection.id} connection={connection} refresh={refresh} />
          ))}
        <MarketCsvSettings onChange={refresh} />
      </CardContent>
    </Card>
  );
}

function Connection({
  connection,
  refresh,
}: {
  connection: MarketConnection;
  refresh: () => void;
}) {
  const t = useTranslations("settings.marketData");
  // Display keys resolve in settings.marketData.providers; unknown entries
  // fall back to the provider's English field label (docs/i18n.md §7 pattern).
  const tProvider = useTranslations("settings.marketData.providers");
  const info = providerInfo(connection.id)!;
  const display = providerDisplayKeys[connection.id];
  const fieldLabel = (field: { key: string; label: string }) => {
    const key = display?.fieldLabels[field.key];
    return key ? tProvider(key) : field.label;
  };
  const fieldOptionLabel = (fieldKey: string, value: string, label: string) => {
    const key = display?.fieldOptionLabels[fieldKey]?.[value];
    return key ? tProvider(key) : label;
  };
  const defaults = () =>
    Object.fromEntries(info.fields.map((field) => [field.key, field.defaultValue ?? ""]));
  const [fields, setFields] = useState<Record<string, string>>(defaults);
  const publicSource = info.mode === "public";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const managed = connection.source === "environment";
  const act = async (action: "save" | "remove" | "test" | "enable") => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await postJson("/api/market-data/connections", {
        provider: connection.id,
        action,
        ...(action === "save" ? { credentials: fields } : {}),
      });
      setFields(defaults());
      setMessage(
        action === "test"
          ? publicSource
            ? t("testPublic")
            : t("testVerified")
          : action === "save"
            ? t("savedMessage")
            : action === "enable"
              ? t("enabledMessage")
              : t("removedMessage"),
      );
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? formatApiError(t, cause) : t("updateFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{connection.name}</h3>
        <span className="text-xs text-muted-foreground">
          {managed
            ? t("managed")
            : connection.configured
              ? publicSource
                ? t("enabledNoKey")
                : t("credentialsSaved")
              : t("notConnected")}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {display ? tProvider(display.description) : info.description}
      </p>
      {!publicSource && <p className="text-xs text-muted-foreground">{t("credentialsNote")}</p>}
      {managed && !connection.configured && (
        <p className="text-xs text-destructive">{t("envIncomplete")}</p>
      )}
      {!managed &&
        !publicSource &&
        info.fields.map((field) => (
          <div key={field.key} className="space-y-1">
            <Label htmlFor={`key-${connection.id}-${field.key}`}>{fieldLabel(field)}</Label>
            {field.options ? (
              <OptionSelect
                id={`key-${connection.id}-${field.key}`}
                value={fields[field.key] ?? ""}
                disabled={busy}
                onValueChange={(value) =>
                  setFields((current) => ({ ...current, [field.key]: value }))
                }
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {fieldOptionLabel(field.key, option.value, option.label)}
                  </option>
                ))}
              </OptionSelect>
            ) : (
              <Input
                id={`key-${connection.id}-${field.key}`}
                type="password"
                value={fields[field.key] ?? ""}
                onChange={(event) =>
                  setFields((current) => ({ ...current, [field.key]: event.target.value }))
                }
                placeholder={
                  connection.configured
                    ? t("enterReplacement", { field: fieldLabel(field).toLowerCase() })
                    : t("enterValue", { field: fieldLabel(field).toLowerCase() })
                }
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
            )}
          </div>
        ))}
      <div className="flex flex-wrap gap-2">
        {!managed && !publicSource && (
          <Button
            disabled={busy || info.fields.some((field) => !fields[field.key]?.trim())}
            onClick={() => void act("save")}
          >
            {t("saveCredentials")}
          </Button>
        )}
        {publicSource && !connection.configured && (
          <Button disabled={busy} onClick={() => void act("enable")}>
            {t("enableSource")}
          </Button>
        )}
        {connection.configured && (
          <Button variant="outline" disabled={busy} onClick={() => void act("test")}>
            {t("testConnection")}
          </Button>
        )}
        {connection.configured && !managed && (
          <Button variant="outline" disabled={busy} onClick={() => void act("remove")}>
            {publicSource ? t("disableSource") : t("removeCredentials")}
          </Button>
        )}
      </div>
      {message && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
