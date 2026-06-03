import {
  collectAllActivityCodes,
  compareActivityCodes,
  detectCodePrefix,
  formatActivityCode,
  maxSequenceNumber,
  sortActivitiesByCode,
  sortDeliverablesByWorkflowOrder,
} from "@/lib/activity-code-sequence";
import type {
  ProjectFullData,
  ScheduleActivity,
  ScheduleActivityRel,
  ScheduleDeliverable,
  ScheduleFragnet,
} from "@/lib/schedule-types";

function normalizeActivityName(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same heuristic as export — workflow steps replicated per deliverable on export. */
export function isGenericActivityName(name: unknown): boolean {
  const n = normalizeActivityName(name);
  if (!n) return false;
  const patterns = [
    "internal check",
    "check",
    "review",
    "approval",
    "approve",
    "sign off",
    "handover",
    "qa",
    "qc",
    "coordination",
    "meeting",
    "mobilization",
    "mobilisation",
  ];
  return patterns.some((p) => n === p || n.includes(p));
}

export function referenceWorkflowDeliverable(fragnet: ScheduleFragnet): ScheduleDeliverable | null {
  const sorted = sortDeliverablesByWorkflowOrder(fragnet.deliverables);
  return sorted.find((d) => d.activities.length > 0) ?? null;
}

export function referenceWorkflowSteps(fragnet: ScheduleFragnet): ScheduleActivity[] {
  const ref = referenceWorkflowDeliverable(fragnet);
  if (!ref) return [];
  // Shared activities must not be cloned onto other deliverables as workflow steps.
  return sortActivitiesByCode(ref.activities.filter((a) => !a.isSharedAcrossDeliverables));
}

function remapRelationships(
  rels: ScheduleActivityRel[],
  codeMap: Map<string, string>
): ScheduleActivityRel[] {
  return rels.map((r) => ({
    ...r,
    activityCode: codeMap.get(r.activityCode) ?? r.activityCode,
  }));
}

function renumberActivityBlock(
  activities: ScheduleActivity[],
  prefix: string,
  startSeq: number
): { activities: ScheduleActivity[]; nextSeq: number } {
  const sorted = sortActivitiesByCode(activities);
  const newCodeById = new Map<string, string>();
  let seq = startSeq;
  for (const a of sorted) {
    newCodeById.set(a.id, formatActivityCode(prefix, seq++));
  }
  const resolveRemappedCode = (oldCode: string): string => {
    const matches = sorted.filter((x) => x.activityCode === oldCode);
    if (matches.length === 1) return newCodeById.get(matches[0]!.id) ?? oldCode;
    return oldCode;
  };
  const out = sorted.map((a) => ({
    ...a,
    activityCode: newCodeById.get(a.id)!,
    relationships: {
      predecessors: a.relationships.predecessors.map((r) => ({
        ...r,
        activityCode: resolveRemappedCode(r.activityCode),
      })),
      successors: a.relationships.successors.map((r) => ({
        ...r,
        activityCode: resolveRemappedCode(r.activityCode),
      })),
    },
  }));
  return { activities: out, nextSeq: seq };
}

function cloneWorkflowStepForDeliverable(
  deliverable: ScheduleDeliverable,
  step: ScheduleActivity,
  activityCode: string,
  codeMap: Map<string, string>
): ScheduleActivity {
  return {
    ...step,
    id: `${deliverable.id}-${step.id}`,
    deliverableId: deliverable.id,
    activityCode,
    bestDuration: step.bestDuration,
    likelyDuration: step.likelyDuration,
    sourceActivityId: step.sourceActivityId ?? step.id,
    isExpandedPerDeliverable: true,
    relationships: {
      predecessors: remapRelationships(step.relationships.predecessors, codeMap),
      successors: remapRelationships(step.relationships.successors, codeMap),
    },
  };
}

function expandFragnetInProjectContext(
  fragnet: ScheduleFragnet,
  steps: ScheduleActivity[],
  prefix: string,
  seq: number
): { fragnet: ScheduleFragnet; seq: number } {
  const orderedDeliverables = sortDeliverablesByWorkflowOrder(fragnet.deliverables);
  const deliverables: ScheduleDeliverable[] = [];
  let workflowSteps = steps;

  for (const d of orderedDeliverables) {
    const ownedActivities = d.activities.filter((a) => !a.isSharedAcrossDeliverables);
    if (ownedActivities.length > 0) {
      const block = renumberActivityBlock(ownedActivities, prefix, seq);
      seq = block.nextSeq;
      workflowSteps = block.activities;
      deliverables.push({ ...d, activities: block.activities });
      continue;
    }
    if (workflowSteps.length === 0) {
      deliverables.push(d);
      continue;
    }
    const codeMap = new Map<string, string>();
    const clones: ScheduleActivity[] = [];
    for (const step of workflowSteps) {
      const code = formatActivityCode(prefix, seq);
      seq++;
      codeMap.set(step.activityCode, code);
      clones.push(cloneWorkflowStepForDeliverable(d, step, code, codeMap));
    }
    deliverables.push({ ...d, activities: clones });
  }

  return {
    fragnet: {
      ...fragnet,
      deliverables: sortDeliverablesByWorkflowOrder(deliverables),
      sharedActivities: fragnet.sharedActivities,
    },
    seq,
  };
}

/**
 * Export-only: clones workflow steps into empty deliverables and renumbers codes.
 * Do not use for Schedule Viewer — the viewer must reflect persisted activities only.
 */
export function expandProjectWorkspaceData(data: ProjectFullData): ProjectFullData {
  const allCodes = collectAllActivityCodes(data.fragnets);
  const prefix = detectCodePrefix(allCodes);
  /** Walk order: A1001, A1002, … across every deliverable and fragnet. */
  let seq = 1001;

  const fragnets: ScheduleFragnet[] = [];
  for (const f of data.fragnets) {
    const steps = referenceWorkflowSteps(f);
    const expanded = expandFragnetInProjectContext(f, steps, prefix, seq);
    seq = expanded.seq;
    fragnets.push(expanded.fragnet);
  }

  return {
    fragnets: fragnets.map((f) => ({
      ...f,
      sharedActivities: f.sharedActivities,
    })),
  };
}

/** @deprecated Use expandProjectWorkspaceData */
export function expandFragnetDeliverableActivities(
  fragnet: ScheduleFragnet,
  projectData?: ProjectFullData
): ScheduleFragnet {
  if (!projectData) {
    return expandProjectWorkspaceData({ fragnets: [fragnet] }).fragnets[0]!;
  }
  return expandProjectWorkspaceData(projectData).fragnets.find((x) => x.id === fragnet.id) ?? fragnet;
}

/** Same effective rows/codes as Schedule workspace (workflow cloned into empty deliverables). */
export function expandProjectDataForExportView(data: ProjectFullData): ProjectFullData {
  return expandProjectWorkspaceData(data);
}

/** CPM dates are stored on the canonical activity row in the database. */
export function cpmLookupActivityId(activity: Pick<ScheduleActivity, "id" | "sourceActivityId">): string {
  return activity.sourceActivityId ?? activity.id;
}

export function resolvePersistedActivityId(
  nodeId: string,
  rows: Array<{ scheduleNodeId?: string; activityId?: string; activity?: ScheduleActivity }>
): string | null {
  const row = rows.find((r) => (r.scheduleNodeId ?? r.activityId) === nodeId);
  const act = row?.activity;
  if (!act) return null;
  if (act.isExpandedPerDeliverable) return null;
  return act.id;
}

export function getEffectiveActivityCount(
  deliverable: Pick<ScheduleDeliverable, "id" | "activities">,
  _fragnetTemplateCount?: number,
  _fragnet?: ScheduleFragnet
): number {
  return deliverable.activities?.length ?? 0;
}

export function deliverableHasEffectiveWorkflow(
  deliverable: Pick<ScheduleDeliverable, "id" | "activities">,
  fragnetTemplateCount?: number,
  fragnet?: ScheduleFragnet
): boolean {
  return getEffectiveActivityCount(deliverable, fragnetTemplateCount, fragnet) > 0;
}

export function deliverableNeedsMaterialization(
  deliverable: Pick<ScheduleDeliverable, "activities">,
  fragnetTemplateCount: number
): boolean {
  return (deliverable.activities?.length ?? 0) === 0 && fragnetTemplateCount > 0;
}

export type ActivityOwnershipKind = "inherited" | "custom" | "detached";

export function activityOwnershipKind(
  a: Pick<ScheduleActivity, "isInherited" | "detachedFromTemplate" | "templateActivityId">
): ActivityOwnershipKind {
  if (a.templateActivityId && (a.detachedFromTemplate || !a.isInherited)) return "detached";
  if (a.isInherited && !a.detachedFromTemplate) return "inherited";
  return "custom";
}
