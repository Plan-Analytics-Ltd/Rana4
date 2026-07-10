import type { ProgrammeSnapshotRole, RelationshipType } from "@prisma/client";
import { prisma } from "../../../utils/prisma.js";
import type { ImportedActivityRow, ImportedRelationshipRow } from "./types.js";
import { resolveWorkPackageDuration } from "./historicalDuration.service.js";
import { diffDaysFromDates } from "./intelligenceMath.js";

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

function activityDurationDays(row: ImportedActivityRow): number {
  const raw =
    row.remainingDurationDays ?? row.originalDurationDays ?? row.actualDurationDays;
  if (raw != null && Number.isFinite(raw) && raw >= 1) return Math.round(raw);
  return 1;
}

function shouldSyncLiveSchedule(snapshotRole?: ProgrammeSnapshotRole | null): boolean {
  return snapshotRole === "LIVE_IMPORT" || snapshotRole === "AS_BUILT";
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

  return prisma.$transaction(async (tx) => {
    let activitiesUpdated = 0;
    const affectedDeliverableIds = new Set<string>();

    for (const row of matched) {
      if (!row.activityId) continue;
      const dur = activityDurationDays(row);
      await tx.activity.update({
        where: { id: row.activityId },
        data: {
          name: row.name?.trim().slice(0, 255) || undefined,
          bestDuration: dur,
          likelyDuration: dur,
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
          plannedStartDate: true,
          plannedFinishDate: true,
          earlyStart: true,
          earlyFinish: true,
        },
      });
      const starts = acts
        .map((a) => a.plannedStartDate ?? a.earlyStart)
        .filter((d): d is Date => d != null);
      const finishes = acts
        .map((a) => a.plannedFinishDate ?? a.earlyFinish)
        .filter((d): d is Date => d != null);
      const minStart = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
      const maxFinish = finishes.length
        ? new Date(Math.max(...finishes.map((d) => d.getTime())))
        : null;
      const span = diffDaysFromDates(minStart, maxFinish);
      const wp = resolveWorkPackageDuration(
        acts.map((a) => ({
          originalDuration: a.bestDuration,
          remainingDuration: a.likelyDuration,
          actualDuration: null,
        })),
        span
      );
      if (wp.durationDays != null) {
        await tx.deliverable.update({
          where: { id: deliverableId },
          data: { bestDuration: wp.durationDays, likelyDuration: wp.durationDays },
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
  });
}
