import { handler, ok } from "@/server/api";
import {
  getAnthropicKey,
  getMultipliers,
  getSetting,
  getTimeZone,
  setAnthropicKey,
  setSetting,
} from "@/server/settings";

export const GET = handler(() =>
  ok({
    timeZone: getTimeZone(),
    multipliers: getMultipliers(),
    aiConfigured: getAnthropicKey() !== null,
    aiModel: getSetting("aiModel") ?? "claude-opus-5",
  }),
);

interface SettingsBody {
  timeZone?: string;
  multipliers?: Record<string, number>;
  /** Set to a key string to store (encrypted), or null to clear. Absent = unchanged. */
  anthropicKey?: string | null;
  aiModel?: string;
}

export const PATCH = handler(async (request: Request) => {
  const body = (await request.json()) as SettingsBody;
  if (body.timeZone !== undefined) setSetting("timeZone", body.timeZone);
  if (body.multipliers !== undefined) setSetting("multipliers", JSON.stringify(body.multipliers));
  if (body.anthropicKey !== undefined) setAnthropicKey(body.anthropicKey);
  if (body.aiModel !== undefined) setSetting("aiModel", body.aiModel);
  return ok({ saved: true });
});
