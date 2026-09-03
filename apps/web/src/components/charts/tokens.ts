"use client";

import { useEffect, useState } from "react";

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
export const useVizTokens = (): VizTokens | null => {
  const [tokens, setTokens] = useState<VizTokens | null>(null);
  useEffect(() => {
    setTokens(readVizTokens());
    const observer = new MutationObserver(() => setTokens(readVizTokens()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return tokens;
};

export const tooltipStyle = (t: VizTokens): React.CSSProperties => ({
  background: t.card,
  border: `1px solid ${t.border}`,
  borderRadius: 8,
  fontSize: 12,
  color: t.foreground,
  boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
});
