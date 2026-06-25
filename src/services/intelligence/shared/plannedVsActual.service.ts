import { prisma } from "../../../utils/prisma.js";
import type {
  ActivityVariance,
  DeliverableVariance,
  PlannedVsActualReport,
  ProjectVarianceSummary,
} from "./types.js";

function daysBetween(a: Date | null | undefined, b: Date | null | undefined): number | null {
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function relKey(p: string, s: string, t: string, lag: number) {
  return `${p.toUpperCase()}\x1d${s.toUpperCase()}\x1d${t}\x1d${lag}`;
}

export async function compareSnapshots(
  baselineSnapshotId: string,
  comparisonSnapshotId: string,
  companyId: string
): Promise<PlannedVsActualReport> {
  const [baseline, comparison] = await Promise.all([
    prisma.programmeSnapshot.findFirst({
      where: { id: baselineSnapshotId, companyId },
      include: { activitySnapshots: true, deliverableSnapshots: true, relationshipSnapshots: true },
    }),
    prisma.programmeSnapshot.findFirst({
      where: { id: comparisonSnapshotId, companyId },
      include: { activitySnapshots: true, deliverableSnapshots: true, relationshipSnapshots: true },
    }),
  ]);

  if (!baseline || !comparison) {
    throw new Error("One or both snapshots not found");
  }
  if (baseline.projectId !== comparison.projectId) {
    throw new Error("Snapshots must belong to the same project");
  }

  const baselineByCode = new Map(
    baseline.activitySnapshots.map((a) => [a.activityCode.toUpperCase(), a])
  );
  const comparisonByCode = new Map(
    comparison.activitySnapshots.map((a) => [a.activityCode.toUpperCase(), a])
  );

  const baselineRels = new Set(
    baseline.relationshipSnapshots.map((r) =>
      relKey(r.predecessorActivityCode, r.successorActivityCode, r.relationshipType, r.lag)
    )
  );
  const comparisonRels = new Set(
    comparison.relationshipSnapshots.map((r) =>
      relKey(r.predecessorActivityCode, r.successorActivityCode, r.relationshipType, r.lag)
    )
  );

  const activityVariances: ActivityVariance[] = [];
  let durationVarianceCount = 0;
  let floatErosionCount = 0;
  let criticalInstability = 0;
  let approvalBottlenecks = 0;
  let disciplineDelays = 0;
  const highRiskAreas = new Set<string>();

  for (const [code, base] of baselineByCode) {
    const comp = comparisonByCode.get(code);
    if (!comp) continue;

    const baseDur = base.originalDuration ?? base.remainingDuration;
    const compDur = comp.actualDuration ?? comp.remainingDuration ?? comp.originalDuration;
    const durationVariance =
      baseDur != null && compDur != null ? compDur - baseDur : null;
    if (durationVariance != null && durationVariance > 0) durationVarianceCount++;

    const startVariance = daysBetween(base.startDate ?? base.earlyStart, comp.startDate ?? comp.earlyStart);
    const finishVariance = daysBetween(base.finishDate ?? base.earlyFinish, comp.finishDate ?? comp.earlyFinish);

    const baseFloat = base.totalFloat;
    const compFloat = comp.totalFloat;
    const floatErosion =
      baseFloat != null && compFloat != null ? baseFloat - compFloat : null;
    if (floatErosion != null && floatErosion > 0) floatErosionCount++;

    const logicVariance = [...comparisonRels].some((k) => !baselineRels.has(k)) ||
      [...baselineRels].some((k) => !comparisonRels.has(k));

    const becameCritical = !base.isCritical && comp.isCritical;
    if (becameCritical) criticalInstability++;

    const tags = comp.classificationTags as Record<string, string>;
    const tagStr = JSON.stringify(tags).toLowerCase();
    if (tagStr.includes("approval") && (durationVariance ?? 0) > 0) approvalBottlenecks++;
    if (tagStr.includes("mep") || tagStr.includes("coordination")) {
      if ((durationVariance ?? 0) > 0) disciplineDelays++;
    }
    if ((durationVariance ?? 0) > 5 || (finishVariance ?? 0) > 5) {
      highRiskAreas.add(tags.discipline ?? tags.ribaStage ?? "schedule");
    }

    activityVariances.push({
      activityCode: base.activityCode,
      activityId: comp.activityId,
      name: comp.name ?? base.name,
      durationVarianceDays: durationVariance,
      startVarianceDays: startVariance,
      finishVarianceDays: finishVariance,
      floatErosionDays: floatErosion,
      logicVariance,
      baselineDurationDays: baseDur,
      comparisonDurationDays: compDur,
      baselineFloatDays: baseFloat,
      comparisonFloatDays: compFloat,
      becameCritical,
    });
  }

  const deliverableVariances: DeliverableVariance[] = [];
  const baseDelById = new Map(
    baseline.deliverableSnapshots.filter((d) => d.deliverableId).map((d) => [d.deliverableId!, d])
  );

  for (const compDel of comparison.deliverableSnapshots) {
    const baseDel = compDel.deliverableId ? baseDelById.get(compDel.deliverableId) : undefined;
    const finishVariance = daysBetween(
      baseDel?.plannedFinish ?? baseDel?.actualFinish,
      compDel.actualFinish ?? compDel.plannedFinish
    );
    const delayed = (finishVariance ?? 0) > 0;

    const bottleneckActivityCodes = activityVariances
      .filter((v) => (v.finishVarianceDays ?? 0) > 0 && v.durationVarianceDays != null && v.durationVarianceDays > 0)
      .slice(0, 5)
      .map((v) => v.activityCode);

    deliverableVariances.push({
      deliverableId: compDel.deliverableId,
      name: compDel.name,
      finishVarianceDays: finishVariance,
      delayed,
      bottleneckActivityCodes,
    });
  }

  const projectSummary: ProjectVarianceSummary = {
    criticalPathInstability: criticalInstability,
    approvalBottleneckCount: approvalBottlenecks,
    disciplineDelayCount: disciplineDelays,
    highRiskAreas: [...highRiskAreas],
    totalActivitiesCompared: activityVariances.length,
    activitiesWithDurationVariance: durationVarianceCount,
    activitiesWithFloatErosion: floatErosionCount,
  };

  return {
    baselineSnapshotId,
    comparisonSnapshotId,
    generatedAt: new Date().toISOString(),
    activityVariances: activityVariances.sort(
      (a, b) => (b.durationVarianceDays ?? 0) - (a.durationVarianceDays ?? 0)
    ),
    deliverableVariances,
    projectSummary,
  };
}

/** Compare baseline snapshot to current live programme without persisting a new snapshot. */
export async function compareBaselineToLive(
  baselineSnapshotId: string,
  projectId: string,
  companyId: string
): Promise<PlannedVsActualReport> {
  const baseline = await prisma.programmeSnapshot.findFirst({
    where: { id: baselineSnapshotId, companyId, projectId },
    include: { activitySnapshots: true, deliverableSnapshots: true, relationshipSnapshots: true },
  });
  if (!baseline) throw new Error("Baseline snapshot not found");

  const liveActivities = await prisma.activity.findMany({
    where: { projectId, companyId },
    select: {
      id: true,
      activityCode: true,
      name: true,
      likelyDuration: true,
      plannedStartDate: true,
      plannedFinishDate: true,
      earlyStart: true,
      earlyFinish: true,
      totalFloat: true,
      isCritical: true,
      status: true,
    },
  });

  const virtualComparisonId = "live";
  const comparisonRows = liveActivities.map((a) => ({
    activityCode: a.activityCode,
    activityId: a.id,
    name: a.name,
    originalDuration: a.likelyDuration,
    remainingDuration: a.likelyDuration,
    actualDuration: null as number | null,
    startDate: a.plannedStartDate ?? a.earlyStart,
    finishDate: a.plannedFinishDate ?? a.earlyFinish,
    earlyStart: a.earlyStart,
    earlyFinish: a.earlyFinish,
    lateStart: null as Date | null,
    lateFinish: null as Date | null,
    totalFloat: a.totalFloat,
    freeFloat: null as number | null,
    isCritical: a.isCritical,
    status: a.status,
    classificationTags: {},
  }));

  const baselineByCode = new Map(
    baseline.activitySnapshots.map((a) => [a.activityCode.toUpperCase(), a])
  );

  const activityVariances: ActivityVariance[] = [];
  let durationVarianceCount = 0;
  let floatErosionCount = 0;
  let criticalInstability = 0;

  for (const comp of comparisonRows) {
    const base = baselineByCode.get(comp.activityCode.toUpperCase());
    if (!base) continue;

    const baseDur = base.originalDuration ?? base.remainingDuration;
    const compDur = comp.remainingDuration ?? comp.originalDuration;
    const durationVariance =
      baseDur != null && compDur != null ? compDur - baseDur : null;
    if (durationVariance != null && durationVariance > 0) durationVarianceCount++;

    const startVariance = daysBetween(base.startDate ?? base.earlyStart, comp.startDate ?? comp.earlyStart);
    const finishVariance = daysBetween(base.finishDate ?? base.earlyFinish, comp.finishDate ?? comp.earlyFinish);

    const floatErosion =
      base.totalFloat != null && comp.totalFloat != null ? base.totalFloat - comp.totalFloat : null;
    if (floatErosion != null && floatErosion > 0) floatErosionCount++;

    const becameCritical = !base.isCritical && comp.isCritical;
    if (becameCritical) criticalInstability++;

    activityVariances.push({
      activityCode: comp.activityCode,
      activityId: comp.activityId,
      name: comp.name,
      durationVarianceDays: durationVariance,
      startVarianceDays: startVariance,
      finishVarianceDays: finishVariance,
      floatErosionDays: floatErosion,
      logicVariance: false,
      baselineDurationDays: baseDur,
      comparisonDurationDays: compDur,
      baselineFloatDays: base.totalFloat,
      comparisonFloatDays: comp.totalFloat,
      becameCritical,
    });
  }

  return {
    baselineSnapshotId,
    comparisonSnapshotId: virtualComparisonId,
    generatedAt: new Date().toISOString(),
    activityVariances,
    deliverableVariances: [],
    projectSummary: {
      criticalPathInstability: criticalInstability,
      approvalBottleneckCount: 0,
      disciplineDelayCount: 0,
      highRiskAreas: [],
      totalActivitiesCompared: activityVariances.length,
      activitiesWithDurationVariance: durationVarianceCount,
      activitiesWithFloatErosion: floatErosionCount,
    },
  };
}
