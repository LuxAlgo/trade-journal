import { readFilters } from "@luxalgo/journal-core";
import { bad, handler, ok } from "@/server/api";
import { getAdjacentTradeKeys, getTradeByKey } from "@/server/trades-query";

export const GET = handler(
  async (request: Request, { params }: { params: Promise<{ key: string }> }) => {
    const { key } = await params;
    const row = getTradeByKey(key);
    if (!row) return bad("Trade not found", 404);
    const search = new URL(request.url).searchParams;
    return ok(
      getAdjacentTradeKeys(
        key,
        readFilters(search),
        search.get("tradeScope") === "account" ? row.accountId : undefined,
      ),
    );
  },
);
