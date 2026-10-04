import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, RetryError, generateText } from "ai";
import {
  defaultLocale,
  formatLocale,
  localeLabels,
  LOCALE_COOKIE,
  resolveRequestedLocale,
  type Locale,
} from "@/i18n/config";
import { getAiKey, getAiModel, getAiProvider } from "./settings";
import { CodedError } from "./api";
import { AI_PROVIDER_NAMES } from "@/lib/ai-settings";

/**
 * BYO-key AI. Self-hosted means YOUR key on YOUR box: the key is read from the
 * encrypted settings store (or the selected provider's environment variable).
 * Requests go straight from this server to the selected provider.
 */
export const aiConfigured = (): boolean => getAiKey(getAiProvider()) !== null;

/**
 * The request's validated interface locale (NEXT_LOCALE cookie), used only to
 * phrase prompt language instructions (docs/i18n.md §9). Missing or invalid
 * cookies fall back to `en`; outside a request scope (direct unit-test
 * invocation) the same English baseline applies by design.
 */
export const requestLocale = async (): Promise<Locale> => {
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    return resolveRequestedLocale(jar.get(LOCALE_COOKIE)?.value);
  } catch {
    return defaultLocale;
  }
};

/**
 * Prompt instruction pinning the response language. Data labels and aggregates
 * in the context stay English (machine data context, not UI copy); this line
 * overrides their language for the model's prose.
 */
export const languageDirective = (locale: Locale): string =>
  `Respond in ${localeLabels[locale]} (BCP 47: ${formatLocale(locale)}). Write every sentence, heading and list item in that language, regardless of the language of the data, labels or this instruction.`;

const SYSTEM = `You are the reflection layer of a trader's journal.
You see only the trader's own recorded data — trades, stats, and notes. Ground every
statement in those numbers; never invent trades, prices, or market context you weren't given.
Be direct and specific like a good trading coach: name the behavior, cite the numbers,
say what to keep and what to fix. No platitudes, no disclaimers about trading being risky —
the trader knows. Keep it tight.`;

export const runAi = async (prompt: string, maxOutputTokens = 1200): Promise<string> => {
  const provider = getAiProvider();
  const apiKey = getAiKey(provider);
  if (!apiKey) {
    throw new CodedError(
      `AI is not configured — add your ${AI_PROVIDER_NAMES[provider]} API key in Settings.`,
      "ai_not_configured",
    );
  }
  const model = getAiModel(provider);
  try {
    const result = await generateText({
      model:
        provider === "openai"
          ? createOpenAI({ apiKey }).responses(model)
          : createAnthropic({ apiKey })(model),
      ...(provider === "openai" ? { providerOptions: { openai: { store: false } } } : {}),
      system: SYSTEM,
      prompt,
      maxOutputTokens,
    });
    if (!result.text.trim())
      throw new CodedError("AI returned no text. Check the model or try again.", "ai_no_text");
    return result.text;
  } catch (error) {
    if (RetryError.isInstance(error)) error = error.lastError;
    // Provider error messages can contain key fragments or request data. Never relay them.
    if (APICallError.isInstance(error)) {
      if (error.statusCode === 401 || error.statusCode === 403)
        throw new CodedError(
          "AI authentication_error: check your provider key and permissions in Settings.",
          "ai_auth_error",
        );
      if (
        /credit balance|billing|insufficient_quota|exceeded your current quota/i.test(error.message)
      )
        throw new CodedError(
          "AI billing: check your provider account's credits and quota.",
          "ai_billing_error",
        );
      if (error.statusCode === 429 || error.statusCode === 529)
        throw new CodedError("AI rate limit: please try again shortly.", "ai_rate_limit");
      if (
        error.statusCode === 404 ||
        /model.*(?:not found|does not exist|access)/i.test(error.message)
      )
        throw new CodedError(
          "AI model unavailable: check the model ID and your provider access in Settings.",
          "ai_model_unavailable",
        );
    }
    throw new CodedError(
      "AI request failed. Check your provider settings or try again shortly.",
      "ai_request_failed",
    );
  }
};
