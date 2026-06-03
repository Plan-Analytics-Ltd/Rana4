"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScheduleNetworkRelationship } from "@/lib/api";
import {
  buildTimelineConfig,
  computeDateRange,
  generateTimelineTicks,
  layoutActivityBar,
  parseScheduleDate,
  timelineWidthPx,
  todayLineX,
  visibleRowRange,
  type BarLayout,
  type TimelineConfig,
  type TimelineZoom,
} from "@/lib/schedule-timeline";
import type { WorkspaceRow } from "@/lib/schedule-workspace-data";
import { GanttTimelineHeader } from "./gantt-timeline-header";
import { GanttBar } from "./gantt-bar";
import { GanttDependencyLines } from "./gantt-dependency-lines";

export function GanttChart(props: {
  rows: WorkspaceRow[];
  relationships: ScheduleNetworkRelationship[];
  criticalActivityIds: Set<string>;
  zoom: TimelineZoom;
  scrollTop: number;
  scrollLeft: number;
  viewportHeight?: number;
  selectedActivityId: string | null;
  hoveredActivityId: string | null;
  onScroll: (top: number, left: number) => void;
}) {
  const {
    rows,
    relationships,
    criticalActivityIds,
    zoom,
    scrollTop,
    scrollLeft,
    selectedActivityId,
    hoveredActivityId,
    onScroll,
  } = props;

  const bodyRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportH, setViewportH] = useState(560);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const schedulableRowsForRange = useMemo(
    () => rows.filter((r) => (r.kind === "activity" || r.kind === "deliverable") && r.cpm),
    [rows]
  );

  const range = useMemo(() => {
    const dates = schedulableRowsForRange.map((r) => ({
      start: parseScheduleDate(r.cpm?.earlyStart ?? null),
      finish: parseScheduleDate(r.cpm?.earlyFinish ?? null),
    }));
    return computeDateRange(dates);
  }, [schedulableRowsForRange]);

  const config = useMemo(
    () => buildTimelineConfig(range.rangeStart, range.rangeEnd, zoom),
    [range, zoom]
  );

  const widthPx = timelineWidthPx(config);
  const ticks = useMemo(() => generateTimelineTicks(config), [config]);
  const todayX = useMemo(() => todayLineX(config), [config]);

  const schedulableRows = useMemo(
    () => rows.filter((r) => r.kind === "activity" || r.kind === "deliverable"),
    [rows]
  );

  const rowIndexByNodeId = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => {
      const nodeId = r.scheduleNodeId ?? r.activityId;
      if (nodeId) m.set(nodeId, i);
    });
    return m;
  }, [rows]);

  const barByNodeId = useMemo(() => {
    const m = new Map<string, ReturnType<typeof layoutActivityBar>>();
    for (const row of schedulableRows) {
      const nodeId = row.scheduleNodeId ?? row.activityId;
      if (!nodeId || !row.cpm) continue;
      const es = parseScheduleDate(row.cpm.earlyStart);
      const ef = parseScheduleDate(row.cpm.earlyFinish);
      const layout = layoutActivityBar(es, ef, row.duration ?? 1, config);
      if (layout) m.set(nodeId, layout);
    }
    return m;
  }, [schedulableRows, config]);

  const totalHeight = rows.length * config.rowHeight;
  const bodyViewport = props.viewportHeight ?? viewportH;
  const { start: visStart, end: visEnd } = visibleRowRange(
    scrollTop,
    bodyViewport,
    config.rowHeight,
    rows.length
  );

  const visibleNodeIds = useMemo(() => {
    const s = new Set<string>();
    for (let i = visStart; i < visEnd; i++) {
      const r = rows[i];
      const id = r?.scheduleNodeId ?? r?.activityId;
      if (id) s.add(id);
    }
    return s;
  }, [rows, visStart, visEnd]);

  const handleScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    onScroll(el.scrollTop, el.scrollLeft);
  }, [onScroll]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el && Math.abs(el.scrollTop - scrollTop) > 1) {
      el.scrollTop = scrollTop;
    }
  }, [scrollTop]);

  const barLayouts = barByNodeId as Map<string, BarLayout>;

  return (
    <div className="flex h-full min-w-0 w-full flex-1 flex-col overflow-hidden bg-white dark:bg-slate-950">
      <div className="min-w-0 overflow-hidden">
        <GanttTimelineHeader config={config} ticks={ticks} widthPx={widthPx} scrollLeft={scrollLeft} />
      </div>
      <div ref={viewportRef} className="min-h-0 min-w-0 flex-1 overflow-hidden">
      <div
        ref={bodyRef}
        className="h-full min-w-0 overflow-auto"
        onScroll={handleScroll}
      >
        <div className="relative" style={{ width: widthPx, height: totalHeight }}>
          <GanttDependencyLines
            relationships={relationships}
            barByActivityId={barLayouts}
            rowIndexByActivityId={rowIndexByNodeId}
            criticalActivityIds={criticalActivityIds}
            config={config}
            widthPx={widthPx}
            heightPx={totalHeight}
            visibleActivityIds={visibleNodeIds}
          />
          {todayX != null && (
            <div
              className="pointer-events-none absolute top-0 z-[5] w-px bg-amber-500/90"
              style={{ left: todayX, height: totalHeight }}
              title="Today"
            />
          )}
          {rows.slice(visStart, visEnd).map((row, offset) => {
            const i = visStart + offset;
            const top = i * config.rowHeight;
            const nodeId = row.scheduleNodeId ?? row.activityId;
            const highlight =
              nodeId != null && (nodeId === selectedActivityId || nodeId === hoveredActivityId);
            const layout = nodeId ? barByNodeId.get(nodeId) : null;

            if (row.kind !== "activity" && row.kind !== "deliverable") {
              return (
                <div
                  key={row.key}
                  className="absolute left-0 right-0 border-b border-slate-100 dark:border-slate-800/80"
                  style={{ top, height: config.rowHeight }}
                />
              );
            }

            if (!layout) {
              return (
                <div
                  key={row.key}
                  className="absolute left-0 border-b border-slate-100 dark:border-slate-800/80"
                  style={{ top, height: config.rowHeight, width: widthPx }}
                />
              );
            }

            const isCritical =
              row.kind === "activity" &&
              row.activityId != null &&
              (row.cpm?.isCritical ?? criticalActivityIds.has(row.activityId));

            return (
              <div
                key={row.key}
                className="absolute left-0 border-b border-slate-100 dark:border-slate-800/80"
                style={{ top, height: config.rowHeight, width: widthPx }}
              >
                {layout && (
                  <GanttBar
                    layout={layout}
                    isCritical={isCritical}
                    isSummary={row.kind === "deliverable"}
                    rowHeight={config.rowHeight}
                    highlighted={highlight}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
}
