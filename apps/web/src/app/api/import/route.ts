import {
  FORMATS,
  parseAuto,
  parseWithMapping,
  readHeaders,
  type GenericMapping,
  type ImportedExecution,
} from "@luxalgo/journal-importers";
import { bad, handler, ok } from "@/server/api";
import { insertExecutions } from "@/server/executions";
import { getTimeZone } from "@/server/settings";

interface ImportBody {
  mode: "preview" | "commit";
  content: string;
  accountId?: string;
  /** Column mapping when auto-detection found nothing. */
  mapping?: GenericMapping;
  timeZone?: string;
}

/**
 * One endpoint, two steps. Preview parses and reports what WOULD be imported —
 * nothing is guessed silently, exactly because the file formats in the wild
 * drift. Commit inserts with dedup, so re-importing the same file is a no-op.
 */
export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as ImportBody;
  if (!body.content) return bad("content is required");
  const timeZone = body.timeZone ?? getTimeZone();

  const parsed = body.mapping
    ? parseWithMapping(body.content, body.mapping, { timeZone })
    : parseAuto(body.content, { timeZone });

  if (!parsed) {
    return ok({
      detected: null,
      headers: readHeaders(body.content),
      needsMapping: true,
    });
  }

  if (body.mode === "preview") {
    const symbols = [...new Set(parsed.executions.map((e) => e.symbol))];
    return ok({
      detected: parsed.format,
      needsMapping: false,
      executions: parsed.executions.slice(0, 50),
      totals: {
        executions: parsed.executions.length,
        symbols: symbols.length,
        skippedRows: parsed.skippedRows,
        from: parsed.executions.reduce<string | null>(
          (min, e) => (min === null || e.executedAt < min ? e.executedAt : min),
          null,
        ),
        to: parsed.executions.reduce<string | null>(
          (max, e) => (max === null || e.executedAt > max ? e.executedAt : max),
          null,
        ),
      },
      warnings: parsed.warnings,
    });
  }

  if (!body.accountId) return bad("accountId is required to commit");
  const result = insertExecutions(
    body.accountId,
    parsed.executions as ImportedExecution[],
    "import",
  );
  return ok({ detected: parsed.format, ...result, warnings: parsed.warnings });
});

/** The import page lists what auto-detection understands. */
export const GET = handler(() => ok({ formats: FORMATS.map(({ id, label }) => ({ id, label })) }));
