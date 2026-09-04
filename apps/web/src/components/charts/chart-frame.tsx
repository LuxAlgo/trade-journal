"use client";

import type { ReactNode } from "react";

/** A bounded plotting surface; animation never changes layout or hit testing. */
export function ChartFrame({
  children,
  height,
}: {
  children: ReactNode;
  height: number | `${number}%`;
}) {
  return (
    <div className="journal-chart-frame" style={{ height }}>
      {children}
    </div>
  );
}
