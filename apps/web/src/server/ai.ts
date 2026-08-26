import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { getAnthropicKey, getSetting } from "./settings";

/**
 * BYO-key AI. Self-hosted means YOUR key on YOUR box: the key is read from the
 * encrypted settings store (or ANTHROPIC_API_KEY) and requests go straight
 * from this server to Anthropic — no LuxAlgo middleman, no telemetry.
 */
export const aiConfigured = (): boolean => getAnthropicKey() !== null;

const SYSTEM = `You are the reflection layer of a trader's journal.
You see only the trader's own recorded data — trades, stats, and notes. Ground every
statement in those numbers; never invent trades, prices, or market context you weren't given.
Be direct and specific like a good trading coach: name the behavior, cite the numbers,
say what to keep and what to fix. No platitudes, no disclaimers about trading being risky —
the trader knows. Keep it tight.`;

export const runAi = async (prompt: string, maxOutputTokens = 1200): Promise<string> => {
  const apiKey = getAnthropicKey();
  if (!apiKey) {
    throw new Error(
      "AI is not configured — add your Anthropic API key in Settings (it stays on your machine).",
    );
  }
  const anthropic = createAnthropic({ apiKey });
  const model = getSetting("aiModel") ?? "claude-opus-5";
  const result = await generateText({
    model: anthropic(model),
    system: SYSTEM,
    prompt,
    maxOutputTokens,
  });
  return result.text;
};
