"use client";

import type { BarLayout } from "@/lib/schedule-timeline";
import { cn } from "@/lib/utils";

export function GanttBar(props: {
  layout: BarLayout;
  isCritical: boolean;
  rowHeight: number;
  highlighted?: boolean;
  isSummary?: boolean;
}) {
  const { layout, isCritical, rowHeight, highlighted, isSummary } = props;
  const top = (rowHeight - (layout.isMilestone ? 12 : 16)) / 2;

  if (layout.isMilestone) {
    const size = 10;
    const cx = layout.left + size / 2;
    const cy = rowHeight / 2;
    return (
      <svg
        className={cn("pointer-events-none absolute", highlighted && "drop-shadow-[0_0_4px_rgba(6,182,212,0.8)]")}
        style={{ left: layout.left, top: 0, width: size + 4, height: rowHeight }}
        aria-hidden
      >
        <polygon
          points={`${cx},${cy - size / 2} ${cx + size / 2},${cy} ${cx},${cy + size / 2} ${cx - size / 2},${cy}`}
          className={cn(
            isCritical
              ? "fill-red-500 stroke-red-700 dark:fill-red-400 dark:stroke-red-300"
              : "fill-cyan-600 stroke-cyan-800 dark:fill-cyan-500 dark:stroke-cyan-300"
          )}
          strokeWidth={1}
        />
      </svg>
    );
  }

  return (
    <div
      className={cn(
        "absolute rounded-sm border",
        isSummary
          ? "border-slate-500 bg-slate-400/70 dark:border-slate-400 dark:bg-slate-500/60"
          : isCritical
            ? "border-red-600 bg-red-500/90 dark:border-red-400 dark:bg-red-600/80"
            : "border-cyan-700 bg-cyan-600/85 dark:border-cyan-500 dark:bg-cyan-600/70",
        highlighted && "ring-2 ring-cyan-400 ring-offset-1 dark:ring-cyan-300"
      )}
      style={{
        left: layout.left,
        top,
        width: layout.width,
        height: 16,
      }}
      title={isCritical ? "Critical path" : undefined}
    />
  );
}
