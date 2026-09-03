import {
  db,
  accounts,
  executions,
  journalDays,
  notes,
  playbooks,
  trades,
  attachments,
  noteTemplates,
  tradeRuleChecks,
  progressRules,
  progressChecks,
  missedTrades,
  folders,
} from "@/db";
import { readFilters } from "@luxalgo/journal-core";
import { queryTrades } from "@/server/trades-query";
import { getJournalDefaults, getMultipliers, getTimeZone } from "@/server/settings";
import { handler, ok } from "@/server/api";

/**
 * Full data export — your journal is yours. Credentials are deliberately
 * excluded: an export must be safe to share or move between machines.
 */
export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "json";

  if (format === "csv") {
    const header =
      "key,account_id,symbol,direction,status,opened_at,closed_at,quantity,avg_entry,avg_exit,gross_pnl,fees,net_pnl,tags,notes";
    const escape = (value: unknown): string => {
      const text = value === null || value === undefined ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = queryTrades(readFilters(url.searchParams)).rows.map((row) =>
      [
        row.key,
        row.accountId,
        row.symbol,
        row.direction,
        row.status,
        row.openedAt,
        row.closedAt ?? "",
        row.quantity,
        row.avgEntry,
        row.avgExit ?? "",
        row.grossPnl,
        row.fees,
        row.netPnl,
        row.tagsJson ?? "[]",
        row.notes ?? "",
      ]
        .map(escape)
        .join(","),
    );
    return new Response([header, ...lines].join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="trades.csv"',
      },
    });
  }

  return ok({
    exportedAt: new Date().toISOString(),
    accounts: db
      .select()
      .from(accounts)
      .all()
      .map(({ credentialsEnc: _omitted, ...safe }) => safe),
    executions: db.select().from(executions).all(),
    trades: db.select().from(trades).all(),
    journalDays: db.select().from(journalDays).all(),
    notes: db.select().from(notes).all(),
    folders: db.select().from(folders).all(),
    playbooks: db.select().from(playbooks).all(),
    noteTemplates: db.select().from(noteTemplates).all(),
    tradeRuleChecks: db.select().from(tradeRuleChecks).all(),
    progressRules: db.select().from(progressRules).all(),
    progressChecks: db.select().from(progressChecks).all(),
    missedTrades: db.select().from(missedTrades).all(),
    journalDefaults: getJournalDefaults(),
    settings: { timeZone: getTimeZone(), multipliers: getMultipliers() },
    attachments: db
      .select()
      .from(attachments)
      .all()
      .map(({ data, ...meta }) => ({ ...meta, dataBase64: data.toString("base64") })),
  });
});
