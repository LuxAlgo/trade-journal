"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Landmark, PencilLine } from "lucide-react";
import { AccountPicker } from "@/components/account-picker";
import { ManualTradeEntry } from "@/components/manual-trade-entry";
import { FilterBar } from "@/components/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { postJson, useApi } from "@/lib/use-api";
import { decodeImportFile } from "@/lib/decode-import";
import { formatTimestamp, isTimeZone } from "@/lib/timezone";
import { dayKeyOf } from "@luxalgo/journal-core";
import { ImportReconciliation } from "@/components/import-reconciliation";
import type { ImportReview, ImportReviewOptions } from "@/lib/import-review";
import { TimeZonePicker } from "@/components/timezone-picker";
import { AiImportOptions } from "@/components/ai-import-options";
import { AI_DEFAULT_MODELS, type AiSettingsPayload } from "@/lib/ai-settings";
import {
  AI_IMPORT_MAX_BYTES,
  AI_IMPORT_MAX_TEXT,
  type AiImportOptions as AiOptions,
} from "@/lib/ai-import";
import { Checkbox } from "@/components/ui/checkbox";

interface BrokerInfo {
  id: string;
  displayName: string;
  credentials: { key: string; label: string; secret?: boolean }[];
  readOnlySetup: string;
}

interface PreviewTotals {
  executions: number;
  symbols: number;
  skippedRows: number;
  from: string | null;
  to: string | null;
}

interface PreviewResponse {
  aiPreviewToken?: string;
  sources?: string[];
  reconciliation?: ImportReview;
  detected: string | null;
  timeZone: string;
  needsMapping?: boolean;
  headers?: string[];
  totals?: PreviewTotals;
  warnings?: string[];
  errors?: string[];
  needsSymbol?: boolean;
  executions?: {
    symbol: string;
    side: string;
    quantity: number;
    price: number;
    fee?: number;
    executedAt: string;
    importMetadata?: { position?: { direction: "long" | "short"; effect: "open" | "close" } };
  }[];
}

export default function ImportPage() {
  return (
    <Suspense>
      <ImportView />
    </Suspense>
  );
}

function ImportView() {
  const router = useRouter();
  return (
    <div>
      <FilterBar title="Import trades" />
      <div className="mx-auto max-w-3xl p-4">
        <Tabs defaultValue="file">
          <TabsList>
            <TabsTrigger value="file" className="max-sm:px-2 max-sm:text-xs">
              <FileUp className="mr-1.5 hidden h-4 w-4 min-[420px]:block" />
              File upload
            </TabsTrigger>
            <TabsTrigger value="sync" className="max-sm:px-2 max-sm:text-xs">
              <Landmark className="mr-1.5 hidden h-4 w-4 min-[420px]:block" />
              Broker sync
            </TabsTrigger>
            <TabsTrigger value="manual" className="max-sm:px-2 max-sm:text-xs">
              <PencilLine className="mr-1.5 hidden h-4 w-4 min-[420px]:block" />
              Manual
            </TabsTrigger>
          </TabsList>
          <TabsContent value="file">
            <FileImport />
          </TabsContent>
          <TabsContent value="sync">
            <BrokerConnect />
          </TabsContent>
          <TabsContent value="manual">
            <Card>
              <CardHeader>
                <CardTitle>Add executions manually</CardTitle>
              </CardHeader>
              <CardContent>
                <ManualTradeEntry onSaved={() => router.push("/trades")} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function FileImport() {
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [reviewOptions, setReviewOptions] = useState<ImportReviewOptions>({});
  const changeReview = (options: ImportReviewOptions) => {
    setReviewOptions(options);
    setPreview((current) =>
      current
        ? {
            ...current,
            reconciliation: current.reconciliation
              ? { ...current.reconciliation, token: null }
              : undefined,
          }
        : null,
    );
  };
  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [mappingApplied, setMappingApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiOptions, setAiOptions] = useState<AiOptions>({
    provider: "openai",
    model: AI_DEFAULT_MODELS.openai,
    apiKey: "",
  });
  const [encoding, setEncoding] = useState<"text" | "pdf">("text");
  const [aiReviewed, setAiReviewed] = useState(false);
  const { data: formatData } = useApi<{ formats: { id: string; label: string }[] }>("/api/import");
  const { data: settingsData, error: settingsError } = useApi<
    AiSettingsPayload & {
      timeZone: string;
      importTimeZone: string;
    }
  >("/api/settings");
  const [statementTimeZone, setStatementTimeZone] = useState<string | null>(null);
  const timeZone = statementTimeZone ?? settingsData?.importTimeZone ?? "";
  const validTimeZone = isTimeZone(timeZone);
  const displayTimeZone = settingsData?.timeZone ?? "UTC";
  const aiReady = Boolean(
    aiOptions.model.trim() &&
    (aiOptions.apiKey?.trim() || settingsData?.aiConnections[aiOptions.provider].configured),
  );
  const invalidateAiPreview = () => {
    setPreview(null);
    setAiReviewed(false);
    setError(null);
  };

  const onFile = async (file: File) => {
    if (!validTimeZone) return;
    setStatementTimeZone(timeZone);
    setPreview(null);
    setAiReviewed(false);
    setContent(null);
    setFileName(file.name);
    setReviewOptions({});
    setSymbol("");
    setMapping({});
    setMappingApplied(false);
    setError(null);
    setBusy(true);
    try {
      const pdf = /\.pdf$/i.test(file.name);
      if (pdf && !aiEnabled) throw new Error("Enable AI parsing to upload a PDF statement.");
      if (aiEnabled && file.size > AI_IMPORT_MAX_BYTES)
        throw new Error("AI uploads must be 8 MB or smaller.");
      if (aiEnabled && !/\.(csv|tsv|txt|html?|xml|pdf)$/i.test(file.name))
        throw new Error(
          "Choose a CSV, TSV, HTML, XML, TXT or PDF file. Export spreadsheets as CSV first.",
        );
      const buffer = await file.arrayBuffer();
      let text: string;
      if (pdf) {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        text = btoa(binary);
      } else {
        text = decodeImportFile(buffer);
        if (aiEnabled && text.length > AI_IMPORT_MAX_TEXT)
          throw new Error(
            "Use a smaller export: AI text parsing supports up to 150,000 characters.",
          );
      }
      setEncoding(pdf ? "pdf" : "text");
      setContent(text);
      // Choosing a file alone never sends it to an AI provider.
      if (aiEnabled) return;
      setPreview(
        await postJson<PreviewResponse>("/api/import", {
          mode: "preview",
          content: text,
          accountId: accountId || undefined,
          review: {},
          fileName: file.name,
          timeZone,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import preview failed");
    } finally {
      setBusy(false);
    }
  };

  const previewFile = async () => {
    if (!content || !validTimeZone || (aiEnabled && !aiReady)) return;
    setPreview(null);
    setAiReviewed(false);
    setBusy(true);
    setError(null);
    try {
      setPreview(
        await postJson<PreviewResponse>("/api/import", {
          mode: "preview",
          content,
          accountId: accountId || undefined,
          review: reviewOptions,
          fileName,
          symbol,
          timeZone,
          encoding,
          ...(aiEnabled ? { ai: aiOptions } : {}),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import preview failed");
    } finally {
      setBusy(false);
    }
  };

  const previewWithMapping = async () => {
    if (!content || !validTimeZone) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(
        await postJson<PreviewResponse>("/api/import", {
          mode: "preview",
          content,
          mapping,
          timeZone,
        }),
      );
      setMappingApplied(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import preview failed");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!content || !accountId || !preview) return;
    setBusy(true);
    try {
      const result = await postJson<{
        inserted: number;
        duplicates: number;
        corrected?: number;
        skipped?: number;
        warnings?: string[];
      }>("/api/import", {
        mode: "commit",
        review: { ...reviewOptions, previewToken: preview.reconciliation?.token ?? undefined },
        content,
        accountId,
        mapping: mappingApplied ? mapping : undefined,
        fileName,
        symbol,
        // Commit with the exact parsing zone used by the reviewed preview.
        timeZone: preview.timeZone,
        ...(preview.aiPreviewToken
          ? {
              ai: { provider: aiOptions.provider, model: aiOptions.model },
              encoding,
              aiPreviewToken: preview.aiPreviewToken,
              aiReviewed,
            }
          : {}),
      });
      const skippedNote =
        result.skipped && result.skipped > 0
          ? ` ${result.skipped} invalid rows were skipped: ${(result.warnings ?? []).at(-1) ?? ""}`
          : "";
      alert(
        `Imported ${result.inserted} executions (${result.duplicates} duplicates skipped, ${result.corrected ?? 0} fee corrections).${skippedNote}`,
      );
      router.push(`/?accounts=${encodeURIComponent(accountId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const mappingFields = ["symbol", "side", "quantity", "price", "fee", "timestamp"] as const;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>Upload a statement or export</CardTitle>
          <AiImportOptions
            enabled={aiEnabled}
            onEnabledChange={(enabled) => {
              setAiEnabled(enabled);
              invalidateAiPreview();
              setContent(null);
              setFileName("");
              setMappingApplied(false);
            }}
            value={aiOptions}
            onChange={(options) => {
              setAiOptions(options);
              invalidateAiPreview();
            }}
            settings={settingsData ?? undefined}
            disabled={busy}
          />
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label
              htmlFor="statement-timezone"
              className="mb-1 block text-xs text-muted-foreground"
            >
              Statement timezone (IANA)
            </Label>
            <TimeZonePicker
              id="statement-timezone"
              label="Statement timezone"
              value={timeZone}
              disabled={busy || !settingsData}
              describedBy="statement-timezone-help"
              onValueChange={(zone) => {
                setStatementTimeZone(zone);
                setPreview(null);
                setAiReviewed(false);
                setMappingApplied(false);
              }}
            />
            <p id="statement-timezone-help" className="mt-1 text-xs text-muted-foreground">
              Choose the timezone used by your broker's statement. Timestamps with an explicit
              offset keep that offset. Your journal displays times in {displayTimeZone}.
            </p>
            {timeZone && !validTimeZone && (
              <p role="alert" className="mt-1 text-xs text-loss">
                Enter a valid IANA timezone, such as Europe/Helsinki.
              </p>
            )}
            {settingsError && (
              <p role="alert" className="mt-1 text-xs text-loss">
                {settingsError}
              </p>
            )}
          </div>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center hover:border-ring">
            <FileUp className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm">
              {fileName ||
                (aiEnabled
                  ? "Choose a statement for AI parsing"
                  : "Choose a CSV / HTML / XML statement")}
            </span>
            <span className="text-xs text-muted-foreground">
              {aiEnabled ? (
                "CSV, TSV, HTML, XML, TXT or PDF. Your file stays local until you preview with AI."
              ) : (
                <>
                  Auto-detected:{" "}
                  {formatData?.formats.map((format) => format.label.split(" (")[0]).join(", ")} —
                  anything else via column mapping.
                </>
              )}
            </span>
            <input
              type="file"
              accept={
                aiEnabled ? ".csv,.txt,.htm,.html,.tsv,.xml,.pdf" : ".csv,.txt,.htm,.html,.tsv,.xml"
              }
              disabled={busy || !settingsData || !validTimeZone}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
                event.target.value = "";
              }}
            />
          </label>
          {content && !preview && (
            <Button
              onClick={previewFile}
              disabled={busy || !validTimeZone || (aiEnabled && !aiReady)}
              variant={aiEnabled ? "default" : "outline"}
            >
              {busy
                ? aiEnabled
                  ? "AI is reading your statement…"
                  : "Reading…"
                : aiEnabled
                  ? "Preview with AI"
                  : "Preview file"}
            </Button>
          )}

          {error && (
            <p role="alert" className="text-sm text-loss">
              {error}
            </p>
          )}
          {preview?.needsSymbol && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 text-xs text-muted-foreground">
                Symbol
                <Input
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                  placeholder="AAPL, EURUSD…"
                  className="mt-1"
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={previewFile}
                disabled={busy || !symbol.trim()}
              >
                Preview
              </Button>
            </div>
          )}
          {preview?.needsMapping && preview.headers && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm">
                Format not recognized — map your columns (nothing is guessed silently):
              </p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {mappingFields.map((field) => (
                  <div key={field}>
                    <Label className="mb-1 block text-xs capitalize text-muted-foreground">
                      {field}
                      {field === "fee" ? " (optional)" : ""}
                    </Label>
                    <Select
                      value={mapping[field] ?? "none"}
                      onValueChange={(value) =>
                        setMapping((m) => ({ ...m, [field]: value === "none" ? "" : value }))
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="column" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {preview.headers!.map((header) => (
                          <SelectItem key={header} value={header}>
                            {header}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <details className="space-y-2 text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  Position identity and ordering (optional)
                </summary>
                <p className="text-muted-foreground">
                  For Open/Close Long/Short rows, map source position IDs, execution IDs or sequence
                  numbers when available. Columns named Position ID, Execution ID, Fill ID and
                  Sequence are recognized automatically. An order ID is not an execution ID.
                </p>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {(["positionId", "executionId", "sequence"] as const).map((field) => (
                    <div key={field}>
                      <Label className="mb-1 block text-xs capitalize text-muted-foreground">
                        {
                          {
                            positionId: "Position ID",
                            executionId: "Execution ID",
                            sequence: "Sequence",
                          }[field]
                        }
                      </Label>
                      <Select
                        value={mapping[field] || "none"}
                        onValueChange={(value) =>
                          setMapping((m) => ({ ...m, [field]: value === "none" ? "" : value }))
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="column" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {preview.headers!.map((header) => (
                            <SelectItem key={header} value={header}>
                              {header}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </details>
              <Button
                size="sm"
                onClick={previewWithMapping}
                disabled={
                  busy ||
                  !mapping.symbol ||
                  !mapping.side ||
                  !mapping.quantity ||
                  !mapping.price ||
                  !mapping.timestamp
                }
              >
                Preview with mapping
              </Button>
            </div>
          )}

          {preview && !preview.needsMapping && preview.totals && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{preview.detected}</Badge>
                <span>{preview.totals.executions} executions</span>
                <span className="text-muted-foreground">· {preview.totals.symbols} symbols</span>
                {preview.totals.from && (
                  <span className="text-muted-foreground">
                    · {dayKeyOf(preview.totals.from, displayTimeZone)} →{" "}
                    {preview.totals.to && dayKeyOf(preview.totals.to, displayTimeZone)}
                  </span>
                )}
                {preview.totals.skippedRows > 0 && (
                  <span className="text-muted-foreground">
                    · {preview.totals.skippedRows} rows skipped
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Statement timezone: {preview.timeZone}. Preview times: {displayTimeZone}.
              </p>
              {!!preview.executions?.length && (
                <div className="space-y-1 border-t pt-2 text-xs">
                  <div
                    className={
                      preview.aiPreviewToken ? "max-h-80 space-y-2 overflow-auto" : "space-y-1"
                    }
                  >
                    {(preview.aiPreviewToken
                      ? preview.executions
                      : preview.executions.slice(0, 5)
                    ).map((execution, index) => (
                      <div key={index}>
                        <div className="flex flex-wrap gap-x-3">
                          <span>
                            {execution.symbol} ·{" "}
                            {execution.importMetadata?.position
                              ? `${execution.importMetadata.position.effect} ${execution.importMetadata.position.direction}`.toUpperCase()
                              : execution.side.toUpperCase()}
                          </span>
                          <span className="text-muted-foreground">
                            {formatTimestamp(execution.executedAt, displayTimeZone)}
                          </span>
                          {preview.aiPreviewToken && (
                            <span>
                              {execution.quantity} @ {execution.price} · Fees {execution.fee}
                            </span>
                          )}
                        </div>
                        {preview.aiPreviewToken && preview.sources?.[index] && (
                          <p className="mt-0.5 text-muted-foreground">
                            Source: {preview.sources[index]}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  {!preview.aiPreviewToken && preview.totals.executions > 5 && (
                    <p className="text-muted-foreground">Showing the first 5 executions.</p>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {preview.detected === "ninjatrader"
                  ? "Recovering an older NinjaTrader import or correcting its timezone? Import the complete history into a new journal account, then compare totals. Keep the original account and its reviews until you have verified the recovery."
                  : "Correcting a previous import? Remove the affected trades before importing again with a different timezone to avoid duplicates. Back up your data first."}
              </p>
              {preview.warnings?.map((warning, index) => (
                <p key={index} className="text-xs text-muted-foreground">
                  ⚠ {warning}
                </p>
              ))}
              {!preview.needsSymbol &&
                preview.errors?.map((message, index) => (
                  <p key={index} role="alert" className="text-xs text-loss">
                    {message}
                  </p>
                ))}
              <fieldset disabled={busy}>
                <AccountPicker
                  value={accountId}
                  onChange={(id) => {
                    setAccountId(id);
                    setReviewOptions({});
                    setPreview((current) =>
                      current ? { ...current, reconciliation: undefined } : null,
                    );
                  }}
                  kind="import"
                />
              </fieldset>
              {preview.detected === "ninjatrader" && accountId && (
                <ImportReconciliation
                  review={preview.reconciliation}
                  options={reviewOptions}
                  onChange={changeReview}
                  onReview={previewFile}
                  busy={busy}
                />
              )}
              <Button
                onClick={commit}
                disabled={
                  !accountId ||
                  busy ||
                  !!preview.errors?.length ||
                  !preview.totals.executions ||
                  (Boolean(preview.aiPreviewToken) && !aiReviewed) ||
                  (preview.detected === "ninjatrader" && !preview.reconciliation?.token)
                }
              >
                {busy ? "Importing…" : "Import"}
              </Button>
              {preview.aiPreviewToken && (
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={aiReviewed}
                    disabled={busy}
                    onCheckedChange={(checked) => setAiReviewed(checked === true)}
                  />
                  I compared all extracted executions with my statement, including the account,
                  quantities, prices, fees and timestamps. Import this preview.
                </label>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BrokerConnect() {
  const router = useRouter();
  const { data } = useApi<{ brokers: BrokerInfo[] }>("/api/brokers");
  const { data: settingsData, error: settingsError } = useApi<{ importTimeZone: string }>(
    "/api/settings",
  );
  const [brokerId, setBrokerId] = useState("");
  const [name, setName] = useState("");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const broker = data?.brokers.find((b) => b.id === brokerId) ?? null;

  const connect = async () => {
    if (!broker) return;
    setBusy(true);
    setError(null);
    try {
      const created = await postJson<{
        id: string;
        sync: { skipped: number; skippedReasons: string[] };
      }>("/api/accounts", {
        name: name || broker.displayName,
        kind: "sync",
        broker: broker.id,
        credentials,
      });
      if (created.sync.skipped > 0) {
        alert(
          `${created.sync.skipped} broker record(s) were skipped: ${created.sync.skippedReasons.join(" ")}`,
        );
      }
      router.push(`/?accounts=${encodeURIComponent(created.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect a broker (read-only keys, stored encrypted on YOUR machine)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">Broker / exchange</Label>
          <Select
            value={brokerId}
            onValueChange={(value) => {
              setBrokerId(value);
              setCredentials({});
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a broker" />
            </SelectTrigger>
            <SelectContent>
              {data?.brokers.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {broker && (
          <>
            <p className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
              {broker.readOnlySetup}
            </p>
            {broker.id === "ibkr-flex" && (
              <p className="text-xs text-muted-foreground">
                {settingsError
                  ? "Could not load the import timezone. Refresh and try again."
                  : settingsData
                    ? `Statement timezone: ${settingsData.importTimeZone}. Used for Flex timestamps without an offset. Change it in Settings → Journal before connecting.`
                    : "Loading statement timezone…"}
              </p>
            )}
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Account name</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={broker.displayName}
              />
            </div>
            {broker.credentials.map((field) => (
              <div key={field.key}>
                <Label className="mb-1 block text-xs text-muted-foreground">{field.label}</Label>
                <Input
                  aria-label={field.label}
                  type={field.secret ? "password" : "text"}
                  value={credentials[field.key] ?? ""}
                  onChange={(event) =>
                    setCredentials((c) => ({ ...c, [field.key]: event.target.value }))
                  }
                  autoComplete="off"
                />
              </div>
            ))}
            {error && <p className="text-sm text-loss">{error}</p>}
            <Button
              onClick={connect}
              disabled={
                busy ||
                broker.credentials.some(
                  (field) => !/optional/i.test(field.label) && !credentials[field.key]?.trim(),
                ) ||
                (broker.id === "ibkr-flex" && !isTimeZone(settingsData?.importTimeZone))
              }
            >
              {busy ? "Connecting…" : "Connect & sync"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
