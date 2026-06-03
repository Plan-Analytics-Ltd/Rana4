import type { AssignedResource, RateCardEntry, RelationshipType } from "@/lib/api";
import { deliverableScopedActivities } from "@/lib/activity-list-filters";

export type ScheduleActivityRel = {
  activityCode: string;
  deliverableName?: string;
  relationshipType: RelationshipType;
  lag: number;
};

export type ScheduleActivity = {
  id: string;
  deliverableId?: string;
  activityCode: string;
  name: string;
  bestDuration: number;
  likelyDuration: number;
  assignedResources: AssignedResource[];
  isSharedAcrossDeliverables?: boolean;
  linkedDeliverables?: Array<{ id: string; name: string; isPrimary?: boolean }>;
  isInherited?: boolean;
  templateActivityId?: string | null;
  detachedFromTemplate?: boolean;
  /** Set when row is a per-deliverable clone (matches export / effective schedule view). */
  sourceActivityId?: string;
  isExpandedPerDeliverable?: boolean;
  relationships: { predecessors: ScheduleActivityRel[]; successors: ScheduleActivityRel[] };
};

export type ScheduleDeliverableRel = {
  deliverableName: string;
  activityCode?: string;
  relationshipType: RelationshipType;
  lag: number;
};

export type ScheduleDeliverable = {
  id: string;
  name: string;
  bestDuration: number;
  likelyDuration: number;
  relationships: { predecessors: ScheduleDeliverableRel[]; successors: ScheduleDeliverableRel[] };
  activities: ScheduleActivity[];
};

export type ScheduleFragnet = {
  id: string;
  name: string;
  activityTemplateCount?: number;
  deliverables: ScheduleDeliverable[];
  /** Canonical shared activities for this WBS (not listed under deliverables). */
  sharedActivities?: ScheduleActivity[];
};

export type ProjectFullData = {
  fragnets: ScheduleFragnet[];
};

const PROJECT_LEVEL_GROUP_NAMES = new Set([
  "project-level / unassigned",
  "project-level deliverables",
  "unassigned deliverables",
]);

export function isProjectLevelGroupName(name: string | null | undefined): boolean {
  return PROJECT_LEVEL_GROUP_NAMES.has(String(name ?? "").trim().toLowerCase());
}

export function normalizeFragnetDisplayName(name: string | null | undefined): string {
  return isProjectLevelGroupName(name) ? "Project-level deliverables" : String(name ?? "");
}

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

function collectSharedActivitiesFromFragnet(
  fragnet: Pick<ScheduleFragnet, "deliverables">
): ScheduleActivity[] {
  const byId = new Map<string, ScheduleActivity>();
  for (const d of fragnet.deliverables) {
    for (const a of d.activities) {
      if (!a.isSharedAcrossDeliverables) continue;
      if (!byId.has(a.id)) byId.set(a.id, a);
    }
  }
  return [...byId.values()];
}

export function parseFullData(raw: ProjectFullData): ProjectFullData {
  return {
    fragnets: raw.fragnets.map((f) => ({
      id: f.id,
      name: normalizeFragnetDisplayName(f.name),
      activityTemplateCount: f.activityTemplateCount ?? 0,
      sharedActivities: collectSharedActivitiesFromFragnet(f).map((a) => ({
        id: a.id,
        deliverableId: a.deliverableId,
        activityCode: a.activityCode,
        name: a.name,
        bestDuration: a.bestDuration,
        likelyDuration: a.likelyDuration,
        assignedResources: normalizeAssignedResources(a.assignedResources),
        isSharedAcrossDeliverables: true,
        linkedDeliverables: a.linkedDeliverables ?? [],
        isInherited: a.isInherited,
        templateActivityId: a.templateActivityId,
        detachedFromTemplate: a.detachedFromTemplate,
        relationships: a.relationships,
      })),
      deliverables: f.deliverables.map((d) => ({
        id: d.id,
        name: d.name,
        bestDuration: d.bestDuration ?? 1,
        likelyDuration: d.likelyDuration ?? 1,
        relationships: d.relationships ?? { predecessors: [], successors: [] },
        activities: deliverableScopedActivities(d.activities).map((a) => ({
          id: a.id,
          deliverableId: a.deliverableId,
          activityCode: a.activityCode,
          name: a.name,
          bestDuration: a.bestDuration,
          likelyDuration: a.likelyDuration,
          assignedResources: normalizeAssignedResources(a.assignedResources),
          isSharedAcrossDeliverables: a.isSharedAcrossDeliverables,
          linkedDeliverables: a.linkedDeliverables ?? [],
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
