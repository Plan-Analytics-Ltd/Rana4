import type { ProgrammeSnapshotRole, RelationshipType, Prisma } from "@prisma/client";
import { prisma } from "../../../utils/prisma.js";
import type { ImportedActivityRow, ImportedRelationshipRow } from "./types.js";

export type LiveProgrammeSyncSummary = {
  synced: boolean;
  activitiesUpdated: number;
  deliverablesUpdated: number;
  relationshipsCreated: number;
  relationshipsUpdated: number;
  relationshipsRemoved: number;
};

type MatchedActivity = ImportedActivityRow & {
  activityId?: string;
  deliverableId?: string;
  fragnetId?: string;
};

/**
 * RANA planning duration seeded from the imported original (target) duration.
 * Best and Likely are both RANA planning estimates — they are NOT derived from
 * Primavera Remaining Duration. Remaining is still imported and stored separately.
 */
export function liveActivityBestDurationDays(row: ImportedActivityRow): number {
  if (row.originalDurationDays != null && Number.isFinite(row.originalDurationDays)) {
    return Math.round(row.originalDurationDays);
  }
  if (row.actualDurationDays != null && Number.isFinite(row.actualDurationDays)) {
    return Math.round(row.actualDurationDays);
  }
  return 1;
}

/** Live likely = original (RANA planning estimate). Remaining no longer populates Likely. */
export function liveActivityLikelyDurationDays(row: ImportedActivityRow): number {
  return liveActivityBestDurationDays(row);
}

export function rollupLiveDeliverableDurations(
  activities: Array<{ bestDuration: number; likelyDuration: number }>
): { bestDuration: number; likelyDuration: number } | null {
  if (activities.length === 0) return null;
  return {
    bestDuration: Math.max(...activities.map((a) => a.bestDuration)),
    likelyDuration: Math.max(...activities.map((a) => a.likelyDuration)),
  };
}

function shouldSyncLiveSchedule(snapshotRole?: ProgrammeSnapshotRole | null): boolean {
  return snapshotRole === "LIVE_IMPORT" || snapshotRole === "AS_BUILT";
}

/** Large programmes can exceed Prisma's default 5s interactive transaction timeout. */
export const PROGRAMME_IMPORT_TX_OPTIONS = {
  maxWait: 30_000,
  timeout: 120_000,
} as const;

/**
 * Update the live schedule inside an existing transaction.
 * All queries must use the supplied tx — never prisma — so they share one atomic unit of work.
 */
export async function syncLiveProgrammeFromImportInTx(
  tx: Prisma.TransactionClient,
  args: {
    projectId: string;
    companyId: string;
    snapshotRole?: ProgrammeSnapshotRole | null;
    activities: MatchedActivity[];
    relationships: ImportedRelationshipRow[];
  }
): Promise<LiveProgrammeSyncSummary> {
  const empty: LiveProgrammeSyncSummary = {
    synced: false,
    activitiesUpdated: 0,
    deliverablesUpdated: 0,
    relationshipsCreated: 0,
    relationshipsUpdated: 0,
    relationshipsRemoved: 0,
  };

  if (!shouldSyncLiveSchedule(args.snapshotRole)) return empty;

  const matched = args.activities.filter((a) => a.activityId);
  if (matched.length === 0) return empty;

  const activityIdByCode = new Map<string, string>();
  for (const a of matched) {
    activityIdByCode.set(a.activityCode.trim().toUpperCase(), a.activityId!);
  }

  let activitiesUpdated = 0;
  const affectedDeliverableIds = new Set<string>();

  for (const row of matched) {
    if (!row.activityId) continue;
    const bestDuration = liveActivityBestDurationDays(row);
    const likelyDuration = liveActivityLikelyDurationDays(row);
    await tx.activity.update({
      where: { id: row.activityId },
      data: {
        name: row.name?.trim().slice(0, 255) || undefined,
        bestDuration,
        likelyDuration,
        plannedStartDate: row.startDate ?? undefined,
        plannedFinishDate: row.finishDate ?? undefined,
        earlyStart: row.earlyStart ?? undefined,
        earlyFinish: row.earlyFinish ?? undefined,
        lateStart: row.lateStart ?? undefined,
        lateFinish: row.lateFinish ?? undefined,
        totalFloat:
          row.totalFloatDays != null ? Math.round(row.totalFloatDays) : undefined,
        freeFloat: row.freeFloatDays != null ? Math.round(row.freeFloatDays) : undefined,
        isCritical: row.isCritical === true,
        p6TaskType: row.p6TaskType?.trim().slice(0, 32) || null,
      },
    });
    activitiesUpdated += 1;
    if (row.deliverableId) affectedDeliverableIds.add(row.deliverableId);
  }

  const liveActivities = await tx.activity.findMany({
    where: { projectId: args.projectId, companyId: args.companyId },
    select: {
      id: true,
      activityCode: true,
      deliverableId: true,
      fragnetId: true,
    },
  });

  const liveByCode = new Map(
    liveActivities.map((a) => [a.activityCode.trim().toUpperCase(), a])
  );

  const importRelKeys = new Set<string>();
  const desiredRels: Array<{
    predId: string;
    succId: string;
    fragnetId: string;
    type: RelationshipType;
    lag: number;
    key: string;
  }> = [];

  for (const r of args.relationships) {
    const predCode = r.predecessorActivityCode.trim().toUpperCase();
    const succCode = r.successorActivityCode.trim().toUpperCase();
    const predId = activityIdByCode.get(predCode);
    const succId = activityIdByCode.get(succCode);
    if (!predId || !succId) continue;
    const pred = liveByCode.get(predCode);
    const succ = liveByCode.get(succCode);
    if (!pred?.fragnetId || !succ?.fragnetId || pred.fragnetId !== succ.fragnetId) continue;
    const key = `${predId}\x1d${succId}\x1d${r.relationshipType}`;
    if (importRelKeys.has(key)) continue;
    importRelKeys.add(key);
    desiredRels.push({
      predId,
      succId,
      fragnetId: pred.fragnetId,
      type: r.relationshipType,
      lag: r.lag ?? 0,
      key,
    });
  }

  const liveRels = await tx.relationship.findMany({
    where: { projectId: args.projectId, companyId: args.companyId },
    select: {
      id: true,
      predecessorActivityId: true,
      successorActivityId: true,
      relationshipType: true,
      lag: true,
    },
  });

  const syncedActivityIds = new Set(matched.map((a) => a.activityId!));
  let relationshipsCreated = 0;
  let relationshipsUpdated = 0;
  let relationshipsRemoved = 0;

  const liveRelByKey = new Map<string, (typeof liveRels)[0]>();
  for (const lr of liveRels) {
    liveRelByKey.set(
      `${lr.predecessorActivityId}\x1d${lr.successorActivityId}\x1d${lr.relationshipType}`,
      lr
    );
  }

  for (const dr of desiredRels) {
    const existing = liveRelByKey.get(dr.key);
    if (existing) {
      if (existing.lag !== dr.lag) {
        await tx.relationship.update({
          where: { id: existing.id },
          data: { lag: dr.lag },
        });
        relationshipsUpdated += 1;
      }
    } else {
      await tx.relationship.create({
        data: {
          projectId: args.projectId,
          companyId: args.companyId,
          fragnetId: dr.fragnetId,
          predecessorActivityId: dr.predId,
          successorActivityId: dr.succId,
          relationshipType: dr.type,
          lag: dr.lag,
        },
      });
      relationshipsCreated += 1;
    }
  }

  for (const lr of liveRels) {
    const inScope =
      syncedActivityIds.has(lr.predecessorActivityId) &&
      syncedActivityIds.has(lr.successorActivityId);
    if (!inScope) continue;
    const key = `${lr.predecessorActivityId}\x1d${lr.successorActivityId}\x1d${lr.relationshipType}`;
    if (!importRelKeys.has(key)) {
      await tx.relationship.delete({ where: { id: lr.id } });
      relationshipsRemoved += 1;
    }
  }

  let deliverablesUpdated = 0;
  for (const deliverableId of affectedDeliverableIds) {
    const acts = await tx.activity.findMany({
      where: { projectId: args.projectId, companyId: args.companyId, deliverableId },
      select: {
        bestDuration: true,
        likelyDuration: true,
      },
    });
    const rolled = rollupLiveDeliverableDurations(acts);
    if (rolled) {
      await tx.deliverable.update({
        where: { id: deliverableId },
        data: {
          bestDuration: rolled.bestDuration,
          likelyDuration: rolled.likelyDuration,
        },
      });
      deliverablesUpdated += 1;
    }
  }

  return {
    synced: true,
    activitiesUpdated,
    deliverablesUpdated,
    relationshipsCreated,
    relationshipsUpdated,
    relationshipsRemoved,
  };
}

/**
 * After a programme import snapshot, update the live schedule so "current" reflects
 * the latest imported programme. Baseline-only imports do not change live data.
 */
export async function syncLiveProgrammeFromImport(args: {
  projectId: string;
  companyId: string;
  snapshotRole?: ProgrammeSnapshotRole | null;
  activities: MatchedActivity[];
  relationships: ImportedRelationshipRow[];
}): Promise<LiveProgrammeSyncSummary> {
  return prisma.$transaction(
    async (tx) => syncLiveProgrammeFromImportInTx(tx, args),
    PROGRAMME_IMPORT_TX_OPTIONS
  );
}
