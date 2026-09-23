import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, RetryError, generateText } from "ai";
import { getAiBaseUrl, getAiKey, getAiModel, getAiProvider } from "./settings";
import { AI_PROVIDER_NAMES } from "@/lib/ai-settings";

/**
 * BYO-key AI. Self-hosted means YOUR key on YOUR box: the key is read from the
 * encrypted settings store (or the selected provider's environment variable).
 * Requests go straight from this server to the selected provider.
 */
export const aiConfigured = (): boolean => getAiKey(getAiProvider()) !== null;

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
    throw new Error(
      `AI is not configured — add your ${AI_PROVIDER_NAMES[provider]} API key in Settings.`,
    );
  }
  const model = getAiModel(provider);
  const baseURL = getAiBaseUrl(provider);
  try {
    const result = await generateText({
      model:
        provider === "openai"
          ? createOpenAI({ apiKey, baseURL }).responses(model)
          : createAnthropic({ apiKey, baseURL })(model),
      ...(provider === "openai" ? { providerOptions: { openai: { store: false } } } : {}),
      system: SYSTEM,
      prompt,
      maxOutputTokens,
    });
    if (!result.text.trim()) throw new Error("AI returned no text. Check the model or try again.");
    return result.text;
  } catch (error) {
    if (RetryError.isInstance(error)) error = error.lastError;
    // Provider error messages can contain key fragments or request data. Never relay them.
    if (APICallError.isInstance(error)) {
      if (error.statusCode === 401 || error.statusCode === 403)
        throw new Error(
          "AI authentication_error: check your provider key and permissions in Settings.",
        );
      if (
        /credit balance|billing|insufficient_quota|exceeded your current quota/i.test(error.message)
      )
        throw new Error("AI billing: check your provider account's credits and quota.");
      if (error.statusCode === 429 || error.statusCode === 529)
        throw new Error("AI rate limit: please try again shortly.");
      if (
        error.statusCode === 404 ||
        /model.*(?:not found|does not exist|access)/i.test(error.message)
      )
        throw new Error(
          "AI model unavailable: check the model ID and your provider access in Settings.",
        );
    }
    throw new Error("AI request failed. Check your provider settings or try again shortly.");
  }
};
