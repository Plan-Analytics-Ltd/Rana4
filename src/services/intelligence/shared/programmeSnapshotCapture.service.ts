import type { ProgrammeSnapshotRole, ProgrammeSnapshotSourceType } from "@prisma/client";
import { prisma } from "../../../utils/prisma.js";
import type {
  ImportedActivityRow,
  ImportedDeliverableRow,
  ImportedRelationshipRow,
  ProgrammeImportMatchResult,
  SnapshotSummary,
} from "./types.js";
import { enrichDeliverableRowsFromActivities } from "./deliverableSnapshotEnrichment.service.js";
import { resolveDeliverableClassification } from "../profiles/deliverableClassification.service.js";
import { resolveProgrammeState } from "./programmeState.service.js";
import {
  buildDeliverableSnapshotContext,
  buildProgrammeSnapshotMetadataFromProfile,
} from "./deliverableSnapshotContext.service.js";
import { resolveWorkPackageDuration } from "./historicalDuration.service.js";
import { diffDaysFromDates } from "./intelligenceMath.js";

function snapshotSummaryFromRow(s: {
  id: string;
  projectId: string;
  importedAt: Date;
  sourceType: ProgrammeSnapshotSourceType;
  snapshotRole: ProgrammeSnapshotRole | null;
  scheduleDate: Date | null;
  label: string | null;
  snapshotVersion: number;
  metrics: unknown;
  importSummary: unknown;
  _count: { activitySnapshots: number; deliverableSnapshots: number };
}): SnapshotSummary {
  const importSummary = (s.importSummary ?? {}) as Record<string, unknown>;
  const programmeDisplayName = String(importSummary.programmeDisplayName ?? "").trim() || null;
  return {
    id: s.id,
    projectId: s.projectId,
    importedAt: s.importedAt.toISOString(),
    sourceType: s.sourceType,
    snapshotRole: s.snapshotRole,
    scheduleDate: s.scheduleDate?.toISOString().slice(0, 10) ?? null,
    label: s.label,
    programmeDisplayName,
    snapshotVersion: s.snapshotVersion,
    metrics: s.metrics as Record<string, unknown>,
    importSummary,
    activityCount: s._count.activitySnapshots,
    deliverableCount: s._count.deliverableSnapshots,
  };
}

export async function getNextSnapshotVersion(projectId: string, companyId: string): Promise<number> {
  const last = await prisma.programmeSnapshot.findFirst({
    where: { projectId, companyId },
    orderBy: { snapshotVersion: "desc" },
    select: { snapshotVersion: true },
  });
  return (last?.snapshotVersion ?? 0) + 1;
}

export async function captureProgrammeSnapshot(args: {
  projectId: string;
  companyId: string;
  userId?: string;
  sourceType: ProgrammeSnapshotSourceType;
  snapshotRole?: ProgrammeSnapshotRole;
  scheduleDate?: Date;
  label?: string;
  sourceFileName?: string;
  metrics?: Record<string, unknown>;
  importSummary?: Record<string, unknown>;
  activities: Array<ImportedActivityRow & {
    activityId?: string;
    deliverableId?: string;
    fragnetId?: string;
  }>;
  deliverables: Array<ImportedDeliverableRow & { deliverableId?: string }>;
  relationships: ImportedRelationshipRow[];
  matchResult: ProgrammeImportMatchResult;
}): Promise<{ snapshotId: string; summary: SnapshotSummary }> {
  const version = await getNextSnapshotVersion(args.projectId, args.companyId);
  const importSummary = {
    ...args.importSummary,
    match: args.matchResult,
  };

  const enrichedDeliverables = enrichDeliverableRowsFromActivities(args.deliverables, args.activities);

  const [profile, liveDeliverables, fragnets] = await Promise.all([
    prisma.projectIntelligenceProfile.findUnique({
      where: { projectId: args.projectId },
    }),
    prisma.deliverable.findMany({
      where: { projectId: args.projectId, companyId: args.companyId },
      select: {
        id: true,
        fragnetId: true,
        fragnet: { select: { name: true } },
      },
    }),
    prisma.fragnet.findMany({
      where: { projectId: args.projectId, companyId: args.companyId },
      select: { id: true, name: true },
    }),
  ]);

  const liveDeliverableById = new Map(liveDeliverables.map((d) => [d.id, d]));
  const fragnetNamesById = new Map(fragnets.map((f) => [f.id, f.name]));
  const programmeMetadata = buildProgrammeSnapshotMetadataFromProfile(profile);

  const programmeState = resolveProgrammeState({
    snapshotRole: args.snapshotRole,
    sourceType: args.sourceType,
  });

  const deliverableCreates = await Promise.all(
    enrichedDeliverables.map(async (d) => {
      const classification = await resolveDeliverableClassification({
        companyId: args.companyId,
        deliverableId: d.deliverableId ?? null,
        deliverableName: d.name,
      });

      const linkedActivities = d.deliverableId
        ? args.activities.filter((a) => a.deliverableId === d.deliverableId)
        : [];
      const calendarSpanDays = diffDaysFromDates(
        (d.actualStart ?? d.plannedStart) ?? null,
        (d.actualFinish ?? d.plannedFinish) ?? null
      );
      const workPackage = resolveWorkPackageDuration(
        linkedActivities.map((a) => ({
          originalDuration: a.originalDurationDays ?? null,
          remainingDuration: a.remainingDurationDays ?? null,
          actualDuration: a.actualDurationDays ?? null,
        })),
        calendarSpanDays
      );

      const liveDeliverable = d.deliverableId ? liveDeliverableById.get(d.deliverableId) : undefined;
      const context = d.deliverableId
        ? buildDeliverableSnapshotContext({
            deliverableId: d.deliverableId,
            classificationTags: (d.classificationTags ?? {}) as Record<string, unknown>,
            activities: args.activities.map((a) => ({
              deliverableId: a.deliverableId ?? null,
              fragnetId: a.fragnetId ?? null,
              classificationTags: (a.classificationTags ?? {}) as Record<string, unknown>,
            })),
            liveDeliverableFragnetId: liveDeliverable?.fragnetId ?? null,
            liveDeliverableFragnetName: liveDeliverable?.fragnet?.name ?? null,
            fragnetNamesById,
            programmeSnapshotStage: programmeMetadata.stage,
            programmeDisciplineTags: programmeMetadata.disciplineTags,
            projectProfileStage: profile?.stage ?? null,
            projectProfilePrimaryRibaStage: profile?.primaryRibaStage ?? null,
            programmeState,
          })
        : {
            fragnetId: null,
            parentWbs: null,
            wbsPath: null,
            stage: programmeMetadata.stage,
            discipline: null,
          };

      return {
        deliverableId: d.deliverableId ?? null,
        name: d.name,
        classification,
        plannedStart: d.plannedStart ?? null,
        plannedFinish: d.plannedFinish ?? null,
        actualStart: d.actualStart ?? null,
        actualFinish: d.actualFinish ?? null,
        totalFloat: d.totalFloatDays != null ? Math.round(d.totalFloatDays) : null,
        status: d.status ?? null,
        classificationTags: (d.classificationTags ?? {}) as object,
        fragnetId: context.fragnetId,
        parentWbs: context.parentWbs,
        wbsPath: context.wbsPath,
        stage: context.stage,
        discipline: context.discipline,
        workPackageDurationDays: workPackage.durationDays,
        durationBasis: workPackage.basis,
      };
    })
  );

  const snapshot = await prisma.programmeSnapshot.create({
    data: {
      projectId: args.projectId,
      companyId: args.companyId,
      sourceType: args.sourceType,
      snapshotRole: args.snapshotRole ?? null,
      programmeState,
      scheduleDate: args.scheduleDate ?? null,
      createdByUserId: args.userId ?? null,
      snapshotVersion: version,
      label: args.label ?? null,
      sourceFileName: args.sourceFileName ?? null,
      sector: programmeMetadata.sector,
      projectType: programmeMetadata.projectType,
      procurementRoute: programmeMetadata.procurementRoute,
      stage: programmeMetadata.stage,
      region: programmeMetadata.region,
      clientType: programmeMetadata.clientType,
      complexity: programmeMetadata.complexity,
      disciplineTags: programmeMetadata.disciplineTags,
      projectTags: programmeMetadata.projectTags,
      classificationTagsList: programmeMetadata.classificationTagsList,
      metrics: (args.metrics ?? {}) as object,
      importSummary: importSummary as object,
      activitySnapshots: {
        create: args.activities.map((a) => ({
          activityId: a.activityId ?? null,
          activityCode: a.activityCode,
          deliverableId: a.deliverableId ?? null,
          fragnetId: a.fragnetId ?? null,
          name: a.name ?? null,
          originalDuration: a.originalDurationDays != null ? Math.round(a.originalDurationDays) : null,
          remainingDuration: a.remainingDurationDays != null ? Math.round(a.remainingDurationDays) : null,
          actualDuration: a.actualDurationDays != null ? Math.round(a.actualDurationDays) : null,
          percentComplete: a.percentComplete ?? null,
          startDate: a.startDate ?? null,
          finishDate: a.finishDate ?? null,
          earlyStart: a.earlyStart ?? null,
          earlyFinish: a.earlyFinish ?? null,
          lateStart: a.lateStart ?? null,
          lateFinish: a.lateFinish ?? null,
          totalFloat: a.totalFloatDays != null ? Math.round(a.totalFloatDays) : null,
          freeFloat: a.freeFloatDays != null ? Math.round(a.freeFloatDays) : null,
          isCritical: a.isCritical ?? false,
          status: a.status ?? null,
          classificationTags: (a.classificationTags ?? {}) as object,
        })),
      },
      deliverableSnapshots: {
        create: deliverableCreates,
      },
      relationshipSnapshots: {
        create: args.relationships.map((r) => ({
          predecessorActivityCode: r.predecessorActivityCode,
          successorActivityCode: r.successorActivityCode,
          relationshipType: r.relationshipType,
          lag: r.lag,
          matchedRelationshipId: r.matchedRelationshipId ?? null,
        })),
      },
    },
    include: {
      _count: { select: { activitySnapshots: true, deliverableSnapshots: true } },
    },
  });

  return {
    snapshotId: snapshot.id,
    summary: snapshotSummaryFromRow(snapshot),
  };
}

export async function listProjectSnapshots(
  projectId: string,
  companyId: string,
  limit = 50
): Promise<SnapshotSummary[]> {
  const rows = await prisma.programmeSnapshot.findMany({
    where: { projectId, companyId },
    orderBy: { importedAt: "desc" },
    take: limit,
    include: { _count: { select: { activitySnapshots: true, deliverableSnapshots: true } } },
  });
  return rows.map((s) => snapshotSummaryFromRow(s));
}

/** Capture live programme state as baseline without file import. */
export async function captureLiveBaselineSnapshot(
  projectId: string,
  companyId: string,
  userId?: string,
  label = "Generated baseline"
): Promise<{ snapshotId: string; summary: SnapshotSummary }> {
  const activities = await prisma.activity.findMany({
    where: { projectId, companyId },
    select: {
      id: true,
      activityCode: true,
      name: true,
      deliverableId: true,
      fragnetId: true,
      likelyDuration: true,
      plannedStartDate: true,
      plannedFinishDate: true,
      earlyStart: true,
      earlyFinish: true,
      lateStart: true,
      lateFinish: true,
      totalFloat: true,
      freeFloat: true,
      isCritical: true,
      status: true,
    },
  });

  const deliverables = await prisma.deliverable.findMany({
    where: { projectId, companyId },
    select: { id: true, name: true },
  });

  const relationships = await prisma.relationship.findMany({
    where: { projectId, companyId },
    include: {
      predecessorActivity: { select: { activityCode: true } },
      successorActivity: { select: { activityCode: true } },
    },
  });

  const liveRels = relationships.map((r) => ({
    predecessorActivityCode: r.predecessorActivity.activityCode,
    successorActivityCode: r.successorActivity.activityCode,
    relationshipType: r.relationshipType,
    lag: r.lag,
    matchedRelationshipId: r.id,
  }));

  const importedActivities = activities.map((a) => ({
    activityCode: a.activityCode,
    activityId: a.id,
    deliverableId: a.deliverableId,
    fragnetId: a.fragnetId,
    name: a.name,
    originalDurationDays: a.likelyDuration,
    remainingDurationDays: a.likelyDuration,
    startDate: a.plannedStartDate ?? a.earlyStart ?? undefined,
    finishDate: a.plannedFinishDate ?? a.earlyFinish ?? undefined,
    earlyStart: a.earlyStart ?? undefined,
    earlyFinish: a.earlyFinish ?? undefined,
    lateStart: a.lateStart ?? undefined,
    lateFinish: a.lateFinish ?? undefined,
    totalFloatDays: a.totalFloat ?? undefined,
    freeFloatDays: a.freeFloat ?? undefined,
    isCritical: a.isCritical,
    status: a.status,
  }));

  return captureProgrammeSnapshot({
    projectId,
    companyId,
    userId,
    sourceType: "BASELINE_GENERATED",
    snapshotRole: "BASELINE",
    label,
    activities: importedActivities,
    deliverables: deliverables.map((d) => ({ name: d.name, deliverableId: d.id })),
    relationships: liveRels,
    matchResult: {
      matchedActivities: activities.length,
      unmatchedActivityCodes: [],
      matchedDeliverables: deliverables.length,
      unmatchedDeliverableNames: [],
      matchedRelationships: relationships.length,
      unmatchedRelationships: 0,
    },
    metrics: {
      activityCount: activities.length,
      criticalCount: activities.filter((a) => a.isCritical).length,
    },
  });
}
