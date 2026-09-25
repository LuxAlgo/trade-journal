export const AI_PROVIDERS = ["anthropic", "openai"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_ANTHROPIC_API_BASE_URL = "https://api.anthropic.com/v1";

export const AI_DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-4.1-mini",
};

export const AI_PROVIDER_NAMES: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export interface AiConnection {
  configured: boolean;
  source: "environment" | "saved" | null;
  model: string;
}

export interface AiSettingsPayload {
  aiProvider: AiProvider;
  aiConfigured: boolean;
  aiModel: string;
  aiBaseUrl: string;
  aiConnections: Record<AiProvider, AiConnection>;
}

export const isAiProvider = (value: unknown): value is AiProvider =>
  value === "anthropic" || value === "openai";
