import { prisma } from "../../../utils/prisma.js";
import {
  rollupDeliverableDatesFromActivities,
  type ActivityDateSource,
} from "../shared/deliverableSnapshotEnrichment.service.js";
import { resolveProgrammeState } from "../shared/programmeState.service.js";
import {
  buildDeliverableSnapshotContext,
  buildProgrammeSnapshotMetadataFromProfile,
} from "../shared/deliverableSnapshotContext.service.js";
import { resolveWorkPackageDuration } from "../shared/historicalDuration.service.js";
import { diffDaysFromDates } from "../shared/intelligenceMath.js";

export type HistoricalLearningRepairResult = {
  snapshotsProgrammeStateUpdated: number;
  snapshotsMetadataUpdated: number;
  deliverableSnapshotsDatesUpdated: number;
  deliverableSnapshotsContextUpdated: number;
  deliverableSnapshotsDurationUpdated: number;
  snapshotsScanned: number;
  deliverableSnapshotsScanned: number;
};

/**
 * Repair historical evidence gaps on existing snapshots:
 * 1. programmeState was never set at capture time
 * 2. programme snapshot metadata (stage, sector, …) missing from profile
 * 3. deliverable snapshots lack dates (XER imports derive deliverables from project, not file)
 * 4. deliverable snapshots lack WBS/stage/discipline context for fingerprint parity
 */
export async function repairCompanyHistoricalLearningEvidence(
  companyId: string
): Promise<HistoricalLearningRepairResult> {
  let snapshotsProgrammeStateUpdated = 0;
  let snapshotsMetadataUpdated = 0;
  let deliverableSnapshotsDatesUpdated = 0;
  let deliverableSnapshotsContextUpdated = 0;
  let deliverableSnapshotsDurationUpdated = 0;
  let deliverableSnapshotsScanned = 0;

  const snapshots = await prisma.programmeSnapshot.findMany({
    where: { companyId },
    select: {
      id: true,
      projectId: true,
      snapshotRole: true,
      sourceType: true,
      programmeState: true,
      sector: true,
      projectType: true,
      procurementRoute: true,
      stage: true,
      region: true,
      clientType: true,
      complexity: true,
      disciplineTags: true,
      projectTags: true,
      classificationTagsList: true,
      project: { include: { intelligenceProfile: true } },
    },
  });

  const projectFragnetNames = new Map<string, Map<string, string>>();
  const projectLiveDeliverables = new Map<
    string,
    Map<string, { fragnetId: string | null; fragnetName: string | null }>
  >();

  for (const snap of snapshots) {
    const resolved = resolveProgrammeState({
      snapshotRole: snap.snapshotRole,
      sourceType: snap.sourceType,
    });
    if (resolved && snap.programmeState !== resolved) {
      await prisma.programmeSnapshot.update({
        where: { id: snap.id },
        data: { programmeState: resolved },
      });
      snapshotsProgrammeStateUpdated += 1;
    }

    const profileMetadata = buildProgrammeSnapshotMetadataFromProfile(snap.project.intelligenceProfile);
    const metadataPatch: Record<string, unknown> = {};
    if (!snap.sector && profileMetadata.sector) metadataPatch.sector = profileMetadata.sector;
    if (!snap.projectType && profileMetadata.projectType) metadataPatch.projectType = profileMetadata.projectType;
    if (!snap.procurementRoute && profileMetadata.procurementRoute) {
      metadataPatch.procurementRoute = profileMetadata.procurementRoute;
    }
    if (!snap.stage && profileMetadata.stage) metadataPatch.stage = profileMetadata.stage;
    if (!snap.region && profileMetadata.region) metadataPatch.region = profileMetadata.region;
    if (!snap.clientType && profileMetadata.clientType) metadataPatch.clientType = profileMetadata.clientType;
    if (!snap.complexity && profileMetadata.complexity) metadataPatch.complexity = profileMetadata.complexity;
    if (
      Array.isArray(snap.disciplineTags) &&
      snap.disciplineTags.length === 0 &&
      profileMetadata.disciplineTags.length > 0
    ) {
      metadataPatch.disciplineTags = profileMetadata.disciplineTags;
    }
    if (
      Array.isArray(snap.projectTags) &&
      snap.projectTags.length === 0 &&
      profileMetadata.projectTags.length > 0
    ) {
      metadataPatch.projectTags = profileMetadata.projectTags;
    }
    if (
      Array.isArray(snap.classificationTagsList) &&
      snap.classificationTagsList.length === 0 &&
      profileMetadata.classificationTagsList.length > 0
    ) {
      metadataPatch.classificationTagsList = profileMetadata.classificationTagsList;
    }

    if (Object.keys(metadataPatch).length > 0) {
      await prisma.programmeSnapshot.update({
        where: { id: snap.id },
        data: metadataPatch,
      });
      snapshotsMetadataUpdated += 1;
      if (metadataPatch.stage) snap.stage = String(metadataPatch.stage);
      if (metadataPatch.disciplineTags) snap.disciplineTags = metadataPatch.disciplineTags as string[];
    }

    if (!projectFragnetNames.has(snap.projectId)) {
      const fragnets = await prisma.fragnet.findMany({
        where: { projectId: snap.projectId, companyId },
        select: { id: true, name: true },
      });
      projectFragnetNames.set(snap.projectId, new Map(fragnets.map((f) => [f.id, f.name])));
    }

    if (!projectLiveDeliverables.has(snap.projectId)) {
      const deliverables = await prisma.deliverable.findMany({
        where: { projectId: snap.projectId, companyId },
        select: {
          id: true,
          fragnetId: true,
          fragnet: { select: { name: true } },
        },
      });
      projectLiveDeliverables.set(
        snap.projectId,
        new Map(
          deliverables.map((d) => [
            d.id,
            { fragnetId: d.fragnetId, fragnetName: d.fragnet?.name ?? null },
          ])
        )
      );
    }
  }

  const deliverableSnapshots = await prisma.deliverableSnapshot.findMany({
    where: { snapshot: { companyId } },
    select: {
      id: true,
      deliverableId: true,
      snapshotId: true,
      name: true,
      classificationTags: true,
      plannedStart: true,
      plannedFinish: true,
      actualStart: true,
      actualFinish: true,
      totalFloat: true,
      fragnetId: true,
      parentWbs: true,
      wbsPath: true,
      stage: true,
      discipline: true,
      workPackageDurationDays: true,
      durationBasis: true,
      snapshot: {
        select: {
          projectId: true,
          programmeState: true,
          stage: true,
          disciplineTags: true,
          project: { include: { intelligenceProfile: true } },
        },
      },
    },
  });

  deliverableSnapshotsScanned = deliverableSnapshots.length;

  const snapshotIds = [...new Set(deliverableSnapshots.map((d) => d.snapshotId))];
  const activityRows = snapshotIds.length
    ? await prisma.activitySnapshot.findMany({
        where: { snapshotId: { in: snapshotIds } },
        select: {
          snapshotId: true,
          deliverableId: true,
          fragnetId: true,
          startDate: true,
          finishDate: true,
          earlyStart: true,
          earlyFinish: true,
          originalDuration: true,
          remainingDuration: true,
          actualDuration: true,
          percentComplete: true,
          status: true,
          totalFloat: true,
          classificationTags: true,
        },
      })
    : [];

  const activitiesBySnapshot = new Map<string, ActivityDateSource[]>();
  const fragnetActivitiesBySnapshot = new Map<
    string,
    Array<{
      deliverableId?: string | null;
      fragnetId?: string | null;
      classificationTags?: Record<string, unknown> | null;
    }>
  >();
  const workDurationsBySnapshotDeliverable = new Map<
    string,
    Array<{ originalDuration: number | null; remainingDuration: number | null; actualDuration: number | null }>
  >();

  for (const row of activityRows) {
    const dateBucket = activitiesBySnapshot.get(row.snapshotId) ?? [];
    dateBucket.push({
      deliverableId: row.deliverableId,
      startDate: row.startDate,
      finishDate: row.finishDate,
      earlyStart: row.earlyStart,
      earlyFinish: row.earlyFinish,
      actualDuration: row.actualDuration,
      percentComplete: row.percentComplete,
      status: row.status,
      totalFloatDays: row.totalFloat,
    });
    activitiesBySnapshot.set(row.snapshotId, dateBucket);

    const fragnetBucket = fragnetActivitiesBySnapshot.get(row.snapshotId) ?? [];
    fragnetBucket.push({
      deliverableId: row.deliverableId,
      fragnetId: row.fragnetId,
      classificationTags: row.classificationTags as Record<string, unknown>,
    });
    fragnetActivitiesBySnapshot.set(row.snapshotId, fragnetBucket);

    const workKey = `${row.snapshotId}\x1d${row.deliverableId ?? ""}`;
    const workBucket = workDurationsBySnapshotDeliverable.get(workKey) ?? [];
    workBucket.push({
      originalDuration: row.originalDuration,
      remainingDuration: row.remainingDuration,
      actualDuration: row.actualDuration,
    });
    workDurationsBySnapshotDeliverable.set(workKey, workBucket);
  }

  for (const del of deliverableSnapshots) {
    const profile = del.snapshot.project.intelligenceProfile;
    const programmeMetadata = buildProgrammeSnapshotMetadataFromProfile(profile);
    const programmeStage = del.snapshot.stage ?? programmeMetadata.stage;
    const liveDeliverable = del.deliverableId
      ? projectLiveDeliverables.get(del.snapshot.projectId)?.get(del.deliverableId)
      : undefined;
    const fragnetNamesById = projectFragnetNames.get(del.snapshot.projectId) ?? new Map<string, string>();

    if (del.deliverableId) {
      const context = buildDeliverableSnapshotContext({
        deliverableId: del.deliverableId,
        deliverableStage: del.stage,
        snapshotDiscipline: del.discipline,
        classificationTags: del.classificationTags as Record<string, unknown>,
        activities: fragnetActivitiesBySnapshot.get(del.snapshotId) ?? [],
        liveDeliverableFragnetId: liveDeliverable?.fragnetId ?? null,
        liveDeliverableFragnetName: liveDeliverable?.fragnetName ?? null,
        fragnetNamesById,
        programmeSnapshotStage: programmeStage,
        programmeDisciplineTags: del.snapshot.disciplineTags,
        projectProfileStage: profile?.stage ?? null,
        projectProfilePrimaryRibaStage: profile?.primaryRibaStage ?? null,
        programmeState: del.snapshot.programmeState,
      });

      const contextChanged =
        context.fragnetId !== del.fragnetId ||
        context.parentWbs !== del.parentWbs ||
        context.wbsPath !== del.wbsPath ||
        context.stage !== del.stage ||
        context.discipline !== del.discipline;

      if (contextChanged) {
        await prisma.deliverableSnapshot.update({
          where: { id: del.id },
          data: {
            fragnetId: context.fragnetId,
            parentWbs: context.parentWbs,
            wbsPath: context.wbsPath,
            stage: context.stage,
            discipline: context.discipline,
          },
        });
        deliverableSnapshotsContextUpdated += 1;
      }
    }

    if (!del.deliverableId) continue;

    const activities = activitiesBySnapshot.get(del.snapshotId) ?? [];
    const rolled = rollupDeliverableDatesFromActivities(del.deliverableId, activities);
    const plannedStart = del.plannedStart ?? rolled.plannedStart;
    const plannedFinish = del.plannedFinish ?? rolled.plannedFinish;
    const actualStart = del.actualStart ?? rolled.actualStart;
    const actualFinish = del.actualFinish ?? rolled.actualFinish;
    const totalFloat = del.totalFloat ?? (rolled.totalFloatDays != null ? Math.round(rolled.totalFloatDays) : null);

    const calendarSpanDays = diffDaysFromDates(
      actualStart ?? plannedStart ?? null,
      actualFinish ?? plannedFinish ?? null
    );
    const workPackage = resolveWorkPackageDuration(
      workDurationsBySnapshotDeliverable.get(`${del.snapshotId}\x1d${del.deliverableId}`) ?? [],
      calendarSpanDays
    );
    if (
      workPackage.durationDays !== del.workPackageDurationDays ||
      workPackage.basis !== del.durationBasis
    ) {
      await prisma.deliverableSnapshot.update({
        where: { id: del.id },
        data: {
          workPackageDurationDays: workPackage.durationDays,
          durationBasis: workPackage.basis,
        },
      });
      deliverableSnapshotsDurationUpdated += 1;
    }

    const datesChanged =
      plannedStart !== del.plannedStart ||
      plannedFinish !== del.plannedFinish ||
      actualStart !== del.actualStart ||
      actualFinish !== del.actualFinish ||
      totalFloat !== del.totalFloat;

    if (!datesChanged) continue;
    if (!plannedStart && !plannedFinish && !actualStart && !actualFinish) continue;

    await prisma.deliverableSnapshot.update({
      where: { id: del.id },
      data: {
        plannedStart,
        plannedFinish,
        actualStart,
        actualFinish,
        totalFloat,
      },
    });
    deliverableSnapshotsDatesUpdated += 1;
  }

  return {
    snapshotsProgrammeStateUpdated,
    snapshotsMetadataUpdated,
    deliverableSnapshotsDatesUpdated,
    deliverableSnapshotsContextUpdated,
    deliverableSnapshotsDurationUpdated,
    snapshotsScanned: snapshots.length,
    deliverableSnapshotsScanned,
  };
}
