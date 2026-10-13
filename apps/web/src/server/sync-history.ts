/**
 * Broker trade history has a floor (Webull returns roughly the last year), so
 * a sync can see a fill that closes a position opened before that floor. Left
 * alone, the close books a position that never existed: selling shares bought
 * before the floor shows up as a phantom short. These pure helpers decide which
 * synced fills to drop and which expired option positions to close.
 */

export interface HistoryFill {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  executedAt: string;
  assetClass?: string;
  /** Broker-stated, e.g. Webull BUY_TO_OPEN. */
  positionEffect?: "open" | "close";
}

const EPS = 1e-9;
const signed = (fill: HistoryFill): number =>
  fill.side === "buy" ? fill.quantity : -fill.quantity;

/**
 * Indexes of `incoming` fills that close a position opened before the history
 * floor. `known` are fills already journaled. Incoming fills that duplicate a
 * known one must be left out by the caller, since both lists feed one running
 * position.
 *
 * - A fill the broker labels as a close, with nothing open on the other side,
 *   is dropped.
 * - Unlabeled equity fills: when the replay ends on a position the broker's own
 *   position list doesn't show, the incoming fills that opened it from flat are
 *   dropped, earliest first.
 *
 * ponytail: a close that only partly overshoots (sell 7 against 3 known) is
 * kept whole; splitting it would change the fill's dedupe hash between syncs.
 */
export const orphanFills = (
  known: HistoryFill[],
  incoming: HistoryFill[],
  brokerQuantity: (symbol: string) => number | undefined,
): Set<number> => {
  const dropped = new Set<number>();
  const bySymbol = new Map<string, { fill: HistoryFill; index: number }[]>();
  for (const fill of known) {
    const list = bySymbol.get(fill.symbol) ?? [];
    list.push({ fill, index: -1 });
    bySymbol.set(fill.symbol, list);
  }
  incoming.forEach((fill, index) => {
    const list = bySymbol.get(fill.symbol) ?? [];
    list.push({ fill, index });
    bySymbol.set(fill.symbol, list);
  });

  for (const [symbol, list] of bySymbol) {
    list.sort((a, b) => a.fill.executedAt.localeCompare(b.fill.executedAt));
    const replay = () => {
      let net = 0;
      const openedFromFlat: number[] = [];
      for (const { fill, index } of list) {
        if (dropped.has(index)) continue;
        const delta = signed(fill);
        if (index >= 0 && fill.positionEffect === "close" && net * delta >= -EPS) {
          dropped.add(index);
          continue;
        }
        if (index >= 0 && fill.positionEffect === undefined && Math.abs(net) < EPS) {
          openedFromFlat.push(index);
        }
        net += delta;
      }
      return { net, openedFromFlat };
    };

    let { net, openedFromFlat } = replay();
    const expected = brokerQuantity(symbol);
    if (expected === undefined || !list.some(({ fill }) => fill.assetClass === "equity")) continue;
    // Drop the earliest fill that opened from flat in the direction the broker
    // doesn't hold, until the replay agrees with the broker's position.
    while (Math.abs(net - expected) > EPS && Math.sign(net) !== Math.sign(expected)) {
      const culprit = openedFromFlat.find(
        (index) => Math.sign(signed(incoming[index]!)) === Math.sign(net),
      );
      if (culprit === undefined) break;
      dropped.add(culprit);
      ({ net, openedFromFlat } = replay());
    }
  }
  return dropped;
};

const newYorkHour = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  hourCycle: "h23",
});

/** 4pm New York on an OCC-style `YYMMDD` expiry, the regular-session close. */
const expiryClose = (yy: string, mm: string, dd: string): string => {
  for (const utcHour of [20, 21]) {
    const at = new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), utcHour));
    if (newYorkHour.format(at) === "16") return at.toISOString();
  }
  return new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), 20)).toISOString();
};

/**
 * Brokers like Webull record no order when an option expires, so an expired
 * contract with a net position would stay open forever. Close it at 0 at the
 * 4pm New York expiry; the fixed timestamp keeps the fill's hash stable across
 * syncs.
 *
 * ponytail: an in-the-money contract that was exercised or assigned is also
 * closed at 0, and the resulting stock position is left to the stock fills.
 * Telling the two apart needs the underlying's price at expiry.
 */
export const expiredOptionCloses = (optionFills: HistoryFill[], now: string): HistoryFill[] => {
  const net = new Map<string, number>();
  for (const fill of optionFills) net.set(fill.symbol, (net.get(fill.symbol) ?? 0) + signed(fill));
  const closes: HistoryFill[] = [];
  for (const [symbol, quantity] of net) {
    const expiry = /^\S+ (\d{2})(\d{2})(\d{2})[CP]\d/.exec(symbol);
    if (!expiry || Math.abs(quantity) < EPS) continue;
    const executedAt = expiryClose(expiry[1]!, expiry[2]!, expiry[3]!);
    if (executedAt >= now) continue;
    closes.push({
      symbol,
      side: quantity > 0 ? "sell" : "buy",
      quantity: Math.abs(quantity),
      executedAt,
      assetClass: "option",
    });
  }
  return closes;
};
