"use client";

import { useEffect, useState } from "react";
import {
  AI_DEFAULT_MODELS,
  AI_KEY_ENV,
  AI_PROVIDERS,
  type AiProvider,
  type AiSettingsPayload,
} from "@/lib/ai-settings";
import { fill } from "@/lib/messages";
import { useI18n } from "./locale";
import { postJson, useApi } from "@/lib/use-api";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { OptionSelect } from "./ui/option-select";

export function AiSettings() {
  const { text } = useI18n();
  const { data, error, loading, refresh } = useApi<AiSettingsPayload>("/api/settings");
  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [model, setModel] = useState(AI_DEFAULT_MODELS.anthropic);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!data) return;
    setProvider(data.aiProvider);
    setModel(data.aiModel);
    setBaseUrl(data.aiConnections.custom.baseUrl ?? "");
  }, [data]);

  const connection = data?.aiConnections[provider];
  const environment = connection?.source === "environment";
  const baseLocked = provider === "custom" && connection?.baseUrlSource === "environment";
  const name = text.ai.providers[provider];
  const disabled = busy || loading || !data;
  const keyReady = Boolean(
    apiKey.trim() || connection?.configured || (provider === "custom" && connection?.source),
  );
  const endpointReady =
    provider !== "custom" || (baseLocked ? Boolean(connection?.baseUrl) : Boolean(baseUrl.trim()));

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
              ...(provider === "custom" && !baseLocked ? { customBaseUrl: baseUrl.trim() } : {}),
              ...(apiKey.trim() ? { [`${provider}Key`]: apiKey.trim() } : {}),
            },
        "PATCH",
      );
      setApiKey("");
      setSaved(fill(remove ? text.ai.removed : text.ai.saved, { name }));
      refresh();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : text.ai.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="ai-settings" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{text.ai.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{text.ai.intro}</p>
        {data && (
          <p className="text-xs text-muted-foreground">
            {fill(text.ai.active, {
              name: text.ai.providers[data.aiProvider],
              state: data.aiConfigured ? text.ai.configured : text.ai.notConfigured,
            })}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ai-provider">{text.ai.provider}</Label>
            <OptionSelect
              id="ai-provider"
              value={provider}
              disabled={disabled}
              onValueChange={(value) => {
                const next = value as AiProvider;
                setProvider(next);
                setModel(data?.aiConnections[next].model ?? AI_DEFAULT_MODELS[next]);
                if (next === "custom") setBaseUrl(data?.aiConnections.custom.baseUrl ?? "");
                setApiKey("");
                setSaved("");
                setFailure("");
              }}
            >
              {AI_PROVIDERS.map((id) => (
                <option key={id} value={id}>
                  {text.ai.providers[id]}
                </option>
              ))}
            </OptionSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ai-model">{text.ai.model}</Label>
            <Input
              id="ai-model"
              value={model}
              disabled={disabled}
              placeholder={AI_DEFAULT_MODELS[provider] || "deepseek-chat"}
              onChange={(event) => {
                setModel(event.target.value);
                setSaved("");
              }}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {provider === "custom" ? text.ai.customModelHelp : text.ai.modelHelp}
        </p>
        {provider === "custom" && (
          <div className="space-y-1">
            <Label htmlFor="ai-base-url">{text.ai.baseUrl}</Label>
            <Input
              id="ai-base-url"
              value={baseUrl}
              disabled={disabled || baseLocked}
              placeholder={text.ai.baseUrlPlaceholder}
              spellCheck={false}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                setSaved("");
              }}
            />
            <p className="text-xs text-muted-foreground">
              {connection?.baseUrlInvalid
                ? text.ai.baseUrlInvalid
                : baseLocked
                  ? text.ai.baseUrlEnv
                  : text.ai.baseUrlHelp}
            </p>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="ai-api-key">{fill(text.ai.key, { name })}</Label>
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
              connection?.configured || connection?.source
                ? text.ai.keyConfigured
                : provider === "anthropic"
                  ? text.ai.keyAnthropic
                  : provider === "openai"
                    ? text.ai.keyOpenAI
                    : text.ai.keyCustom
            }
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            {environment
              ? fill(text.ai.keyEnv, { variable: AI_KEY_ENV[provider] })
              : connection?.source
                ? text.ai.keyKeep
                : text.ai.keyAdd}
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
            disabled={disabled || !model.trim() || !keyReady || !endpointReady}
            onClick={() => save()}
          >
            {busy ? text.ai.saving : text.ai.save}
          </Button>
          {connection?.source === "saved" && (
            <Button variant="outline" disabled={disabled} onClick={() => save(true)}>
              {fill(text.ai.remove, { name })}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
