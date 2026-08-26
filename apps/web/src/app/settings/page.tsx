"use client";

import { Suspense, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postJson, useApi } from "@/lib/use-api";

interface SettingsPayload {
  timeZone: string;
  multipliers: Record<string, number>;
  aiConfigured: boolean;
  aiModel: string;
}

export default function SettingsPage() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const { data, refresh } = useApi<SettingsPayload>("/api/settings");
  const [timeZone, setTimeZone] = useState("");
  const [multipliers, setMultipliers] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setTimeZone(data.timeZone);
      setMultipliers(
        Object.entries(data.multipliers)
          .map(([symbol, multiplier]) => `${symbol}=${multiplier}`)
          .join("\n"),
      );
    }
  }, [data]);

  const save = async () => {
    const parsedMultipliers: Record<string, number> = {};
    for (const line of multipliers.split("\n")) {
      const [symbol, value] = line.split("=").map((part) => part.trim());
      if (symbol && value && Number.isFinite(Number(value))) {
        parsedMultipliers[symbol.toUpperCase()] = Number(value);
      }
    }
    await postJson("/api/settings", { timeZone, multipliers: parsedMultipliers }, "PATCH");
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    refresh();
  };

  return (
    <div>
      <FilterBar title="Settings" />
      <div className="mx-auto max-w-2xl space-y-3 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Journal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">
                Timezone (IANA) — your trading day is bucketed in this zone
              </Label>
              <Input
                value={timeZone}
                onChange={(event) => setTimeZone(event.target.value)}
                placeholder="America/New_York"
              />
              <button
                className="mt-1 text-xs text-muted-foreground underline"
                onClick={() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)}
              >
                Use this device's timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})
              </button>
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">
                Contract multipliers (futures/options) — one per line, SYMBOL=multiplier
              </Label>
              <textarea
                value={multipliers}
                onChange={(event) => setMultipliers(event.target.value)}
                placeholder={"ES=50\nNQ=20\nMES=5"}
                className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm"
              />
            </div>
            <Button onClick={save}>{saved ? "Saved ✓" : "Save"}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI (bring your own key)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Recaps, trade critiques, and “ask your journal” run against YOUR Anthropic API key,
              from YOUR machine. The key is encrypted at rest next to your data and never leaves
              this server except to call the model. Status:{" "}
              <span className={data?.aiConfigured ? "text-profit" : "text-muted-foreground"}>
                {data?.aiConfigured ? "configured" : "not configured"}
              </span>
            </p>
            <div className="flex gap-2">
              <Input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-ant-…"
                autoComplete="off"
              />
              <Button
                disabled={!apiKey}
                onClick={async () => {
                  await postJson("/api/settings", { anthropicKey: apiKey }, "PATCH");
                  setApiKey("");
                  refresh();
                }}
              >
                Save key
              </Button>
              {data?.aiConfigured && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    await postJson("/api/settings", { anthropicKey: null }, "PATCH");
                    refresh();
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your data</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <a href="/api/export" download="trade-journal-export.json">
              <Button variant="outline">
                <Download />
                Full backup (JSON)
              </Button>
            </a>
            <a href="/api/export?format=csv" download>
              <Button variant="outline">
                <Download />
                Trades (CSV)
              </Button>
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
