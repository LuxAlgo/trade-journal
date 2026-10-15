import { eq } from "drizzle-orm";
import { db, settings } from "@/db";
import { decryptJson, encryptJson } from "./crypto";
import { EMPTY_DEFAULTS, type JournalDefaults } from "@/lib/journal-defaults";
import { DEFAULT_CONVERSION, parseCurrencyConversion } from "@/lib/currencies";
import {
  AI_DEFAULT_MODELS,
  AI_KEY_ENV,
  isAiProvider,
  parseCustomBaseUrl,
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

export const aiKeyEnvironment = (provider: AiProvider): string | null =>
  process.env[AI_KEY_ENV[provider]]?.trim() || null;

export const customBaseUrlLocked = (): boolean => Boolean(process.env.CUSTOM_AI_BASE_URL?.trim());

/** Saved or environment OpenAI-compatible base URL. An invalid environment value is not replaced by a saved URL. */
export const readCustomBaseUrl = (): {
  url: string | null;
  source: "environment" | "saved" | null;
  invalid: boolean;
} => {
  const env = process.env.CUSTOM_AI_BASE_URL?.trim() ?? "";
  if (env) {
    const parsed = parseCustomBaseUrl(env);
    return parsed.ok
      ? { url: parsed.url, source: "environment", invalid: false }
      : { url: null, source: "environment", invalid: true };
  }
  const saved = getSetting("customBaseUrl")?.trim() ?? "";
  if (!saved) return { url: null, source: null, invalid: false };
  const parsed = parseCustomBaseUrl(saved);
  return parsed.ok
    ? { url: parsed.url, source: "saved", invalid: false }
    : { url: null, source: null, invalid: false };
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

export const getAiProvider = (): AiProvider => {
  const selected = getSetting("aiProvider");
  if (isAiProvider(selected)) return selected;
  // Preserve existing Anthropic setups; an OpenAI-only setup works without a UI visit.
  return !getAiKey("anthropic") && getAiKey("openai") ? "openai" : "anthropic";
};

export const aiModelSetting = (provider: AiProvider): string =>
  provider === "anthropic" ? "aiModel" : provider === "openai" ? "openaiModel" : "customModel";

export const getAiModel = (provider: AiProvider): string =>
  getSetting(aiModelSetting(provider))?.trim() || AI_DEFAULT_MODELS[provider];

export const getAiSettings = (): AiSettingsPayload => {
  const aiProvider = getAiProvider();
  const endpoint = readCustomBaseUrl();
  const connection = (provider: AiProvider) => {
    const key = Boolean(getAiKey(provider));
    const base = provider === "custom" ? endpoint : null;
    return {
      configured: provider === "custom" ? key && Boolean(base?.url) : key,
      source: aiKeyEnvironment(provider)
        ? ("environment" as const)
        : key
          ? ("saved" as const)
          : null,
      model: getAiModel(provider),
      ...(provider === "custom"
        ? {
            baseUrl: endpoint.url,
            baseUrlSource: endpoint.source,
            baseUrlInvalid: endpoint.invalid,
          }
        : {}),
    };
  };
  const aiConnections = {
    anthropic: connection("anthropic"),
    openai: connection("openai"),
    custom: connection("custom"),
  };
  return {
    aiProvider,
    aiConfigured: aiConnections[aiProvider].configured,
    aiModel: aiConnections[aiProvider].model,
    aiConnections,
  };
};
