export const DASHBOARD_LAYOUT_KEY = "journal-dashboard-layouts-v1";

export interface DashboardArrangement {
  order: string[];
  hidden: string[];
}
export interface DashboardPreferences {
  current: DashboardArrangement;
  layouts: Record<string, DashboardArrangement>;
}

export type DashboardCardSize = "small" | "medium" | "wide" | "full";

/** Overview shows every card; focused presets keep the rest available in Customize. */
export function dashboardLayoutPresets(ids: string[]) {
  return [
    {
      name: "Overview",
      description: "All cards in the original order.",
      order: [],
    },
    {
      name: "Trading day",
      description: "Calendar and recent trades first, then daily results.",
      order: [8, 9, 0, 1, 3, 7, 15],
    },
    {
      name: "Performance",
      description: "Returns, win rate, equity, and your trading edge.",
      order: [0, 1, 2, 4, 6, 7, 5, 15],
    },
    {
      name: "Risk review",
      description: "Drawdown, streaks, expectancy, and daily swings.",
      order: [10, 11, 12, 14, 6, 7],
    },
  ].map(({ order, ...preset }) => {
    const selected = order.map((id) => `widget-${id}`);
    return {
      ...preset,
      arrangement: normalizeArrangement(
        {
          order: selected,
          hidden: selected.length ? ids.filter((id) => !selected.includes(id)) : [],
        },
        ids,
      ),
    };
  });
}

/**
 * Fill each responsive grid row without changing card order. Any columns left
 * over before the next card are shared across the cards already in that row.
 */
export function balancedDashboardSpans(
  cards: { id: string; size: DashboardCardSize; layoutGroup?: string }[],
  columns: number,
  base: Record<DashboardCardSize, number>,
): Record<string, number> {
  const spans: Record<string, number> = {};
  let row: string[] = [];
  let used = 0;
  let group: string | undefined;

  const finishRow = () => {
    if (!row.length) return;
    let remaining = columns - used;
    for (let index = 0; remaining > 0; index++, remaining--)
      spans[row[index % row.length]!] = (spans[row[index % row.length]!] ?? 0) + 1;
    row = [];
    used = 0;
    group = undefined;
  };

  for (const card of cards) {
    const span = Math.min(columns, Math.max(1, base[card.size]));
    if (row.length && card.layoutGroup !== group) finishRow();
    if (used + span > columns) finishRow();
    spans[card.id] = span;
    row.push(card.id);
    used += span;
    group = card.layoutGroup;
    if (used === columns) finishRow();
  }
  finishRow();
  return spans;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Keep valid saved choices, discard stale IDs, and include newly available cards. */
export function normalizeArrangement(value: unknown, ids: string[]): DashboardArrangement {
  const raw = isRecord(value) ? value : {};
  const known = new Set(ids);
  const valid = (list: unknown) =>
    Array.isArray(list)
      ? list.filter((id): id is string => typeof id === "string" && known.has(id))
      : [];
  return {
    order: [...new Set([...valid(raw.order), ...ids])],
    hidden: [...new Set(valid(raw.hidden))],
  };
}

export function readDashboardPreferences(raw: string | null, ids: string[]): DashboardPreferences {
  const parsed: unknown = raw ? JSON.parse(raw) : null;
  const value = isRecord(parsed) ? parsed : {};
  const layouts = isRecord(value.layouts) ? value.layouts : {};
  return {
    current: normalizeArrangement(value.current, ids),
    layouts: Object.fromEntries(
      Object.entries(layouts)
        .filter(([, layout]) => isRecord(layout) && Array.isArray(layout.order))
        .map(([name, layout]) => [name, normalizeArrangement(layout, ids)]),
    ),
  };
}

export const visibleCardIds = (layout: DashboardArrangement) =>
  layout.order.filter((id) => !layout.hidden.includes(id));

/** Reorder visible cards while leaving hidden cards in their saved slots. */
export function moveDashboardCard(
  layout: DashboardArrangement,
  from: string,
  to: string,
): DashboardArrangement {
  const visible = visibleCardIds(layout);
  const fromIndex = visible.indexOf(from),
    toIndex = visible.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return layout;
  visible.splice(toIndex, 0, visible.splice(fromIndex, 1)[0]!);
  let index = 0;
  return {
    ...layout,
    order: layout.order.map((id) => (layout.hidden.includes(id) ? id : visible[index++]!)),
  };
}
