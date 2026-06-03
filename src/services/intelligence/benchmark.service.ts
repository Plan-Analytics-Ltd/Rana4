import type { ProgrammeState } from "@prisma/client";
import { prisma } from "../../utils/prisma.js";
import { computeProjectSimilarityScore, getSimilarDeliverables, getSimilarProjects } from "./similarity.service.js";
import { computeOutlier } from "./outlier.service.js";
import type { OutlierStatus } from "./outlier.service.js";

const ALLOWED_SNAPSHOT_STATES: ProgrammeState[] = ["APPROVED_BASELINE", "AS_BUILT", "FINAL_AS_BUILT"];
const MIN_AUTO_PROJECT_SIMILARITY = 50;
const MIN_DELIVERABLE_SIMILARITY = 30;

function msPerDay() {
  return 24 * 60 * 60 * 1000;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function diffDays(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const start = new Date(a);
  const finish = new Date(b);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(finish.getTime())) return null;
  const d = (finish.getTime() - start.getTime()) / msPerDay();
  if (!Number.isFinite(d)) return null;
  return Math.max(0, Math.round(d));
}

function median(sorted: number[]): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const pp = Math.max(0, Math.min(1, p));
  const idx = (sorted.length - 1) * pp;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

function stddev(values: number[], avg: number): number | null {
  if (values.length < 2) return null;
  const v = values.reduce((acc, x) => acc + (x - avg) * (x - avg), 0) / (values.length - 1);
  return Math.sqrt(v);
}

type BenchmarkConfidenceTier = "NONE" | "LOW" | "MEDIUM" | "HIGH";

function confidenceTierFromSampleSize(sampleSize: number): BenchmarkConfidenceTier {
  if (sampleSize <= 0) return "NONE";
  if (sampleSize <= 4) return "LOW";
  if (sampleSize <= 9) return "MEDIUM";
  return "HIGH";
}

function confidenceLevelFromScore(score: number): "LOW" | "MEDIUM" | "HIGH" {
  const s = clamp01(score);
  if (s <= 0.39) return "LOW";
  if (s <= 0.69) return "MEDIUM";
  return "HIGH";
}

function capOutlierStatusForSampleSize(sampleSize: number, raw: OutlierStatus): OutlierStatus {
  // Sample Size Behaviour rules:
  // 0 => NONE: no benchmark available
  // 1–2 => LOW: statistics only, no red flag generation
  // 3–4 => LOW: red flag allowed but capped at WATCH (mapped to SLIGHTLY_HIGH)
  // 5–9 => MEDIUM: normal benchmark behaviour
  // 10+ => HIGH: full benchmark behaviour
  if (sampleSize <= 2) return "NORMAL";
  if (sampleSize <= 4) {
    if (raw === "RED_FLAG" || raw === "EXTREME_OUTLIER") return "SLIGHTLY_HIGH";
    return raw;
  }
  return raw;
}

async function getCurrentDeliverableDurationDays(projectId: string, companyId: string, deliverableId: string) {
  /**
   * Duration definition (CURRENT project):
   * We estimate deliverable duration as a date-span across linked activities (not deliverable best/likely durations).
   * - Start = earliest(plannedStartDate else earlyStart)
   * - Finish = latest(plannedFinishDate else earlyFinish)
   */
  const activities = await prisma.activity.findMany({
    where: {
      projectId,
      companyId,
      OR: [
        { deliverableId },
        { deliverableLinks: { some: { deliverableId, companyId } } },
      ],
    },
    select: {
      plannedStartDate: true,
      plannedFinishDate: true,
      earlyStart: true,
      earlyFinish: true,
    },
  });

  let minStart: Date | null = null;
  let maxFinish: Date | null = null;

  for (const a of activities) {
    const s = a.plannedStartDate ?? a.earlyStart ?? null;
    const f = a.plannedFinishDate ?? a.earlyFinish ?? null;
    if (s && (!minStart || s.getTime() < minStart.getTime())) minStart = s;
    if (f && (!maxFinish || f.getTime() > maxFinish.getTime())) maxFinish = f;
  }

  if (!minStart || !maxFinish) return null;
  const days = Math.max(0, Math.round((maxFinish.getTime() - minStart.getTime()) / msPerDay()));
  return days;
}

function getDurationStrategyMetadata() {
  const historicalDurationDefinition =
    "Historical durationDays computed from DeliverableSnapshot dates: (actualFinish-actualStart) else (plannedFinish-plannedStart). Rounded to whole days; negative durations clamped to 0.";
  const currentDurationDefinition =
    "Current durationDays computed from live Activity dates linked to the deliverable: earliest(plannedStartDate else earlyStart) to latest(plannedFinishDate else earlyFinish), rounded to whole days.";
  const durationComparisonType = "ACTIVITY_SPAN";
  return { historicalDurationDefinition, currentDurationDefinition, durationComparisonType };
}

export async function getDeliverableBenchmark(args: {
  projectId: string;
  companyId: string;
  deliverableId: string;
  selectedProjectIds?: string[];
}) {
  const deliverable = await prisma.deliverable.findFirst({
    where: { id: args.deliverableId, projectId: args.projectId, companyId: args.companyId },
    select: { id: true, name: true, classification: true },
  });
  if (!deliverable) {
    const err: any = new Error("Deliverable not found");
    err.status = 404;
    throw err;
  }

  const selectedProjectIds =
    args.selectedProjectIds?.map((s) => String(s).trim()).filter(Boolean) ?? [];

  let comparableProjectIds: string[] = [];
  let matchedProjects: Array<{
    projectId: string;
    projectName: string;
    similarityScore: number;
    manuallySelected: boolean;
    warning?: string;
  }> = [];
  let projectSimilarityRejected = 0;
  let projectSimilarityIncluded = 0;

  if (selectedProjectIds.length > 0) {
    const projects = await prisma.project.findMany({
      where: { companyId: args.companyId, id: { in: selectedProjectIds }, archivedAt: null },
      select: { id: true, name: true },
    });
    comparableProjectIds = projects.map((p) => p.id);
    matchedProjects = await Promise.all(
      projects.map(async (p) => {
        const similarityScore = await computeProjectSimilarityScore({
          companyId: args.companyId,
          aProjectId: args.projectId,
          bProjectId: p.id,
        });
        const warning =
          similarityScore < MIN_AUTO_PROJECT_SIMILARITY
            ? "Project included by manual selection despite low similarity."
            : undefined;
        return {
          projectId: p.id,
          projectName: p.name,
          similarityScore,
          manuallySelected: true,
          ...(warning ? { warning } : {}),
        };
      })
    );
    projectSimilarityIncluded = matchedProjects.length;
  } else {
    const sim = await getSimilarProjects({ projectId: args.projectId, companyId: args.companyId, limit: 20 });
    const eligible = sim.matches.filter((m) => m.similarityScore >= MIN_AUTO_PROJECT_SIMILARITY);
    projectSimilarityRejected = sim.matches.length - eligible.length;
    matchedProjects = eligible.map((m) => ({
      projectId: m.projectId,
      projectName: m.projectName,
      similarityScore: m.similarityScore,
      manuallySelected: false,
    }));
    projectSimilarityIncluded = matchedProjects.length;
    comparableProjectIds = matchedProjects.map((m) => m.projectId);
  }

  // Used only to report aggregated "unsupportedProgrammeState" exclusions.
  const totalSnapshotCandidatesAcrossStates = await prisma.deliverableSnapshot.count({
    where: {
      snapshot: {
        companyId: args.companyId,
        projectId: comparableProjectIds.length > 0 ? { in: comparableProjectIds } : { not: args.projectId },
        project: { archivedAt: null },
      },
    },
  });

  const simDeliverables = await getSimilarDeliverables({
    projectId: args.projectId,
    companyId: args.companyId,
    deliverableId: args.deliverableId,
    limit: 200,
    selectedProjectIds: comparableProjectIds.length > 0 ? comparableProjectIds : undefined,
    allowedProgrammeStates: ALLOWED_SNAPSHOT_STATES,
  });

  const excludedEvidence = {
    projectSimilarity: projectSimilarityRejected,
    classificationMismatch: 0,
    missingDates: 0,
    unsupportedProgrammeState: 0,
    lowDeliverableSimilarity: 0,
  };

  const baseClassification = deliverable.classification ?? null;
  const candidateAfterProgrammeState = simDeliverables.matches.length;
  let candidateBothHaveClassification = 0;
  let candidateClassificationMatches = 0;

  const candidates = simDeliverables.matches
    .map((m) => {
      const e = m.evidence;
      return {
        ...m,
        programmeState: e?.programmeState ?? null,
        projectId: e?.projectId ?? "",
        projectName: e?.projectName ?? "Unknown project",
        plannedStart: e?.plannedStart ?? null,
        plannedFinish: e?.plannedFinish ?? null,
        actualStart: e?.actualStart ?? null,
        actualFinish: e?.actualFinish ?? null,
      };
    })
    .filter((m) => {
      if (m.similarityScore < MIN_DELIVERABLE_SIMILARITY) {
        excludedEvidence.lowDeliverableSimilarity += 1;
        return false;
      }
      return true;
    });

  const gatedByClassification = candidates.filter((m) => {
    const histClass = (m.classification ?? null) as string | null;
    if (baseClassification && histClass) {
      candidateBothHaveClassification += 1;
      if (String(baseClassification) === String(histClass)) {
        candidateClassificationMatches += 1;
        return true;
      }
      excludedEvidence.classificationMismatch += 1;
      return false;
    }
    return true;
  });

  const candidateSamples = gatedByClassification.length;

  const samples = gatedByClassification
    .map((m) => {
      // Duration definition (HISTORICAL samples):
      // durationDays = actualFinish - actualStart else plannedFinish - plannedStart
      const durationActual = diffDays(m.actualStart, m.actualFinish);
      const durationPlanned = diffDays(m.plannedStart, m.plannedFinish);
      const durationDays = durationActual ?? durationPlanned;
      if (durationDays == null || !Number.isFinite(durationDays) || durationDays < 0) {
        excludedEvidence.missingDates += 1;
        return null;
      }
      return { ...m, durationDays };
    })
    .filter((m): m is NonNullable<typeof m> => !!m);

  excludedEvidence.unsupportedProgrammeState = Math.max(
    0,
    totalSnapshotCandidatesAcrossStates - candidateAfterProgrammeState
  );

  const durations = samples.map((s) => s.durationDays as number).sort((a, b) => a - b);
  const sampleSize = durations.length;
  const avg = sampleSize > 0 ? durations.reduce((a, b) => a + b, 0) / sampleSize : null;
  const med = median(durations);
  const p75 = percentile(durations, 0.75);
  const sd = avg != null ? stddev(durations, avg) : null;

  const benchmark = {
    sampleSize,
    minimumDuration: sampleSize > 0 ? durations[0]! : null,
    maximumDuration: sampleSize > 0 ? durations[durations.length - 1]! : null,
    averageDuration: avg != null ? Math.round(avg * 10) / 10 : null,
    medianDuration: med != null ? Math.round(med * 10) / 10 : null,
    percentile75: p75 != null ? Math.round(p75 * 10) / 10 : null,
    standardDeviation: sd != null ? Math.round(sd * 10) / 10 : null,
    allSampleDurations: durations,
  };

  const durationMeta = getDurationStrategyMetadata();

  const currentDurationDays = await getCurrentDeliverableDurationDays(args.projectId, args.companyId, args.deliverableId);
  const rawOutlier = computeOutlier({
    currentDurationDays,
    averageDurationDays: benchmark.averageDuration,
    medianDurationDays: benchmark.medianDuration,
    standardDeviationDays: benchmark.standardDeviation,
  });

  const sampleSizeConfidenceTier = confidenceTierFromSampleSize(sampleSize);
  const cappedStatus = capOutlierStatusForSampleSize(sampleSize, rawOutlier.status);
  const benchmarkNotes: string[] = [];
  if (sampleSize === 0) {
    benchmarkNotes.push("No benchmark available (no valid historical duration samples).");
  } else if (sampleSize <= 2) {
    benchmarkNotes.push(
      `Benchmark based on limited historical evidence (${sampleSize} sample${sampleSize === 1 ? "" : "s"}). Statistics only; red flag generation disabled.`
    );
  } else if (sampleSize <= 4) {
    benchmarkNotes.push("Benchmark based on limited historical evidence (3–4 samples). Red flag status capped at WATCH.");
  }
  if (cappedStatus !== rawOutlier.status) {
    benchmarkNotes.push(`Outlier status capped due to limited evidence (raw=${rawOutlier.status}, effective=${cappedStatus}).`);
  }

  const outlier = {
    ...rawOutlier,
    rawStatus: rawOutlier.status,
    status: cappedStatus,
  };

  // Benchmark confidence scoring:
  // Sample Size (40%), Avg Project Similarity (30%), Classification Match Rate (20%), Data Completeness (10%).
  const sampleSizeScore = clamp01(sampleSize / 10); // 10+ => 1.0
  const avgProjectSimilarity =
    matchedProjects.length > 0
      ? matchedProjects.reduce((acc, p) => acc + (Number(p.similarityScore) || 0), 0) / matchedProjects.length
      : 0;
  const avgProjectSimilarityScore = clamp01(avgProjectSimilarity / 100);
  const classificationMatchRate =
    candidateBothHaveClassification > 0 ? candidateClassificationMatches / candidateBothHaveClassification : 1;
  const dataCompleteness = candidateSamples > 0 ? samples.length / candidateSamples : 0;

  const confidenceScore =
    sampleSizeScore * 0.4 +
    avgProjectSimilarityScore * 0.3 +
    clamp01(classificationMatchRate) * 0.2 +
    clamp01(dataCompleteness) * 0.1;
  const confidenceLevel = confidenceLevelFromScore(confidenceScore);

  const benchmarkQuality = {
    sampleSize,
    confidenceLevel,
    confidenceScore: round2(confidenceScore),
    classificationMatchRate: round2(classificationMatchRate),
    averageProjectSimilarity: Math.round(avgProjectSimilarity),
    dataCompleteness: round2(dataCompleteness),
    qualityScore: round2(confidenceScore),
    manuallySelectedProjects: matchedProjects.filter((p) => p.manuallySelected).length,
  };

  const sectorByProjectId = new Map<string, string>();
  if (matchedProjects.length > 0) {
    const profiles = await prisma.projectIntelligenceProfile.findMany({
      where: { companyId: args.companyId, projectId: { in: matchedProjects.map((m) => m.projectId) } },
      select: { projectId: true, sector: true },
    });
    for (const p of profiles) sectorByProjectId.set(p.projectId, p.sector ?? "unknown");
  }
  const projectBreakdown: Record<string, number> = {};
  for (const mp of matchedProjects) {
    const sector = (sectorByProjectId.get(mp.projectId) ?? "unknown").toLowerCase() || "unknown";
    projectBreakdown[sector] = (projectBreakdown[sector] ?? 0) + 1;
  }

  const evidence = {
    sampleSize,
    projectBreakdown,
    matchedProjects,
    projectSelection: {
      includedProjects: projectSimilarityIncluded,
      excludedProjects: projectSimilarityRejected,
      minSimilarityScore: selectedProjectIds.length > 0 ? null : MIN_AUTO_PROJECT_SIMILARITY,
    },
    excludedEvidence,
    classificationMatchRate: round2(classificationMatchRate),
    matchedDeliverables: samples.map((s) => ({
      projectId: s.projectId,
      projectName: s.projectName,
      deliverableId: s.deliverableId,
      deliverableName: s.deliverableName,
      classification: s.classification,
      programmeState: s.programmeState,
      durationDays: s.durationDays,
      similarityScore: s.similarityScore,
    })),
  };

  return {
    deliverable: { id: deliverable.id, name: deliverable.name, classification: deliverable.classification ?? null },
    currentDurationDays,
    benchmark: {
      ...benchmark,
      confidenceScore: round2(confidenceScore),
      confidenceLevel,
      notes: benchmarkNotes,
      historicalDurationDefinition: durationMeta.historicalDurationDefinition,
      currentDurationDefinition: durationMeta.currentDurationDefinition,
      durationComparisonType: durationMeta.durationComparisonType,
      benchmarkQuality,
      sampleSizeConfidenceTier,
    },
    outlier,
    evidence,
  };
}

