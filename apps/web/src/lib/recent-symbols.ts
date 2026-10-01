export interface RecentSymbol {
  provider: string;
  dataset: string | null;
  symbol: string;
}

const KEY = "journal-chart-recent-v1";
export const MAX_RECENT = 8;

/** Newest first, one entry per source and symbol, only well-formed entries. */
export function mergeRecent(list: RecentSymbol[], entry: RecentSymbol): RecentSymbol[] {
  const same = (a: RecentSymbol) =>
    a.provider === entry.provider &&
    a.symbol === entry.symbol &&
    (a.dataset ?? null) === (entry.dataset ?? null);
  return [entry, ...list.filter((item) => !same(item))].slice(0, MAX_RECENT);
}

export function parseRecent(raw: string | null): RecentSymbol[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is RecentSymbol =>
          Boolean(item) &&
          typeof item.provider === "string" &&
          typeof item.symbol === "string" &&
          item.symbol.length > 0 &&
          item.symbol.length <= 100 &&
          (item.dataset === null || typeof item.dataset === "string"),
      )
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Per-browser convenience; blocked storage just means no recent list. */
export const recentSymbols = {
  read(): RecentSymbol[] {
    try {
      return parseRecent(localStorage.getItem(KEY));
    } catch {
      return [];
    }
  },
  add(entry: RecentSymbol): RecentSymbol[] {
    const next = mergeRecent(this.read(), { ...entry, dataset: entry.dataset ?? null });
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Keep the in-memory list for this page.
    }
    return next;
  },
};
