import type { AiProvider } from "./ai-settings";

export const AI_IMPORT_MAX_BYTES = 8 * 1024 * 1024;
export const AI_IMPORT_MAX_TEXT = 150_000;
export const AI_IMPORT_MAX_EXECUTIONS = 200;
export const AI_IMPORT_HELP =
  "If you're having issues importing a file, AI parsing can help. The journal supports many broker exports, but column names and statement layouts can change. OpenAI or Anthropic can interpret unfamiliar formats and extract trades for your review. Check quantities, prices, fees and dates against your statement before importing. Your file is sent to your chosen provider using your API key; provider usage charges apply.";

export interface AiImportOptions {
  provider: AiProvider;
  model: string;
  apiKey?: string;
}
