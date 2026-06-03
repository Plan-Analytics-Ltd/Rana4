import type {
  DeliverableRelationship,
  RateCardEntry,
  Relationship,
  ScheduleDiagnostic,
  ScheduleNetworkActivity,
  ScheduleNetworkRelationship,
} from "@/lib/api";
import type {
  ScheduleActivity,
  ScheduleActivityRel,
  ScheduleDeliverable,
  ScheduleDeliverableRel,
  ProjectFullData,
  ScheduleFragnet,
} from "@/lib/schedule-types";
import { isProjectLevelGroupName } from "@/lib/schedule-types";
import { validateProjectSchedule, type ValidationIssue } from "@/lib/schedule-validation";
import { validateFragnetRelationshipHealth } from "@/lib/schedule-relationship-health";
import {
  compareActivityCodes,
  sortDeliverablesByWorkflowOrder,
} from "@/lib/activity-code-sequence";
import { deliverableScopedActivities } from "@/lib/activity-list-filters";
import { cpmLookupActivityId } from "@/lib/schedule-effective";
import { deliverableScheduleNodeId } from "@/lib/schedule-node-ids";
import { addCalendarDays, parseScheduleDate, startOfUtcToday, toDayIndex } from "@/lib/schedule-timeline";

function formatRelLag(lag: number): string {
  return lag === 0 ? "" : lag > 0 ? `+${lag}` : String(lag);
}

function formatDeliverableRelLabel(r: ScheduleDeliverableRel, role: "predecessor" | "successor"): string {
  const lag = formatRelLag(r.lag);
  if (role === "successor" && r.activityCode) {
    return `${r.relationshipType}${lag}→${r.activityCode}`;
  }
  if (role === "predecessor" && r.activityCode) {
    return `←${r.activityCode} ${r.relationshipType}${lag}`;
  }
  const name = r.deliverableName;
  return role === "predecessor" ? `←${name} ${r.relationshipType}${lag}` : `→${name} ${r.relationshipType}${lag}`;
}

/** Compact REL column text for activity rows (includes deliverable↔activity links). */
export function formatActivityRelationshipSummary(
  predecessors: ScheduleActivityRel[],
  successors: ScheduleActivityRel[]
): string {
  const parts = [
    ...predecessors.map((r) =>
      r.deliverableName
        ? `←${r.deliverableName} ${r.relationshipType}${formatRelLag(r.lag)}`
        : `←${r.activityCode} ${r.relationshipType}${formatRelLag(r.lag)}`
    ),
    ...successors.map((r) =>
      r.deliverableName
        ? `${r.relationshipType}${formatRelLag(r.lag)}→${r.deliverableName}`
        : `${r.relationshipType}${formatRelLag(r.lag)}→${r.activityCode}`
    ),
  ];
  if (parts.length > 0) return parts.join(" · ");
  return "—";
}

/** Compact REL column text for deliverable summary rows. */
export function formatDeliverableRelationshipSummary(
  relationships: ScheduleDeliverable["relationships"],
  activityCount: number
): string {
  const parts: string[] = [
    ...relationships.predecessors.map((r) => formatDeliverableRelLabel(r, "predecessor")),
    ...relationships.successors.map((r) => formatDeliverableRelLabel(r, "successor")),
  ];
  if (parts.length > 0) return parts.join(" · ");
  return activityCount > 0 ? `${activityCount} act` : "—";
}

export type WorkspaceRowKind =
  | "fragnet"
  | "deliverable"
  | "sharedGroup"
  | "activity"
  | "sharedLinkedDeliverable";

export type WorkspaceCollapseState = {
  fragnets: Record<string, boolean>;
  deliverables: Record<string, boolean>;
  sharedGroups: Record<string, boolean>;
  /** Per shared-activity id: expanded linked-deliverable list. */
  sharedActivities: Record<string, boolean>;
};

export type WorkspaceRow = {
  key: string;
  kind: WorkspaceRowKind;
  depth: number;
  fragnetId: string;
  deliverableId?: string;
  /** Gantt / logic node id — activities use UUID; deliverables use `del:{id}`. */
  scheduleNodeId?: string;
  activityId?: string;
  label: string;
  code?: string;
  duration?: number;
  bestDuration?: number;
  likelyDuration?: number;
  activity?: ScheduleActivity;
  cpm?: ScheduleNetworkActivity;
  relSummary?: string;
  resourceCount?: number;
  isSummary?: boolean;
  /** Shared activity rows: comma-separated linked deliverable names. */
  sharedByLabel?: string;
};

/** Shared activities for a WBS (populated by parseFullData). */
export function collectFragnetSharedActivities(fragnet: ScheduleFragnet): ScheduleActivity[] {
  const list = fragnet.sharedActivities ?? [];
  return [...list].sort((a, b) => compareActivityCodes(a.activityCode, b.activityCode));
}

/** Unique persisted activity count (matches Activities page / full-data). */
export function countCanonicalActivities(data: ProjectFullData): number {
  const seen = new Set<string>();
  for (const f of data.fragnets) {
    for (const a of collectFragnetSharedActivities(f)) {
      seen.add(a.id);
    }
    for (const d of f.deliverables) {
      for (const a of deliverableScopedActivities(d.activities)) {
        seen.add(a.id);
      }
    }
  }
  return seen.size;
}

export type RowDiagnostic = {
  code: string;
  severity: ValidationIssue["severity"];
  message: string;
};

const DIAG_ICONS: Record<string, string> = {
  CPM_CYCLE: "cycle",
  CYCLE: "cycle",
  NEGATIVE_FLOAT: "float",
  IMPOSSIBLE_DATES: "dates",
  OPEN_END: "open",
  DANGLING_LOGIC: "dangle",
  DISCONNECTED_NETWORK: "network",
  ORPHAN_PRED: "orphan",
  INVALID_DURATION: "duration",
};

export function diagnosticIcon(code: string): string {
  return DIAG_ICONS[code] ?? "issue";
}

function rollupDeliverableCpm(activityRows: WorkspaceRow[]): ScheduleNetworkActivity | undefined {
  let earlyStart: string | null = null;
  let earlyFinish: string | null = null;
  let lateStart: string | null = null;
  let lateFinish: string | null = null;
  let any = false;
  for (const r of activityRows) {
    const c = r.cpm;
    if (!c?.earlyStart || !c?.earlyFinish) continue;
    any = true;
    if (!earlyStart || c.earlyStart < earlyStart) earlyStart = c.earlyStart;
    if (!earlyFinish || c.earlyFinish > earlyFinish) earlyFinish = c.earlyFinish;
    if (c.lateStart && (!lateStart || c.lateStart < lateStart)) lateStart = c.lateStart;
    if (c.lateFinish && (!lateFinish || c.lateFinish > lateFinish)) lateFinish = c.lateFinish;
  }
  if (!any || !earlyStart || !earlyFinish) return undefined;
  return {
    id: "rollup",
    activityCode: "",
    earlyStart,
    earlyFinish,
    lateStart,
    lateFinish,
    totalFloat: 0,
    freeFloat: 0,
    isCritical: false,
  };
}

function buildFallbackDeliverableCpm(
  data: ProjectFullData,
  deliverableRelationships: DeliverableRelationship[],
  scenario: "best" | "likely",
  projectStart: string | null | undefined
): Map<string, ScheduleNetworkActivity> {
  const fallback = new Map<string, ScheduleNetworkActivity>();
  const anchor = parseScheduleDate(projectStart) ?? startOfUtcToday();
  const anchorDay = toDayIndex(anchor);

  for (const fragnet of data.fragnets) {
    const deliverables = sortDeliverablesByWorkflowOrder(fragnet.deliverables);
    if (deliverables.length === 0) continue;

    const durationById = new Map(
      deliverables.map((deliverable) => [
        deliverable.id,
        Math.max(1, scenario === "best" ? deliverable.bestDuration : deliverable.likelyDuration),
      ])
    );
    const relevantRelationships = deliverableRelationships.filter(
      (relationship) =>
        relationship.fragnetId === fragnet.id &&
        durationById.has(relationship.predecessorDeliverableId) &&
        durationById.has(relationship.successorDeliverableId)
    );

    const successorsByDeliverableId = new Map<string, DeliverableRelationship[]>();
    const indegree = new Map<string, number>(deliverables.map((deliverable) => [deliverable.id, 0]));

    for (const relationship of relevantRelationships) {
      const list = successorsByDeliverableId.get(relationship.predecessorDeliverableId) ?? [];
      list.push(relationship);
      successorsByDeliverableId.set(relationship.predecessorDeliverableId, list);
      indegree.set(
        relationship.successorDeliverableId,
        (indegree.get(relationship.successorDeliverableId) ?? 0) + 1
      );
    }

    const queue = deliverables
      .filter((deliverable) => (indegree.get(deliverable.id) ?? 0) === 0)
      .map((deliverable) => deliverable.id);
    const orderedIds: string[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      orderedIds.push(currentId);
      for (const relationship of successorsByDeliverableId.get(currentId) ?? []) {
        const nextId = relationship.successorDeliverableId;
        const nextDegree = (indegree.get(nextId) ?? 0) - 1;
        indegree.set(nextId, nextDegree);
        if (nextDegree === 0) queue.push(nextId);
      }
    }

    for (const deliverable of deliverables) {
      if (!orderedIds.includes(deliverable.id)) orderedIds.push(deliverable.id);
    }

    const earlyStartDayById = new Map<string, number>(deliverables.map((deliverable) => [deliverable.id, anchorDay]));
    const earlyFinishDayById = new Map<string, number>();

    for (const deliverableId of orderedIds) {
      const durationDays = durationById.get(deliverableId) ?? 1;
      const startDay = earlyStartDayById.get(deliverableId) ?? anchorDay;
      const finishDay = startDay + durationDays - 1;
      earlyFinishDayById.set(deliverableId, finishDay);

      for (const relationship of successorsByDeliverableId.get(deliverableId) ?? []) {
        const successorId = relationship.successorDeliverableId;
        const successorDuration = durationById.get(successorId) ?? 1;
        const successorCurrentStart = earlyStartDayById.get(successorId) ?? anchorDay;
        const lag = relationship.lag ?? 0;
        const candidateStart =
          relationship.relationshipType === "SS"
            ? startDay + lag
            : relationship.relationshipType === "FF"
              ? finishDay + lag - (successorDuration - 1)
              : relationship.relationshipType === "SF"
                ? startDay + lag - (successorDuration - 1)
                : finishDay + lag + 1;
        earlyStartDayById.set(successorId, Math.max(successorCurrentStart, candidateStart));
      }
    }

    for (const deliverable of deliverables) {
      const durationDays = durationById.get(deliverable.id) ?? 1;
      const startDay = earlyStartDayById.get(deliverable.id) ?? anchorDay;
      const finishDay = earlyFinishDayById.get(deliverable.id) ?? startDay + durationDays - 1;
      fallback.set(deliverable.id, {
        id: `del:${deliverable.id}`,
        activityCode: deliverable.name,
        earlyStart: addCalendarDays(anchor, startDay - anchorDay).toISOString().slice(0, 10),
        earlyFinish: addCalendarDays(anchor, finishDay - anchorDay).toISOString().slice(0, 10),
        lateStart: addCalendarDays(anchor, startDay - anchorDay).toISOString().slice(0, 10),
        lateFinish: addCalendarDays(anchor, finishDay - anchorDay).toISOString().slice(0, 10),
        totalFloat: 0,
        freeFloat: 0,
        isCritical: false,
      });
    }
  }

  return fallback;
}

export function buildWorkspaceRows(
  data: ProjectFullData,
  collapse: WorkspaceCollapseState,
  cpmById: Map<string, ScheduleNetworkActivity>,
  deliverableRelationships: DeliverableRelationship[],
  scenario: "best" | "likely",
  search: string,
  projectStart?: string | null
): WorkspaceRow[] {
  const q = search.trim().toLowerCase();
  const fallbackDeliverableCpm = buildFallbackDeliverableCpm(
    data,
    deliverableRelationships,
    scenario,
    projectStart
  );
  const rows: WorkspaceRow[] = [];

  for (const f of data.fragnets) {
    const isProjectLevelGroup = isProjectLevelGroupName(f.name);
    const fOpen = collapse.fragnets[f.id] ?? true;
    const fMatch = !q || f.name.toLowerCase().includes(q);
    let fHasVisibleChild = false;
    const deliverableRows: WorkspaceRow[] = [];

    const sharedActivities = collectFragnetSharedActivities(f);
    const sharedRows: WorkspaceRow[] = [];
    if (sharedActivities.length > 0) {
      const sharedGroupOpen = collapse.sharedGroups[f.id] ?? true;
      const sharedGroupRow: WorkspaceRow = {
        key: `shared:${f.id}`,
        kind: "sharedGroup",
        depth: 1,
        fragnetId: f.id,
        label: "Shared Activities",
        relSummary: `${sharedActivities.length} act`,
        isSummary: true,
      };
      let sharedVisible = !q;
      const sharedActivityRows: WorkspaceRow[] = [];
      for (const a of sharedActivities) {
        const linked = (a.linkedDeliverables ?? []).filter((ld) => ld.name);
        const linkedNames = linked.map((ld) => ld.name);
        const sharedByLabel = linkedNames.length > 0 ? linkedNames.join(", ") : "—";
        const match =
          !q ||
          a.activityCode.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          sharedByLabel.toLowerCase().includes(q) ||
          f.name.toLowerCase().includes(q);
        if (!match) continue;
        sharedVisible = true;
        const actOpen = collapse.sharedActivities[a.id] ?? true;
        const relSummary = formatActivityRelationshipSummary(
          a.relationships.predecessors,
          a.relationships.successors
        );
        sharedActivityRows.push({
          key: `act:${a.id}`,
          kind: "activity",
          depth: 2,
          fragnetId: f.id,
          scheduleNodeId: a.id,
          activityId: a.id,
          label: a.name,
          code: a.activityCode,
          duration: scenario === "best" ? a.bestDuration : a.likelyDuration,
          bestDuration: a.bestDuration,
          likelyDuration: a.likelyDuration,
          activity: a,
          cpm: cpmById.get(cpmLookupActivityId(a)),
          relSummary,
          resourceCount: a.assignedResources?.length ?? 0,
          sharedByLabel,
        });
        if ((actOpen || q) && linked.length > 0) {
          for (const ld of linked) {
            sharedActivityRows.push({
              key: `shared-del:${a.id}:${ld.id}`,
              kind: "sharedLinkedDeliverable",
              depth: 3,
              fragnetId: f.id,
              label: ld.name,
            });
          }
        }
      }
      if (sharedVisible) {
        fHasVisibleChild = true;
        sharedRows.push(sharedGroupRow);
        if (sharedGroupOpen || q) sharedRows.push(...sharedActivityRows);
      }
    }

    for (const d of sortDeliverablesByWorkflowOrder(f.deliverables)) {
      const dOpen = collapse.deliverables[d.id] ?? true;
      const dMatch = !q || d.name.toLowerCase().includes(q);
      const activityRows: WorkspaceRow[] = [];

      const sortedActivities = deliverableScopedActivities(d.activities).sort((a, b) =>
        compareActivityCodes(a.activityCode, b.activityCode)
      );
      for (const a of sortedActivities) {
        const match =
          !q ||
          a.activityCode.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          (a.isSharedAcrossDeliverables &&
            (a.linkedDeliverables ?? []).some((ld) => ld.name.toLowerCase().includes(q))) ||
          d.name.toLowerCase().includes(q) ||
          f.name.toLowerCase().includes(q);
        if (!match) continue;
        const relSummary = formatActivityRelationshipSummary(
          a.relationships.predecessors,
          a.relationships.successors
        );
        activityRows.push({
          key: `act:${a.id}`,
          kind: "activity",
          depth: 2,
          fragnetId: f.id,
          deliverableId: d.id,
          scheduleNodeId: a.id,
          activityId: a.id,
          label: a.name,
          code: a.activityCode,
          duration: scenario === "best" ? a.bestDuration : a.likelyDuration,
          bestDuration: a.bestDuration,
          likelyDuration: a.likelyDuration,
          activity: a,
          cpm: cpmById.get(cpmLookupActivityId(a)),
          relSummary,
          resourceCount: a.assignedResources?.length ?? 0,
        });
      }

      const delRelSummary = formatDeliverableRelationshipSummary(
        d.relationships ?? { predecessors: [], successors: [] },
        activityRows.length
      );

      const visible =
        !q ||
        dMatch ||
        activityRows.length > 0;
      if (!visible) continue;

      fHasVisibleChild = true;
      const deliverableRow: WorkspaceRow = {
        key: `del:${d.id}`,
        kind: "deliverable",
        depth: 1,
        fragnetId: f.id,
        deliverableId: d.id,
        scheduleNodeId: deliverableScheduleNodeId(d.id),
        label: d.name,
        code: d.name,
        duration: scenario === "best" ? d.bestDuration : d.likelyDuration,
        bestDuration: d.bestDuration,
        likelyDuration: d.likelyDuration,
        cpm: rollupDeliverableCpm(activityRows) ?? fallbackDeliverableCpm.get(d.id),
        relSummary: delRelSummary,
        isSummary: true,
      };
      deliverableRows.push(deliverableRow);
      if (dOpen || q) activityRows.forEach((r) => deliverableRows.push(r));
    }

    if (fHasVisibleChild || fMatch) {
      if (isProjectLevelGroup) {
        rows.push(...sharedRows);
        rows.push(...deliverableRows);
        continue;
      }
      if (fMatch && !fHasVisibleChild && q) {
        rows.push({
          key: `frag:${f.id}`,
          kind: "fragnet",
          depth: 0,
          fragnetId: f.id,
          label: f.name,
        });
      } else {
        rows.push({
          key: `frag:${f.id}`,
          kind: "fragnet",
          depth: 0,
          fragnetId: f.id,
          label: f.name,
        });
        if (fOpen || q) {
          rows.push(...sharedRows);
          rows.push(...deliverableRows);
        }
      }
    }
  }

  return rows;
}

export function cpmActivityMap(activities: ScheduleNetworkActivity[]): Map<string, ScheduleNetworkActivity> {
  return new Map(activities.map((a) => [a.id, a]));
}

export function buildDiagnosticsByActivity(
  issues: Array<ValidationIssue | ScheduleDiagnostic>,
  codeToId: Map<string, string>
): Map<string, RowDiagnostic[]> {
  const byActivity = new Map<string, RowDiagnostic[]>();

  const push = (activityId: string | undefined, d: RowDiagnostic) => {
    if (!activityId) return;
    const list = byActivity.get(activityId) ?? [];
    if (!list.some((x) => x.code === d.code && x.message === d.message)) list.push(d);
    byActivity.set(activityId, list);
  };

  for (const issue of issues) {
    const code = issue.code;
    const severity = issue.severity as RowDiagnostic["severity"];
    const message = issue.message;
    const entityId = "entityId" in issue ? issue.entityId : undefined;
    const entityLabel = "entityLabel" in issue ? issue.entityLabel : undefined;

    if (entityId) {
      push(entityId, { code, severity, message });
      continue;
    }
    if (entityLabel && codeToId.has(entityLabel)) {
      push(codeToId.get(entityLabel), { code, severity, message });
    }
    if (code === "CPM_CYCLE" && entityId) {
      for (const id of entityId.split(",")) push(id.trim(), { code, severity, message });
    }
  }

  return byActivity;
}

export function relationshipHealthIssues(
  data: ProjectFullData,
  relationships: ScheduleNetworkRelationship[]
): ValidationIssue[] {
  const all: ValidationIssue[] = [];
  for (const f of data.fragnets) {
    const acts: import("@/lib/api").Activity[] = [];
    const actIds = new Set<string>();
    for (const d of f.deliverables) {
      for (const a of d.activities) {
        actIds.add(a.id);
        acts.push({
          id: a.id,
          fragnetId: f.id,
          deliverableId: d.id,
          activityCode: a.activityCode,
          name: a.name,
          status: "ACTIVE",
          bestDuration: a.bestDuration,
          likelyDuration: a.likelyDuration,
          assuranceNoteId: null,
          createdAt: "",
        });
      }
    }
    const rels: Relationship[] = relationships
      .filter(
        (r) => actIds.has(r.predecessorActivityId) && actIds.has(r.successorActivityId)
      )
      .map((r) => ({ ...r, fragnetId: f.id }));
    all.push(...validateFragnetRelationshipHealth(acts, rels));
  }
  return all;
}

export function activityCodeToIdMap(data: ProjectFullData): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of data.fragnets) {
    for (const a of collectFragnetSharedActivities(f)) {
      m.set(a.activityCode, a.id);
    }
    for (const d of f.deliverables) {
      for (const a of deliverableScopedActivities(d.activities)) {
        m.set(a.activityCode, a.id);
      }
    }
  }
  return m;
}

export function projectStructuralIssues(
  data: ProjectFullData,
  rateCard: RateCardEntry[],
  scenario: "best" | "likely"
): ValidationIssue[] {
  return validateProjectSchedule(data, rateCard, scenario);
}

export function collectActivityDates(rows: WorkspaceRow[]): Array<{ start: Date | null; finish: Date | null }> {
  const out: Array<{ start: Date | null; finish: Date | null }> = [];
  for (const row of rows) {
    if (row.kind !== "activity" || !row.cpm) continue;
    out.push({
      start: parseScheduleDate(row.cpm.earlyStart),
      finish: parseScheduleDate(row.cpm.earlyFinish),
    });
  }
  return out;
}

export function activityRowsOnly(rows: WorkspaceRow[]): WorkspaceRow[] {
  return rows.filter((r) => r.kind === "activity");
}

export function rowIndexByActivityId(rows: WorkspaceRow[]): Map<string, number> {
  const m = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.activityId) m.set(r.activityId, i);
  });
  return m;
}
