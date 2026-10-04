"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { MAX_CSV_BYTES, type MarketCsvDataset } from "@/lib/market-csv";
import { RESOLUTIONS, type MarketBar, type Resolution } from "@/lib/market-data";
import { postJson, useApi } from "@/lib/use-api";
import { formatApiError } from "@/lib/api-error";
import { decodeImportFile } from "@/lib/decode-import";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { OptionSelect } from "./ui/option-select";
import { MonetaryValue } from "./privacy";
interface Preview {
  count: number;
  from: string;
  to: string;
  sample: MarketBar[];
}
export function MarketCsvSettings({ onChange }: { onChange: () => void }) {
  const t = useTranslations("settings.csv");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const {
    data,
    refresh,
    error: listError,
    errorInfo: listErrorInfo,
  } = useApi<{ datasets: MarketCsvDataset[] }>("/api/market-data/csv");
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [symbol, setSymbol] = useState("");
  const [resolution, setResolution] = useState<Resolution | "">("");
  const [currency, setCurrency] = useState("");
  const [priceBasis, setPriceBasis] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const change = () => {
    setPreview(null);
    setMessage("");
    setError("");
  };
  const basisLabel = (basis: string) => {
    const key = (
      {
        raw: "basisRaw",
        split: "basisSplit",
        adjusted: "basisAdjusted",
        midpoint: "basisMidpoint",
        bid: "basisBid",
        ask: "basisAsk",
      } as Record<string, string>
    )[basis];
    return key ? t(key) : basis;
  };
  const act = async (action: "preview" | "import" | "remove", id?: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = await postJson<Preview>("/api/market-data/csv", {
        action,
        id,
        ...file,
        symbol,
        resolution,
        currency,
        priceBasis,
      });
      if (action === "preview") setPreview(body);
      else {
        setPreview(null);
        setMessage(action === "import" ? t("imported") : t("removed"));
        refresh();
        onChange();
      }
    } catch (cause) {
      setError(cause instanceof Error ? formatApiError(t, cause) : t("requestFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 rounded-lg border p-3" id="market-csv">
      <h3 className="text-sm font-medium">{t("title")}</h3>
      <p className="text-xs text-muted-foreground">{t("intro")}</p>
      <a className="text-xs underline" href="/market-data-template.csv" download>
        {t("templateLink")}
      </a>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="candle-file">{t("candleFile")}</Label>
          <Input
            id="candle-file"
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            disabled={busy}
            onChange={async (event) => {
              const selected = event.target.files?.[0];
              change();
              setFile(null);
              if (!selected) return;
              if (selected.size > MAX_CSV_BYTES) {
                setError(t("fileTooLarge"));
                return;
              }
              setBusy(true);
              try {
                setFile({
                  name: selected.name,
                  content: decodeImportFile(await selected.arrayBuffer()),
                });
              } catch {
                setError(t("readFailed"));
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="candle-symbol">{t("symbol")}</Label>
          <Input
            id="candle-symbol"
            value={symbol}
            disabled={busy}
            placeholder={t("symbolPlaceholder")}
            onChange={(event) => {
              change();
              setSymbol(event.target.value.trim());
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="candle-resolution">{t("resolution")}</Label>
          <OptionSelect
            id="candle-resolution"
            value={resolution}
            disabled={busy}
            onValueChange={(value) => {
              change();
              setResolution(value as Resolution);
            }}
          >
            <option value="" disabled>
              {t("resolutionPlaceholder")}
            </option>
            {Object.keys(RESOLUTIONS).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </OptionSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="candle-currency">{t("quoteCurrency")}</Label>
          <Input
            id="candle-currency"
            value={currency}
            disabled={busy}
            maxLength={12}
            onChange={(event) => {
              change();
              setCurrency(event.target.value.toUpperCase());
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="candle-basis">{t("priceBasis")}</Label>
          <OptionSelect
            id="candle-basis"
            value={priceBasis}
            disabled={busy}
            onValueChange={(value) => {
              change();
              setPriceBasis(value);
            }}
          >
            <option value="" disabled>
              {t("basisPlaceholder")}
            </option>
            <option value="raw">{t("basisRaw")}</option>
            <option value="split">{t("basisSplit")}</option>
            <option value="adjusted">{t("basisAdjusted")}</option>
            <option value="midpoint">{t("basisMidpoint")}</option>
            <option value="bid">{t("basisBid")}</option>
            <option value="ask">{t("basisAsk")}</option>
          </OptionSelect>
        </div>
      </div>
      <Button
        variant="outline"
        disabled={busy || !file || !symbol || !currency || !resolution || !priceBasis}
        onClick={() => void act("preview")}
      >
        {t("validate")}
      </Button>
      {preview && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-xs">
            {t("previewSummary", { count: preview.count, from: preview.from, to: preview.to })}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="text-left">{t("firstCandles")}</caption>
              <thead>
                <tr>
                  {/* Machine column names from the CSV contract: kept in en. */}
                  {["Time", "Open", "High", "Low", "Close"].map((label) => (
                    <th key={label} className="p-2">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((bar) => (
                  <tr key={bar.time}>
                    <td className="p-2">{new Date(bar.time).toISOString()}</td>
                    {[bar.open, bar.high, bar.low, bar.close].map((value, index) => (
                      <td key={index} className="p-2">
                        <MonetaryValue>{value}</MonetaryValue>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button disabled={busy} onClick={() => void act("import")}>
            {t("importCandles")}
          </Button>
        </div>
      )}
      {(error || listError) && (
        <p role="alert" className="text-xs text-destructive">
          {error || formatApiError(tErrors, listErrorInfo ?? listError)}
        </p>
      )}
      {message && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
      {data?.datasets.map((dataset) => (
        <div
          key={dataset.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
        >
          <div className="min-w-0 text-xs">
            <p className="break-all font-medium">
              {dataset.name} · {dataset.symbol} · {dataset.resolution}
            </p>
            <p className="text-muted-foreground">
              {t("datasetSummary", {
                count: dataset.count,
                currency: dataset.currency,
                basis: basisLabel(dataset.priceBasis),
                from: dataset.from.slice(0, 10),
                to: dataset.to.slice(0, 10),
              })}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void act("remove", dataset.id)}
          >
            {t("removeDataset")}
          </Button>
        </div>
      ))}
    </div>
  );
}
