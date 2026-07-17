import type { Prisma } from "@prisma/client";
import { prisma } from "../../../utils/prisma.js";
import {
  buildDeliverableFingerprint,
  fingerprintCacheKey,
} from "../matching/deliverableFingerprint.service.js";
import { computeDeliverableEvolution } from "../matching/deliverableEvolution.service.js";
import { computeDeliverableTimeline } from "../matching/historicalTimeline.service.js";
import {
  computeProjectEvolutionIntelligence,
  type ProjectEvolutionIntelligence,
} from "./projectEvolutionIntelligence.service.js";
import type { HistoricalRevision } from "../matching/revisionGrouping.service.js";
import { diffDaysFromDates } from "./intelligenceMath.js";
import {
  buildPlannerRevisionStoryLabel,
  computeLiveUpdateIndices,
  resolveCanonicalProgrammeName,
} from "./programmeIdentity.service.js";
import {
  buildProgrammeLogicSummary,
  computeRevisionProgrammeIntelligence,
  type RevisionProgrammeIntelligence,
  type SnapshotLogicState,
} from "./programmeLogicEvolution.service.js";
import { resolveDeliverableDurationView } from "./durationSource.service.js";

/** Live deliverable anchor for resolving the same logical deliverable across programme revisions. */
export type ProjectEvolutionDeliverableAnchor = {
  deliverableId: string;
  name: string;
  fragnetId: string | null;
};

export function buildProjectEvolutionSnapshotWhere(args: {
  projectId: string;
  companyId: string;
  anchor: ProjectEvolutionDeliverableAnchor;
}): Prisma.DeliverableSnapshotWhereInput {
  const { projectId, companyId, anchor } = args;

  const identityClause: Prisma.DeliverableSnapshotWhereInput = anchor.fragnetId
    ? {
        OR: [
          { deliverableId: anchor.deliverableId },
          {
            AND: [
              { fragnetId: anchor.fragnetId },
              { name: { equals: anchor.name, mode: "insensitive" } },
            ],
          },
        ],
      }
    : { deliverableId: anchor.deliverableId };

  return {
    snapshot: { projectId, companyId },
    ...identityClause,
  };
}

export function oneDeliverableSnapshotPerProgrammeRevision<
  T extends { snapshot: { id: string } },
>(rows: T[]): T[] {
  const byProgrammeSnapshot = new Map<string, T>();
  for (const row of rows) {
    if (!byProgrammeSnapshot.has(row.snapshot.id)) {
      byProgrammeSnapshot.set(row.snapshot.id, row);
    }
  }
  return [...byProgrammeSnapshot.values()];
}

export type ProgrammeStateChangeKind =
  | "stable"
  | "progress"
  | "remaining_increase"
  | "replanning";

export type DeliverableProjectEvolutionRevision = {
  snapshotId: string;
  label: string;
  programmeDisplayName: string | null;
  role: string | null;
  programmeState: string | null;
  importedAt: string;
  /**
   * Programme-state duration for this revision (Remaining-first).
   * Drives evolution trends, timeline, and change deltas.
   */
  durationDays: number | null;
  durationChangeDays: number | null;
  /** Explicit Remaining Duration (programme state). Same source as durationDays when resolved. */
  remainingDurationDays: number | null;
  remainingDurationChangeDays: number | null;
  /** Primavera Original / Target duration (planning) — for progress vs replanning. */
  planningDurationDays: number | null;
  planningDurationChangeDays: number | null;
  /** True when planning duration changed vs previous revision. */
  planningChanged: boolean;
  /** Classifies programme-state change since previous revision (null on first revision). */
  changeKind: ProgrammeStateChangeKind | null;
};

export type DeliverableProjectEvolutionReport = {
  deliverableId: string;
  deliverableName: string;
  programmeDisplayName: string | null;
  revisions: DeliverableProjectEvolutionRevision[];
  evolution: ReturnType<typeof computeDeliverableEvolution>;
  timeline: ReturnType<typeof computeDeliverableTimeline>;
  projectEvolutionIntelligence: ProjectEvolutionIntelligence;
  programmeLogicEvolution: RevisionProgrammeIntelligence[];
  programmeLogicSummary: string | null;
  durationView: Awaited<ReturnType<typeof resolveDeliverableDurationView>>;
};

function programmeDisplayNameFromSnapshot(snapshot: {
  label: string | null;
  snapshotVersion: number;
  snapshotRole: string | null;
  importSummary: unknown;
  sourceFileName: string | null;
}): string | null {
  const summary = snapshot.importSummary as Record<string, unknown> | undefined;
  const stored = String(summary?.programmeDisplayName ?? "").trim();
  if (stored) return stored;
  return null;
}

function snapshotLabel(
  snapshot: {
    label: string | null;
    snapshotVersion: number;
    snapshotRole: string | null;
    programmeState: string | null;
    importSummary: unknown;
    sourceFileName: string | null;
  },
  programmeDisplayName: string | null,
  liveMeta: { index: number; isLatest: boolean; total: number } | null
): string {
  return buildPlannerRevisionStoryLabel({
    snapshotRole: snapshot.snapshotRole,
    programmeState: snapshot.programmeState,
    liveUpdateIndex: liveMeta?.index ?? null,
    isLatestLiveUpdate: liveMeta?.isLatest ?? false,
    totalLiveUpdates: liveMeta?.total ?? 0,
  });
}

/**
 * Calendar-span fallback only — used when no activity duration fields exist.
 * Prefer Remaining / Original from ActivitySnapshot for Project Evolution.
 */
function resolveCalendarFallbackDays(row: {
  workPackageDurationDays: number | null;
  plannedStart: Date | null;
  plannedFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
}): number | null {
  // Prefer stored WP only as last-resort when activities lack remaining/original;
  // Evolution normally does not invent values.
  const span = diffDaysFromDates(
    row.actualStart ?? row.plannedStart,
    row.actualFinish ?? row.plannedFinish
  );
  if (span != null) return span;
  if (row.workPackageDurationDays != null && Number.isFinite(row.workPackageDurationDays)) {
    return Math.round(row.workPackageDurationDays);
  }
  return null;
}

type SnapshotActivityDurations = {
  originalDuration: number | null;
  remainingDuration: number | null;
  actualDuration: number | null;
};

/** Max Remaining across activities — programme state at this revision. */
export function resolveProgrammeRemainingDays(
  activities: SnapshotActivityDurations[],
  fallback: number | null = null
): number | null {
  const remaining = activities
    .map((a) => a.remainingDuration)
    .filter((d): d is number => d != null && Number.isFinite(d) && d >= 0)
    .map((d) => Math.round(d));
  if (remaining.length > 0) return Math.max(...remaining);

  // Fall through only when Remaining was never stored for any activity
  const originals = activities
    .map((a) => a.originalDuration)
    .filter((d): d is number => d != null && Number.isFinite(d) && d >= 0)
    .map((d) => Math.round(d));
  if (originals.length > 0) return Math.max(...originals);

  const actuals = activities
    .map((a) => a.actualDuration)
    .filter((d): d is number => d != null && Number.isFinite(d) && d >= 0)
    .map((d) => Math.round(d));
  if (actuals.length > 0) return Math.max(...actuals);

  return fallback;
}

/** Max Original/Target across activities — planning duration (not programme remaining). */
export function resolvePlanningDurationDays(
  activities: SnapshotActivityDurations[],
  fallback: number | null = null
): number | null {
  const originals = activities
    .map((a) => a.originalDuration)
    .filter((d): d is number => d != null && Number.isFinite(d) && d >= 0)
    .map((d) => Math.round(d));
  if (originals.length > 0) return Math.max(...originals);

  const remaining = activities
    .map((a) => a.remainingDuration)
    .filter((d): d is number => d != null && Number.isFinite(d) && d >= 0)
    .map((d) => Math.round(d));
  if (remaining.length > 0) return Math.max(...remaining);

  return fallback;
}

export function classifyProgrammeStateChange(args: {
  remaining: number | null;
  previousRemaining: number | null;
  planning: number | null;
  previousPlanning: number | null;
}): ProgrammeStateChangeKind | null {
  const { remaining, previousRemaining, planning, previousPlanning } = args;
  if (previousRemaining == null && previousPlanning == null) return null;

  const planningChanged =
    planning != null && previousPlanning != null && planning !== previousPlanning;
  if (planningChanged) return "replanning";

  if (remaining != null && previousRemaining != null) {
    if (remaining < previousRemaining) return "progress";
    if (remaining > previousRemaining) return "remaining_increase";
    return "stable";
  }
  return "stable";
}

async function loadActivityDurationsBySnapshot(
  snapshotIds: string[],
  deliverableId: string
): Promise<Map<string, SnapshotActivityDurations[]>> {
  const map = new Map<string, SnapshotActivityDurations[]>();
  if (snapshotIds.length === 0) return map;

  const rows = await prisma.activitySnapshot.findMany({
    where: {
      snapshotId: { in: snapshotIds },
      deliverableId,
    },
    select: {
      snapshotId: true,
      originalDuration: true,
      remainingDuration: true,
      actualDuration: true,
    },
  });

  for (const row of rows) {
    const list = map.get(row.snapshotId) ?? [];
    list.push({
      originalDuration: row.originalDuration,
      remainingDuration: row.remainingDuration,
      actualDuration: row.actualDuration,
    });
    map.set(row.snapshotId, list);
  }
  return map;
}

async function loadSnapshotLogicStates(
  snapshotIds: string[],
  deliverableId: string
): Promise<Map<string, SnapshotLogicState>> {
  if (snapshotIds.length === 0) return new Map();

  const [activities, relationships, snapshots] = await Promise.all([
    prisma.activitySnapshot.findMany({
      where: {
        snapshotId: { in: snapshotIds },
        deliverableId,
      },
      select: {
        snapshotId: true,
        activityCode: true,
        name: true,
        totalFloat: true,
        freeFloat: true,
        isCritical: true,
        finishDate: true,
      },
    }),
    prisma.relationshipSnapshot.findMany({
      where: { snapshotId: { in: snapshotIds } },
      select: {
        snapshotId: true,
        predecessorActivityCode: true,
        successorActivityCode: true,
        relationshipType: true,
        lag: true,
      },
    }),
    prisma.programmeSnapshot.findMany({
      where: { id: { in: snapshotIds } },
      select: {
        id: true,
        label: true,
        snapshotVersion: true,
        snapshotRole: true,
        programmeState: true,
        importSummary: true,
        sourceFileName: true,
      },
    }),
  ]);

  const snapMeta = new Map(snapshots.map((s) => [s.id, s]));
  const orderedSnapshots = snapshotIds
    .map((id) => snapMeta.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s);
  const liveIndices = computeLiveUpdateIndices(
    orderedSnapshots.map((s) => ({
      snapshotRole: s.snapshotRole,
      programmeState: s.programmeState,
    }))
  );
  const result = new Map<string, SnapshotLogicState>();

  for (let i = 0; i < snapshotIds.length; i++) {
    const snapId = snapshotIds[i]!;
    const meta = snapMeta.get(snapId);
    const snapActs = activities.filter((a) => a.snapshotId === snapId);
    const codes = new Set(snapActs.map((a) => a.activityCode.toUpperCase()));
    const snapRels = relationships.filter(
      (r) =>
        r.snapshotId === snapId &&
        (codes.has(r.successorActivityCode.toUpperCase()) ||
          codes.has(r.predecessorActivityCode.toUpperCase()))
    );

    const programmeDisplayName = meta ? programmeDisplayNameFromSnapshot(meta) : null;
    const liveMeta = liveIndices.get(i) ?? null;
    result.set(snapId, {
      snapshotId: snapId,
      label: meta ? snapshotLabel(meta, programmeDisplayName, liveMeta) : `Revision`,
      activities: snapActs.map((a) => ({
        activityCode: a.activityCode,
        name: a.name,
        totalFloat: a.totalFloat,
        freeFloat: a.freeFloat,
        isCritical: a.isCritical,
        finishDate: a.finishDate,
      })),
      relationships: snapRels.map((r) => ({
        predecessorActivityCode: r.predecessorActivityCode,
        successorActivityCode: r.successorActivityCode,
        relationshipType: r.relationshipType,
        lag: r.lag,
      })),
    });
  }

  return result;
}

/** Deliverable revision history for the current project only (Project Evolution). */
export async function getDeliverableProjectEvolution(args: {
  projectId: string;
  companyId: string;
  deliverableId: string;
}): Promise<DeliverableProjectEvolutionReport> {
  const deliverable = await prisma.deliverable.findFirst({
    where: { id: args.deliverableId, projectId: args.projectId, companyId: args.companyId },
    select: { id: true, name: true, fragnetId: true },
  });
  if (!deliverable) {
    const err: any = new Error("Deliverable not found");
    err.status = 404;
    throw err;
  }

  const project = await prisma.project.findFirst({
    where: { id: args.projectId, companyId: args.companyId },
    select: { name: true },
  });

  const anchor: ProjectEvolutionDeliverableAnchor = {
    deliverableId: deliverable.id,
    name: deliverable.name,
    fragnetId: deliverable.fragnetId,
  };

  const liveActivities = await prisma.activity.findMany({
    where: {
      projectId: args.projectId,
      companyId: args.companyId,
      deliverableId: deliverable.id,
    },
    select: { activityCode: true },
  });

  const rawRows = await prisma.deliverableSnapshot.findMany({
    where: buildProjectEvolutionSnapshotWhere({
      projectId: args.projectId,
      companyId: args.companyId,
      anchor,
    }),
    include: {
      snapshot: {
        select: {
          id: true,
          snapshotVersion: true,
          snapshotRole: true,
          programmeState: true,
          importedAt: true,
          label: true,
          stage: true,
          sourceFileName: true,
          importSummary: true,
        },
      },
    },
    orderBy: { snapshot: { importedAt: "asc" } },
  });

  const rows = oneDeliverableSnapshotPerProgrammeRevision(rawRows);
  const snapshotIds = rows.map((r) => r.snapshot.id);
  const [logicBySnapshot, activityDurationsBySnapshot] = await Promise.all([
    loadSnapshotLogicStates(snapshotIds, deliverable.id),
    loadActivityDurationsBySnapshot(snapshotIds, deliverable.id),
  ]);

  const deliverableActivityCodes = new Set<string>();
  for (const state of logicBySnapshot.values()) {
    for (const a of state.activities) {
      deliverableActivityCodes.add(a.activityCode.toUpperCase());
    }
  }
  for (const a of liveActivities) {
    deliverableActivityCodes.add(a.activityCode.trim().toUpperCase());
  }

  const programmeDisplayName =
    rows
      .map((r) => programmeDisplayNameFromSnapshot(r.snapshot))
      .find((n) => n) ??
    resolveCanonicalProgrammeName({ ranaProjectName: project?.name }) ??
    null;

  const revisionDurations = rows.map((d) => {
    const acts = activityDurationsBySnapshot.get(d.snapshot.id) ?? [];
    const calendarFallback = resolveCalendarFallbackDays(d);
    const remainingDurationDays = resolveProgrammeRemainingDays(acts, calendarFallback);
    const planningDurationDays = resolvePlanningDurationDays(acts, calendarFallback);
    return { remainingDurationDays, planningDurationDays };
  });

  const historicalRevisions: HistoricalRevision[] = rows.map((d, i) => {
    const fp = buildDeliverableFingerprint({
      deliverableName: d.name,
      classification: d.classification,
      programmeState: d.snapshot.programmeState,
      stage: d.snapshot.stage,
    });
    return {
      snapshotId: d.snapshot.id,
      snapshotVersion: d.snapshot.snapshotVersion,
      snapshotRole: d.snapshot.snapshotRole,
      programmeState: d.snapshot.programmeState,
      projectId: args.projectId,
      deliverableId: d.deliverableId,
      deliverableName: d.name,
      importedAt: d.snapshot.importedAt,
      // Evolution trends track programme remaining (programme state), not planning Target
      durationDays: revisionDurations[i]!.remainingDurationDays,
      fingerprintKey: fingerprintCacheKey(fp),
    };
  });

  const evolution = computeDeliverableEvolution(historicalRevisions);
  const timeline = computeDeliverableTimeline(historicalRevisions);
  const liveIndices = computeLiveUpdateIndices(
    rows.map((r) => ({
      snapshotRole: r.snapshot.snapshotRole,
      programmeState: r.snapshot.programmeState,
    }))
  );

  const revisions: DeliverableProjectEvolutionRevision[] = historicalRevisions.map((r, i) => {
    const prevRemaining = i > 0 ? revisionDurations[i - 1]!.remainingDurationDays : null;
    const prevPlanning = i > 0 ? revisionDurations[i - 1]!.planningDurationDays : null;
    const remaining = revisionDurations[i]!.remainingDurationDays;
    const planning = revisionDurations[i]!.planningDurationDays;
    const remainingChange =
      remaining != null && prevRemaining != null ? remaining - prevRemaining : null;
    const planningChange =
      planning != null && prevPlanning != null ? planning - prevPlanning : null;
    const planningChanged =
      planning != null && prevPlanning != null && planning !== prevPlanning;
    const snap = rows[i]!.snapshot;
    const displayName = programmeDisplayNameFromSnapshot(snap) ?? programmeDisplayName;
    return {
      snapshotId: r.snapshotId,
      label: snapshotLabel(snap, displayName, liveIndices.get(i) ?? null),
      programmeDisplayName: displayName,
      role: snap.snapshotRole,
      programmeState: snap.programmeState,
      importedAt: r.importedAt.toISOString(),
      durationDays: remaining,
      durationChangeDays: remainingChange,
      remainingDurationDays: remaining,
      remainingDurationChangeDays: remainingChange,
      planningDurationDays: planning,
      planningDurationChangeDays: planningChange,
      planningChanged,
      changeKind: classifyProgrammeStateChange({
        remaining,
        previousRemaining: prevRemaining,
        planning,
        previousPlanning: prevPlanning,
      }),
    };
  });

  const projectEvolutionIntelligence = computeProjectEvolutionIntelligence(
    revisions.map((r) => ({
      label: r.label,
      role: r.role,
      importedAt: r.importedAt,
      durationDays: r.durationDays,
      durationChangeDays: r.durationChangeDays,
    }))
  );

  const programmeLogicEvolution = computeRevisionProgrammeIntelligence({
    revisions: revisions.map((r) => ({
      snapshotId: r.snapshotId,
      label: r.label,
      durationDays: r.durationDays,
      durationChangeDays: r.durationChangeDays,
      logicState:
        logicBySnapshot.get(r.snapshotId) ?? {
          snapshotId: r.snapshotId,
          label: r.label,
          activities: [],
          relationships: [],
        },
    })),
    deliverableActivityCodes,
  });

  const mergedObservations = [
    ...projectEvolutionIntelligence.plannerObservations,
    ...programmeLogicEvolution.flatMap((r) => r.plannerObservations),
  ];
  projectEvolutionIntelligence.plannerObservations = [...new Set(mergedObservations)].slice(0, 15);

  const durationView = await resolveDeliverableDurationView({
    projectId: args.projectId,
    companyId: args.companyId,
    deliverableId: deliverable.id,
  });

  return {
    deliverableId: deliverable.id,
    deliverableName: deliverable.name,
    programmeDisplayName,
    revisions,
    evolution,
    timeline,
    projectEvolutionIntelligence,
    programmeLogicEvolution,
    programmeLogicSummary: buildProgrammeLogicSummary(programmeLogicEvolution),
    durationView,
  };
}
