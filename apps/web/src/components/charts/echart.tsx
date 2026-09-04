"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { AxisPointerComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

echarts.use([
  BarChart,
  LineChart,
  AxisPointerComponent,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
]);

/** Thin ECharts mount: init once, setOption on change, resize with the box. */
export function EChart({
  option,
  className,
  height = 280,
}: {
  option: EChartsOption;
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
    let frame = 0;
    let width = host.clientWidth,
      height = host.clientHeight;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || (entry.contentRect.width === width && entry.contentRect.height === height))
        return;
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          chart.resize();
        });
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () =>
      chartRef.current?.setOption(
        {
          ...option,
          animation: !motion.matches,
          animationDuration: 850,
          animationDurationUpdate: 0,
          animationEasing: "cubicInOut",
        },
        { notMerge: true },
      );
    apply();
    motion.addEventListener("change", apply);
    return () => motion.removeEventListener("change", apply);
  }, [option]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ height, width: "100%", overflow: "hidden", minWidth: 0 }}
    />
  );
}
