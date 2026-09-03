export interface LinkableTrade {
  key: string;
  symbol: string;
  direction: string;
  openedAt: string;
  accountName: string;
}

export const tradePath = (key: string) => `/trades/${encodeURIComponent(key)}`;

/** Client navigation can supply an encoded segment; preserve literal % in an already decoded key. */
export const tradeKeyFromSegment = (segment: string) =>
  segment.includes("|") ? segment : decodeURIComponent(segment);

export const tradeLinkLabel = (trade: LinkableTrade) =>
  `${trade.symbol} · ${trade.direction} · ${trade.openedAt.replace("T", " ").replace(/Z$/, " UTC")} · ${trade.accountName}`;

export const tradeMarkdownLink = (trade: LinkableTrade) =>
  `[${tradeLinkLabel(trade)
    .replace(/[\\[\]`*_<>]/g, "\\$&")
    .replace(/[\r\n]+/g, " ")}](${tradePath(trade.key)})`;
