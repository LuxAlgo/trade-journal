import { eq } from "drizzle-orm";
import { db, settings } from "@/db";
import { decryptJson, encryptJson } from "./crypto";
import { EMPTY_DEFAULTS, type JournalDefaults } from "@/lib/journal-defaults";
import { DEFAULT_CONVERSION, parseCurrencyConversion } from "@/lib/currencies";
import {
  AI_DEFAULT_MODELS,
  AI_KEY_VARIABLES,
  isAiProvider,
  type AiConnection,
  type AiProvider,
  type AiSettingsPayload,
} from "@/lib/ai-settings";

export const getJournalDefaults = (): JournalDefaults => {
  try {
    return { ...EMPTY_DEFAULTS, ...JSON.parse(getSetting("journalDefaults") ?? "{}") };
  } catch {
    return EMPTY_DEFAULTS;
  }
};

export const getSetting = (key: string): string | null =>
  db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;

export const setSetting = (key: string, value: string): void => {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
};

export const deleteSetting = (key: string): void => {
  db.delete(settings).where(eq(settings.key, key)).run();
};

export const getCurrencyConversion = () => {
  const saved = getSetting("currencyConversion");
  if (!saved) return DEFAULT_CONVERSION;
  // Invalid saved settings must not silently fall back to a different valuation.
  return parseCurrencyConversion(JSON.parse(saved));
};

/** Journal display timezone (IANA), default UTC. */
export const getTimeZone = (): string => getSetting("timeZone") ?? "UTC";

/** Preserve the legacy parsing default until a separate import zone is saved. */
export const getImportTimeZone = (): string => getSetting("importTimeZone") ?? getTimeZone();

/** Per-symbol contract multipliers for futures/options P&L. */
export const getMultipliers = (): Record<string, number> => {
  const raw = getSetting("multipliers");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
};

export const aiKeyEnvironment = (provider: AiProvider): string | null => {
  const variable = AI_KEY_VARIABLES[provider];
  return (variable && process.env[variable]?.trim()) || null;
};

/** Provider keys are stored separately and encrypted like broker credentials. */
export const getAiKey = (provider: AiProvider): string | null => {
  const environment = aiKeyEnvironment(provider);
  if (environment) return environment;
  const envelope = getSetting(`${provider}KeyEnc`);
  if (!envelope) return null;
  try {
    const key = decryptJson<unknown>(envelope);
    return typeof key === "string" ? key.trim() || null : null;
  } catch {
    return null;
  }
};

export const setAiKey = (provider: AiProvider, key: string | null): void => {
  if (key === null) deleteSetting(`${provider}KeyEnc`);
  else setSetting(`${provider}KeyEnc`, encryptJson(key.trim()));
};

export const getAnthropicKey = (): string | null => getAiKey("anthropic");
export const setAnthropicKey = (key: string | null): void => setAiKey("anthropic", key);

/** An http(s) API root without credentials, query or fragment, minus trailing slashes. */
export const normalizeAiBaseUrl = (value: string): string | null => {
  if (value.length > 2048 || /[?#]/.test(value)) return null;
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
};

export const getCompatibleBaseUrl = (): string | null => getSetting("compatibleBaseUrl");

/** A saved key belongs to the server it was entered for, so a new URL drops it. */
export const setCompatibleBaseUrl = (url: string, keepKey: boolean): void => {
  if (!keepKey && url !== getCompatibleBaseUrl()) setAiKey("compatible", null);
  setSetting("compatibleBaseUrl", url);
};

export const getAiProvider = (): AiProvider => {
  const selected = getSetting("aiProvider");
  if (isAiProvider(selected)) return selected;
  // Preserve existing Anthropic setups; an OpenAI-only setup works without a UI visit.
  return !getAiKey("anthropic") && getAiKey("openai") ? "openai" : "anthropic";
};

/** Anthropic keeps the legacy "aiModel" key; other providers use "<provider>Model". */
export const aiModelSetting = (provider: AiProvider): string =>
  provider === "anthropic" ? "aiModel" : `${provider}Model`;

export const getAiModel = (provider: AiProvider): string =>
  getSetting(aiModelSetting(provider))?.trim() || AI_DEFAULT_MODELS[provider];

/** Hosted providers need a key. A compatible server needs a URL and model; its key is optional. */
export const aiProviderConfigured = (provider: AiProvider): boolean =>
  provider === "compatible"
    ? Boolean(getCompatibleBaseUrl() && getAiModel(provider))
    : getAiKey(provider) !== null;

export const getAiSettings = (): AiSettingsPayload => {
  const aiProvider = getAiProvider();
  const connection = (provider: AiProvider): AiConnection => ({
    configured: aiProviderConfigured(provider),
    source: aiKeyEnvironment(provider)
      ? ("environment" as const)
      : getAiKey(provider)
        ? ("saved" as const)
        : null,
    model: getAiModel(provider),
    baseUrl: provider === "compatible" ? getCompatibleBaseUrl() : null,
  });
  const aiConnections = {
    anthropic: connection("anthropic"),
    openai: connection("openai"),
    compatible: connection("compatible"),
  };
  return {
    aiProvider,
    aiConfigured: aiConnections[aiProvider].configured,
    aiModel: aiConnections[aiProvider].model,
    aiConnections,
  };
};
