/* Adapted from ChristopherDownie/prop-firm-sim, commit 2aedb92208ab34ef7a1d0e42c290b8b78bae081f.
 * Copyright (c) 2026 LuxAlgo. MIT license: packages/importers/LICENSE.
 * Journal adaptation keeps history parsing separate from existing fill importers. */

/*
  Header → canonical-field mapping for tabular imports. Matching is
  deterministic: exact alias lookup on a normalized header (lowercased,
  punctuation and spaces removed, trailing currency codes stripped), then a
  short prefix list. Ambiguous headers ("type", "side", "action") are resolved
  by inspecting the column's VALUES, never guessed from the name alone.
*/

import type { CanonicalField, ColumnMapping } from "./model";
import type { CsvRecord } from "./csv";

/** Lowercase, spell out "%", strip the rest: "Net PnL (USD)" → "netpnlusd", "Return %" → "returnpct". */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/%/gu, "pct")
    .replace(/[^a-z0-9]/gu, "");
}

const CURRENCY_SUFFIX = /(usd|eur|gbp|jpy|aud|cad|chf|nzd|usdt|usdc|btc|eth)$/;

/** Strip a trailing currency code: "netpnlusd" → "netpnl". */
function stripCurrency(normalized: string): string {
  return normalized.replace(CURRENCY_SUFFIX, "");
}

/**
 * Exact-alias dictionary (normalized names). Order within a field does not
 * matter; conflicts across fields are resolved by first-listed field below.
 */
const ALIASES: ReadonlyArray<readonly [CanonicalField, readonly string[]]> = [
  // R first: legacy parseTradeLog treated "result" as R, keep that meaning.
  [
    "r",
    [
      "r",
      "rmultiple",
      "rmultiples",
      "rr",
      "rrr",
      "resultr",
      "pnlr",
      "realizedr",
      "rmult",
      "riskmultiple",
      "result",
      "rvalue",
    ],
  ],
  [
    "tradeId",
    [
      "tradeid",
      "trade",
      "tradenumber",
      "tradeno",
      "positionid",
      "position",
      "ticket",
      "ticketnumber",
      "dealid",
      "deal",
      "id",
      "tradeidnumber",
    ],
  ],
  ["orderId", ["orderid", "order", "orderno", "ordernumber", "orderref", "orderreference"]],
  [
    "symbol",
    [
      "symbol",
      "symbols",
      "instrument",
      "ticker",
      "tickersymbol",
      "market",
      "pair",
      "currencypair",
      "asset",
      "security",
      "item",
      "symbolname",
      "underlying",
    ],
  ],
  [
    "direction",
    [
      "direction",
      "side",
      "buysell",
      "bs",
      "longshort",
      "positionside",
      "tradeside",
      "tradetype",
      "marketpos",
      "marketposition",
      "openingdirection",
    ],
  ],
  ["eventType", ["eventtype", "event", "entryexit", "inout", "transactiontype"]],
  [
    "quantity",
    [
      "quantity",
      "qty",
      "size",
      "sizeqty",
      "volume",
      "lots",
      "lotsize",
      "contracts",
      "shares",
      "units",
      "filledqty",
      "fillquantity",
      "filledquantity",
      "filled",
      "positionsize",
      "positionsizeqty",
      "numberofcontracts",
    ],
  ],
  [
    "entryTime",
    [
      "entrytime",
      "opentime",
      "openedat",
      "opened",
      "opendate",
      "dateopened",
      "entrydate",
      "entrydatetime",
      "opentimeutc",
      "openperiod",
      "boughttimestamp",
      "entrytimestamp",
      "opentimestamp",
      "starttime",
      "startdate",
    ],
  ],
  [
    "exitTime",
    [
      "exittime",
      "closetime",
      "closedat",
      "closed",
      "closedate",
      "dateclosed",
      "exitdate",
      "exitdatetime",
      "closetimeutc",
      "soldtimestamp",
      "exittimestamp",
      "closetimestamp",
      "endtime",
      "enddate",
    ],
  ],
  // Single time column (executions / event rows / dateless journals).
  [
    "entryTime",
    [
      "time",
      "date",
      "datetime",
      "dateandtime",
      "timestamp",
      "filltime",
      "executiontime",
      "tradetime",
      "tradedate",
      "transactiontime",
    ],
  ],
  [
    "entryPrice",
    [
      "entryprice",
      "openprice",
      "priceopen",
      "avgentryprice",
      "averageentryprice",
      "buyprice",
      "entry",
      "pricein",
      "openingprice",
      "entryavg",
      "openavg",
    ],
  ],
  [
    "exitPrice",
    [
      "exitprice",
      "closeprice",
      "priceclose",
      "avgexitprice",
      "averageexitprice",
      "sellprice",
      "exit",
      "priceout",
      "closingprice",
      "exitavg",
      "closeavg",
    ],
  ],
  // Single price column (executions / event rows).
  [
    "entryPrice",
    ["price", "fillprice", "avgprice", "avgfillprice", "executionprice", "tradedprice"],
  ],
  [
    "stopPrice",
    [
      "stoploss",
      "stop",
      "sl",
      "stopprice",
      "initialstop",
      "initialstoploss",
      "stoplossprice",
      "slprice",
      "protectivestop",
    ],
  ],
  [
    "pnl",
    [
      "pnl",
      "pl",
      "netpnl",
      "netprofit",
      "profit",
      "profitloss",
      "profitandloss",
      "realizedpnl",
      "realizedpl",
      "realized",
      "netpl",
      "netgain",
      "gain",
      "gainloss",
      "grosspnl",
      "grossprofit",
      "closedpnl",
      "tradepnl",
    ],
  ],
  [
    "fees",
    [
      "commission",
      "commissions",
      "fee",
      "fees",
      "comm",
      "commissionfees",
      "commfees",
      "totalfees",
      "brokeragefees",
      "commissionsfees",
    ],
  ],
  ["swap", ["swap", "swaps", "rollover", "financing", "overnightfee", "overnightfees"]],
  [
    "riskAmount",
    [
      "risk",
      "riskamount",
      "initialrisk",
      "riskedamount",
      "risked",
      "dollarrisk",
      "cashrisk",
      "riskvalue",
      "riskpertrade",
      "maxrisk",
    ],
  ],
  [
    "returnPct",
    ["returnpct", "return", "profitpct", "gainpct", "plpct", "changepct", "returnonequity", "roi"],
  ],
];

/**
 * Headers we recognize as real but irrelevant to the canonical model -
 * mapped nowhere, and never counted against detection confidence.
 */
const KNOWN_IRRELEVANT = new Set(
  [
    "signal",
    "comment",
    "comments",
    "note",
    "notes",
    "strategy",
    "setup",
    "tags",
    "mistake",
    "rating",
    "cumpnl",
    "cumulativepnl",
    "cumulativeprofit",
    "cumprofit",
    "balance",
    "equity",
    "spread",
    "cumulativepnlpct",
    "cumprofitpct",
    "cumulativeprofitpct",
    "runup",
    "drawdown",
    "runuppct",
    "drawdownpct",
    "favorableexcursion",
    "adverseexcursion",
    "favorableexcursionpct",
    "adverseexcursionpct",
    "mae",
    "mfe",
    "duration",
    "durationbars",
    "bars",
    "holdtime",
    "magic",
    "magicnumber",
    "expert",
    "taxes",
    "tax",
    "tp",
    "takeprofit",
    "takeprofitprice",
    "tpprice",
    "target",
    "targetprice",
    "sizevalue",
    "value",
    "account",
    "accountname",
    "accountid",
    "currency",
    "exchange",
    "broker",
    "session",
    "expiry",
    "cumnetprofit",
    "etd",
    "levelofdetail",
    "assetclass",
    "conid",
    "notescodes",
    "code",
    "codes",
    "entryname",
    "exitname",
    "product",
    "productdescription",
    "priceformat",
    "priceformattype",
    "ticksize",
    "venue",
    "notionalvalue",
    "lastcommandid",
    "versionid",
    "text",
    "decimallimit",
    "decimalstop",
    "decimalfillavg",
    "spreaddefinitionid",
    "limitprice",
    "pairid",
    "netpos",
    "netprice",
    "leverage",
    "margin",
    "levelid",
    "strike",
    "callput",
    "expiration",
    // "status" is consumed by the generic adapter's cancelled-row filter, not mapped.
    "status",
    "state",
    "orderstatus",
  ].map(normalizeHeader),
);

/** Fields whose "second occurrence" of the same header means the exit leg (MT4/MT5 style). */
const ENTRY_TO_EXIT: Partial<Record<CanonicalField, CanonicalField>> = {
  entryTime: "exitTime",
  entryPrice: "exitPrice",
};

const EXACT_LOOKUP = ((): Map<string, CanonicalField> => {
  const map = new Map<string, CanonicalField>();
  for (const [field, names] of ALIASES) {
    for (const name of names) if (!map.has(name)) map.set(name, field);
  }
  return map;
})();

/** Prefix fallbacks, checked only after exact lookup fails. Longest prefixes first. */
const PREFIX_LOOKUP: ReadonlyArray<readonly [string, CanonicalField]> = [
  ["netpnl", "pnl"],
  ["realizedpnl", "pnl"],
  ["profit", "pnl"],
  ["pnl", "pnl"],
  ["commission", "fees"],
  ["entryprice", "entryPrice"],
  ["exitprice", "exitPrice"],
  ["openprice", "entryPrice"],
  ["closeprice", "exitPrice"],
  ["price", "entryPrice"],
  ["stoploss", "stopPrice"],
  ["dateandtime", "entryTime"],
  ["datetime", "entryTime"],
  ["return", "returnPct"],
];

/** Match one header to a canonical field, or null. Deterministic; no fuzzy scoring. */
export function matchHeader(header: string): CanonicalField | null {
  const normalized = normalizeHeader(header);
  if (normalized === "" || KNOWN_IRRELEVANT.has(normalized)) return null;
  const exact = EXACT_LOOKUP.get(normalized) ?? EXACT_LOOKUP.get(stripCurrency(normalized));
  if (exact !== undefined) return exact;
  const stripped = stripCurrency(normalized);
  for (const [prefix, field] of PREFIX_LOOKUP) {
    if (stripped.startsWith(prefix)) return field;
  }
  return null;
}

const DIRECTION_VALUE = /^(buy|sell|long|short|b|s|bot|sld|bought|sold|1|-1)$/i;
const EVENT_VALUE = /^(entry|exit|open|close|in|out)([\s_-].*)?$/i;

export interface HeaderMappingResult {
  mapping: ColumnMapping;
  /** Headers that matched nothing (after the known-irrelevant list). */
  unmapped: string[];
  /** Normalized header names that were recognized (for confidence scoring). */
  matched: CanonicalField[];
}

/**
 * Map a header row to canonical fields.
 *
 * - A repeated header that maps to entryTime/entryPrice takes the exit slot on
 *   its second occurrence (MetaTrader's `...,Time,Price,...,Time,Price,...`).
 * - "type"/"side"/"action"-style columns are resolved by values: buy/sell/long/
 *   short → direction; entry/exit → eventType (direction is then derived from
 *   the event values by the caller).
 * - First match wins on any other collision; later duplicates go unmapped.
 */
export function mapHeaders(header: string[], sample: readonly CsvRecord[]): HeaderMappingResult {
  const mapping: ColumnMapping = {};
  const unmapped: string[] = [];
  const matched: CanonicalField[] = [];
  const claimedBy = new Map<CanonicalField, string>();

  const columnValues = (index: number): string[] => {
    const values: string[] = [];
    for (const record of sample.slice(0, 25)) {
      const v = (record.cells[index] ?? "").trim();
      if (v !== "") values.push(v);
    }
    return values;
  };

  header.forEach((raw, index) => {
    const normalized = normalizeHeader(raw);
    let field = matchHeader(raw);

    // Value-driven resolution for ambiguous action columns.
    if (
      normalized === "type" ||
      normalized === "action" ||
      field === "direction" ||
      field === "eventType"
    ) {
      const values = columnValues(index);
      if (values.length > 0) {
        const eventish = values.filter((v) => EVENT_VALUE.test(v)).length;
        const directionish = values.filter((v) => DIRECTION_VALUE.test(v)).length;
        if (eventish >= directionish && eventish > values.length / 2) field = "eventType";
        else if (directionish > values.length / 2) field = "direction";
        else if (normalized === "type" || normalized === "action") field = null;
      } else if (normalized === "type" || normalized === "action") {
        field = null;
      }
    }

    if (field === null) {
      if (!KNOWN_IRRELEVANT.has(normalized) && normalized !== "") unmapped.push(raw);
      return;
    }
    if (mapping[field] !== undefined) {
      // Only an IDENTICAL repeated header means "the exit leg" (MetaTrader's
      // `...,Time,Price,...,Time,Price`); different names ("Date" then "Time")
      // must not be promoted, or a time-of-day column becomes an exit time.
      const exitField = ENTRY_TO_EXIT[field];
      if (
        exitField !== undefined &&
        mapping[exitField] === undefined &&
        claimedBy.get(field) === normalized
      ) {
        mapping[exitField] = index;
        matched.push(exitField);
        return;
      }
      unmapped.push(raw);
      return;
    }
    mapping[field] = index;
    claimedBy.set(field, normalized);
    matched.push(field);
  });

  return { mapping, unmapped, matched };
}

/** Parse a direction cell; tolerant of platform vocabulary. */
export function parseDirectionValue(raw: string): "long" | "short" | null {
  const value = raw.trim().toLowerCase();
  if (/^(long|buy|b|bot|bought|1|buytoopen|buyopen)$/.test(value.replace(/[\s_-]/g, "")))
    return "long";
  if (
    /^(short|sell|s|sld|sold|-1|selltoopen|sellshort|sellopen)$/.test(value.replace(/[\s_-]/g, ""))
  )
    return "short";
  return null;
}
