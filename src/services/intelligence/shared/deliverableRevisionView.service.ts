import type { ProgrammeSnapshotRole } from "@prisma/client";
import { prisma } from "../../../utils/prisma.js";
import {
  buildPlannerRevisionStoryLabel,
  computeLiveUpdateIndices,
} from "./programmeIdentity.service.js";

export type ProgrammeRevisionOption = {
  /** `live` for the editable programme; otherwise a programme snapshot id. */
  value: string;
  label: string;
  snapshotRole: ProgrammeSnapshotRole | null;
  importedAt: string | null;
  isLatestLiveUpdate?: boolean;
};

export type RevisionDeliverableDurations = {
  deliverableId: string;
  bestDuration: number;
  likelyDuration: number;
};

/**
 * RANA planning duration for a snapshot activity, seeded from the stored original
 * (target) duration. Best and Likely both use this — Remaining is retained in the
 * snapshot but no longer drives displayed Best/Likely durations.
 */
function snapshotActivityPlanningDays(activity: {
  originalDuration: number | null;
  actualDuration: number | null;
}): number {
  if (activity.originalDuration != null && Number.isFinite(activity.originalDuration)) {
    return Math.round(activity.originalDuration);
  }
  if (activity.actualDuration != null && Number.isFinite(activity.actualDuration)) {
    return Math.round(activity.actualDuration);
  }
  return 0;
}

export function resolveDeliverableRevisionDurations(
  activities: Array<{
    originalDuration: number | null;
    remainingDuration: number | null;
    actualDuration: number | null;
  }>,
  workPackageDurationDays: number | null = null
): { bestDuration: number; likelyDuration: number } {
  if (activities.length === 0) {
    const fallback = workPackageDurationDays ?? 0;
    return { bestDuration: fallback, likelyDuration: fallback };
  }

  const planning = activities.map(snapshotActivityPlanningDays);
  const bestDuration = Math.max(...planning);
  const likelyDuration = Math.max(...planning);
  return { bestDuration, likelyDuration };
}

/**
 * RANA planning durations for the current live programme.
 * activity.bestDuration holds the imported original (target) duration.
 * Likely is seeded from Original, not Remaining — stale activity.likely values
 * from the old model are ignored in favour of best (original).
 */
export function resolveLiveDeliverablePlanningDurations(
  activities: Array<{ bestDuration: number; likelyDuration: number }>
): { bestDuration: number; likelyDuration: number } | null {
  if (activities.length === 0) return null;
  const planningDays = activities.map((a) => a.bestDuration);
  const d = Math.max(...planningDays);
  return { bestDuration: d, likelyDuration: d };
}

/** Align live activity and deliverable rows with the RANA planning model (Likely = Original). */
export async function persistLiveRanaPlanningDurations(
  projectId: string,
  companyId: string
): Promise<void> {
  const activities = await prisma.activity.findMany({
    where: { projectId, companyId },
    select: { id: true, deliverableId: true, bestDuration: true, likelyDuration: true },
  });

  for (const activity of activities) {
    if (activity.likelyDuration !== activity.bestDuration) {
      await prisma.activity.update({
        where: { id: activity.id },
        data: { likelyDuration: activity.bestDuration },
      });
    }
  }

  const byDeliverable = new Map<string, Array<{ bestDuration: number; likelyDuration: number }>>();
  for (const activity of activities) {
    if (!activity.deliverableId) continue;
    const list = byDeliverable.get(activity.deliverableId) ?? [];
    list.push({
      bestDuration: activity.bestDuration,
      likelyDuration: activity.bestDuration,
    });
    byDeliverable.set(activity.deliverableId, list);
  }

  for (const [deliverableId, acts] of byDeliverable) {
    const planned = resolveLiveDeliverablePlanningDurations(acts);
    if (!planned) continue;
    await prisma.deliverable.update({
      where: { id: deliverableId },
      data: {
        bestDuration: planned.bestDuration,
        likelyDuration: planned.likelyDuration,
      },
    });
  }
}

export async function getLiveDeliverableDurations(
  projectId: string,
  companyId: string
): Promise<RevisionDeliverableDurations[]> {
  const activities = await prisma.activity.findMany({
    where: { projectId, companyId },
    select: { bestDuration: true, likelyDuration: true },
  });

  const needsRepair = activities.some((a) => a.likelyDuration !== a.bestDuration);
  if (needsRepair) {
    await persistLiveRanaPlanningDurations(projectId, companyId);
  }

  const deliverables = await prisma.deliverable.findMany({
    where: { projectId, companyId },
    select: { id: true, bestDuration: true, likelyDuration: true },
  });

  return deliverables.map((d) => ({
    deliverableId: d.id,
    bestDuration: d.bestDuration,
    likelyDuration: d.likelyDuration,
  }));
}

export async function listProgrammeRevisionOptions(
  projectId: string,
  companyId: string
): Promise<ProgrammeRevisionOption[]> {
  const snapshots = await prisma.programmeSnapshot.findMany({
    where: { projectId, companyId },
    orderBy: { importedAt: "asc" },
    select: {
      id: true,
      snapshotRole: true,
      programmeState: true,
      importedAt: true,
    },
  });

  const options: ProgrammeRevisionOption[] = [
    {
      value: "live",
      label: "Current Live Programme",
      snapshotRole: null,
      importedAt: null,
    },
  ];

  const liveIndices = computeLiveUpdateIndices(
    snapshots.map((s) => ({
      snapshotRole: s.snapshotRole,
      programmeState: s.programmeState,
    }))
  );

  let latestLiveSnapshotId: string | null = null;
  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i]!;
    const liveMeta = liveIndices.get(i) ?? null;
    const label = buildPlannerRevisionStoryLabel({
      snapshotRole: snap.snapshotRole,
      programmeState: snap.programmeState,
      liveUpdateIndex: liveMeta?.index ?? null,
      isLatestLiveUpdate: liveMeta?.isLatest ?? false,
      totalLiveUpdates: liveMeta?.total ?? 0,
    });

    if (liveMeta?.isLatest) latestLiveSnapshotId = snap.id;

    options.push({
      value: snap.id,
      label,
      snapshotRole: snap.snapshotRole,
      importedAt: snap.importedAt.toISOString(),
      isLatestLiveUpdate: liveMeta?.isLatest ?? false,
    });
  }

  const liveUpdateCount = [...liveIndices.values()].length;
  if (latestLiveSnapshotId && liveUpdateCount > 1) {
    const latest = snapshots.find((s) => s.id === latestLiveSnapshotId)!;
    options.push({
      value: latestLiveSnapshotId,
      label: "Latest Update",
      snapshotRole: latest.snapshotRole,
      importedAt: latest.importedAt.toISOString(),
      isLatestLiveUpdate: true,
    });
  }

  const asBuilt = snapshots.find((s) => s.snapshotRole === "AS_BUILT");
  if (asBuilt && !options.some((o) => o.value === asBuilt.id && o.label === "As-built")) {
    options.push({
      value: asBuilt.id,
      label: "As-built",
      snapshotRole: asBuilt.snapshotRole,
      importedAt: asBuilt.importedAt.toISOString(),
    });
  }

  return options;
}

export async function getRevisionDeliverableDurations(
  projectId: string,
  companyId: string,
  snapshotId: string
): Promise<RevisionDeliverableDurations[]> {
  const snapshot = await prisma.programmeSnapshot.findFirst({
    where: { id: snapshotId, projectId, companyId },
    select: { id: true },
  });
  if (!snapshot) {
    throw Object.assign(new Error("Programme revision not found"), { status: 404 });
  }

  const [deliverableSnapshots, activitySnapshots] = await Promise.all([
    prisma.deliverableSnapshot.findMany({
      where: { snapshotId },
      select: {
        deliverableId: true,
        workPackageDurationDays: true,
      },
    }),
    prisma.activitySnapshot.findMany({
      where: { snapshotId, deliverableId: { not: null } },
      select: {
        deliverableId: true,
        originalDuration: true,
        remainingDuration: true,
        actualDuration: true,
      },
    }),
  ]);

  const activitiesByDeliverable = new Map<
    string,
    Array<{
      originalDuration: number | null;
      remainingDuration: number | null;
      actualDuration: number | null;
    }>
  >();

  for (const row of activitySnapshots) {
    if (!row.deliverableId) continue;
    const list = activitiesByDeliverable.get(row.deliverableId) ?? [];
    list.push({
      originalDuration: row.originalDuration,
      remainingDuration: row.remainingDuration,
      actualDuration: row.actualDuration,
    });
    activitiesByDeliverable.set(row.deliverableId, list);
  }

  return deliverableSnapshots
    .filter((d): d is typeof d & { deliverableId: string } => !!d.deliverableId)
    .map((d) => {
      const acts = activitiesByDeliverable.get(d.deliverableId) ?? [];
      const durations = resolveDeliverableRevisionDurations(acts, d.workPackageDurationDays);
      return {
        deliverableId: d.deliverableId,
        bestDuration: durations.bestDuration,
        likelyDuration: durations.likelyDuration,
      };
    });
}
