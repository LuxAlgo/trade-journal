import { and, count, desc, eq } from "drizzle-orm";
import { db, accounts, propAccounts, propEntries, propReceipts, propAudit } from "@/db";
import { requireValue, RequestError } from "./api";
import { newId, nowIso } from "./ids";
import { getTimeZone } from "./settings";
import {
  currencyDigits,
  toMinor,
  expectedPayout,
  receivedPayout,
  PROP_PROGRAMS,
  PROP_STATES,
  PAYOUT_STATES,
  EXPENSE_CATEGORIES,
  type PropAccount,
  type PropEntry,
  type PropReceipt,
  type PropData,
} from "@/lib/prop-firms";
export class PropConflict extends RequestError {}
export const propToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: getTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const propData = (): PropData => ({
  accounts: db.select().from(propAccounts).all() as PropAccount[],
  entries: db.select().from(propEntries).all() as PropEntry[],
  receipts: db.select().from(propReceipts).all() as PropReceipt[],
  today: propToday(),
});
const text = (v: unknown, title: string, max = 200, required = true) => {
  requireValue(
    typeof v === "string" && v.trim().length <= max && (!required || v.trim()),
    `Enter ${title}.`,
  );
  return v.trim();
};
const idValue = (v: unknown) => {
  const id = text(v, "a record ID", 100);
  requireValue(/^[a-zA-Z0-9_-]+$/.test(id), "Invalid record ID.");
  return id;
};
const optionalId = (v: unknown) => (v === "" || v == null ? null : idValue(v));
const choice = <T extends string>(v: unknown, values: readonly T[], name: string): T => {
  requireValue(values.includes(v as T), `Choose ${name}.`);
  return v as T;
};
const date = (v: unknown, title: string, future = false) => {
  const day = text(v, title, 10);
  requireValue(
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
      !isNaN(Date.parse(day)) &&
      new Date(day).toISOString().slice(0, 10) === day,
    `Enter a valid ${title}.`,
  );
  requireValue(future || day <= propToday(), `${title} cannot be in the future.`);
  return day;
};
const maybeDate = (v: unknown, title: string, future = false) =>
  v === "" || v == null ? null : date(v, title, future);
const money = (v: unknown, currency: string) => {
  try {
    return toMinor(v, currency);
  } catch (e) {
    throw new RequestError((e as Error).message);
  }
};
const currency = (v: unknown) => {
  const code = text(v, "a currency", 3).toUpperCase();
  try {
    currencyDigits(code);
  } catch (e) {
    throw new RequestError((e as Error).message);
  }
  return code;
};
const audit = (
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  reason: string,
) =>
  db
    .insert(propAudit)
    .values({
      id: newId(),
      entityType,
      entityId,
      beforeJson: before ? JSON.stringify(before) : null,
      afterJson: JSON.stringify(after),
      reason,
      createdAt: nowIso(),
    })
    .run();
const checkRevision = (old: { revision: number } | undefined, revision: unknown) => {
  if (revision !== (old?.revision ?? 0))
    throw new PropConflict(
      "This record changed in another view. Refresh and review it before saving.",
    );
};
const same = (old: object, values: object) =>
  Object.entries(values).every(([key, value]) => (old as Record<string, unknown>)[key] === value);
const details = (body: Record<string, unknown>) => ({
  reference: text(body.reference ?? "", "a reference up to 200 characters", 200, false),
  notes: text(body.notes ?? "", "notes up to 5,000 characters", 5000, false),
});
const editReason = (body: Record<string, unknown>, old: unknown) =>
  old ? text(body.reason, "a reason for this change", 500) : "Created";
export function mutateProp(body: Record<string, unknown>) {
  return db.transaction(() => {
    const id = idValue(body.id);
    if (body.action === "account.save") {
      const old = db.select().from(propAccounts).where(eq(propAccounts.id, id)).get();
      const code = currency(body.currency),
        parentId = optionalId(body.parentId),
        journalAccountId = optionalId(body.journalAccountId);
      const values = {
        firm: text(body.firm, "a firm name"),
        name: text(body.name, "an account or attempt name"),
        program: choice(body.program, PROP_PROGRAMS, "an account program"),
        status: choice(body.status, PROP_STATES, "an account status"),
        currency: code,
        sizeMinor: body.size === "" || body.size == null ? null : money(body.size, code),
        parentId,
        journalAccountId,
        openedOn: date(body.openedOn, "opening date"),
        closedOn: maybeDate(body.closedOn, "closing date"),
        renewalOn: maybeDate(body.renewalOn, "next renewal date", true),
        renewalMinor:
          body.renewalAmount === "" || body.renewalAmount == null
            ? null
            : money(body.renewalAmount, code),
        notes: text(body.notes ?? "", "notes up to 5,000 characters", 5000, false),
      };
      requireValue(
        !values.closedOn || values.closedOn >= values.openedOn,
        "Closing date must follow opening date.",
      );
      requireValue(
        values.status === "active" ? !values.closedOn : Boolean(values.closedOn),
        "Active accounts have no closing date; resolved accounts need a closing date.",
      );
      requireValue(
        values.status !== "passed" || ["evaluation", "verification"].includes(values.program),
        "Only an evaluation or verification can be marked passed. Track funding as a new linked phase.",
      );
      requireValue(
        !values.renewalOn || values.renewalMinor !== null,
        "Enter the expected renewal amount.",
      );
      requireValue(
        !values.renewalOn || values.status === "active",
        "Clear the renewal reminder for a resolved account.",
      );
      if (journalAccountId)
        requireValue(
          db
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.id, journalAccountId))
            .get(),
          "Linked journal account not found.",
        );
      if (parentId) {
        const parent = db.select().from(propAccounts).where(eq(propAccounts.id, parentId)).get();
        requireValue(
          parent &&
            parent.id !== id &&
            parent.firm.toLowerCase() === values.firm.toLowerCase() &&
            parent.currency === code &&
            parent.openedOn <= values.openedOn,
          "Choose an earlier account or attempt at the same firm and currency.",
        );
        const visited = new Set([id]);
        let ancestor: typeof parent | undefined = parent;
        while (ancestor) {
          requireValue(!visited.has(ancestor.id), "Account lineage cannot contain a cycle.");
          visited.add(ancestor.id);
          ancestor = ancestor.parentId
            ? db.select().from(propAccounts).where(eq(propAccounts.id, ancestor.parentId)).get()
            : undefined;
        }
      }
      if (old) {
        const phases = db.select().from(propAccounts).where(eq(propAccounts.parentId, id)).all();
        requireValue(
          phases.every(
            (a) =>
              a.firm.toLowerCase() === values.firm.toLowerCase() &&
              a.currency === code &&
              a.openedOn >= values.openedOn,
          ),
          "This change conflicts with a linked phase or reset.",
        );
        const linked = db.select().from(propEntries).where(eq(propEntries.accountId, id)).all();
        requireValue(
          !linked.length ||
            (old.currency === code && old.firm === values.firm && old.program === values.program),
          "An account with cash records keeps its firm, currency and phase. Create a linked phase for funding or a reset.",
        );
        requireValue(
          linked.every((e) => e.occurredOn >= values.openedOn),
          "Opening date cannot be after this account's cash records.",
        );
      } else
        requireValue(
          db.select({ n: count() }).from(propAccounts).get()!.n < 2000,
          "Account limit reached (2,000).",
        );
      if (old && body.revision === 0 && same(old, values)) return { id };
      checkRevision(old, body.revision);
      const updated = {
        ...values,
        id,
        archived: old?.archived ?? false,
        revision: (old?.revision ?? 0) + 1,
        createdAt: old?.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      db.insert(propAccounts)
        .values(updated)
        .onConflictDoUpdate({ target: propAccounts.id, set: updated })
        .run();
      audit("account", id, old, updated, editReason(body, old));
      return { id };
    }
    if (body.action === "account.archive") {
      const old = db.select().from(propAccounts).where(eq(propAccounts.id, id)).get();
      requireValue(old, "Account not found.", "prop_account_not_found");
      checkRevision(old, body.revision);
      requireValue(typeof body.archived === "boolean", "Choose archive or restore.");
      const updated = {
        ...old,
        archived: body.archived,
        revision: old.revision + 1,
        updatedAt: nowIso(),
      };
      db.update(propAccounts).set(updated).where(eq(propAccounts.id, id)).run();
      audit("account", id, old, updated, text(body.reason, "a reason", 500));
      return { id };
    }
    if (body.action === "entry.save") {
      const old = db.select().from(propEntries).where(eq(propEntries.id, id)).get();
      requireValue(!old?.voided, "Restore this entry before editing it.");
      const accountId = optionalId(body.accountId),
        account = accountId
          ? db.select().from(propAccounts).where(eq(propAccounts.id, accountId)).get()
          : null;
      requireValue(!accountId || account, "Prop account not found.", "prop_account_not_found");
      const code = currency(body.currency),
        kind = choice(body.kind, ["expense", "refund", "payout"] as const, "an entry type");
      const amountMinor = money(body.amount, code),
        parentId = optionalId(body.parentId);
      const splitBps = kind === "payout" ? money(body.splitPercent, "USD") : 10000;
      const feeMinor = kind === "payout" ? money(body.fee ?? "0", code) : 0;
      requireValue(amountMinor > 0 || kind === "expense", "Enter an amount greater than zero.");
      requireValue(
        splitBps > 0 && splitBps <= 10000,
        "Trader share must be greater than 0 and at most 100 percent.",
      );
      const values = {
        accountId,
        firm: text(body.firm, "a firm name"),
        kind,
        currency: code,
        amountMinor,
        splitBps,
        feeMinor,
        category:
          kind === "expense"
            ? choice(body.category, EXPENSE_CATEGORIES, "an expense category")
            : kind,
        occurredOn: date(body.occurredOn, kind === "payout" ? "request date" : "cash date"),
        dueOn: kind === "payout" ? maybeDate(body.dueOn, "expected payment date", true) : null,
        status:
          kind === "payout"
            ? choice(body.status, PAYOUT_STATES, "a payout status")
            : ("completed" as const),
        parentId: kind === "refund" ? parentId : null,
        ...details(body),
      };
      if (account)
        requireValue(
          account.firm === values.firm &&
            account.currency === code &&
            values.occurredOn >= account.openedOn,
          "Use the selected account's firm, currency and a date on or after it opened.",
        );
      if (kind === "payout") {
        requireValue(
          account && ["funded", "instant_funded", "live"].includes(account.program),
          "Payouts need a funded, instant-funded or live prop account.",
        );
        requireValue(
          expectedPayout(values as PropEntry) >= 0,
          "Withheld fees cannot exceed your share of the payout.",
        );
        requireValue(
          !values.dueOn || values.dueOn >= values.occurredOn,
          "Expected payment date must follow the request date.",
        );
      }
      if (kind === "refund") {
        const expense = parentId
          ? db.select().from(propEntries).where(eq(propEntries.id, parentId)).get()
          : null;
        requireValue(
          expense &&
            expense.id !== id &&
            !expense.voided &&
            expense.kind === "expense" &&
            expense.currency === code &&
            expense.firm === values.firm &&
            expense.accountId === accountId &&
            expense.occurredOn <= values.occurredOn,
          "Link this refund to a matching expense in the same account, firm and currency.",
        );
        const other = db
          .select()
          .from(propEntries)
          .where(eq(propEntries.parentId, expense.id))
          .all()
          .filter((e) => !e.voided && e.id !== id)
          .reduce((sum, e) => sum + e.amountMinor, 0);
        requireValue(
          other + amountMinor <= expense.amountMinor,
          "Refunds cannot exceed the original expense.",
        );
      }
      if (old) {
        requireValue(
          old.kind === kind &&
            old.currency === code &&
            old.accountId === accountId &&
            old.firm === values.firm &&
            old.parentId === values.parentId,
          "Account, currency, firm, entry type and refund link are fixed. Void an incorrect entry and add a replacement.",
        );
        const children = db
          .select()
          .from(propEntries)
          .where(eq(propEntries.parentId, id))
          .all()
          .filter((e) => !e.voided);
        requireValue(
          !children.length ||
            (children.reduce((sum, e) => sum + e.amountMinor, 0) <= amountMinor &&
              children.every((e) => e.occurredOn >= values.occurredOn)),
          "This change conflicts with recorded refunds.",
        );
        const receipts = db
          .select()
          .from(propReceipts)
          .where(eq(propReceipts.payoutId, id))
          .all() as PropReceipt[];
        requireValue(
          receipts.filter((r) => !r.voided).every((r) => r.occurredOn >= values.occurredOn),
          "Request date cannot follow a recorded payment.",
        );
        const net = receivedPayout(id, receipts);
        requireValue(
          !["rejected", "cancelled"].includes(values.status) || net === 0,
          "Record a reversal before rejecting or cancelling a paid payout.",
        );
        requireValue(
          values.status !== "completed" || kind !== "payout" || net > 0,
          "Record money received before completing a payout.",
        );
      } else {
        requireValue(
          kind !== "payout" || values.status !== "completed",
          "Add the payout request first, then record the actual receipt.",
        );
        requireValue(
          db.select({ n: count() }).from(propEntries).get()!.n < 20_000,
          "Entry limit reached (20,000).",
        );
      }
      if (old && body.revision === 0 && same(old, values)) return { id };
      checkRevision(old, body.revision);
      const updated = {
        ...values,
        id,
        revision: (old?.revision ?? 0) + 1,
        voided: false,
        createdAt: old?.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      db.insert(propEntries)
        .values(updated)
        .onConflictDoUpdate({ target: propEntries.id, set: updated })
        .run();
      audit("entry", id, old, updated, editReason(body, old));
      return { id };
    }
    if (body.action === "entry.void") {
      const old = db.select().from(propEntries).where(eq(propEntries.id, id)).get();
      requireValue(old, "Entry not found.", "prop_entry_not_found");
      checkRevision(old, body.revision);
      requireValue(typeof body.voided === "boolean", "Choose void or restore.");
      const refunds = db
        .select()
        .from(propEntries)
        .where(eq(propEntries.parentId, id))
        .all()
        .filter((e) => !e.voided);
      requireValue(
        !body.voided || !refunds.length,
        "Void linked refunds before voiding their expense.",
      );
      if (!body.voided && old.kind === "refund") {
        const parent = db.select().from(propEntries).where(eq(propEntries.id, old.parentId!)).get();
        const others = db
          .select()
          .from(propEntries)
          .where(eq(propEntries.parentId, old.parentId!))
          .all()
          .filter((e) => !e.voided && e.id !== id);
        requireValue(
          parent &&
            !parent.voided &&
            parent.occurredOn <= old.occurredOn &&
            others.reduce((sum, e) => sum + e.amountMinor, old.amountMinor) <= parent.amountMinor,
          "Restore the expense first and ensure refunds do not exceed its amount.",
        );
      }
      const updated = {
        ...old,
        voided: body.voided,
        revision: old.revision + 1,
        updatedAt: nowIso(),
      };
      db.update(propEntries).set(updated).where(eq(propEntries.id, id)).run();
      audit("entry", id, old, updated, text(body.reason, "a reason", 500));
      return { id };
    }
    if (body.action === "receipt.add" || body.action === "receipt.void") {
      const payoutId = idValue(body.payoutId),
        payout = db.select().from(propEntries).where(eq(propEntries.id, payoutId)).get();
      requireValue(
        payout && payout.kind === "payout" && !payout.voided,
        "Choose an active payout record.",
      );
      const old = db.select().from(propReceipts).where(eq(propReceipts.id, id)).get();
      const rows = db
        .select()
        .from(propReceipts)
        .where(eq(propReceipts.payoutId, payoutId))
        .all() as PropReceipt[];
      let updated: PropReceipt;
      if (body.action === "receipt.add") {
        requireValue(
          !["rejected", "cancelled"].includes(payout.status),
          "Reopen the payout before recording money received or reversed.",
        );
        updated = {
          id,
          payoutId,
          kind: choice(body.kind, ["receipt", "reversal"] as const, "receipt or reversal"),
          amountMinor: money(body.amount, payout.currency),
          occurredOn: date(body.occurredOn, "settlement date"),
          ...details(body),
          voided: false,
          createdAt: old?.createdAt ?? nowIso(),
        };
        requireValue(
          updated.amountMinor > 0 && updated.occurredOn >= payout.occurredOn,
          "Enter a positive amount and a settlement date on or after the payout request.",
        );
        if (old && same(old, updated)) return { id };
        requireValue(
          !old,
          "Receipt ID already exists. Void an incorrect receipt and add a replacement.",
        );
        requireValue(
          db.select({ n: count() }).from(propReceipts).get()!.n < 50_000,
          "Receipt limit reached (50,000).",
        );
      } else {
        requireValue(
          old && old.payoutId === payoutId && typeof body.voided === "boolean",
          "Choose a receipt to void or restore.",
        );
        updated = { ...old, kind: old.kind as PropReceipt["kind"], voided: body.voided };
      }
      checkRevision(payout, body.revision);
      const next = [...rows.filter((r) => r.id !== id), updated]
        .filter((r) => !r.voided)
        .sort(
          (a, b) => a.occurredOn.localeCompare(b.occurredOn) || (a.kind === "receipt" ? -1 : 1),
        );
      let balance = 0;
      for (const r of next) {
        requireValue(
          r.occurredOn >= payout.occurredOn,
          "A receipt cannot precede its payout request.",
        );
        balance += r.amountMinor * (r.kind === "reversal" ? -1 : 1);
        requireValue(balance >= 0, "A reversal cannot exceed the money received by that date.");
      }
      requireValue(
        !["rejected", "cancelled"].includes(payout.status) || balance === 0,
        "Reopen the payout before restoring received money.",
      );
      db.insert(propReceipts)
        .values(updated)
        .onConflictDoUpdate({ target: propReceipts.id, set: updated })
        .run();
      const updatedPayout = {
        ...payout,
        revision: payout.revision + 1,
        updatedAt: nowIso(),
        status: balance === 0 && payout.status === "completed" ? "approved" : payout.status,
      };
      db.update(propEntries).set(updatedPayout).where(eq(propEntries.id, payoutId)).run();
      audit(
        "entry",
        payoutId,
        { payout, receipt: old ?? null },
        { payout: updatedPayout, receipt: updated },
        body.action === "receipt.add"
          ? `Recorded ${updated.kind}`
          : text(body.reason, "a reason", 500),
      );
      return { id };
    }
    throw new RequestError("Choose a supported prop tracker action.");
  });
}
export function propHistory(type: string, id: string) {
  requireValue(["account", "entry"].includes(type), "Choose an account or entry history.");
  return db
    .select()
    .from(propAudit)
    .where(and(eq(propAudit.entityType, type), eq(propAudit.entityId, idValue(id))))
    .orderBy(desc(propAudit.createdAt))
    .limit(100)
    .all();
}
