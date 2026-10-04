import { accounts, db } from "@/db";
import { eq } from "drizzle-orm";
import { bad, handler, ok, requireValue } from "@/server/api";
import { connectionKey, providerFor } from "@/server/market-data/connections";
import { MarketDataError } from "@/server/market-data/provider";
import { getTradeByKey, rowToTrade } from "@/server/trades-query";
import { listExecutions } from "@/server/executions";
import { isResolution } from "@/lib/market-data";
import { estimateExcursions } from "@/lib/excursions";

import { estimateFingerprint, saveEstimate, savedEstimates } from "@/server/market-data/estimates";

export const GET = handler(
  async (_request: Request, { params }: { params: Promise<{ key: string }> }) => {
    const { key } = await params;
    const row = getTradeByKey(key);
    if (!row) return bad("Trade not found", 404, "trade_not_found");
    return ok({ saved: savedEstimates([rowToTrade(row)]).get(key) ?? null });
  },
);

export const POST = handler(
  async (request: Request, { params }: { params: Promise<{ key: string }> }) => {
    const { key } = await params;
    const row = getTradeByKey(key);
    if (!row) return bad("Trade not found", 404, "trade_not_found");
    const body = await request.json();
    requireValue(body && typeof body.provider === "string", "Choose a market data provider.");
    requireValue(
      typeof body.symbol === "string" &&
        body.symbol.trim().length > 0 &&
        body.symbol.length <= 100 &&
        !/[\x00-\x1f]/.test(body.symbol),
      "Enter the provider's exact instrument symbol.",
    );
    requireValue(
      body.dataset === undefined ||
        (typeof body.dataset === "string" && /^[a-zA-Z0-9_-]{0,80}$/.test(body.dataset)),
      "Invalid dataset.",
    );
    requireValue(isResolution(body.resolution), "Choose a supported candle resolution.");
    requireValue(
      body.basisConfirmed === undefined || typeof body.basisConfirmed === "boolean",
      "Invalid price basis confirmation.",
    );
    requireValue(
      body.estimateOnly === undefined || typeof body.estimateOnly === "boolean",
      "Invalid response mode.",
    );
    requireValue(Boolean(row.closedAt), "Market replay is available for closed trades only.");
    requireValue(
      row.assetClass !== "option",
      "Option contract history is not supported by this connector yet. An underlying's candles cannot stand in for option prices.",
    );
    const from = Date.parse(row.openedAt),
      to = Date.parse(row.closedAt!);
    requireValue(
      Number.isFinite(from) && Number.isFinite(to) && to > from && to <= Date.now(),
      "Trade must have valid past entry and exit timestamps.",
    );
    try {
      const provider = providerFor(body.provider);
      if (["binance", "coinbase"].includes(provider.id))
        requireValue(
          row.assetClass == null || row.assetClass === "crypto",
          "This provider supplies spot crypto candles only. Choose a crypto trade.",
        );
      if (provider.id === "alpaca")
        requireValue(
          row.assetClass == null ||
            (body.dataset === "crypto" ? row.assetClass === "crypto" : row.assetClass === "equity"),
          "Choose the Alpaca dataset that matches this trade's asset class.",
        );
      if (provider.id === "oanda")
        requireValue(
          row.assetClass == null || ["forex", "cfd"].includes(row.assetClass),
          "OANDA supports forex and CFD instruments.",
        );
      const trade = rowToTrade(row);
      const fingerprint = estimateFingerprint(trade);
      const history = await provider.history(
        {
          symbol: body.symbol.trim(),
          dataset: body.dataset || undefined,
          resolution: body.resolution,
          from,
          to,
          signal: request.signal,
        },
        connectionKey(provider.id),
      );
      const accountCurrency = db
        .select({ currency: accounts.currency })
        .from(accounts)
        .where(eq(accounts.id, row.accountId))
        .get()?.currency;
      const currencyMatches = !history.quoteCurrency || history.quoteCurrency === accountCurrency;
      const estimate = estimateExcursions(
        trade,
        listExecutions(row.accountId, trade.executionIds),
        history,
        body.basisConfirmed === true && currencyMatches,
      );
      if (!currencyMatches)
        estimate.warnings.unshift(
          `The candle quote currency (${history.quoteCurrency}) differs from this account (${accountCurrency}). Monetary estimates are unavailable; no FX conversion is applied.`,
        );
      const current = getTradeByKey(key);
      if (current && estimateFingerprint(rowToTrade(current)) === fingerprint)
        saveEstimate(trade, { ...history, estimate }, fingerprint);
      if (body.estimateOnly) {
        const { bars: _bars, ...metadata } = history;
        return ok({ ...metadata, estimate });
      }
      return ok({ ...history, estimate });
    } catch (error) {
      if (error instanceof MarketDataError)
        return bad(error.message, 502, "market_data_unavailable");
      throw error;
    }
  },
);
