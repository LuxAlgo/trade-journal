"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CurrencyPicker } from "./currency-picker";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  DEFAULT_CONVERSION,
  currencyName,
  parseCurrencyConversion,
  type CurrencyConversion,
} from "@/lib/currencies";
import { postJson, useApi } from "@/lib/use-api";
import { formatApiError } from "@/lib/api-error";
import { formatLocale, type Locale } from "@/i18n/config";

export function CurrencySettings() {
  const t = useTranslations("settings.currency");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const locale = useLocale() as Locale;
  const {
    data: settingsData,
    error: settingsError,
    errorInfo: settingsErrorInfo,
    refresh: settingsRefresh,
  } = useApi<{
    currencyConversion: CurrencyConversion;
  }>("/api/settings");
  const {
    data: accountsData,
    error: accountsError,
    errorInfo: accountsErrorInfo,
  } = useApi<{ accounts: { currency: string }[] }>("/api/accounts");
  const [enabled, setEnabled] = useState(false);
  const [reportingCurrency, setReportingCurrency] = useState(DEFAULT_CONVERSION.reportingCurrency);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!settingsData) return;
    const config = settingsData.currencyConversion;
    setEnabled(config.enabled);
    setReportingCurrency(config.reportingCurrency);
    setRates(
      Object.fromEntries(Object.entries(config.rates).map(([code, rate]) => [code, String(rate)])),
    );
  }, [settingsData]);
  const currencies = [
    ...new Set([
      reportingCurrency,
      ...(accountsData?.accounts.map((account) => account.currency) ?? []),
      ...Object.keys(rates),
    ]),
  ].sort();
  const dirty = () => {
    setSaved(false);
    setError("");
  };
  const save = async () => {
    setError("");
    setSaved(false);
    try {
      const parsedRates = Object.fromEntries(
        Object.entries(rates)
          .filter(([code, value]) => code !== reportingCurrency && value.trim() !== "")
          .map(([code, value]) => [code, Number(value)]),
      );
      const config = parseCurrencyConversion({ enabled, reportingCurrency, rates: parsedRates });
      const missing = currencies.filter(
        (code) => code !== reportingCurrency && !config.rates[code],
      );
      if (enabled && missing.length)
        throw new Error(t("missingRate", { currencies: missing.join(", ") }));
      setBusy(true);
      await postJson("/api/settings", { currencyConversion: config }, "PATCH");
      setSaved(true);
      settingsRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? formatApiError(t, cause) : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card id="currency-conversion" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        <fieldset disabled={busy || !settingsData || !accountsData} className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
                dirty();
              }}
            />
            {t("enable")}
          </label>
          <div className="space-y-1">
            <Label htmlFor="reporting-currency">{t("reporting")}</Label>
            <CurrencyPicker
              id="reporting-currency"
              value={reportingCurrency}
              extraCodes={currencies}
              onChange={(code) => {
                setReportingCurrency(code);
                setRates({});
                dirty();
              }}
            />
            <p className="text-xs text-muted-foreground">{t("reportingHelp")}</p>
          </div>
          <div className="space-y-3">
            {currencies.map((code) => (
              <div key={code} className="space-y-1">
                <Label htmlFor={`conversion-${code}`}>{currencyName(code, locale)}</Label>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="tnum">{t("oneEquals", { code })}</span>
                  <Input
                    id={`conversion-${code}`}
                    type="number"
                    step="any"
                    min="0"
                    className="w-40"
                    aria-label={t("perUnit", { code })}
                    value={code === reportingCurrency ? "1" : (rates[code] ?? "")}
                    disabled={code === reportingCurrency}
                    onChange={(event) => {
                      setRates((current) => ({ ...current, [code]: event.target.value }));
                      dirty();
                    }}
                  />
                  <span>{reportingCurrency}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("fixedNote")}</p>
          <Button onClick={save} disabled={busy}>
            {busy ? t("saving") : t("save")}
          </Button>
        </fieldset>
        {(error || settingsError || accountsError) && (
          <p role="alert" className="text-sm text-destructive">
            {error ||
              (settingsError
                ? formatApiError(tErrors, settingsErrorInfo ?? settingsError)
                : accountsError
                  ? formatApiError(tErrors, accountsErrorInfo ?? accountsError)
                  : "")}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("saved")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
