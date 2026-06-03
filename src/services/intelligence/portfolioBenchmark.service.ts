import { prisma } from "../../utils/prisma.js";

export type BenchmarkMetric = {
  key: string;
  label: string;
  sampleSize: number;
  average: number;
  median: number;
  min: number;
  max: number;
  unit: string;
};

export type PortfolioBenchmarkReport = {
  generatedAt: string;
  companyId: string;
  filters: Record<string, string | undefined>;
  metrics: BenchmarkMetric[];
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function aggregate(values: number[], key: string, label: string, unit: string): BenchmarkMetric | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    key,
    label,
    sampleSize: values.length,
    average: Math.round((sum / values.length) * 100) / 100,
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
    unit,
  };
}

/**
 * Aggregate historical metrics across company snapshots for portfolio benchmarking.
 */
export async function computePortfolioBenchmarks(
  companyId: string,
  filters?: { projectType?: string; ribaStage?: string }
): Promise<PortfolioBenchmarkReport> {
  const profiles = await prisma.projectIntelligenceProfile.findMany({
    where: {
      companyId,
      ...(filters?.projectType ? { projectType: filters.projectType } : {}),
      ...(filters?.ribaStage ? { primaryRibaStage: filters.ribaStage } : {}),
    },
    select: { projectId: true },
  });
  const projectIds = profiles.map((p) => p.projectId);
  if (projectIds.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      companyId,
      filters: filters ?? {},
      metrics: [],
    };
  }

  const snapshots = await prisma.programmeSnapshot.findMany({
    where: { companyId, projectId: { in: projectIds } },
    include: { activitySnapshots: true },
    orderBy: { importedAt: "desc" },
  });

  const durationsByDeliverableType = new Map<string, number[]>();
  const approvalDurations: number[] = [];
  const floatConsumption: number[] = [];
  const delayCategories = new Map<string, number>();

  for (const snap of snapshots) {
    for (const act of snap.activitySnapshots) {
      const dur = act.actualDuration ?? act.remainingDuration ?? act.originalDuration;
      if (dur != null && dur > 0) {
        const tags = act.classificationTags as Record<string, string>;
        const delType = tags.deliverableType ?? tags.deliverable ?? "unknown";
        const arr = durationsByDeliverableType.get(delType) ?? [];
        arr.push(dur);
        durationsByDeliverableType.set(delType, arr);

        const tagStr = JSON.stringify(tags).toLowerCase();
        if (tagStr.includes("approval") && dur > 0) approvalDurations.push(dur);

        if (act.totalFloat != null && act.totalFloat < 5) floatConsumption.push(act.totalFloat);

        if ((act.actualDuration ?? 0) > (act.originalDuration ?? 0)) {
          const cat = tags.discipline ?? tags.ribaStage ?? "general";
          delayCategories.set(cat, (delayCategories.get(cat) ?? 0) + 1);
        }
      }
    }
  }

  const metrics: BenchmarkMetric[] = [];

  for (const [type, values] of durationsByDeliverableType) {
    const m = aggregate(values, `duration_${type}`, `Average duration: ${type}`, "days");
    if (m) metrics.push(m);
  }

  const approval = aggregate(approvalDurations, "approval_duration", "Average approval-related duration", "days");
  if (approval) metrics.push(approval);

  const float = aggregate(floatConsumption, "float_consumption", "Activities with low float at snapshot", "days");
  if (float) metrics.push(float);

  for (const [cat, count] of delayCategories) {
    metrics.push({
      key: `delay_category_${cat}`,
      label: `Delay occurrences: ${cat}`,
      sampleSize: count,
      average: count,
      median: count,
      min: count,
      max: count,
      unit: "count",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    companyId,
    filters: filters ?? {},
    metrics,
  };
}
