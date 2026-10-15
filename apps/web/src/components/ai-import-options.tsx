"use client";
import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Settings2, X } from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { HelpHint } from "./ui/tooltip";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { OptionSelect } from "./ui/option-select";
import {
  AI_DEFAULT_MODELS,
  AI_PROVIDERS,
  type AiSettingsPayload,
  type AiProvider,
} from "@/lib/ai-settings";
import { type AiImportOptions as Options } from "@/lib/ai-import";
import { fill } from "@/lib/messages";
import { useI18n } from "./locale";

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
  const { text, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const connection = settings?.aiConnections[value.provider];
  const name = text.ai.providers[value.provider];
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
          {text.ai.importToggle}
        </Label>
        <HelpHint heading={text.ai.importHeading}>{text.ai.importHelp}</HelpHint>
        {enabled && (
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={text.ai.importSettings}
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
          aria-label={text.ai.importSettings}
          className="z-50 w-[360px] max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">{text.ai.importSettings}</span>
            <Popover.Close
              aria-label={text.ai.importClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            >
              <X className="size-4" />
            </Popover.Close>
          </div>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="import-ai-provider">{text.ai.provider}</Label>
                <OptionSelect
                  id="import-ai-provider"
                  value={value.provider}
                  disabled={disabled}
                  onValueChange={(provider) => {
                    const next = provider as AiProvider;
                    onChange({
                      provider: next,
                      model: settings?.aiConnections[next]?.model ?? AI_DEFAULT_MODELS[next],
                      apiKey: "",
                      baseUrl:
                        next === "custom" ? (settings?.aiConnections.custom?.baseUrl ?? "") : "",
                    });
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
                <Label htmlFor="import-ai-model">{text.ai.model}</Label>
                <Input
                  id="import-ai-model"
                  value={value.model}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...value, model: e.target.value })}
                  placeholder={AI_DEFAULT_MODELS[value.provider]}
                />
              </div>
            </div>
            {value.provider === "custom" && (
              <div className="space-y-1">
                <Label htmlFor="import-ai-base-url">{text.ai.baseUrl}</Label>
                <Input
                  id="import-ai-base-url"
                  value={value.baseUrl ?? ""}
                  disabled={disabled || connection?.baseUrlSource === "environment"}
                  placeholder={text.ai.baseUrlPlaceholder}
                  spellCheck={false}
                  onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{text.ai.baseUrlHelp}</p>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="import-ai-key">{fill(text.ai.key, { name })}</Label>
              <Input
                id="import-ai-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={value.apiKey ?? ""}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
                placeholder={
                  connection?.configured || connection?.source
                    ? text.ai.importKeyBlank
                    : text.ai.importKeyEnter
                }
              />
              <p className="text-xs text-muted-foreground">
                {text.ai.importKeyNote}{" "}
                <a href="/settings#ai-settings" className="underline">
                  {text.nav.settings}
                </a>
                {locale === "zh" ? "。" : "."}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">{fill(text.ai.importSend, { name })}</p>
            <p className="text-xs text-muted-foreground">{text.ai.importLimits}</p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
