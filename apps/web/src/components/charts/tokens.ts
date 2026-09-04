"use client";

import { useSyncExternalStore } from "react";

export interface VizTokens {
  surface: string;
  inkMuted: string;
  gridline: string;
  baseline: string;
  brand: string;
  prismFrom: string;
  prismTo: string;
  profit: string;
  profitFill: string;
  loss: string;
  series: string[];
  foreground: string;
  card: string;
  border: string;
}

/** Resolve the design tokens from the document so canvas painters match the theme. */
export const readVizTokens = (): VizTokens => {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    surface: v("--viz-surface", "#1a1a19"),
    inkMuted: v("--ink-muted", "#898781"),
    gridline: v("--gridline", "#2c2c2a"),
    baseline: v("--baseline", "#30303a"),
    brand: v("--brand", "#1197e2"),
    prismFrom: v("--prism-from", "#2ea7ee"),
    prismTo: v("--prism-to", "#b45bff"),
    profit: v("--profit", "#0ca30c"),
    profitFill: v("--profit-fill", "#0ca30c"),
    loss: v("--loss", "#d03b3b"),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--series-${i}`, "#3987e5")),
    foreground: v("--foreground", "#f4f4f2"),
    card: v("--card", "#1a1a19"),
    border: v("--border", "#2c2c2a"),
  };
};

/**
 * Resolved viz colors. SVG charts could use `var(--x)` strings, but ECharts
 * paints to canvas, which can't — so every chart resolves tokens through this
 * hook and re-resolves when the theme class flips.
 */
let tokens: VizTokens | null = null;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
const getTokens = () => tokens;
const getServerTokens = () => null;
function subscribeTokens(listener: () => void) {
  listeners.add(listener);
  if (!observer) {
    const read = () => {
      const next = readVizTokens();
      if (JSON.stringify(next) === JSON.stringify(tokens)) return;
      tokens = next;
      listeners.forEach((notify) => notify());
    };
    observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    read();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      observer?.disconnect();
      observer = null;
      tokens = null;
    }
  };
}
/** Every mounted chart shares one theme observer and one computed-style read. */
export const useVizTokens = (): VizTokens | null =>
  useSyncExternalStore(subscribeTokens, getTokens, getServerTokens);

export const tooltipStyle = (t: VizTokens): React.CSSProperties => ({
  background: t.card,
  border: `1px solid ${t.border}`,
  borderRadius: 12,
  padding: "12px 14px",
  fontSize: 13,
  lineHeight: 1.6,
  color: t.foreground,
  boxShadow: "0 12px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1)",
});
