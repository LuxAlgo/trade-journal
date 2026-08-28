"use client";

import { useId } from "react";
import { useVizTokens } from "./tokens";

/**
 * Semicircle gauge for a 0-1 ratio (win rate, day win rate). The value is
 * always printed in ink — the arc only reinforces it.
 */
export function Gauge({
  value,
  label,
  size = 96,
}: {
  value: number | null;
  label: string;
  size?: number;
}) {
  const t = useVizTokens();
  const gradientId = useId();
  const radius = size / 2 - 6;
  const circumference = Math.PI * radius;
  const ratio = value === null ? 0 : Math.min(Math.max(value, 0), 1);
  if (!t) return <div style={{ width: size, height: size / 2 + 18 }} />;
  return (
    <div
      className="flex flex-col items-center"
      role="img"
      aria-label={`${label}: ${value === null ? "no data" : `${(ratio * 100).toFixed(1)}%`}`}
    >
      <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={t.prismFrom} />
            <stop offset="100%" stopColor={t.prismTo} />
          </linearGradient>
        </defs>
        <path
          d={`M 6 ${size / 2 + 2} A ${radius} ${radius} 0 0 1 ${size - 6} ${size / 2 + 2}`}
          fill="none"
          stroke={t.gridline}
          strokeWidth={8}
          strokeLinecap="round"
        />
        <path
          d={`M 6 ${size / 2 + 2} A ${radius} ${radius} 0 0 1 ${size - 6} ${size / 2 + 2}`}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${circumference * ratio} ${circumference}`}
        />
      </svg>
      <div className="-mt-5 text-center">
        <div className="text-lg font-semibold tnum">
          {value === null ? "–" : `${(ratio * 100).toFixed(1)}%`}
        </div>
      </div>
    </div>
  );
}
