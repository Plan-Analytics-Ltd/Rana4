import {
  addWorkingDays,
  DEFAULT_CALENDAR,
  startOfDay,
  subtractWorkingDays,
  toDayIndex,
  type WorkCalendar,
} from "./calendar.service.js";
import { forwardSuccessorBounds, maxDate } from "./relationship-engine.js";
import type { ActivityGraph } from "./network.service.js";
import type { ScheduleRelationshipInput } from "./types.js";

export type ForwardPassResult = {
  earlyStart: Map<string, Date>;
  earlyFinish: Map<string, Date>;
  drivingRelationshipId: Map<string, string | null>;
};

export function runForwardPass(
  graph: ActivityGraph,
  topoOrder: string[],
  projectStart: Date,
  durationOf: (id: string) => number,
  calendar: WorkCalendar = DEFAULT_CALENDAR
): ForwardPassResult {
  const earlyStart = new Map<string, Date>();
  const earlyFinish = new Map<string, Date>();
  const drivingRelationshipId = new Map<string, string | null>();

  const relsBySucc = new Map<string, ScheduleRelationshipInput[]>();
  for (const r of graph.relationships) {
    const list = relsBySucc.get(r.successorActivityId) ?? [];
    list.push(r);
    relsBySucc.set(r.successorActivityId, list);
  }

  const anchor = startOfDay(projectStart);

  for (const id of topoOrder) {
    const duration = Math.max(1, durationOf(id));
    const preds = relsBySucc.get(id) ?? [];

    let es = anchor;
    let driving: string | null = null;

    for (const r of preds) {
      const pES = earlyStart.get(r.predecessorActivityId)!;
      const pEF = earlyFinish.get(r.predecessorActivityId)!;
      const bounds = forwardSuccessorBounds(r.relationshipType, pES, pEF, r.lag, calendar);
      if (bounds.minEarlyStart && toDayIndex(bounds.minEarlyStart) > toDayIndex(es)) {
        es = bounds.minEarlyStart;
        driving = r.id;
      }
    }

    let ef = addWorkingDays(es, duration, calendar);

    for (const r of preds) {
      const pES = earlyStart.get(r.predecessorActivityId)!;
      const pEF = earlyFinish.get(r.predecessorActivityId)!;
      const bounds = forwardSuccessorBounds(r.relationshipType, pES, pEF, r.lag, calendar);
      if (bounds.minEarlyFinish && toDayIndex(bounds.minEarlyFinish) > toDayIndex(ef)) {
        ef = bounds.minEarlyFinish;
        const backES = subtractWorkingDays(ef, duration, calendar);
        if (toDayIndex(backES) > toDayIndex(es)) {
          es = backES;
          driving = r.id;
        }
      }
    }

    earlyStart.set(id, es);
    earlyFinish.set(id, ef);
    drivingRelationshipId.set(id, driving);
  }

  return { earlyStart, earlyFinish, drivingRelationshipId };
}
