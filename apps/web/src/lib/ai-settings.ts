export const AI_PROVIDERS = ["anthropic", "openai", "custom"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-4.1-mini",
  custom: "",
};

export const AI_PROVIDER_NAMES: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  custom: "Custom",
};

export const AI_KEY_ENV: Record<AiProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  custom: "CUSTOM_AI_API_KEY",
};

export interface AiConnection {
  configured: boolean;
  source: "environment" | "saved" | null;
  model: string;
  /** Present for the custom OpenAI-compatible endpoint. */
  baseUrl?: string | null;
  baseUrlSource?: "environment" | "saved" | null;
  baseUrlInvalid?: boolean;
}

export interface AiSettingsPayload {
  aiProvider: AiProvider;
  aiConfigured: boolean;
  aiModel: string;
  aiConnections: Record<AiProvider, AiConnection>;
}

export const isAiProvider = (value: unknown): value is AiProvider =>
  value === "anthropic" || value === "openai" || value === "custom";

export type BaseUrlResult = { ok: true; url: string } | { ok: false; error: string };

/** Normalize an OpenAI-compatible base URL. Chat Completions is appended by the SDK. */
export const parseCustomBaseUrl = (value: string): BaseUrlResult => {
  const raw = value.trim();
  if (!raw) return { ok: false, error: "Enter an API base URL." };
  if (raw.length > 300 || /\s/.test(raw))
    return { ok: false, error: "Enter a valid http(s) API base URL." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Enter a valid http(s) API base URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, error: "API base URL must start with http:// or https://." };
  if (url.username || url.password)
    return { ok: false, error: "Remove the username and password from the API base URL." };
  if (!url.hostname) return { ok: false, error: "Enter a valid http(s) API base URL." };
  if (url.search || url.hash)
    return { ok: false, error: "Remove the query and hash from the API base URL." };
  const path = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/+$/, "");
  return { ok: true, url: `${url.origin}${path}` };
};
