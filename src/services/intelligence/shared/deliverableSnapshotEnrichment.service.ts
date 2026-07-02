import type { ImportedActivityRow, ImportedDeliverableRow } from "./types.js";

export type ActivityDateSource = {
  deliverableId?: string | null;
  startDate?: Date | null;
  finishDate?: Date | null;
  earlyStart?: Date | null;
  earlyFinish?: Date | null;
  actualStart?: Date | null;
  actualFinish?: Date | null;
  actualDuration?: number | null;
  percentComplete?: number | null;
  status?: string | null;
  totalFloatDays?: number | null;
};

export type RolledUpDeliverableDates = {
  plannedStart: Date | null;
  plannedFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  totalFloatDays: number | null;
};

function minDate(...dates: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!best || d.getTime() < best.getTime()) best = d;
  }
  return best;
}

function maxDate(...dates: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!best || d.getTime() > best.getTime()) best = d;
  }
  return best;
}

function hasActualProgress(activity: ActivityDateSource): boolean {
  if (activity.actualStart && activity.actualFinish) return true;
  if (activity.actualDuration != null && activity.actualDuration >= 0) return true;
  if (activity.percentComplete != null && activity.percentComplete >= 100) return true;
  const status = String(activity.status ?? "").trim().toUpperCase();
  return status.includes("COMPLETE") || status === "TK_COMPLETE";
}

function activityActualStart(activity: ActivityDateSource): Date | null {
  if (activity.actualStart) return activity.actualStart;
  if (!hasActualProgress(activity)) return null;
  return activity.startDate ?? null;
}

function activityActualFinish(activity: ActivityDateSource): Date | null {
  if (activity.actualFinish) return activity.actualFinish;
  if (!hasActualProgress(activity)) return null;
  return activity.finishDate ?? null;
}

/** Roll up linked activity dates into deliverable planned/actual spans. */
export function rollupDeliverableDatesFromActivities(
  deliverableId: string,
  activities: ActivityDateSource[]
): RolledUpDeliverableDates {
  const linked = activities.filter((a) => a.deliverableId === deliverableId);
  if (linked.length === 0) {
    return {
      plannedStart: null,
      plannedFinish: null,
      actualStart: null,
      actualFinish: null,
      totalFloatDays: null,
    };
  }

  const plannedStart = minDate(...linked.map((a) => a.earlyStart ?? a.startDate ?? null));
  const plannedFinish = maxDate(...linked.map((a) => a.earlyFinish ?? a.finishDate ?? null));
  const actualStart = minDate(...linked.map((a) => activityActualStart(a)));
  const actualFinish = maxDate(...linked.map((a) => activityActualFinish(a)));

  const floats = linked
    .map((a) => a.totalFloatDays)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const totalFloatDays = floats.length > 0 ? Math.min(...floats) : null;

  return { plannedStart, plannedFinish, actualStart, actualFinish, totalFloatDays };
}

function mergeDates(existing: Date | null | undefined, rolled: Date | null): Date | null | undefined {
  return existing ?? rolled ?? undefined;
}

/**
 * Fill missing deliverable snapshot dates from linked import activities.
 * XER imports do not include explicit deliverable rows — dates must be derived.
 */
export function enrichDeliverableRowsFromActivities<
  T extends ImportedDeliverableRow & { deliverableId?: string },
>(
  deliverables: T[],
  activities: Array<ImportedActivityRow & { deliverableId?: string | null }>
): T[] {
  const activitySources: ActivityDateSource[] = activities.map((a) => ({
    deliverableId: a.deliverableId ?? null,
    startDate: a.startDate ?? null,
    finishDate: a.finishDate ?? null,
    earlyStart: a.earlyStart ?? null,
    earlyFinish: a.earlyFinish ?? null,
    actualStart: a.actualStart ?? null,
    actualFinish: a.actualFinish ?? null,
    actualDuration: a.actualDurationDays ?? null,
    percentComplete: a.percentComplete ?? null,
    status: a.status ?? null,
    totalFloatDays: a.totalFloatDays ?? null,
  }));

  return deliverables.map((d) => {
    if (!d.deliverableId) return d;
    const hasDates =
      d.plannedStart ||
      d.plannedFinish ||
      d.actualStart ||
      d.actualFinish;
    if (hasDates) return d;

    const rolled = rollupDeliverableDatesFromActivities(d.deliverableId, activitySources);
    return {
      ...d,
      plannedStart: mergeDates(d.plannedStart, rolled.plannedStart),
      plannedFinish: mergeDates(d.plannedFinish, rolled.plannedFinish),
      actualStart: mergeDates(d.actualStart, rolled.actualStart),
      actualFinish: mergeDates(d.actualFinish, rolled.actualFinish),
      totalFloatDays: d.totalFloatDays ?? rolled.totalFloatDays ?? undefined,
    };
  });
}
