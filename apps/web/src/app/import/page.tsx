"use client";
import { MonetaryField } from "@/components/privacy";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Landmark, PencilLine } from "lucide-react";
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
import { fmtNumber } from "@/lib/utils";

interface BrokerInfo {
  id: string;
  displayName: string;
  credentials: { key: string; label: string; secret?: boolean }[];
  readOnlySetup: string;
}

interface AccountRow {
  id: string;
  name: string;
  kind: string;
  archivedAt: string | null;
}

interface PreviewTotals {
  executions: number;
  symbols: number;
  skippedRows: number;
  from: string | null;
  to: string | null;
}

interface PreviewResponse {
  detected: string | null;
  needsMapping?: boolean;
  headers?: string[];
  totals?: PreviewTotals;
  warnings?: string[];
  executions?: {
    symbol: string;
    side: string;
    quantity: number;
    price: number;
    executedAt: string;
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
            <ManualEntry />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/** Account picker used by every method; offers creating a new one inline. */
function AccountPicker({
  value,
  onChange,
  kind,
}: {
  value: string;
  onChange: (id: string) => void;
  kind: "import" | "manual";
}) {
  const { data, refresh } = useApi<{ accounts: AccountRow[] }>("/api/accounts");
  const accounts = data?.accounts.filter((account) => !account.archivedAt) ?? [];
  return (
    <div className="flex min-w-0 flex-wrap items-end gap-2">
      <div className="min-w-0 flex-[1_1_180px]">
        <Label className="mb-1 block text-xs text-muted-foreground">Into account</Label>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Choose an account" />
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
        variant="outline"
        onClick={async () => {
          const name = prompt("New account name");
          if (!name) return;
          const result = await postJson<{ id: string }>("/api/accounts", { name, kind });
          refresh();
          onChange(result.id);
        }}
      >
        New account
      </Button>
    </div>
  );
}

function FileImport() {
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { data: formatData } = useApi<{ formats: { id: string; label: string }[] }>("/api/import");

  const onFile = async (file: File) => {
    const text = await file.text();
    setContent(text);
    setFileName(file.name);
    setBusy(true);
    try {
      setPreview(
        await postJson<PreviewResponse>("/api/import", { mode: "preview", content: text }),
      );
    } finally {
      setBusy(false);
    }
  };

  const previewWithMapping = async () => {
    if (!content) return;
    setBusy(true);
    try {
      setPreview(
        await postJson<PreviewResponse>("/api/import", { mode: "preview", content, mapping }),
      );
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!content || !accountId) return;
    setBusy(true);
    try {
      const result = await postJson<{ inserted: number; duplicates: number }>("/api/import", {
        mode: "commit",
        content,
        accountId,
        mapping: preview?.needsMapping ? mapping : undefined,
      });
      alert(`Imported ${result.inserted} executions (${result.duplicates} duplicates skipped).`);
      router.push("/");
    } finally {
      setBusy(false);
    }
  };

  const mappingFields = ["symbol", "side", "quantity", "price", "fee", "timestamp"] as const;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Upload a statement or export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center hover:border-ring">
            <FileUp className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm">{fileName || "Drop or choose a CSV / HTML statement"}</span>
            <span className="text-xs text-muted-foreground">
              Auto-detected:{" "}
              {formatData?.formats.map((format) => format.label.split(" (")[0]).join(", ")} —
              anything else via column mapping.
            </span>
            <input
              type="file"
              accept=".csv,.txt,.htm,.html,.tsv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
          </label>

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
                    · {preview.totals.from.slice(0, 10)} → {preview.totals.to?.slice(0, 10)}
                  </span>
                )}
                {preview.totals.skippedRows > 0 && (
                  <span className="text-muted-foreground">
                    · {preview.totals.skippedRows} rows skipped
                  </span>
                )}
              </div>
              {preview.warnings?.map((warning, index) => (
                <p key={index} className="text-xs text-muted-foreground">
                  ⚠ {warning}
                </p>
              ))}
              <AccountPicker value={accountId} onChange={setAccountId} kind="import" />
              <Button onClick={commit} disabled={!accountId || busy}>
                {busy ? "Importing…" : "Import"}
              </Button>
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
      await postJson("/api/accounts", {
        name: name || broker.displayName,
        kind: "sync",
        broker: broker.id,
        credentials,
      });
      router.push("/");
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
              disabled={busy || broker.credentials.some((field) => !credentials[field.key])}
            >
              {busy ? "Connecting…" : "Connect & sync"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface ManualLeg {
  datetime: string;
  side: "buy" | "sell";
  quantity: string;
  price: string;
  fee: string;
}

function ManualEntry() {
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [symbol, setSymbol] = useState("");
  const [legs, setLegs] = useState<ManualLeg[]>([
    { datetime: "", side: "buy", quantity: "", price: "", fee: "" },
    { datetime: "", side: "sell", quantity: "", price: "", fee: "" },
  ]);
  const [busy, setBusy] = useState(false);

  const setLeg = (index: number, patch: Partial<ManualLeg>) =>
    setLegs((current) => current.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)));

  const valid =
    accountId &&
    symbol &&
    legs.some((leg) => leg.datetime && Number(leg.quantity) > 0 && leg.price !== "");

  const save = async () => {
    setBusy(true);
    try {
      await postJson("/api/executions", {
        accountId,
        executions: legs
          .filter((leg) => leg.datetime && Number(leg.quantity) > 0 && leg.price !== "")
          .map((leg) => ({
            symbol,
            side: leg.side,
            quantity: Number(leg.quantity),
            price: Number(leg.price),
            fee: leg.fee === "" ? 0 : Number(leg.fee),
            executedAt: new Date(leg.datetime).toISOString(),
          })),
      });
      router.push("/trades");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add executions manually</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <AccountPicker value={accountId} onChange={setAccountId} kind="manual" />
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">Symbol</Label>
          <Input
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            placeholder="AAPL, ESZ6, BTCUSDT…"
          />
        </div>
        <div className="manual-executions space-y-3">
          {legs.map((leg, index) => (
            <fieldset
              key={index}
              className="manual-execution-row grid min-w-0 gap-2 rounded-lg border p-3"
            >
              <legend className="px-1 text-xs text-muted-foreground">Execution {index + 1}</legend>
              <label className="manual-execution-date grid min-w-0 gap-1 text-xs text-muted-foreground">
                Date & time
                <Input
                  type="datetime-local"
                  value={leg.datetime}
                  onChange={(event) => setLeg(index, { datetime: event.target.value })}
                />
              </label>
              <div className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                <span id={`execution-side-${index}`}>Side</span>
                <Select
                  value={leg.side}
                  onValueChange={(value) => setLeg(index, { side: value as "buy" | "sell" })}
                >
                  <SelectTrigger aria-labelledby={`execution-side-${index}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">Buy</SelectItem>
                    <SelectItem value="sell">Sell</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                Quantity
                <Input
                  placeholder="qty"
                  inputMode="decimal"
                  value={leg.quantity}
                  onChange={(event) => setLeg(index, { quantity: event.target.value })}
                />
              </label>
              <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                Price
                <MonetaryField>
                  <Input
                    placeholder="price"
                    inputMode="decimal"
                    value={leg.price}
                    onChange={(event) => setLeg(index, { price: event.target.value })}
                  />
                </MonetaryField>
              </label>
              <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                Fee
                <MonetaryField>
                  <Input
                    placeholder="fee"
                    inputMode="decimal"
                    value={leg.fee}
                    onChange={(event) => setLeg(index, { fee: event.target.value })}
                  />
                </MonetaryField>
              </label>
            </fieldset>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setLegs((current) => [
                ...current,
                { datetime: "", side: "sell", quantity: "", price: "", fee: "" },
              ])
            }
          >
            Add execution
          </Button>
          <Button size="sm" onClick={save} disabled={!valid || busy}>
            {busy ? "Saving…" : "Save trade"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Executions matching an open position on {symbol || "the symbol"} are stitched into round
          trips automatically ({fmtNumber(legs.filter((leg) => leg.datetime).length, 0)} legs so
          far).
        </p>
      </CardContent>
    </Card>
  );
}
