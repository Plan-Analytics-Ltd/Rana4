import { prisma } from "../../../utils/prisma.js";
import { resolveCurrentDeliverableDuration } from "../shared/durationSource.service.js";
import { computeRobustBenchmarkStats } from "../shared/robustStatistics.service.js";
import { computeExpectedDuration } from "../prediction/expectedDuration.service.js";
import { getForecastReliabilityForClassification } from "../prediction/forecastReliability.service.js";
import { ALLOWED_SNAPSHOT_STATES } from "../shared/intelligenceConstants.js";
import { clamp01, diffDaysFromIso, round2 } from "../shared/intelligenceMath.js";
import { confidenceLevelFromScore } from "../learning/learningMaturity.service.js";
import { computeOutcomePredictionFromLayers } from "../prediction/outcomePrediction.service.js";
import {
  getSimilarDeliverables,
  getSimilarProjects,
  scoreProjectProfilesSimilarity,
} from "../shared/similarity.service.js";
import {
  capOutlierStatusForSampleSize,
  capPositionForSampleSize,
  computeOutlier,
  plannerPositionLabel,
} from "../shared/outlier.service.js";
import { DEFAULT_MIN_COMPARABLE_SIMILARITY, MIN_AUTO_PROJECT_SIMILARITY } from "../matching/similarityWeights.config.js";
import { selectBenchmarkEvidence } from "../matching/evidenceSelection.service.js";
import { revisionDiversityPenalty } from "../matching/evidenceDiversity.service.js";
import { buildPlannerEvidenceSummary } from "../matching/plannerEvidenceLanguage.service.js";
import { computeDeliverableTimeline } from "../matching/historicalTimeline.service.js";
import { groupHistoricalRevisions } from "../matching/revisionGrouping.service.js";
import { buildDeliverableFingerprint } from "../matching/deliverableFingerprint.service.js";

const MIN_DELIVERABLE_SIMILARITY = DEFAULT_MIN_COMPARABLE_SIMILARITY;

const diffDays = diffDaysFromIso;

export type BenchmarkReport = Awaited<ReturnType<typeof getDeliverableBenchmark>>;

type BenchmarkConfidenceTier = "NONE" | "LOW" | "MEDIUM" | "HIGH";

function confidenceTierFromSampleSize(sampleSize: number): BenchmarkConfidenceTier {
  if (sampleSize <= 0) return "NONE";
  if (sampleSize <= 4) return "LOW";
  if (sampleSize <= 9) return "MEDIUM";
  return "HIGH";
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
        snapshotId: m.snapshotId ?? e?.snapshotId ?? "",
        programmeState: e?.programmeState ?? null,
        projectId: e?.projectId ?? "",
        projectName: e?.projectName ?? "Unknown project",
        plannedStart: e?.plannedStart ?? null,
        plannedFinish: e?.plannedFinish ?? null,
        actualStart: e?.actualStart ?? null,
        actualFinish: e?.actualFinish ?? null,
        workPackageDurationDays: e?.workPackageDurationDays ?? null,
        durationBasis: e?.durationBasis ?? null,
        fingerprintKey: m.fingerprintKey ?? "",
      };
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

  const rawCandidates = gatedByClassification
    .map((m) => {
      // Phase 10: benchmark uses the canonical planner-equivalent work-package duration
      // (max activity original/remaining/actual duration) persisted on the snapshot.
      // Calendar span (actual/planned finish − start) is only a last-resort fallback,
      // used when a snapshot has no work-package duration recorded.
      const durationActual = diffDays(m.actualStart, m.actualFinish);
      const durationPlanned = diffDays(m.plannedStart, m.plannedFinish);
      const calendarSpan = durationActual ?? durationPlanned;
      const durationDays = m.workPackageDurationDays ?? calendarSpan;
      if (durationDays == null || !Number.isFinite(durationDays) || durationDays < 0) {
        excludedEvidence.missingDates += 1;
        return null;
      }
      return {
        snapshotId: m.snapshotId,
        projectId: m.projectId,
        projectName: m.projectName,
        deliverableId: m.deliverableId,
        deliverableName: m.deliverableName,
        classification: m.classification,
        programmeState: m.programmeState,
        durationDays,
        similarityScore: m.similarityScore,
        fingerprintKey: m.fingerprintKey,
        similaritySignals: m.similaritySignals,
      };
    })
    .filter((m): m is NonNullable<typeof m> => !!m);

  excludedEvidence.lowDeliverableSimilarity = rawCandidates.filter(
    (c) => c.similarityScore < MIN_DELIVERABLE_SIMILARITY
  ).length;

  const evidenceSelection = selectBenchmarkEvidence(rawCandidates, {
    minSimilarity: MIN_DELIVERABLE_SIMILARITY,
    deduplicateForStats: true,
  });

  const samples = evidenceSelection.deduplicated;

  excludedEvidence.unsupportedProgrammeState = Math.max(
    0,
    totalSnapshotCandidatesAcrossStates - candidateAfterProgrammeState
  );

  const durations = samples.map((s) => s.durationDays as number);
  const robust = computeRobustBenchmarkStats(durations);
  const sampleSize = robust.sampleSize;

  const durationSource = await resolveCurrentDeliverableDuration({
    projectId: args.projectId,
    companyId: args.companyId,
    deliverableId: args.deliverableId,
  });
  const currentDurationDays = durationSource.durationDays;

  const rawOutlier = computeOutlier({
    currentDurationDays,
    medianDurationDays: robust.medianDuration,
    averageDurationDays: robust.trimmedMean ?? robust.averageDuration,
    standardDeviationDays: robust.standardDeviation,
    historicalDurations: durations,
  });

  const sampleSizeConfidenceTier = confidenceTierFromSampleSize(sampleSize);
  const cappedStatus = capOutlierStatusForSampleSize(sampleSize, rawOutlier.status);
  const cappedPosition = capPositionForSampleSize(sampleSize, rawOutlier.position);
  const benchmarkNotes: string[] = [];
  if (robust.statisticsNote) benchmarkNotes.push(robust.statisticsNote);
  if (sampleSize === 0) {
    benchmarkNotes.push("No benchmark available (no valid historical duration samples).");
  } else if (sampleSize <= 2) {
    benchmarkNotes.push(
      `Benchmark based on limited historical evidence (${sampleSize} sample${sampleSize === 1 ? "" : "s"}). Statistics only; strong deviation flags suppressed.`
    );
  } else if (sampleSize <= 4) {
    benchmarkNotes.push("Benchmark based on limited historical evidence (3–4 samples). Extreme deviation flags are capped.");
  }
  if (cappedStatus !== rawOutlier.status || cappedPosition !== rawOutlier.position) {
    benchmarkNotes.push(
      `Deviation severity capped due to limited evidence (raw position=${rawOutlier.position}, effective=${cappedPosition}; raw status=${rawOutlier.status}, effective=${cappedStatus}).`
    );
  }

  const outlier = {
    ...rawOutlier,
    rawStatus: rawOutlier.status,
    status: cappedStatus,
    rawPosition: rawOutlier.position,
    effectivePosition: cappedPosition,
    rawPositionLabel: plannerPositionLabel(rawOutlier.position),
    effectivePositionLabel: plannerPositionLabel(cappedPosition),
    position: cappedPosition,
    positionLabel: plannerPositionLabel(cappedPosition),
  };

  const projectEvidence = {
    distinctProjects: evidenceSelection.diversity.distinctProjects,
    distinctSnapshots: evidenceSelection.diversity.distinctRevisions,
    revisionRatio: evidenceSelection.diversity.revisionRatio,
  };
  const revisionPenalty = revisionDiversityPenalty(
    projectEvidence.revisionRatio,
    projectEvidence.distinctProjects
  );

  const sampleSizeScore = clamp01(sampleSize / 10);
  const projectDiversityScore = clamp01(projectEvidence.distinctProjects / 5);
  const avgProjectSimilarity =
    matchedProjects.length > 0
      ? matchedProjects.reduce((acc, p) => acc + (Number(p.similarityScore) || 0), 0) / matchedProjects.length
      : 0;
  const avgProjectSimilarityScore = clamp01(avgProjectSimilarity / 100);
  const classificationMatchRate =
    candidateBothHaveClassification > 0 ? candidateClassificationMatches / candidateBothHaveClassification : 1;
  const dataCompleteness = candidateSamples > 0 ? samples.length / candidateSamples : 0;

  const confidenceScore =
    (sampleSizeScore * 0.3 +
      projectDiversityScore * 0.2 +
      avgProjectSimilarityScore * 0.25 +
      clamp01(classificationMatchRate) * 0.15 +
      clamp01(dataCompleteness) * 0.1) *
    revisionPenalty;
  const confidenceLevel = confidenceLevelFromScore(confidenceScore);

  const benchmark = {
    sampleSize,
    minimumDuration: robust.minimumDuration,
    maximumDuration: robust.maximumDuration,
    averageDuration: robust.trimmedMean ?? robust.averageDuration,
    rawAverageDuration: robust.averageDuration,
    medianDuration: robust.medianDuration,
    percentile25: robust.percentile25,
    percentile75: robust.percentile75,
    interquartileRange: robust.interquartileRange,
    standardDeviation: robust.standardDeviation,
    primaryReference: robust.primaryReference,
    historicalOutlierCount: robust.historicalOutliers.count,
    historicalOutlierValues: robust.historicalOutliers.values,
    allSampleDurations: [...durations].sort((a, b) => a - b),
  };

  const benchmarkQuality = {
    sampleSize,
    distinctProjects: projectEvidence.distinctProjects,
    distinctSnapshots: projectEvidence.distinctSnapshots,
    distinctDeliverables: evidenceSelection.diversity.distinctDeliverables,
    revisionRatio: round2(projectEvidence.revisionRatio),
    completedProjects: evidenceSelection.diversity.completedProjects,
    evidenceQuantity: evidenceSelection.diversity.observationCount,
    evidenceDiversity: evidenceSelection.diversity.diversityLabel,
    evidenceMaturity: evidenceSelection.diversity.maturityLabel,
    confidenceLevel,
    confidenceScore: round2(confidenceScore),
    classificationMatchRate: round2(classificationMatchRate),
    averageProjectSimilarity: Math.round(avgProjectSimilarity),
    dataCompleteness: round2(dataCompleteness),
    qualityScore: round2(confidenceScore),
    manuallySelectedProjects: matchedProjects.filter((p) => p.manuallySelected).length,
    excludedLowSimilarity: evidenceSelection.excludedLowSimilarity,
    minComparableSimilarity: MIN_DELIVERABLE_SIMILARITY,
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

  const sectorLabel = [...sectorByProjectId.values()][0] ?? null;
  const plannerEvidenceSummary = buildPlannerEvidenceSummary({
    diversity: evidenceSelection.diversity,
    sectorLabel,
    medianDuration: robust.medianDuration,
    matchingConfidence: confidenceLevel,
  });

  const timelineRevisions = groupHistoricalRevisions(
    evidenceSelection.selected.map((s) => ({
      snapshotId: s.snapshotId,
      snapshotVersion: 0,
      snapshotRole: null,
      programmeState: s.programmeState,
      projectId: s.projectId,
      projectName: s.projectName,
      deliverableId: s.deliverableId,
      deliverableName: s.deliverableName,
      importedAt: s.importedAt ?? new Date(0),
      durationDays: s.durationDays,
      fingerprint: buildDeliverableFingerprint({
        deliverableName: s.deliverableName,
        classification: s.classification,
      }),
    }))
  );
  const timelineForDeliverable = timelineRevisions
    .flatMap((p) => p.deliverables)
    .find(
      (d) =>
        d.deliverableName.toLowerCase() === deliverable.name.toLowerCase() ||
        d.deliverableId === deliverable.id
    );
  const historicalTimeline = timelineForDeliverable
    ? computeDeliverableTimeline(timelineForDeliverable.revisions)
    : null;

  const evidence = {
    sampleSize,
    projectBreakdown,
    matchedProjects,
    plannerSummary: plannerEvidenceSummary,
    evidenceDiversity: evidenceSelection.diversity,
    historicalTimeline,
    rankedMatches: evidenceSelection.ranked.slice(0, 10).map((s) => ({
      deliverableName: s.deliverableName,
      projectName: s.projectName,
      similarityScore: s.similarityScore,
      programmeState: s.programmeState,
    })),
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
      snapshotId: s.snapshotId,
      durationDays: s.durationDays,
      similarityScore: s.similarityScore,
      similaritySignals: s.similaritySignals,
    })),
    allRankedCount: evidenceSelection.ranked.length,
    selectedCount: evidenceSelection.selected.length,
  };

  return {
    deliverable: { id: deliverable.id, name: deliverable.name, classification: deliverable.classification ?? null },
    currentDurationDays,
    currentDurationSource: {
      source: durationSource.source,
      sourceTable: durationSource.sourceTable,
      sourceFields: durationSource.sourceFields,
      definition: durationSource.definition,
    },
    benchmark: {
      ...benchmark,
      confidenceScore: round2(confidenceScore),
      confidenceLevel,
      notes: benchmarkNotes,
      historicalDurationDefinition:
        "Historical duration from DeliverableSnapshot dates: (actualFinish−actualStart) else (plannedFinish−plannedStart). Benchmark reference is the median; outliers are retained but noted.",
      currentDurationDefinition: durationSource.definition,
      durationComparisonType: durationSource.source === "ACTIVITY_DATE_SPAN" ? "ACTIVITY_SPAN" : "PLANNER_ESTIMATE",
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

