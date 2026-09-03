import { db, accounts } from "@/db";
import { rebuildAccount } from "@/server/rebuild";
import { handler, ok, requireValue } from "@/server/api";
import {
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
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY || getSetting("anthropicKeyEnc")),
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
  if (body.timeZone !== undefined) {
    let valid = false;
    try {
      new Intl.DateTimeFormat("en", { timeZone: body.timeZone }).format();
      valid = true;
    } catch {}
    requireValue(valid && typeof body.timeZone === "string", "Enter a valid IANA timezone.");
  }
  if (body.multipliers !== undefined)
    requireValue(
      body.multipliers &&
        typeof body.multipliers === "object" &&
        Object.values(body.multipliers).every(
          (n) => typeof n === "number" && Number.isFinite(n) && n > 0,
        ),
      "Contract multipliers must be positive numbers.",
    );
  if (body.timeZone !== undefined) setSetting("timeZone", body.timeZone);
  if (body.multipliers !== undefined)
    db.transaction(() => {
      setSetting("multipliers", JSON.stringify(body.multipliers));
      for (const account of db.select({ id: accounts.id }).from(accounts).all())
        rebuildAccount(account.id);
    });
  if (body.anthropicKey !== undefined) setAnthropicKey(body.anthropicKey);
  if (body.aiModel !== undefined) setSetting("aiModel", body.aiModel);
  return ok({ saved: true });
});
