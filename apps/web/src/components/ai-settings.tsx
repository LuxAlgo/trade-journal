"use client";

import { useEffect, useState } from "react";
import {
  AI_DEFAULT_MODELS,
  AI_PROVIDER_NAMES,
  AI_PROVIDERS,
  type AiProvider,
  type AiSettingsPayload,
} from "@/lib/ai-settings";
import { postJson, useApi } from "@/lib/use-api";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { OptionSelect } from "./ui/option-select";

export function AiSettings() {
  const { data, error, loading, refresh } = useApi<AiSettingsPayload>("/api/settings");
  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [model, setModel] = useState(AI_DEFAULT_MODELS.anthropic);
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!data) return;
    setProvider(data.aiProvider);
    setModel(data.aiModel);
    setBaseURL(data.aiConnections.compatible.baseURL ?? "");
  }, [data]);

  const connection = data?.aiConnections[provider];
  const environment = connection?.source === "environment";
  const name = AI_PROVIDER_NAMES[provider];
  const disabled = busy || loading || !data;

  const save = async (remove = false) => {
    setBusy(true);
    setFailure("");
    setSaved("");
    try {
      await postJson(
        "/api/settings",
        remove
          ? {
              [`${provider}Key`]: null,
            }
          : {
              aiProvider: provider,
              aiModel: model.trim(),
              ...(provider === "compatible" ? { compatibleBaseURL: baseURL.trim() } : {}),
              ...(apiKey.trim() ? { [`${provider}Key`]: apiKey.trim() } : {}),
            },
        "PATCH",
      );
      setApiKey("");
      setSaved(remove ? `${name} key removed.` : `${name} settings saved.`);
      refresh();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Couldn’t save AI settings.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="ai-settings" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>AI (bring your own key)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Use Anthropic, OpenAI, or an OpenAI-compatible service for recaps, trade critiques, and
          “ask your journal”. Your key is encrypted at rest. AI requests go from your server
          directly to the provider you select.
        </p>
        {data && (
          <p className="text-xs text-muted-foreground">
            Active provider: {AI_PROVIDER_NAMES[data.aiProvider]} ·{" "}
            {data.aiConfigured ? "Key configured" : "Not configured"}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ai-provider">Provider</Label>
            <OptionSelect
              id="ai-provider"
              value={provider}
              disabled={disabled}
              onValueChange={(value) => {
                const next = value as AiProvider;
                setProvider(next);
                setBaseURL(data?.aiConnections.compatible.baseURL ?? "");
                setModel(data?.aiConnections[next].model ?? AI_DEFAULT_MODELS[next]);
                setApiKey("");
                setSaved("");
                setFailure("");
              }}
            >
              {AI_PROVIDERS.map((id) => (
                <option key={id} value={id}>
                  {AI_PROVIDER_NAMES[id]}
                </option>
              ))}
            </OptionSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ai-model">Model ID</Label>
            <Input
              id="ai-model"
              value={model}
              disabled={disabled}
              placeholder={AI_DEFAULT_MODELS[provider]}
              onChange={(event) => {
                setModel(event.target.value);
                setSaved("");
              }}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Use a text model available to your provider account. Each provider keeps its own model and
          key.
        </p>
        {provider === "compatible" && (
          <div className="space-y-1">
            <Label htmlFor="ai-base-url">Base URL</Label>
            <Input
              id="ai-base-url"
              value={baseURL}
              disabled={disabled}
              placeholder="https://your-provider.example/v1"
              onChange={(event) => {
                setBaseURL(event.target.value);
                setSaved("");
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Enter the API base address, without /chat/completions. Your key and journal context
              will be sent to this service using Chat Completions.
            </p>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="ai-api-key">{name} API key</Label>
          <Input
            id="ai-api-key"
            type="password"
            value={apiKey}
            disabled={disabled || environment}
            onChange={(event) => {
              setApiKey(event.target.value);
              setSaved("");
            }}
            placeholder={
              connection?.configured
                ? "Key configured"
                : provider === "anthropic"
                  ? "sk-ant-…"
                  : "sk-…"
            }
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            {environment
              ? `Using ${provider === "compatible" ? "COMPATIBLE_API_KEY" : provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} from the server environment. Change or remove that variable on the server to update the key.`
              : connection?.configured
                ? "Leave blank to keep your saved key, or enter a replacement."
                : "Add your API key, then save to use this provider."}
          </p>
        </div>
        {(error || failure) && (
          <p role="alert" className="text-xs text-destructive">
            {failure || error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-xs text-profit">
            {saved}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              disabled ||
              !model.trim() ||
              (provider === "compatible" && !baseURL.trim()) ||
              (!apiKey.trim() && !connection?.configured)
            }
            onClick={() => save()}
          >
            {busy ? "Saving…" : "Save AI settings"}
          </Button>
          {connection?.source === "saved" && (
            <Button variant="outline" disabled={disabled} onClick={() => save(true)}>
              Remove {name} key
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
