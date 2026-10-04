"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatLocale, type Locale } from "@/i18n/config";
import { fmtNumber } from "@/lib/utils";
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
  const t = useTranslations("charts");
  const locale = useLocale();
  const tag = formatLocale(locale as Locale);
  const viz = useVizTokens();
  const radius = size / 2 - 6;
  const circumference = Math.PI * radius;
  const ratio = value === null ? 0 : Math.min(Math.max(value, 0), 1);
  if (!viz) return <div style={{ width: size, height: size / 2 + 18 }} />;
  return (
    <div
      className="journal-gauge flex min-w-0 flex-col items-center"
      role="img"
      aria-label={`${label}: ${value === null ? t("gaugeNoData") : `${fmtNumber(ratio * 100, 1, tag)}%`}`}
    >
      <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`}>
        <path
          d={`M 6 ${size / 2 + 2} A ${radius} ${radius} 0 0 1 ${size - 6} ${size / 2 + 2}`}
          fill="none"
          stroke={viz.gridline}
          strokeWidth={8}
          strokeLinecap="round"
        />
        <path
          d={`M 6 ${size / 2 + 2} A ${radius} ${radius} 0 0 1 ${size - 6} ${size / 2 + 2}`}
          fill="none"
          stroke={viz.brand}
          className="journal-gauge-value"
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${circumference * ratio} ${circumference}`}
        />
      </svg>
      <div className="-mt-5 text-center">
        <div className="text-lg font-semibold tnum">
          {value === null ? "–" : `${fmtNumber(ratio * 100, 1, tag)}%`}
        </div>
      </div>
    </div>
  );
}
