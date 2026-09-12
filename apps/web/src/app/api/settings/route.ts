import { db, accounts } from "@/db";
import { rebuildAccount } from "@/server/rebuild";
import { handler, ok, requireValue } from "@/server/api";
import {
  getMultipliers,
  getTimeZone,
  getImportTimeZone,
  aiKeyEnvironment,
  aiModelSetting,
  getAiProvider,
  getAiSettings,
  setAiKey,
  setSetting,
} from "@/server/settings";
import { AI_PROVIDERS, AI_PROVIDER_NAMES, isAiProvider, type AiProvider } from "@/lib/ai-settings";
import { isTimeZone } from "@/lib/timezone";

export const GET = handler(() =>
  ok({
    timeZone: getTimeZone(),
    importTimeZone: getImportTimeZone(),
    multipliers: getMultipliers(),
    ...getAiSettings(),
  }),
);

interface SettingsBody {
  timeZone?: string;
  importTimeZone?: string;
  multipliers?: Record<string, number>;
  /** Set to a key string to store (encrypted), or null to clear. Absent = unchanged. */
  anthropicKey?: string | null;
  openaiKey?: string | null;
  aiProvider?: AiProvider;
  aiModel?: string;
}

export const PATCH = handler(async (request: Request) => {
  const body = (await request.json()) as SettingsBody;
  requireValue(body && typeof body === "object" && !Array.isArray(body), "Enter valid settings.");
  if (body.aiProvider !== undefined)
    requireValue(isAiProvider(body.aiProvider), "Choose Anthropic or OpenAI.");
  const provider = body.aiProvider ?? getAiProvider();
  if (body.aiModel !== undefined)
    requireValue(
      typeof body.aiModel === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(body.aiModel.trim()),
      "Enter a valid model ID.",
    );
  for (const id of AI_PROVIDERS) {
    const key = body[`${id}Key`];
    if (key === undefined) continue;
    requireValue(
      key === null ||
        (typeof key === "string" &&
          key.trim().length > 0 &&
          key.length <= 4096 &&
          !/\s/.test(key.trim())),
      `Enter a valid ${AI_PROVIDER_NAMES[id]} API key.`,
    );
    requireValue(
      !aiKeyEnvironment(id),
      `${AI_PROVIDER_NAMES[id]} uses an environment key. Update or remove it on the server.`,
    );
  }
  for (const key of ["timeZone", "importTimeZone"] as const)
    if (body[key] !== undefined)
      requireValue(
        isTimeZone(body[key]),
        `Enter a valid IANA ${key === "timeZone" ? "display" : "import"} timezone.`,
      );
  if (body.multipliers !== undefined)
    requireValue(
      body.multipliers &&
        typeof body.multipliers === "object" &&
        Object.values(body.multipliers).every(
          (n) => typeof n === "number" && Number.isFinite(n) && n > 0,
        ),
      "Contract multipliers must be positive numbers.",
    );
  db.transaction(() => {
    // A display-only change must not silently alter the legacy import default.
    if (body.timeZone !== undefined || body.importTimeZone !== undefined)
      setSetting("importTimeZone", body.importTimeZone ?? getImportTimeZone());
    if (body.timeZone !== undefined) setSetting("timeZone", body.timeZone);
  });
  if (body.multipliers !== undefined)
    db.transaction(() => {
      setSetting("multipliers", JSON.stringify(body.multipliers));
      for (const account of db.select({ id: accounts.id }).from(accounts).all())
        rebuildAccount(account.id);
    });
  db.transaction(() => {
    for (const id of AI_PROVIDERS) {
      const key = body[`${id}Key`];
      if (key !== undefined) setAiKey(id, key);
    }
    if (body.aiProvider !== undefined) setSetting("aiProvider", body.aiProvider);
    if (body.aiModel !== undefined) setSetting(aiModelSetting(provider), body.aiModel.trim());
  });
  return ok({ saved: true });
});
