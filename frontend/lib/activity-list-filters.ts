import type { Activity, ActivityCodeType, Deliverable, Relationship } from "@/lib/api";
import { activityOwnershipKind } from "@/lib/schedule-effective";
import { buildRelationshipAdjacency } from "@/lib/schedule-relationship-health";

export type ActivityOwnershipFilter = "all" | "inherited" | "custom" | "detached";
export type ActivityLinkFilter = "all" | "linked" | "open_start" | "open_finish" | "isolated" | "missing_resources";

export type ActivityListFilters = {
  search: string;
  deliverableId: string;
  ownership: ActivityOwnershipFilter;
  linkState: ActivityLinkFilter;
  p6TypeId: string;
  p6CodeId: string;
  resourceQuery: string;
};

export const DEFAULT_ACTIVITY_FILTERS: ActivityListFilters = {
  search: "",
  deliverableId: "",
  ownership: "all",
  linkState: "all",
  p6TypeId: "",
  p6CodeId: "",
  resourceQuery: "",
};

export function filterActivities(
  activities: Activity[],
  relationships: Relationship[],
  deliverables: Deliverable[],
  filters: ActivityListFilters,
  codeTypes: ActivityCodeType[]
): Activity[] {
  const q = filters.search.trim().toLowerCase();
  const { predCount, succCount } = buildRelationshipAdjacency(activities, relationships);
  const deliverableName = new Map(deliverables.map((d) => [d.id, d.name.toLowerCase()]));

  return activities.filter((a) => {
    if (filters.deliverableId && a.deliverableId !== filters.deliverableId) return false;

    const kind = activityOwnershipKind(a);
    if (filters.ownership === "inherited" && kind !== "inherited") return false;
    if (filters.ownership === "custom" && kind !== "custom") return false;
    if (filters.ownership === "detached" && kind !== "detached") return false;

    const preds = predCount.get(a.id) ?? 0;
    const succs = succCount.get(a.id) ?? 0;
    if (filters.linkState === "linked" && preds === 0 && succs === 0) return false;
    if (filters.linkState === "open_start" && !(preds === 0 && succs > 0)) return false;
    if (filters.linkState === "open_finish" && !(succs === 0 && preds > 0)) return false;
    if (filters.linkState === "isolated" && (preds > 0 || succs > 0)) return false;
    if (filters.linkState === "missing_resources" && (a.assignedResources?.length ?? 0) > 0) return false;

    if (filters.p6TypeId) {
      const row = a.activityCodeAssignments?.find((x) => x.typeId === filters.p6TypeId);
      if (!row) return false;
      if (filters.p6CodeId && row.codeId !== filters.p6CodeId) return false;
    }

    if (filters.resourceQuery.trim()) {
      const rq = filters.resourceQuery.trim().toLowerCase();
      const hit = (a.assignedResources ?? []).some(
        (r) => r.resourceName.toLowerCase().includes(rq) || r.resourceType.toLowerCase().includes(rq)
      );
      if (!hit) return false;
    }

    if (q) {
      const dName = a.deliverableId ? deliverableName.get(a.deliverableId) ?? "" : "";
      const p6 = (a.activityCodeAssignments ?? [])
        .map((x) => `${x.type.name} ${x.code.name}`)
        .join(" ")
        .toLowerCase();
      const blob = `${a.activityCode} ${a.name} ${dName} ${p6}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }

    return true;
  });
}

export function highlightSearch(text: string, search: string): { text: string; match: boolean } {
  const q = search.trim();
  if (!q) return { text, match: false };
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  return { text, match: idx >= 0 };
}
