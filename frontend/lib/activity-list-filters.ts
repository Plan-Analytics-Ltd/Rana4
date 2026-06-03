import type { Activity, Deliverable } from "@/lib/api";

/** Junction-linked deliverable IDs (shared activities only). */
export function getLinkedDeliverableIds(
  activity: Pick<Activity, "deliverableId" | "linkedDeliverables" | "isSharedAcrossDeliverables">
): string[] {
  if (!activity.isSharedAcrossDeliverables) {
    return activity.deliverableId ? [activity.deliverableId] : [];
  }
  return (activity.linkedDeliverables ?? []).map((d) => d.id).filter(Boolean);
}

/** True when this activity should appear under the given deliverable. */
export function isActivityLinkedToDeliverable(
  activity: Pick<Activity, "deliverableId" | "linkedDeliverables" | "isSharedAcrossDeliverables">,
  deliverableId: string
): boolean {
  if (!deliverableId) return false;
  if (activity.isSharedAcrossDeliverables) {
    return (activity.linkedDeliverables ?? []).some((d) => d.id === deliverableId);
  }
  const ownerId = String(activity.deliverableId ?? "").trim();
  // Trust full-data grouping when owner id is absent; otherwise require an exact match.
  if (!ownerId) return true;
  return ownerId === deliverableId;
}

/**
 * Activities listed under a deliverable in project full-data (WBS / schedule tree).
 * Non-shared rows are already scoped by the API; only shared rows need junction checks.
 */
export function deliverableScopedActivities<T extends Pick<Activity, "isSharedAcrossDeliverables">>(
  activities: T[]
): T[] {
  return activities.filter((a) => !a.isSharedAcrossDeliverables);
}

export function filterActivitiesForDeliverable<T extends Pick<Activity, "deliverableId" | "linkedDeliverables" | "isSharedAcrossDeliverables">>(
  activities: T[],
  deliverableId: string
): T[] {
  return activities.filter((a) => isActivityLinkedToDeliverable(a, deliverableId));
}

export type ActivityListFilters = {
  search: string;
  deliverableId: string;
};

export const DEFAULT_ACTIVITY_FILTERS: ActivityListFilters = {
  search: "",
  deliverableId: "",
};

export function filterActivities(
  activities: Activity[],
  deliverables: Deliverable[],
  filters: ActivityListFilters
): Activity[] {
  const q = filters.search.trim().toLowerCase();
  const deliverableName = new Map(deliverables.map((d) => [d.id, d.name.toLowerCase()]));

  return activities.filter((a) => {
    const linkedIds = getLinkedDeliverableIds(a);
    if (filters.deliverableId && !linkedIds.includes(filters.deliverableId)) return false;
    if (!q) return true;
    const dNames = linkedIds.map((id) => deliverableName.get(id) ?? "").join(" ");
    const blob = `${a.activityCode} ${a.name} ${dNames}`.toLowerCase();
    return blob.includes(q);
  });
}
