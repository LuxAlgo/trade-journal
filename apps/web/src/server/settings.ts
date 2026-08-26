import { eq } from "drizzle-orm";
import { db, settings } from "@/db";
import { decryptJson, encryptJson } from "./crypto";

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

/** Journal display timezone (IANA), default UTC. */
export const getTimeZone = (): string => getSetting("timeZone") ?? "UTC";

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

/** BYO Anthropic API key, encrypted at rest like broker credentials. */
export const getAnthropicKey = (): string | null => {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const envelope = getSetting("anthropicKeyEnc");
  if (!envelope) return null;
  try {
    return decryptJson<string>(envelope);
  } catch {
    return null;
  }
};

export const setAnthropicKey = (key: string | null): void => {
  if (key === null) deleteSetting("anthropicKeyEnc");
  else setSetting("anthropicKeyEnc", encryptJson(key));
};
