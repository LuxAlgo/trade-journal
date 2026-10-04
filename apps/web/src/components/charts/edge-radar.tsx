"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { EdgeScoreComponents } from "@luxalgo/journal-core";
import { tooltipStyle, useVizTokens } from "./tokens";
import { ChartFrame } from "./chart-frame";

const LABEL_KEYS = [
  "winRate",
  "profitFactor",
  "avgWinLoss",
  "drawdown",
  "recovery",
  "consistency",
] as const satisfies readonly (keyof EdgeScoreComponents)[];

const LABEL_MESSAGE: Record<(typeof LABEL_KEYS)[number], string> = {
  winRate: "radarWinRate",
  profitFactor: "radarProfitFactor",
  avgWinLoss: "radarAvgWinLoss",
  drawdown: "radarDrawdown",
  recovery: "radarRecovery",
  consistency: "radarConsistency",
};

/** The open Edge Score, drawn from its six 0-100 components. */
export function EdgeRadar({
  components,
  height = 220,
}: {
  components: EdgeScoreComponents;
  height?: number | `${number}%`;
}) {
  const t = useTranslations("charts");
  const viz = useVizTokens();
  const [radius, setRadius] = useState(48);
  if (!viz) return <div style={{ height }} />;
  const data = LABEL_KEYS.map((key) => ({
    metric: t(LABEL_MESSAGE[key]),
    value: Math.round(components[key]),
  }));
  return (
    <ChartFrame height={height}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        onResize={(width, height) =>
          setRadius(Math.max(20, Math.min(width / 2 - 84, height / 2 - 34)))
        }
      >
        <RadarChart className="journal-edge-radar" data={data} outerRadius={radius}>
          <PolarGrid stroke={viz.gridline} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <PolarAngleAxis dataKey="metric" tick={{ fill: viz.inkMuted, fontSize: 11 }} />
          <Tooltip
            cursor={false}
            allowEscapeViewBox={{ x: false, y: false }}
            contentStyle={tooltipStyle(viz)}
            formatter={(value) => [`${value}/100`, t("radarScore")]}
          />
          <Radar
            dataKey="value"
            stroke={viz.brand}
            fill={viz.brand}
            fillOpacity={0.28}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </RadarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
