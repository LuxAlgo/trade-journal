"use client";
import { createElement, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Settings2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Checkbox } from "./ui/checkbox";
import { HelpHint } from "./ui/tooltip";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { OptionSelect } from "./ui/option-select";
import {
  AI_DEFAULT_MODELS,
  AI_PROVIDER_NAMES,
  type AiSettingsPayload,
  type AiProvider,
} from "@/lib/ai-settings";
import type { AiImportOptions as Options } from "@/lib/ai-import";

export function AiImportOptions({
  enabled,
  onEnabledChange,
  value,
  onChange,
  settings,
  disabled,
}: {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  value: Options;
  onChange: (value: Options) => void;
  settings?: AiSettingsPayload;
  disabled: boolean;
}) {
  const t = useTranslations("import.ai");
  const [open, setOpen] = useState(false);
  const connection = settings?.aiConnections[value.provider];
  return (
    <Popover.Root open={open && enabled} onOpenChange={setOpen}>
      <div className="flex shrink-0 items-center gap-1.5">
        <Checkbox
          id="ai-import-enabled"
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(checked) => {
            onEnabledChange(checked === true);
            setOpen(checked === true);
          }}
        />
        <Label
          htmlFor="ai-import-enabled"
          className="flex cursor-pointer items-center gap-1.5 text-xs font-normal text-muted-foreground"
        >
          {t("enabledLabel")}
        </Label>
        <HelpHint heading={t("helpHeading")}>{t("help")}</HelpHint>
        {enabled && (
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={t("settingsAria")}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Settings2 className="size-3.5" />
            </button>
          </Popover.Trigger>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label={t("settingsAria")}
          className="z-50 w-[360px] max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">{t("settingsTitle")}</span>
            <Popover.Close
              aria-label={t("closeAria")}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            >
              <X className="size-4" />
            </Popover.Close>
          </div>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="import-ai-provider">{t("provider")}</Label>
                <OptionSelect
                  id="import-ai-provider"
                  value={value.provider}
                  disabled={disabled}
                  onValueChange={(provider) => {
                    const next = provider as AiProvider;
                    onChange({
                      provider: next,
                      model: settings?.aiConnections[next].model ?? AI_DEFAULT_MODELS[next],
                      apiKey: "",
                    });
                  }}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </OptionSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="import-ai-model">{t("model")}</Label>
                <Input
                  id="import-ai-model"
                  value={value.model}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...value, model: e.target.value })}
                  placeholder={AI_DEFAULT_MODELS[value.provider]}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="import-ai-key">
                {t("apiKey", { provider: AI_PROVIDER_NAMES[value.provider] })}
              </Label>
              <Input
                id="import-ai-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={value.apiKey ?? ""}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
                placeholder={
                  connection?.configured ? t("keyConfiguredPlaceholder") : t("keyPlaceholder")
                }
              />
              <p className="text-xs text-muted-foreground">
                {t.rich("sessionKeyNote", {
                  a: (chunks) =>
                    createElement(
                      "a",
                      { href: "/settings#ai-settings", className: "underline" },
                      chunks,
                    ),
                })}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t.rich("sendNotice", {
                provider: AI_PROVIDER_NAMES[value.provider],
                strong: (chunks) => createElement("strong", null, chunks),
              })}
            </p>
            <p className="text-xs text-muted-foreground">{t("limits")}</p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
