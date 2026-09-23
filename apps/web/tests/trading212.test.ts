import { describe, expect, it, vi } from "vitest";
import { fetchTrading212Snapshot, trading212Execution } from "../src/server/trading212";

describe("Trading 212 sync", () => {
  it("uses Basic auth with the selected environment and imports filled orders", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://demo.trading212.com");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Basic ${Buffer.from("key-id:secret-key").toString("base64")}`,
      );
      if (url.pathname.endsWith("/account/summary")) {
        return Response.json({
          id: 42,
          currency: "GBP",
          totalValue: 1000,
          cash: { availableToTrade: 300 },
        });
      }
      if (url.pathname.endsWith("/positions")) {
        return Response.json([
          {
            instrument: { ticker: "AAPL_US_EQ" },
            quantity: 2,
            walletImpact: { currentValue: 400 },
          },
        ]);
      }
      return Response.json({
        items: [
          {
            order: { ticker: "AAPL_US_EQ", side: "BUY" },
            fill: { quantity: 2, price: 200, filledAt: "2026-09-22T10:00:00Z" },
          },
          { order: { ticker: "AAPL_US_EQ", side: "BUY" }, fill: null },
        ],
        nextPagePath: null,
      });
    });
    const snapshot = await fetchTrading212Snapshot(
      { apiKey: "key-id", apiSecret: "secret-key", environment: "demo" },
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(snapshot.accounts[0]).toMatchObject({
      id: "trading212-42",
      equity: 1000,
      cash: 300,
      positions: [{ symbol: "AAPL", quantity: 2, marketValue: 400 }],
      trades: [
        {
          symbol: "AAPL",
          side: "buy",
          quantity: 2,
          price: 200,
          executedAt: "2026-09-22T10:00:00Z",
        },
      ],
    });
  });

  it("rejects missing credentials and never follows an unrelated page path", async () => {
    await expect(fetchTrading212Snapshot({ apiKey: "key" })).rejects.toThrow("secret key");
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/account/summary")) return Response.json({ totalValue: 10 });
      if (path.endsWith("/positions")) return Response.json([]);
      return Response.json({ items: [], nextPagePath: "/api/v0/equity/orders" });
    });
    await expect(
      fetchTrading212Snapshot({ apiKey: "key", apiSecret: "secret" }, fetcher),
    ).rejects.toThrow("invalid history page path");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("ignores unfilled orders", () => {
    expect(
      trading212Execution({ order: { ticker: "AAPL_US_EQ", side: "BUY" }, fill: null }),
    ).toBeNull();
  });
});
