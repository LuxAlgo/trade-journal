/**
 * Keeps several charts in step: each chart publishes its crosshair time and visible
 * window, and the others follow when the matching sync is on. A chart never receives its
 * own messages, so following cannot echo back into a loop.
 */
export interface ChartSyncOptions {
  crosshair: boolean;
  time: boolean;
}

export interface ChartSyncHandlers {
  crosshair?: (time: number | null) => void;
  range?: (range: { from: number; to: number }) => void;
}

export interface ChartSync {
  crosshair(from: string, time: number | null): void;
  range(from: string, range: { from: number; to: number }): void;
  subscribe(id: string, handlers: ChartSyncHandlers): () => void;
  setOptions(options: ChartSyncOptions): void;
}

export function createChartSync(initial: ChartSyncOptions): ChartSync {
  let options = initial;
  const charts = new Map<string, ChartSyncHandlers>();
  const others = (from: string) => [...charts].filter(([id]) => id !== from).map(([, h]) => h);
  return {
    crosshair(from, time) {
      if (!options.crosshair && time !== null) return;
      for (const h of others(from)) h.crosshair?.(time);
    },
    range(from, range) {
      if (!options.time) return;
      for (const h of others(from)) h.range?.(range);
    },
    subscribe(id, handlers) {
      charts.set(id, handlers);
      return () => {
        if (charts.get(id) === handlers) charts.delete(id);
      };
    },
    setOptions(next) {
      // Turning crosshair sync off clears any crosshair the others were showing.
      if (options.crosshair && !next.crosshair)
        for (const h of charts.values()) h.crosshair?.(null);
      options = next;
    },
  };
}
