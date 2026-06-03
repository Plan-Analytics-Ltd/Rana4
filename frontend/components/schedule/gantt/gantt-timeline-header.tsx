"use client";

import type { TimelineConfig, TimelineTick } from "@/lib/schedule-timeline";
import { cn } from "@/lib/utils";

export function GanttTimelineHeader(props: {
  config: TimelineConfig;
  ticks: TimelineTick[];
  widthPx: number;
  scrollLeft: number;
}) {
  const { config, ticks, widthPx, scrollLeft } = props;

  return (
    <div
      className="sticky top-0 z-20 min-w-0 overflow-hidden border-b border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-900"
      style={{ height: config.headerHeight }}
    >
      <div
        className="relative h-full overflow-hidden"
        style={{ width: widthPx, transform: `translateX(-${scrollLeft}px)` }}
      >
        {ticks.map((t, i) => (
          <div
            key={`${t.x}-${i}`}
            className={cn(
              "absolute top-0 flex h-full flex-col justify-end border-r border-slate-200/80 px-1 pb-1 text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400",
              config.zoom === "days" && "min-w-0"
            )}
            style={{ left: t.x, width: t.width }}
          >
            <span className="truncate">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
