"use client";

import { useMemo } from "react";
import type { RelationshipType, ScheduleNetworkRelationship } from "@/lib/api";
import type { BarLayout } from "@/lib/schedule-timeline";
import type { TimelineConfig } from "@/lib/schedule-timeline";

function anchorForRel(
  type: RelationshipType,
  pred: BarLayout,
  succ: BarLayout,
  predRow: number,
  succRow: number,
  config: TimelineConfig
): { x1: number; y1: number; x2: number; y2: number } {
  const py = predRow * config.rowHeight + config.rowHeight / 2;
  const sy = succRow * config.rowHeight + config.rowHeight / 2;
  let x1: number;
  let x2: number;
  switch (type) {
    case "SS":
      x1 = pred.left;
      x2 = succ.left;
      break;
    case "FF":
      x1 = pred.left + pred.width;
      x2 = succ.left + succ.width;
      break;
    case "SF":
      x1 = pred.left;
      x2 = succ.left + succ.width;
      break;
    case "FS":
    default:
      x1 = pred.left + pred.width;
      x2 = succ.left;
      break;
  }
  return { x1, y1: py, x2, y2: sy };
}

export function GanttDependencyLines(props: {
  relationships: ScheduleNetworkRelationship[];
  barByActivityId: Map<string, BarLayout>;
  rowIndexByActivityId: Map<string, number>;
  criticalActivityIds: Set<string>;
  config: TimelineConfig;
  widthPx: number;
  heightPx: number;
  visibleActivityIds: Set<string>;
}) {
  const {
    relationships,
    barByActivityId,
    rowIndexByActivityId,
    criticalActivityIds,
    config,
    widthPx,
    heightPx,
    visibleActivityIds,
  } = props;

  const paths = useMemo(() => {
    const out: Array<{ d: string; critical: boolean; id: string }> = [];
    for (const rel of relationships) {
      if (!visibleActivityIds.has(rel.predecessorActivityId) || !visibleActivityIds.has(rel.successorActivityId)) {
        continue;
      }
      const predBar = barByActivityId.get(rel.predecessorActivityId);
      const succBar = barByActivityId.get(rel.successorActivityId);
      const predRow = rowIndexByActivityId.get(rel.predecessorActivityId);
      const succRow = rowIndexByActivityId.get(rel.successorActivityId);
      if (predBar == null || succBar == null || predRow == null || succRow == null) continue;

      const { x1, y1, x2, y2 } = anchorForRel(
        rel.relationshipType,
        predBar,
        succBar,
        predRow,
        succRow,
        config
      );
      const midX = (x1 + x2) / 2;
      const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
      const critical =
        criticalActivityIds.has(rel.predecessorActivityId) && criticalActivityIds.has(rel.successorActivityId);
      out.push({ d, critical, id: rel.id });
      if (out.length >= 200) break;
    }
    return out;
  }, [
    relationships,
    barByActivityId,
    rowIndexByActivityId,
    criticalActivityIds,
    config,
    visibleActivityIds,
  ]);

  if (paths.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-10"
      width={widthPx}
      height={heightPx}
      aria-hidden
    >
      {paths.map((p) => (
        <path
          key={p.id}
          d={p.d}
          fill="none"
          strokeWidth={p.critical ? 2 : 1}
          className={
            p.critical
              ? "stroke-red-500/80 dark:stroke-red-400/90"
              : "stroke-slate-400/70 dark:stroke-slate-500/80"
          }
        />
      ))}
    </svg>
  );
}
