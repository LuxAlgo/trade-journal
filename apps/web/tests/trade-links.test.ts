import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import {
  tradeLinkLabel,
  tradeMarkdownLink,
  tradePath,
  tradeKeyFromSegment,
} from "../src/lib/trade-links";

describe("exact trade links", () => {
  it("accepts encoded client navigation and decoded reload params without decoding a literal percent twice", () => {
    const key = "account|S%P|long|2026-09-01T14:30:00Z";
    expect(tradeKeyFromSegment(encodeURIComponent(key))).toBe(key);
    expect(tradeKeyFromSegment(key)).toBe(key);
  });
  const first = {
    key: "one|ES|long|2026-09-01T14:30:00Z",
    symbol: "ES",
    direction: "long",
    openedAt: "2026-09-01T14:30:00Z",
    accountName: "Main account",
  };
  it("distinguishes trades by time and account even with the same symbol and day", () => {
    const later = {
      ...first,
      key: "one|ES|long|2026-09-01T15:30:00Z",
      openedAt: "2026-09-01T15:30:00Z",
    };
    const otherAccount = {
      ...first,
      key: "two|ES|long|2026-09-01T14:30:00Z",
      accountName: "Second account",
    };
    expect(new Set([first, later, otherAccount].map(tradeLinkLabel)).size).toBe(3);
    expect(new Set([first, later, otherAccount].map(tradeMarkdownLink)).size).toBe(3);
  });
  it("renders a clickable exact key and escapes special characters in the label", () => {
    const trade = {
      ...first,
      key: "acct|S%P/[X]|long|2026-09-01T14:30:00Z",
      symbol: "S%P/[X]",
      accountName: "**Main** [account]",
    };
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown, { children: tradeMarkdownLink(trade) }),
    );
    expect(html).toContain(`href="${tradePath(trade.key)}"`);
    expect(decodeURIComponent(tradePath(trade.key).slice("/trades/".length))).toBe(trade.key);
    expect(html).not.toContain("<strong>");
  });
});
