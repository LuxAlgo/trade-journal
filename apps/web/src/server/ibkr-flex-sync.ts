import {
  parseOptionSymbol,
  resolveOptionInstrument,
  type AssetClass,
  type BrokerExecutionMetadata,
} from "@luxalgo/journal-core";
import {
  parseTimestamp,
  type ImportedExecution,
  type ParsedImport,
} from "@luxalgo/journal-importers";

type Attributes = Record<string, string>;

export interface IbkrFlexSyncResult {
  executions: ImportedExecution[];
  warnings: string[];
  stats: {
    trades: number;
    lifecycleEvents: number;
    lifecycleClosures: number;
    unresolvedLifecycleEvents: number;
    expiredContractsWithoutLifecycle: number;
    identifiedSpreadOrders: number;
  };
}

export interface IbkrFlexParseOptions {
  now?: Date;
  timeZone?: string;
  /** Sync windows omit unmatched closes; upload windows retain them for cross-file matching. */
  reconcileWindow?: boolean;
  reportExpiredGaps?: boolean;
}

const ASSET_CLASSES: Record<string, AssetClass> = {
  STK: "equity",
  OPT: "option",
  FOP: "option",
  FUT: "futures",
  CASH: "forex",
  CRYPTO: "crypto",
  CFD: "cfd",
};

const decodeXml = (value: string): string =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

const parseAttributes = (text: string): Attributes => {
  const row: Attributes = {};
  for (const pair of text.matchAll(/([\w-]+)="([^"]*)"/g)) {
    if (pair[1]) row[pair[1]] = decodeXml(pair[2] ?? "");
  }
  return row;
};

const elements = (xml: string, tag: string): Attributes[] => {
  const rows: Attributes[] = [];
  for (const match of xml.matchAll(new RegExp(`<${tag}\\s+([^>]*?)/?>`, "g"))) {
    rows.push(parseAttributes(match[1] ?? ""));
  }
  return rows;
};

const statementElements = (xml: string, tag: string): Attributes[] => {
  const statements = [...xml.matchAll(/<FlexStatement\s+([^>]*?)>([\s\S]*?)<\/FlexStatement>/g)];
  if (statements.length === 0) return elements(xml, tag);
  return statements.flatMap((statement) => {
    const accountId = parseAttributes(statement[1] ?? "").accountId;
    return elements(statement[2] ?? "", tag).map((row) => ({
      ...(accountId ? { accountId } : {}),
      ...row,
    }));
  });
};

const attr = (row: Attributes, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
};

const number = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const flexTimestamp = (
  raw: string | undefined,
  timeZone: string,
  endOfDay = false,
): string | undefined => {
  if (!raw) return undefined;
  let normalized = raw.trim();
  const compactDate = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactDate) {
    normalized = `${compactDate[1]}-${compactDate[2]}-${compactDate[3]}`;
  } else if (/^\d{4}-\d{2}-\d{2};/.test(normalized)) {
    normalized = normalized.replace(";", " ");
  }
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += " 23:59:59";
  return parseTimestamp(normalized, timeZone) ?? undefined;
};

const brokerMetadata = (
  row: Attributes,
  kind: BrokerExecutionMetadata["kind"],
): BrokerExecutionMetadata => ({
  provider: "ibkr-flex",
  kind,
  accountId: attr(row, "accountId"),
  tradeId: attr(row, "tradeID"),
  transactionId: attr(row, "transactionID"),
  executionId: attr(row, "ibExecID"),
  orderId: attr(row, "ibOrderID"),
  brokerageOrderId: attr(row, "brokerageOrderID"),
  orderReference: attr(row, "orderReference"),
  relatedTradeId: attr(row, "relatedTradeID"),
  relatedTransactionId: attr(row, "relatedTransactionID"),
  conid: attr(row, "conid"),
  openCloseIndicator: attr(row, "openCloseIndicator"),
  notes: attr(row, "notes", "notesCodes"),
  transactionType: attr(row, "transactionType"),
  realizedPnl: number(attr(row, "realizedPnl", "fifoPnlRealized")),
  proceeds: number(attr(row, "proceeds")),
  basis: number(attr(row, "cost", "costBasis", "basis")),
});

const metadataId = (row: Attributes, index: number, prefix: string): string => {
  const brokerId = attr(row, "transactionID", "tradeID", "ibExecID");
  if (brokerId) return `${prefix}:${attr(row, "accountId") ?? ""}:${brokerId}`;
  return [
    prefix,
    attr(row, "accountId"),
    attr(row, "conid", "symbol"),
    attr(row, "dateTime", "date", "tradeDate"),
    attr(row, "buySell", "transactionType"),
    attr(row, "quantity"),
    attr(row, "tradePrice"),
    attr(row, "ibOrderID"),
    index,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(":");
};

const instrument = (row: Attributes) =>
  resolveOptionInstrument({
    symbol: attr(row, "symbol"),
    description: attr(row, "description"),
    underlying: attr(row, "underlyingSymbol"),
    expiry: attr(row, "expiry"),
    strike: attr(row, "strike"),
    right: attr(row, "putCall"),
    assetClass: ASSET_CLASSES[attr(row, "assetCategory", "assetClass") ?? ""],
  });

const explicitStrategyGroup = (broker: BrokerExecutionMetadata): string | undefined => {
  const id = broker.orderId ?? broker.orderReference ?? broker.brokerageOrderId;
  return id ? `ibkr-order:${broker.accountId ?? ""}:${id}` : undefined;
};

const positionKey = (accountId: string | undefined, symbol: string): string =>
  `${accountId ?? ""}\u0000${symbol}`;

const executionPositionKey = (execution: ImportedExecution): string =>
  positionKey(execution.importMetadata?.broker?.accountId, execution.symbol);

const discardUnsharedExplicitGroups = (executions: ImportedExecution[]): void => {
  const symbolsByGroup = new Map<string, Set<string>>();
  for (const execution of executions) {
    const group = execution.importMetadata?.broker?.strategyGroupId;
    if (!group) continue;
    const symbols = symbolsByGroup.get(group) ?? new Set<string>();
    symbols.add(execution.symbol);
    symbolsByGroup.set(group, symbols);
  }
  for (const execution of executions) {
    const broker = execution.importMetadata?.broker;
    if (broker?.strategyGroupId && symbolsByGroup.get(broker.strategyGroupId)?.size === 1) {
      delete broker.strategyGroupId;
    }
  }
};

const addStructuralSpreadGroups = (executions: ImportedExecution[]): number => {
  const candidates = new Map<string, ImportedExecution[]>();
  for (const execution of executions) {
    const contract = parseOptionSymbol(execution.symbol);
    if (!contract || execution.importMetadata?.broker?.kind !== "trade") continue;
    if (execution.importMetadata.broker.strategyGroupId) continue;
    const key = [
      execution.importMetadata.broker.accountId ?? "",
      execution.executedAt,
      contract.underlying,
      contract.expiry,
      contract.right,
      execution.quantity,
    ].join("|");
    const group = candidates.get(key);
    if (group) group.push(execution);
    else candidates.set(key, [execution]);
  }

  let grouped = 0;
  for (const [key, group] of candidates) {
    if (
      group.length !== 2 ||
      group[0]!.side === group[1]!.side ||
      group[0]!.symbol === group[1]!.symbol
    ) {
      continue;
    }
    const groupId = `ibkr-vertical:${key}`;
    for (const execution of group) {
      execution.importMetadata!.broker!.strategyGroupId = groupId;
    }
    grouped++;
  }
  return grouped;
};

const reconcileClosingTrades = (
  rows: ImportedExecution[],
): {
  executions: ImportedExecution[];
  signedPositions: Map<string, number>;
  clamped: number;
  omitted: number;
} => {
  const sorted = [...rows].sort(
    (left, right) =>
      Date.parse(left.executedAt) - Date.parse(right.executedAt) ||
      (left.importMetadata?.order ?? 0) - (right.importMetadata?.order ?? 0),
  );
  const executions: ImportedExecution[] = [];
  const signedPositions = new Map<string, number>();
  let clamped = 0;
  let omitted = 0;

  for (const execution of sorted) {
    const openClose = execution.importMetadata?.broker?.openCloseIndicator?.toUpperCase();
    const key = executionPositionKey(execution);
    const current = signedPositions.get(key) ?? 0;
    const signed = execution.side === "buy" ? execution.quantity : -execution.quantity;
    let next = execution;
    if (openClose?.startsWith("C")) {
      if (Math.abs(current) <= 1e-9 || Math.sign(current) === Math.sign(signed)) {
        omitted++;
        continue;
      }
      const closingQuantity = Math.min(execution.quantity, Math.abs(current));
      if (closingQuantity < execution.quantity) {
        next = { ...execution, quantity: closingQuantity };
        clamped++;
      }
    }
    const nextSigned = next.side === "buy" ? next.quantity : -next.quantity;
    signedPositions.set(key, current + nextSigned);
    executions.push(next);
  }
  return { executions, signedPositions, clamped, omitted };
};

const deduplicateNormalizedTrades = (rows: ImportedExecution[]): ImportedExecution[] => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [
      row.symbol,
      row.side,
      row.quantity.toPrecision(12),
      row.price.toPrecision(12),
      row.executedAt,
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const deduplicateBrokerIds = (rows: ImportedExecution[]): ImportedExecution[] => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const id = row.importMetadata?.id;
    if (!id || !seen.has(id)) {
      if (id) seen.add(id);
      return true;
    }
    return false;
  });
};

export const parseIbkrFlexSync = (
  xml: string,
  input: Date | IbkrFlexParseOptions = {},
): IbkrFlexSyncResult => {
  const options: IbkrFlexParseOptions = input instanceof Date ? { now: input } : input;
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? "UTC";
  const reconcileWindow = options.reconcileWindow ?? true;
  const warnings: string[] = [];
  const tradeExecutions: ImportedExecution[] = [];
  let unpricedClosingTrades = 0;

  for (const [index, row] of statementElements(xml, "Trade").entries()) {
    const resolved = instrument(row);
    const sideRaw = attr(row, "buySell")?.toUpperCase();
    const quantity = Math.abs(number(attr(row, "quantity")) ?? 0);
    const reportedPrice = number(attr(row, "tradePrice"));
    const executedAt = flexTimestamp(attr(row, "dateTime", "tradeDate"), timeZone);
    const broker = brokerMetadata(row, "trade");
    const multiplier = number(attr(row, "multiplier")) ?? 100;
    let price = reportedPrice;
    if (
      resolved.assetClass === "option" &&
      broker.openCloseIndicator?.toUpperCase().startsWith("C") &&
      reportedPrice === 0
    ) {
      price =
        broker.basis !== undefined &&
        broker.realizedPnl !== undefined &&
        quantity > 0 &&
        multiplier > 0
          ? Math.abs(broker.basis - broker.realizedPnl) / (quantity * multiplier)
          : undefined;
      if (price !== undefined) broker.settlementPriceSource = "realized-pnl-basis";
    } else if (reportedPrice !== undefined) {
      broker.settlementPriceSource = "trade-price";
    }
    if (
      !resolved.symbol ||
      (sideRaw !== "BUY" && sideRaw !== "SELL") ||
      quantity <= 0 ||
      price === undefined ||
      price < 0 ||
      !executedAt
    ) {
      if (
        resolved.assetClass === "option" &&
        broker.openCloseIndicator?.toUpperCase().startsWith("C") &&
        reportedPrice === 0 &&
        price === undefined
      ) {
        unpricedClosingTrades++;
      }
      continue;
    }
    broker.strategyGroupId = explicitStrategyGroup(broker);
    tradeExecutions.push({
      symbol: resolved.symbol,
      side: sideRaw === "BUY" ? "buy" : "sell",
      quantity,
      price,
      fee: Math.abs(number(attr(row, "ibCommission")) ?? 0),
      executedAt,
      assetClass: resolved.assetClass,
      importMetadata: {
        id: metadataId(row, index, "ibkr-trade"),
        ...(broker.accountId ? { group: `ibkr-account:${broker.accountId}` } : {}),
        order: index,
        preserveFee: true,
        broker,
      },
    });
  }
  if (unpricedClosingTrades > 0) {
    warnings.push(
      `${unpricedClosingTrades} zero-price option closing fill(s) lacked both Cost Basis and Realized P/L, so their settlement value could not be determined and they were not journaled.`,
    );
  }

  const normalizedTrades = reconcileWindow
    ? deduplicateNormalizedTrades(tradeExecutions)
    : deduplicateBrokerIds(tradeExecutions);
  const reconciled = reconcileWindow
    ? reconcileClosingTrades(normalizedTrades)
    : {
        executions: normalizedTrades,
        signedPositions: normalizedTrades.reduce((positions, execution) => {
          const signed = execution.side === "buy" ? execution.quantity : -execution.quantity;
          const key = executionPositionKey(execution);
          positions.set(key, (positions.get(key) ?? 0) + signed);
          return positions;
        }, new Map<string, number>()),
        clamped: 0,
        omitted: 0,
      };
  const executions = reconciled.executions;
  if (reconciled.clamped > 0 || reconciled.omitted > 0) {
    warnings.push(
      `${reconciled.clamped} closing fill(s) were limited to the position visible inside the query window and ${reconciled.omitted} unmatched closing fill(s) were omitted, preventing pre-window history from creating false reverse positions.`,
    );
  }
  discardUnsharedExplicitGroups(executions);
  const inferredSpreadOrders = addStructuralSpreadGroups(executions);
  const spreadOrders = new Set(
    executions
      .map((execution) => execution.importMetadata?.broker?.strategyGroupId)
      .filter((value): value is string => Boolean(value)),
  );
  const signedPositions = reconciled.signedPositions;

  let lifecycleClosures = 0;
  let unresolvedLifecycleEvents = 0;
  const lifecycleRows = statementElements(xml, "OptionEAE");
  for (const [index, row] of lifecycleRows.entries()) {
    const resolved = instrument(row);
    if (resolved.assetClass !== "option" || resolved.missingContract) continue;
    const reportedQuantity = Math.abs(number(attr(row, "quantity")) ?? 0);
    const executedAt = flexTimestamp(attr(row, "dateTime", "date", "tradeDate"), timeZone, true);
    const transactionType = attr(row, "transactionType")?.toUpperCase() ?? "";
    const key = positionKey(attr(row, "accountId"), resolved.symbol);
    const openQuantity = signedPositions.get(key) ?? 0;
    const side = openQuantity > 0 ? "sell" : openQuantity < 0 ? "buy" : undefined;
    const quantity = Math.min(reportedQuantity, Math.abs(openQuantity));
    const multiplier = number(attr(row, "multiplier")) ?? 100;
    const proceeds = number(attr(row, "proceeds"));
    const reportedPrice = number(attr(row, "tradePrice"));
    const price =
      reportedPrice ??
      (proceeds !== undefined && quantity > 0 && multiplier > 0
        ? Math.abs(proceeds) / (quantity * multiplier)
        : undefined);

    if (!side || quantity <= 0 || !executedAt || price === undefined || price < 0) {
      unresolvedLifecycleEvents++;
      warnings.push(
        `${resolved.symbol}: ${transactionType || "option lifecycle event"} lacks enough direction, quantity, date, Trade Price or Proceeds data to determine its expiration value.`,
      );
      continue;
    }

    const broker = brokerMetadata(row, "option-lifecycle");
    broker.settlementPriceSource = reportedPrice !== undefined ? "trade-price" : "proceeds";
    executions.push({
      symbol: resolved.symbol,
      side,
      quantity,
      price,
      fee: Math.abs(number(attr(row, "commTax", "commission", "ibCommission")) ?? 0),
      executedAt,
      assetClass: "option",
      importMetadata: {
        id: metadataId(row, index, "ibkr-option-lifecycle"),
        ...(broker.accountId ? { group: `ibkr-account:${broker.accountId}` } : {}),
        order: executions.length + index,
        preserveFee: true,
        broker,
      },
    });
    signedPositions.set(key, openQuantity + (side === "buy" ? quantity : -quantity));
    lifecycleClosures++;
  }

  const openPositionSymbols = new Set(
    statementElements(xml, "OpenPosition").flatMap((row) => {
      const symbol = instrument(row).symbol;
      return symbol ? [positionKey(attr(row, "accountId"), symbol)] : [];
    }),
  );
  const today = now.toISOString().slice(0, 10);
  const expiredWithoutLifecycle = [...signedPositions].filter(([key, quantity]) => {
    if (Math.abs(quantity) <= 1e-9 || openPositionSymbols.has(key)) return false;
    const symbol = key.split("\u0000")[1] ?? key;
    const contract = parseOptionSymbol(symbol);
    return contract !== null && contract.expiry < today;
  });
  if ((options.reportExpiredGaps ?? reconcileWindow) && expiredWithoutLifecycle.length > 0) {
    warnings.push(
      `${expiredWithoutLifecycle.length} expired option contract(s) are absent from current positions but have no usable Option Exercises, Assignments and Expirations record. Their expiration proceeds and P&L cannot be determined from the exposed data.`,
    );
  }

  return {
    executions,
    warnings,
    stats: {
      trades: executions.length - lifecycleClosures,
      lifecycleEvents: lifecycleRows.length,
      lifecycleClosures,
      unresolvedLifecycleEvents,
      expiredContractsWithoutLifecycle: expiredWithoutLifecycle.length,
      identifiedSpreadOrders: spreadOrders.size || inferredSpreadOrders,
    },
  };
};

export const isIbkrFlexXml = (content: string): boolean =>
  /^\s*<FlexQueryResponse\b/.test(content) && /<FlexStatement\b/.test(content);

export const parseIbkrFlexXmlImport = (content: string, timeZone = "UTC"): ParsedImport => {
  const result = parseIbkrFlexSync(content, {
    timeZone,
    reconcileWindow: false,
    reportExpiredGaps: false,
  });
  return {
    format: "ibkr-flex-xml",
    executions: result.executions,
    skippedRows: result.stats.unresolvedLifecycleEvents,
    warnings: result.warnings,
    ...(result.executions.length === 0
      ? { errors: ["No usable Trade or option lifecycle records were found in the Flex XML."] }
      : {}),
  };
};
