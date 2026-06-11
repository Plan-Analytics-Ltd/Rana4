import type { LearningMaturity } from "@prisma/client";
import {
  loadHistoricalDeliverableDurations,
  median,
  percentile,
  round1,
  stddev,
  type DurationEvidenceFilters,
} from "./durationEvidence.service.js";
import {
  confidenceLevelFromScore,
  learningMaturityFrom,
  learningMaturityLabel,
  predictabilityFromDurations,
} from "./learningMaturity.service.js";

export type ExpectedDurationResult = {
  minimumExpectedDays: number | null;
  mostLikelyDays: number | null;
  maximumExpectedDays: number | null;
  rangeLabel: string | null;
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  confidenceScore: number;
  evidenceCount: number;
  projectCount: number;
  learningMaturity: LearningMaturity;
  maturityLabel: string;
  evidenceVolume: number;
  coverageScore: number;
  filtersApplied: DurationEvidenceFilters;
  explanation: string[];
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Explainable expected duration from filtered historical deliverable snapshots.
 */
export async function computeExpectedDuration(args: {
  companyId: string;
  filters: DurationEvidenceFilters;
  projectIds?: string[];
  excludeProjectId?: string;
}): Promise<ExpectedDurationResult> {
  const samples = await loadHistoricalDeliverableDurations(args);
  const durations = samples.map((s) => s.durationDays).sort((a, b) => a - b);
  const evidenceCount = durations.length;
  const projectCount = new Set(samples.map((s) => s.projectId)).size;

  const explanation: string[] = [
    `Filtered historical deliverables by classification: ${args.filters.classification}.`,
  ];
  if (args.filters.projectType) explanation.push(`Project type filter: ${args.filters.projectType}.`);
  if (args.filters.stage) explanation.push(`Stage filter: ${args.filters.stage}.`);
  if (args.filters.complexity) explanation.push(`Complexity filter: ${args.filters.complexity}.`);
  if (args.filters.procurementRoute) explanation.push(`Procurement filter: ${args.filters.procurementRoute}.`);
  if (args.filters.clientType) explanation.push(`Client type filter: ${args.filters.clientType}.`);
  explanation.push(`Evidence count: ${evidenceCount} deliverable observations across ${projectCount} project(s).`);

  if (evidenceCount === 0) {
    return {
      minimumExpectedDays: null,
      mostLikelyDays: null,
      maximumExpectedDays: null,
      rangeLabel: null,
      confidenceLevel: "LOW",
      confidenceScore: 0,
      evidenceCount: 0,
      projectCount: 0,
      learningMaturity: "LIMITED",
      maturityLabel: learningMaturityLabel("LIMITED"),
      evidenceVolume: 0,
      coverageScore: 0,
      filtersApplied: args.filters,
      explanation: [...explanation, "No comparable historical evidence matched the filters."],
    };
  }

  const minDur = durations[0]!;
  const maxDur = durations[durations.length - 1]!;
  const med = median(durations)!;
  const p25 = percentile(durations, 0.25) ?? minDur;
  const p75 = percentile(durations, 0.75) ?? maxDur;
  const minimumExpectedDays = evidenceCount >= 5 ? Math.round(p25) : minDur;
  const maximumExpectedDays = evidenceCount >= 5 ? Math.round(p75) : maxDur;
  const mostLikelyDays = Math.round(med);

  const avg = durations.reduce((a, b) => a + b, 0) / evidenceCount;
  const sd = stddev(durations, avg);
  const predictability = predictabilityFromDurations(durations) ?? 0;

  const sampleScore = clamp01(evidenceCount / 20);
  const projectSpreadScore = clamp01(projectCount / 8);
  const predictabilityScore = predictability;
  const completenessScore = [
    args.filters.projectType,
    args.filters.stage,
    args.filters.complexity,
    args.filters.procurementRoute,
    args.filters.clientType,
  ].filter(Boolean).length / 5;

  const confidenceScore = round1(
    sampleScore * 0.4 + projectSpreadScore * 0.3 + predictabilityScore * 0.2 + completenessScore * 0.1
  );
  const confidenceLevel = confidenceLevelFromScore(confidenceScore);
  const learningMaturity = learningMaturityFrom(evidenceCount, confidenceLevel);
  const coverageScore = round1(projectSpreadScore);

  explanation.push(
    `Most likely duration = median (${mostLikelyDays} days).`,
    `Expected range uses ${evidenceCount >= 5 ? "25th–75th percentile" : "min–max"} of observed durations (${minimumExpectedDays}–${maximumExpectedDays} days).`
  );
  if (sd != null) explanation.push(`Standard deviation: ${round1(sd)} days.`);

  return {
    minimumExpectedDays,
    mostLikelyDays,
    maximumExpectedDays,
    rangeLabel: `${minimumExpectedDays}–${maximumExpectedDays} Days`,
    confidenceLevel,
    confidenceScore,
    evidenceCount,
    projectCount,
    learningMaturity,
    maturityLabel: learningMaturityLabel(learningMaturity),
    evidenceVolume: evidenceCount,
    coverageScore,
    filtersApplied: args.filters,
    explanation,
  };
}
