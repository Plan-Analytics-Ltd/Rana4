import { prisma } from "../../../utils/prisma.js";
import { median, percentile, round1, stddev } from "../shared/durationEvidence.service.js";
import { computeExpectedDuration } from "../prediction/expectedDuration.service.js";
import { getForecastReliabilityForClassification } from "../prediction/forecastReliability.service.js";
import { ALLOWED_SNAPSHOT_STATES } from "../shared/intelligenceConstants.js";
import { clamp01, diffDaysFromIso, MS_PER_DAY, round2 } from "../shared/intelligenceMath.js";
import { confidenceLevelFromScore } from "../learning/learningMaturity.service.js";
import { computeOutcomePredictionFromLayers } from "../prediction/outcomePrediction.service.js";
import {
  getSimilarDeliverables,
  getSimilarProjects,
  scoreProjectProfilesSimilarity,
} from "../shared/similarity.service.js";
import { computeOutlier } from "../shared/outlier.service.js";
import type { OutlierStatus } from "../shared/outlier.service.js";

const MIN_AUTO_PROJECT_SIMILARITY = 50;
const MIN_DELIVERABLE_SIMILARITY = 30;

const diffDays = diffDaysFromIso;

export type BenchmarkReport = Awaited<ReturnType<typeof getDeliverableBenchmark>>;

type BenchmarkConfidenceTier = "NONE" | "LOW" | "MEDIUM" | "HIGH";

function confidenceTierFromSampleSize(sampleSize: number): BenchmarkConfidenceTier {
  if (sampleSize <= 0) return "NONE";
  if (sampleSize <= 4) return "LOW";
  if (sampleSize <= 9) return "MEDIUM";
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
  const days = Math.max(0, Math.round((maxFinish.getTime() - minStart.getTime()) / MS_PER_DAY));
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
    const profileRows = await prisma.projectIntelligenceProfile.findMany({
      where: {
        companyId: args.companyId,
        projectId: { in: [args.projectId, ...comparableProjectIds] },
      },
    });
    const profileByProject = new Map(profileRows.map((row) => [row.projectId, row]));
    const sourceProfile = profileByProject.get(args.projectId);
    matchedProjects = projects.map((p) => {
      const similarityScore =
        p.id === args.projectId
          ? 100
          : scoreProjectProfilesSimilarity(sourceProfile, profileByProject.get(p.id));
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
    });
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

  const intelligenceProfile = await prisma.projectIntelligenceProfile.findUnique({
    where: { projectId: args.projectId },
    select: {
      projectType: true,
      stage: true,
      complexity: true,
      procurementRoute: true,
      clientType: true,
      primaryRibaStage: true,
    },
  });

  const forecastReliability = await getForecastReliabilityForClassification(
    args.companyId,
    deliverable.classification
  );

  const expectedDuration = await computeExpectedDuration({
    companyId: args.companyId,
    filters: {
      classification: baseClassification ?? "OTHER",
      projectType: intelligenceProfile?.projectType,
      stage: intelligenceProfile?.stage ?? intelligenceProfile?.primaryRibaStage,
      complexity: intelligenceProfile?.complexity,
      procurementRoute: intelligenceProfile?.procurementRoute,
      clientType: intelligenceProfile?.clientType,
    },
    projectIds: comparableProjectIds.length > 0 ? comparableProjectIds : undefined,
    excludeProjectId: args.projectId,
  });

  const predictedOutcome = computeOutcomePredictionFromLayers({
    expected: expectedDuration,
    reliability: forecastReliability,
  });

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
      expectedDuration: {
        rangeLabel: expectedDuration.rangeLabel,
        minimumExpectedDays: expectedDuration.minimumExpectedDays,
        mostLikelyDays: expectedDuration.mostLikelyDays,
        maximumExpectedDays: expectedDuration.maximumExpectedDays,
        confidenceLevel: expectedDuration.confidenceLevel,
        confidenceScore: expectedDuration.confidenceScore,
        evidenceCount: expectedDuration.evidenceCount,
        learningMaturity: expectedDuration.learningMaturity,
        maturityLabel: expectedDuration.maturityLabel,
        evidenceVolume: expectedDuration.evidenceVolume,
        coverageScore: expectedDuration.coverageScore,
        explanation: expectedDuration.explanation,
      },
      forecastReliability: forecastReliability
        ? {
            reliabilityLabel: forecastReliability.reliabilityLabel,
            reliabilityBand: forecastReliability.reliabilityBand,
            overrunFrequency: forecastReliability.overrunFrequency,
            underrunFrequency: forecastReliability.underrunFrequency,
            onTargetFrequency: forecastReliability.onTargetFrequency,
            averageVariancePercent: forecastReliability.averageVariancePercent,
            averageVarianceDays: forecastReliability.averageVarianceDays,
            plannedAverageDuration: forecastReliability.plannedAverageDuration,
            actualAverageDuration: forecastReliability.actualAverageDuration,
            sampleSize: forecastReliability.sampleSize,
            predictabilityScore: forecastReliability.predictabilityScore,
            confidenceLevel: forecastReliability.confidenceLevel,
            confidenceScore: forecastReliability.confidenceScore,
          }
        : null,
      predictedOutcome: predictedOutcome
        ? {
            rangeLabel: predictedOutcome.rangeLabel,
            predictedMinimumDuration: predictedOutcome.predictedMinimumDuration,
            predictedMostLikelyDuration: predictedOutcome.predictedMostLikelyDuration,
            predictedMaximumDuration: predictedOutcome.predictedMaximumDuration,
            predictionConfidenceLevel: predictedOutcome.predictionConfidenceLevel,
            predictionConfidenceScore: predictedOutcome.predictionConfidenceScore,
            evidenceCount: predictedOutcome.evidenceCount,
            reasoning: predictedOutcome.reasoning,
          }
        : null,
    },
    outlier,
    evidence,
  };
}

