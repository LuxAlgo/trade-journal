import type { ImportedExecution } from "@luxalgo/journal-importers";

const API_PATH = "/api/v0";
const HISTORY_PATH = `${API_PATH}/equity/history/orders`;

type Credentials = Record<string, string>;
type HistoryItem = {
  order?: { ticker?: string; side?: string; quantity?: number };
  fill?: { quantity?: number; price?: number; filledAt?: string } | null;
};

const symbol = (ticker: string) => ticker.split("_")[0] || ticker;

export function trading212Execution(item: HistoryItem): ImportedExecution | null {
  const order = item.order;
  const fill = item.fill;
  if (!order?.ticker || !fill) return null;
  const side = order.side?.toLowerCase();
  if (side !== "buy" && side !== "sell") return null;
  if (!fill.quantity || !fill.price || !fill.filledAt) return null;
  return {
    symbol: symbol(order.ticker),
    side,
    quantity: Math.abs(fill.quantity),
    price: fill.price,
    fee: 0,
    executedAt: fill.filledAt,
    assetClass: "equity",
  };
}

/** Trading 212's current key-pair API is not supported by broker-sdk 0.3.0. */
export async function fetchTrading212Snapshot(
  credentials: Credentials,
  fetcher: typeof fetch = fetch,
) {
  const { apiKey, apiSecret } = credentials;
  if (!apiKey || !apiSecret) throw new Error("Trading 212 needs an API key ID and secret key.");
  const environment = credentials.environment || "live";
  if (environment !== "live" && environment !== "demo") {
    throw new Error("Trading 212 environment must be live or demo.");
  }
  const origin = `https://${environment}.trading212.com`;
  const authorization = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`, "utf8").toString("base64")}`;

  const get = async (path: string): Promise<unknown> => {
    const url = new URL(path, origin);
    if (url.origin !== origin || !url.pathname.startsWith(`${API_PATH}/`)) {
      throw new Error("Trading 212 returned an invalid history page path.");
    }
    const response = await fetcher(url, { headers: { Authorization: authorization } });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "Trading 212 rejected the credentials or API permissions. Check the key pair, environment, and read access to account, positions, and history.",
        );
      }
      if (response.status === 429)
        throw new Error("Trading 212 rate limit reached. Try syncing again shortly.");
      throw new Error(`Trading 212 request failed (HTTP ${response.status}).`);
    }
    return response.json();
  };

  const summary = (await get(`${API_PATH}/equity/account/summary`)) as {
    id?: number;
    currency?: string;
    totalValue?: number;
    cash?: { availableToTrade?: number };
  };
  const rawPositions = (await get(`${API_PATH}/equity/positions`)) as {
    instrument?: { ticker?: string };
    quantity?: number;
    averagePricePaid?: number;
    walletImpact?: { currentValue?: number };
  }[];
  if (!Array.isArray(rawPositions) || !Number.isFinite(summary.totalValue)) {
    throw new Error("Trading 212 returned an unexpected account response.");
  }

  const trades: ImportedExecution[] = [];
  let nextPath: string | null = `${HISTORY_PATH}?limit=50`;
  const visited = new Set<string>();
  while (nextPath) {
    const historyUrl = new URL(nextPath, origin);
    if (historyUrl.origin !== origin || historyUrl.pathname !== HISTORY_PATH) {
      throw new Error("Trading 212 returned an invalid history page path.");
    }
    if (visited.has(nextPath)) throw new Error("Trading 212 repeated a history page.");
    visited.add(nextPath);
    // Historical orders are limited to six requests per minute.
    if (visited.size > 1) await new Promise((resolve) => setTimeout(resolve, 10_000));
    const page = (await get(nextPath)) as { items?: HistoryItem[]; nextPagePath?: string | null };
    if (!Array.isArray(page.items))
      throw new Error("Trading 212 returned an unexpected history response.");
    for (const item of page.items) {
      const execution = trading212Execution(item);
      if (execution) trades.push(execution);
    }
    nextPath = page.nextPagePath ?? null;
  }

  return {
    fetchedAt: new Date().toISOString(),
    accounts: [
      {
        id: `trading212-${summary.id ?? environment}`,
        name: "Trading 212",
        currency: summary.currency ?? "EUR",
        equity: summary.totalValue!,
        cash: summary.cash?.availableToTrade,
        positions: rawPositions.flatMap((position) => {
          const ticker = position.instrument?.ticker;
          if (!ticker || !position.quantity) return [];
          return [
            {
              symbol: symbol(ticker),
              quantity: position.quantity,
              ...(position.walletImpact?.currentValue !== undefined
                ? { marketValue: position.walletImpact.currentValue }
                : {}),
              ...(position.averagePricePaid !== undefined
                ? { averageEntryPrice: position.averagePricePaid }
                : {}),
              assetClass: "equity",
            },
          ];
        }),
        trades,
      },
    ],
  };
}
