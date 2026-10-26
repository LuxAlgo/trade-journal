import {
  FORMATS,
  HYPERLIQUID_FORMAT_ID,
  parseAuto,
  parseWithMapping,
  readHeaders,
  type GenericMapping,
  type ImportedExecution,
} from "@luxalgo/journal-importers";
import { bad, handler, ok, requireValue } from "@/server/api";
import { insertExecutions } from "@/server/executions";
import { getImportTimeZone } from "@/server/settings";
import { isTimeZone } from "@/lib/timezone";
import type { ImportReviewOptions } from "@/lib/import-review";
import { previewNinjaTraderImport, commitNinjaTraderImport } from "@/server/ninjatrader-import";
import {
  IBKR_FLEX_XML,
  flexUploadSyncProblem,
  looksLikeFlexXml,
  parseFlexXmlImport,
} from "@/server/ibkr-flex-xml-import";
import { reconcileXtbHoldings, xlsxStatement } from "@/server/xtb-import";
import { reconcileHyperliquidSync } from "@/server/hyperliquid-import";
import type { AiImportOptions } from "@/lib/ai-import";
import {
  createAiImportPreview,
  parseStatementWithAi,
  readAiImportPreview,
} from "@/server/ai-import";

interface ImportBody {
  mode: "preview" | "commit";
  content: string;
  accountId?: string;
  /** Column mapping when auto-detection found nothing. */
  mapping?: GenericMapping;
  timeZone?: string;
  fileName?: string;
  symbol?: string;
  review?: ImportReviewOptions;
  ai?: AiImportOptions;
  encoding?: "text" | "pdf" | "xlsx";
  aiPreviewToken?: string;
  aiReviewed?: boolean;
}

/**
 * One endpoint, two steps. Preview parses and reports what WOULD be imported;
 * nothing is guessed silently, exactly because the file formats in the wild
 * drift. Commit inserts with dedup, so re-importing the same file is a no-op.
 */
export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as ImportBody;
  if (typeof body.content !== "string" || !body.content) return bad("content is required");
  if (!["preview", "commit"].includes(body.mode)) return bad("mode must be preview or commit");
  if (body.symbol !== undefined && (typeof body.symbol !== "string" || body.symbol.length > 100))
    return bad("Invalid symbol");
  if (body.fileName !== undefined && typeof body.fileName !== "string")
    return bad("Invalid filename");
  if (body.timeZone !== undefined)
    requireValue(isTimeZone(body.timeZone), "Enter a valid IANA statement timezone.");
  const timeZone = body.timeZone ?? getImportTimeZone();
  requireValue(
    body.encoding === undefined || ["text", "pdf", "xlsx"].includes(body.encoding),
    "Unsupported file encoding.",
  );
  requireValue(body.encoding !== "pdf" || body.ai, "Enable AI parsing to upload PDF statements.");
  requireValue(
    body.encoding !== "xlsx" || (!body.ai && !body.mapping),
    "Turn off AI parsing for an XTB Excel report. The XTB importer reads it directly.",
  );
  requireValue(!body.ai || !body.mapping, "Choose AI parsing or column mapping, not both.");
  // Workbooks are reduced to a statement here, so preview and commit parse the same server-side text.
  const content = body.encoding === "xlsx" ? await xlsxStatement(body.content) : body.content;
  const statement = {
    content: body.content,
    fileName: body.fileName,
    // Only AI parsing reads this, and a workbook with AI parsing is refused above.
    encoding: body.encoding === "xlsx" ? undefined : body.encoding,
    timeZone,
  };
  if (body.ai && body.mode === "commit")
    requireValue(
      body.aiReviewed === true && body.aiPreviewToken,
      "Review the AI preview before importing.",
    );

  const parsed = body.ai
    ? body.mode === "preview"
      ? await parseStatementWithAi(statement, body.ai, request.signal)
      : readAiImportPreview(statement, body.aiPreviewToken!)
    : body.mapping
      ? parseWithMapping(content, body.mapping, { timeZone })
      : looksLikeFlexXml(content)
        ? parseFlexXmlImport(content, timeZone)
        : parseAuto(content, { timeZone, fileName: body.fileName, symbol: body.symbol });

  if (!parsed) {
    return ok({
      detected: null,
      timeZone,
      headers: readHeaders(content),
      needsMapping: true,
    });
  }

  const syncProblem =
    parsed.format === IBKR_FLEX_XML.id && body.accountId
      ? flexUploadSyncProblem(body.accountId, timeZone)
      : null;
  const xtb =
    parsed.format === "xtb" && body.accountId
      ? reconcileXtbHoldings(body.accountId, parsed.executions as ImportedExecution[])
      : null;
  const hyperliquid =
    parsed.format === HYPERLIQUID_FORMAT_ID && body.accountId
      ? reconcileHyperliquidSync(body.accountId, parsed.executions as ImportedExecution[])
      : null;
  // The preview then counts only the fills that will be saved.
  if (hyperliquid) parsed.executions = hyperliquid.executions;
  const problems = [syncProblem, xtb?.problem, hyperliquid?.problem].filter(
    (problem): problem is string => !!problem,
  );
  const errors = [...(parsed.errors ?? []), ...problems];
  const warnings = [
    ...(parsed.warnings ?? []),
    ...(xtb?.matched
      ? [`${xtb.matched} open holding(s) imported earlier are closed by this file.`]
      : []),
    ...(hyperliquid?.covered
      ? [
          `${hyperliquid.covered} fill(s) at or after this account's first synced fill (${hyperliquid.since}) are left to broker sync, which covers that period. Only older fills from this file are added.`,
        ]
      : []),
  ];

  if (body.mode === "preview") {
    const symbols = [...new Set(parsed.executions.map((e) => e.symbol))];
    return ok({
      detected: parsed.format,
      timeZone,
      needsMapping: false,
      executions: body.ai ? parsed.executions : parsed.executions.slice(0, 50),
      ...(body.ai
        ? {
            aiPreviewToken: createAiImportPreview(statement, parsed),
            sources: "sources" in parsed ? parsed.sources : [],
          }
        : {}),
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
      warnings,
      errors: problems.length ? errors : parsed.errors,
      needsSymbol: parsed.needsSymbol,
      reconciliation:
        parsed.format === "ninjatrader" && body.accountId
          ? previewNinjaTraderImport(body.accountId, parsed, body.content, timeZone, body.review)
          : undefined,
    });
  }

  if (!body.accountId) return bad("accountId is required to commit");
  if (errors.length) return bad(errors.join(" "));
  if (parsed.executions.length === 0) return bad("No executions to import");
  const result =
    parsed.format === "ninjatrader"
      ? commitNinjaTraderImport(body.accountId, parsed, body.content, timeZone, body.review)
      : insertExecutions(
          body.accountId,
          xtb?.executions ?? (parsed.executions as ImportedExecution[]),
          "import",
          undefined,
          { preserveFees: Boolean(body.ai) },
        );
  if (xtb?.matched) result.duplicates += xtb.matched;
  if (hyperliquid?.covered) result.duplicates += hyperliquid.covered;
  // Invalid rows are skipped with a warning rather than failing the whole file.
  const commitWarnings = [
    ...warnings,
    ...(result.skipped > 0
      ? [
          `${result.skipped} row(s) were skipped because they could not be journaled: ${result.skippedReasons.join(" ")}`,
        ]
      : []),
  ];
  return ok({ detected: parsed.format, ...result, warnings: commitWarnings });
});

/** The import page lists what auto-detection understands. */
export const GET = handler(() =>
  ok({ formats: [...FORMATS, IBKR_FLEX_XML].map(({ id, label }) => ({ id, label })) }),
);
