import {
  addWorkingDays,
  DEFAULT_CALENDAR,
  startOfDay,
  subtractWorkingDays,
  toDayIndex,
  type WorkCalendar,
} from "./calendar.service.js";
import { backwardPredecessorBounds } from "./relationship-engine.js";
import type { ActivityGraph } from "./network.service.js";
import type { ScheduleRelationshipInput } from "./types.js";

export type BackwardPassResult = {
  lateStart: Map<string, Date>;
  lateFinish: Map<string, Date>;
  totalFloat: Map<string, number>;
  freeFloat: Map<string, number>;
};

export function runBackwardPass(
  graph: ActivityGraph,
  reverseTopo: string[],
  projectEnd: Date,
  earlyStart: Map<string, Date>,
  earlyFinish: Map<string, Date>,
  durationOf: (id: string) => number,
  calendar: WorkCalendar = DEFAULT_CALENDAR
): BackwardPassResult {
  const lateStart = new Map<string, Date>();
  const lateFinish = new Map<string, Date>();
  const totalFloat = new Map<string, number>();
  const freeFloat = new Map<string, number>();

  const relsByPred = new Map<string, ScheduleRelationshipInput[]>();
  for (const r of graph.relationships) {
    const list = relsByPred.get(r.predecessorActivityId) ?? [];
    list.push(r);
    relsByPred.set(r.predecessorActivityId, list);
  }

  const end = startOfDay(projectEnd);

  for (const id of reverseTopo) {
    const duration = Math.max(1, durationOf(id));
    const succs = graph.adj.get(id) ?? [];

    let lf = end;
    if (succs.length === 0) {
      lf = end;
    } else {
      let lfBound = lf;
      for (const succId of succs) {
        const sLS = lateStart.get(succId)!;
        const sLF = lateFinish.get(succId)!;
        for (const r of graph.relationships) {
          if (r.predecessorActivityId !== id || r.successorActivityId !== succId) continue;
          const bounds = backwardPredecessorBounds(r.relationshipType, sLS, sLF, r.lag, calendar);
          if (bounds.maxLateFinish && toDayIndex(bounds.maxLateFinish) < toDayIndex(lfBound)) {
            lfBound = bounds.maxLateFinish;
          }
          if (bounds.maxLateStart) {
            const impliedLF = addWorkingDays(bounds.maxLateStart, duration, calendar);
            if (toDayIndex(impliedLF) < toDayIndex(lfBound)) lfBound = impliedLF;
          }
        }
      }
      lf = lfBound;
    }

    let ls = subtractWorkingDays(lf, duration, calendar);

    for (const succId of succs) {
      const sLS = lateStart.get(succId)!;
      const sLF = lateFinish.get(succId)!;
      for (const r of graph.relationships) {
        if (r.predecessorActivityId !== id || r.successorActivityId !== succId) continue;
        const bounds = backwardPredecessorBounds(r.relationshipType, sLS, sLF, r.lag, calendar);
        if (bounds.maxLateStart && toDayIndex(bounds.maxLateStart) < toDayIndex(ls)) {
          ls = bounds.maxLateStart;
          lf = addWorkingDays(ls, duration, calendar);
        }
      }
    }

    lateStart.set(id, ls);
    lateFinish.set(id, lf);

    const es = earlyStart.get(id)!;
    const ef = earlyFinish.get(id)!;
    const tf = Math.max(0, toDayIndex(ls) - toDayIndex(es));
    totalFloat.set(id, tf);

    let ff = tf;
    const succRels = (relsByPred.get(id) ?? []).filter((r) => graph.activityIds.has(r.successorActivityId));
    if (succRels.length > 0) {
      let minGap = Number.POSITIVE_INFINITY;
      for (const r of succRels) {
        const sES = earlyStart.get(r.successorActivityId)!;
        if (r.relationshipType === "FS") {
          const gap = toDayIndex(sES) - toDayIndex(ef) - 1 - Math.max(0, r.lag);
          minGap = Math.min(minGap, gap);
        } else if (r.relationshipType === "SS") {
          const gap = toDayIndex(sES) - toDayIndex(es) - Math.max(0, r.lag);
          minGap = Math.min(minGap, gap);
        } else {
          minGap = Math.min(minGap, tf);
        }
      }
      ff = Math.max(0, Math.min(tf, minGap));
    }
    freeFloat.set(id, ff);
  }

  return { lateStart, lateFinish, totalFloat, freeFloat };
}
