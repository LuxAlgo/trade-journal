import { BrokerError } from "@luxalgo/broker-sdk";
import { parseFlexStatement } from "@luxalgo/broker-sdk/adapters";
import type { ParsedImport } from "@luxalgo/journal-importers";
import { eq } from "drizzle-orm";
import { accounts, db } from "@/db";
import { RequestError, requireValue } from "./api";
import { brokerTradesToExecutions, untimedFillsReason } from "./broker-trades";
import {
  assertIbkrSyncTimeZone,
  canonicalImportTimeZone,
  isIbkrSyncAccount,
} from "./ibkr-sync-timezone";
import { getImportTimeZone } from "./settings";

export const IBKR_FLEX_XML = { id: "ibkr-flex-xml", label: "Interactive Brokers (Flex Query XML)" };

/** A Flex Query response or statement, optionally after an XML declaration and comments. */
export const looksLikeFlexXml = (content: string): boolean =>
  /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:FlexQueryResponse|FlexStatements?)[\s>]/.test(
    content.replace(/^﻿/, ""),
  );

/** Attribute maps for one element name, read the same way as the SDK's Flex parser. */
const elements = (xml: string, tag: string): Record<string, string>[] =>
  [...xml.matchAll(new RegExp(`<${tag}\\s([^>]*?)/?>`, "g"))].map((match) =>
    Object.fromEntries(
      [...(match[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)].map((pair) => [pair[1]!, pair[2]!]),
    ),
  );

const isSummaryRow = (trade: Record<string, string>): boolean =>
  Boolean(trade.levelOfDetail) && trade.levelOfDetail!.toUpperCase() !== "EXECUTION";

/** Order, closed-lot and summary rows repeat the executions they summarize. */
export const withoutSummaryRows = (
  xml: string,
): { xml: string; summaries: Record<string, string>[] } => {
  const summaries = elements(xml, "Trade").filter(isSummaryRow);
  return {
    summaries,
    xml: summaries.length
      ? xml.replace(/<Trade\s[^>]*?\/?>/g, (tag) =>
          isSummaryRow(elements(tag, "Trade")[0] ?? {}) ? "" : tag,
        )
      : xml,
  };
};

/**
 * Parse an uploaded Flex Query XML statement with the broker SDK's Flex parser,
 * the same parser broker sync uses. Naive `dateTime` values are read in the
 * statement timezone, so the "Default import timezone" setting applies to
 * uploads exactly as it applies to sync.
 */
export const parseFlexXmlImport = (content: string, timeZone: string): ParsedImport => {
  requireValue(
    !/^[+-]/.test(timeZone.trim()),
    "Choose a named IANA statement timezone for IBKR Flex statements, such as America/New_York, not a UTC offset.",
  );
  const zone = canonicalImportTimeZone(timeZone);
  const errors: string[] = [];
  const warnings: string[] = [];

  const rows = elements(content, "Trade");
  const accountIds = new Set(
    [...elements(content, "FlexStatement"), ...rows]
      .map((attrs) => attrs.accountId?.trim())
      .filter((id): id is string => Boolean(id)),
  );
  if (accountIds.size > 1)
    errors.push(
      `This Flex statement contains ${accountIds.size} IBKR accounts (${[...accountIds].join(", ")}). Export one account per Flex Query, or import each account's statement into its own journal account.`,
    );

  const { xml: executionXml, summaries } = withoutSummaryRows(content);
  if (summaries.length)
    warnings.push(
      `${summaries.length} Trade summary row(s) (${[...new Set(summaries.map((row) => row.levelOfDetail))].join(", ")}) were skipped; only execution rows are imported.`,
    );

  let parsed: ReturnType<typeof parseFlexStatement>;
  try {
    parsed = parseFlexStatement(executionXml, { statementTimeZone: zone });
  } catch (error) {
    if (error instanceof BrokerError) requireValue(false, error.message);
    throw error;
  }

  const { timed, untimed } = brokerTradesToExecutions(parsed.trades);
  const dropped = rows.length - summaries.length - parsed.trades.length;
  if (dropped > 0)
    warnings.push(
      `${dropped} Trade row(s) were skipped: a missing symbol, side, quantity or price, or a zero price such as an option expiry or assignment.`,
    );
  if (untimed > 0)
    warnings.push(
      `${untimedFillsReason(untimed, true)} Flex dates must use the default yyyyMMdd date and HHmmss time formats.`,
    );
  if (timed.length === 0 && errors.length === 0)
    errors.push(
      "No executions could be read from this Flex statement. Include the Trades section at Execution level in the Flex Query.",
    );

  return {
    format: IBKR_FLEX_XML.id,
    executions: timed,
    skippedRows: dropped + untimed,
    warnings,
    ...(errors.length ? { errors } : {}),
  };
};

/**
 * An upload into an IBKR sync account must use the statement timezone sync
 * uses, or the same fills would hash differently and be stored twice.
 */
export const flexUploadSyncProblem = (accountId: string, zone: string): string | null => {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account || (!isIbkrSyncAccount(account) && account.ibkrSyncTimeZone === null)) return null;
  const syncZone = canonicalImportTimeZone(account.ibkrSyncTimeZone ?? getImportTimeZone());
  const uploadZone = canonicalImportTimeZone(zone);
  if (uploadZone !== syncZone)
    return `This account syncs IBKR statements in ${syncZone}, but this upload uses ${uploadZone}. Upload with the ${syncZone} statement timezone so uploaded and synced fills match, or import into a separate account.`;
  try {
    assertIbkrSyncTimeZone(account, uploadZone);
  } catch (error) {
    if (error instanceof RequestError) return error.message;
    throw error;
  }
  return null;
};
