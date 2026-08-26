"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

/** Thin ECharts mount: init once, setOption on change, resize with the box. */
export function EChart({
  option,
  className,
  height = 280,
}: {
  option: echarts.EChartsOption;
  className?: string;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = echarts.init(host);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={hostRef} className={className} style={{ height, width: "100%" }} />;
}
