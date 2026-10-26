/**
 * A broker's trade history starts somewhere (Webull keeps about a year), so a
 * sync can see a fill that closes a position opened before that start. Booked
 * as is, it shows a position that never existed: selling shares bought before
 * the start becomes a short. These pure helpers decide how much of each new
 * fill the journal keeps, and close option positions that expired while held.
 */

export interface SyncedFill {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  executedAt: string;
  assetClass?: string | null;
  /** Broker-stated: whether the fill opened or closed a position. */
  positionEffect?: "open" | "close";
  /** A separately held position on the same symbol, as round trips group it. */
  group?: string;
}

const EPS = 1e-9;
const direction = (fill: SyncedFill): number => (fill.side === "buy" ? 1 : -1);

/**
 * How much to keep of each `fresh` fill that reaches back before the start of
 * the broker's history, by index into `fresh`; 0 drops the fill. Fills kept
 * whole are left out. `stored` are fills already journaled; the caller leaves
 * out fresh fills that repeat a stored one, since both feed one position.
 *
 * - A fill the broker labels as a close, with nothing open on that side, is
 *   dropped. One that closes more than the history opened (sell 3 against 1)
 *   keeps what the history covers; the rest closed shares bought before the
 *   start, at a cost the journal never saw.
 * - Unlabeled fills of the `checked` asset class, when the broker's position
 *   list disagrees with where the replay ends: the earliest fill that opened
 *   the wrong position is cut back, again and again. One that opened from
 *   flat is dropped; one that crossed flat keeps only its closing part.
 *
 * Each position (symbol and group) replays on its own, as round trips do.
 *
 * ponytail: a real flip the broker's list agrees with in direction (sell 3
 * against 2 bought before the start, leaving a short of 1) keeps all 3.
 */
export const keepWithinHistory = (
  stored: SyncedFill[],
  fresh: SyncedFill[],
  brokerQuantity: (symbol: string) => number | undefined,
  checked = "equity",
): Map<number, number> => {
  const keep = new Map<number, number>();
  const positions = new Map<string, { fill: SyncedFill; index: number }[]>();
  const add = (fill: SyncedFill, index: number) => {
    const key = JSON.stringify([fill.symbol, fill.group ?? null]);
    const list = positions.get(key);
    if (list) list.push({ fill, index });
    else positions.set(key, [{ fill, index }]);
  };
  stored.forEach((fill) => add(fill, -1));
  fresh.forEach(add);

  for (const fills of positions.values()) {
    fills.sort((a, b) => a.fill.executedAt.localeCompare(b.fill.executedAt));
    const replay = () => {
      let held = 0;
      // Fresh fills that opened a position, and how much of each closed the one before.
      const openers: { index: number; closing: number }[] = [];
      for (const { fill, index } of fills) {
        const quantity = keep.get(index) ?? fill.quantity;
        if (quantity < EPS) continue;
        const change = direction(fill) * quantity;
        if (index >= 0 && fill.positionEffect === "close") {
          if (held * change >= -EPS) {
            keep.set(index, 0);
            continue;
          }
          if (quantity > Math.abs(held) + EPS) {
            keep.set(index, Math.abs(held));
            held = 0;
            continue;
          }
        }
        const after = held + change;
        const flips = Math.abs(after) > EPS && Math.sign(after) !== Math.sign(held);
        if (index >= 0 && fill.positionEffect === undefined && (Math.abs(held) < EPS || flips)) {
          openers.push({ index, closing: Math.abs(held) });
        }
        held = after;
      }
      return { held, openers };
    };

    let { held, openers } = replay();
    const { symbol, group } = fills[0]!.fill;
    // The broker's list nets each symbol, so it only speaks for an ungrouped position.
    const expected = group === undefined ? brokerQuantity(symbol) : undefined;
    if (expected === undefined || !fills.some(({ fill }) => fill.assetClass === checked)) continue;
    while (Math.abs(held - expected) > EPS && Math.sign(held) !== Math.sign(expected)) {
      const opener = openers.find(({ index }) => direction(fresh[index]!) === Math.sign(held));
      if (!opener) break;
      keep.set(opener.index, opener.closing);
      ({ held, openers } = replay());
    }
  }
  for (const [index, quantity] of keep) {
    if (quantity > fresh[index]!.quantity - EPS) keep.delete(index);
  }
  return keep;
};

const OCC_SYMBOL = /^\S+ (\d{2})(\d{2})(\d{2})[CP]\d/;
const newYorkHour = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  hourCycle: "h23",
});

/** 4pm New York, the US options close, on a `YYMMDD` expiry: 20:00Z in summer, 21:00Z in winter. */
const expiryClose = (yy: string, mm: string, dd: string): string => {
  const at = (utcHour: number) =>
    new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), utcHour));
  return (newYorkHour.format(at(20)) === "16" ? at(20) : at(21)).toISOString();
};

/**
 * Closing fills for option contracts still held after they expired. Webull
 * records no fill when an option expires worthless, so the contract would
 * otherwise stay open forever and its loss never count. Each closes at 0 at
 * the 4pm New York expiry; that fixed time gives it the same hash every sync.
 *
 * ponytail: a contract exercised or assigned in the money also closes at 0.
 * Telling the two apart needs the underlying's price at expiry.
 */
export const expiredOptionCloses = (optionFills: SyncedFill[], now: string): SyncedFill[] => {
  const held = new Map<string, number>();
  for (const fill of optionFills) {
    held.set(fill.symbol, (held.get(fill.symbol) ?? 0) + direction(fill) * fill.quantity);
  }
  const closes: SyncedFill[] = [];
  for (const [symbol, quantity] of held) {
    const expiry = OCC_SYMBOL.exec(symbol);
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
