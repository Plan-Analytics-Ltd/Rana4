import type { AssignedResource, RateCardEntry, RelationshipType } from "@/lib/api";

export type ScheduleActivityRel = {
  activityCode: string;
  relationshipType: RelationshipType;
  lag: number;
};

export type ScheduleActivity = {
  id: string;
  activityCode: string;
  name: string;
  bestDuration: number;
  likelyDuration: number;
  assignedResources: AssignedResource[];
  isInherited?: boolean;
  templateActivityId?: string | null;
  detachedFromTemplate?: boolean;
  relationships: { predecessors: ScheduleActivityRel[]; successors: ScheduleActivityRel[] };
};

export type ScheduleDeliverable = {
  id: string;
  name: string;
  activities: ScheduleActivity[];
};

export type ScheduleFragnet = {
  id: string;
  name: string;
  activityTemplateCount?: number;
  deliverables: ScheduleDeliverable[];
};

export type ProjectFullData = {
  fragnets: ScheduleFragnet[];
};

export function normalizeAssignedResources(raw: unknown): AssignedResource[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is AssignedResource =>
      r != null &&
      typeof r === "object" &&
      typeof (r as AssignedResource).resourceType === "string" &&
      typeof (r as AssignedResource).resourceName === "string"
  );
}

export function parseFullData(raw: ProjectFullData): ProjectFullData {
  return {
    fragnets: raw.fragnets.map((f) => ({
      id: f.id,
      name: f.name,
      activityTemplateCount: f.activityTemplateCount ?? 0,
      deliverables: f.deliverables.map((d) => ({
        id: d.id,
        name: d.name,
        activities: d.activities.map((a) => ({
          id: a.id,
          activityCode: a.activityCode,
          name: a.name,
          bestDuration: a.bestDuration,
          likelyDuration: a.likelyDuration,
          assignedResources: normalizeAssignedResources(a.assignedResources),
          isInherited: a.isInherited,
          templateActivityId: a.templateActivityId,
          detachedFromTemplate: a.detachedFromTemplate,
          relationships: a.relationships,
        })),
      })),
    })),
  };
}

export function rateCardLookup(entries: RateCardEntry[]): Map<string, RateCardEntry> {
  const m = new Map<string, RateCardEntry>();
  for (const e of entries) {
    m.set(`${e.resourceType.trim().toLowerCase()}|${e.resourceName.trim().toLowerCase()}`, e);
  }
  return m;
}
