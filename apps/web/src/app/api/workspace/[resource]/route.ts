import { asc, desc, eq } from "drizzle-orm";
import { dayKeyOf } from "@luxalgo/journal-core";
import {
  db,
  noteTemplates,
  progressRules,
  progressChecks,
  missedTrades,
  playbooks,
  accounts,
} from "@/db";
import { handler, ok, bad, requireValue } from "@/server/api";
import { newId, nowIso } from "@/server/ids";
import { getJournalDefaults, getTimeZone, setSetting } from "@/server/settings";
import { scheduledRules } from "@/lib/progress";
import { parseJournalDefaults } from "@/lib/journal-defaults";

type Context = { params: Promise<{ resource: string }> };
const today = () => dayKeyOf(nowIso(), getTimeZone());
const rules = () =>
  db
    .select()
    .from(progressRules)
    .orderBy(asc(progressRules.createdAt))
    .all()
    .map((r) => ({ ...r, weekdays: JSON.parse(r.weekdaysJson) as number[] }));
const validDate = (s: unknown): s is string =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !isNaN(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const text = (s: unknown, max = 100000): s is string => typeof s === "string" && s.length <= max;
const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);

export const GET = handler(async (_request: Request, { params }: Context) => {
  const { resource } = await params;
  if (resource === "templates") return ok({ templates: db.select().from(noteTemplates).all() });
  if (resource === "progress")
    return ok({ rules: rules(), checks: db.select().from(progressChecks).all(), today: today() });
  if (resource === "missed")
    return ok({
      trades: db.select().from(missedTrades).orderBy(desc(missedTrades.observedAt)).all(),
    });
  if (resource === "defaults") return ok(getJournalDefaults());
  return bad("Unknown resource", 404);
});

export const POST = handler(async (request: Request, { params }: Context) => {
  const { resource } = await params;
  const b = await request.json();
  if (resource === "templates") {
    requireValue(
      text(b.name, 100) && b.name.trim() && text(b.content),
      "A template needs a name and content (up to 100,000 characters).",
    );
    const id = newId();
    db.insert(noteTemplates).values({ id, name: b.name.trim(), content: b.content }).run();
    return ok({ id });
  }
  if (resource === "progress") {
    if (b.ruleId) {
      requireValue(
        validDate(b.date) && b.date <= today() && typeof b.done === "boolean",
        "Choose a valid date up to today.",
      );
      requireValue(
        scheduledRules(rules(), b.date).some((r) => r.id === b.ruleId),
        "This routine is not scheduled on that date.",
      );
      const id = `${b.ruleId}:${b.date}`;
      db.insert(progressChecks)
        .values({ id, ruleId: b.ruleId, date: b.date, done: b.done })
        .onConflictDoUpdate({ target: progressChecks.id, set: { done: b.done } })
        .run();
      return ok({ saved: true });
    }
    requireValue(
      text(b.title, 200) &&
        b.title.trim() &&
        ["Before trading", "During trading", "After trading"].includes(b.stage),
      "Enter a routine title and stage.",
    );
    requireValue(
      Array.isArray(b.weekdays) &&
        b.weekdays.length > 0 &&
        b.weekdays.every((n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 6),
      "Select at least one weekday.",
    );
    const id = newId();
    db.insert(progressRules)
      .values({
        id,
        title: b.title.trim(),
        stage: b.stage,
        weekdaysJson: JSON.stringify([...new Set(b.weekdays)]),
        createdAt: today(),
      })
      .run();
    return ok({ id });
  }
  if (resource === "missed") {
    requireValue(
      text(b.symbol, 80) && b.symbol.trim() && ["long", "short"].includes(b.direction),
      "Enter a symbol and direction.",
    );
    requireValue(
      text(b.observedAt, 40) && !isNaN(Date.parse(b.observedAt)),
      "Enter a valid observation time.",
    );
    requireValue(text(b.notes ?? ""), "Notes are too long.");
    for (const key of ["entry", "stop", "target"])
      requireValue(b[key] == null || finite(b[key]), `Invalid ${key} price.`);
    requireValue(
      !b.playbookId || db.select().from(playbooks).where(eq(playbooks.id, b.playbookId)).get(),
      "Strategy not found.",
    );
    const values = {
      symbol: b.symbol.trim().toUpperCase(),
      direction: b.direction,
      observedAt: new Date(b.observedAt).toISOString(),
      playbookId: b.playbookId || null,
      entry: b.entry ?? null,
      stop: b.stop ?? null,
      target: b.target ?? null,
      notes: b.notes ?? "",
    };
    if (b.id) {
      requireValue(
        db.select().from(missedTrades).where(eq(missedTrades.id, b.id)).get(),
        "Missed trade not found.",
      );
      db.update(missedTrades).set(values).where(eq(missedTrades.id, b.id)).run();
      return ok({ id: b.id });
    }
    const id = newId();
    db.insert(missedTrades)
      .values({ id, ...values, createdAt: nowIso() })
      .run();
    return ok({ id });
  }
  if (resource === "defaults") {
    const known = new Set(
      db
        .select({ id: accounts.id })
        .from(accounts)
        .all()
        .map((a) => a.id),
    );
    const parsed = parseJournalDefaults(b, (id) => known.has(id));
    if (parsed.error !== undefined) return bad(parsed.error);
    setSetting("journalDefaults", JSON.stringify(parsed.defaults));
    return ok({ saved: true });
  }
  return bad("Unknown resource", 404);
});

export const DELETE = handler(async (request: Request, { params }: Context) => {
  const { resource } = await params;
  const b = await request.json();
  requireValue(text(b.id, 200), "Invalid id.");
  if (resource === "templates") db.delete(noteTemplates).where(eq(noteTemplates.id, b.id)).run();
  else if (resource === "progress")
    db.update(progressRules).set({ archivedAt: today() }).where(eq(progressRules.id, b.id)).run();
  else if (resource === "missed")
    db.update(missedTrades)
      .set({ archivedAt: b.restore ? null : nowIso() })
      .where(eq(missedTrades.id, b.id))
      .run();
  else return bad("Unknown resource", 404);
  return ok({ saved: true });
});
