"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { EdgeScoreComponents } from "@luxalgo/journal-core";
import { tooltipStyle, useVizTokens } from "./tokens";

const LABELS: Record<keyof EdgeScoreComponents, string> = {
  winRate: "Win %",
  profitFactor: "Profit factor",
  avgWinLoss: "Avg win/loss",
  drawdown: "Drawdown",
  recovery: "Recovery",
  consistency: "Consistency",
};

/** The open Edge Score, drawn from its six 0-100 components. */
export function EdgeRadar({
  components,
  height = 220,
}: {
  components: EdgeScoreComponents;
  height?: number;
}) {
  const t = useVizTokens();
  if (!t) return <div style={{ height }} />;
  const data = (Object.keys(LABELS) as (keyof EdgeScoreComponents)[]).map((key) => ({
    metric: LABELS[key],
    value: Math.round(components[key]),
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke={t.gridline} />
        <PolarAngleAxis dataKey="metric" tick={{ fill: t.inkMuted, fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle(t)} formatter={(value) => [`${value}/100`, "Score"]} />
        <Radar
          dataKey="value"
          stroke={t.brand}
          fill={t.brand}
          fillOpacity={0.28}
          strokeWidth={2}
          isAnimationActive={false}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
