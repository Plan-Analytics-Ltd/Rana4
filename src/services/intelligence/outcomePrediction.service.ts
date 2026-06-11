import { DeliverableClassification, type ReliabilityBand } from "@prisma/client";
import { prisma } from "../../utils/prisma.js";
import {
  formatClassificationLabel,
  loadCompanyHistoricalDurationSamples,
  round1,
  type HistoricalDurationSampleWithMeta,
} from "./durationEvidence.service.js";
import { computeExpectedDuration, type ExpectedDurationResult } from "./expectedDuration.service.js";
import type { DeliverableReliabilityProfileDto } from "./forecastReliability.service.js";
import { MIN_INSIGHT_SAMPLE, MIN_PROFILE_SAMPLE } from "./intelligenceConstants.js";
import { clamp01 } from "./intelligenceMath.js";
import { confidenceLevelFromScore } from "./learningMaturity.service.js";

export type OutcomePredictionResult = {
  predictedMinimumDuration: number | null;
  predictedMostLikelyDuration: number | null;
  predictedMaximumDuration: number | null;
  rangeLabel: string | null;
  predictionConfidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  predictionConfidenceScore: number;
  evidenceCount: number;
  reasoning: string[];
};

export type DeliverableOutcomeProfileDto = {
  id: string;
  classification: string;
  label: string;
  sampleSize: number;
  projectCount: number;
  predictedMinimumDuration: number | null;
  predictedMostLikelyDuration: number | null;
  predictedMaximumDuration: number | null;
  rangeLabel: string | null;
  historicalAverageDuration: number | null;
  historicalMedianDuration: number | null;
  historicalOverrunFrequency: number;
  historicalAverageVariancePercent: number | null;
  predictionConfidenceLevel: string;
  predictionConfidenceScore: number;
  reasoning: string[];
  lastUpdated: string;
};

type KnowledgeInputs = {
  averageDuration: number | null;
  medianDuration: number | null;
  minimumDuration: number | null;
  maximumDuration: number | null;
  sampleSize: number;
  projectCount: number;
  confidenceScore: number;
};

type ReliabilityInputs = {
  overrunFrequency: number;
  averageVariancePercent: number | null;
  averageVarianceDays: number | null;
  reliabilityBand: ReliabilityBand | null;
  reliabilityLabel: string | null;
  sampleSize: number;
  confidenceScore: number;
};

/**
 * Deterministic outcome prediction combining expected duration with
 * historical planned-vs-actual reliability behaviour.
 */
export function computeOutcomePrediction(args: {
  expectedMin: number;
  expectedMax: number;
  expectedMostLikely: number;
  expectedConfidenceScore: number;
  evidenceCount: number;
  knowledge: KnowledgeInputs | null;
  reliability: ReliabilityInputs | null;
}): OutcomePredictionResult {
  const reasoning: string[] = [];
  const knowledge = args.knowledge;
  const reliability = args.reliability;

  let predictedMin = args.expectedMin;
  let predictedMax = args.expectedMax;
  let predictedMostLikely = args.expectedMostLikely;

  const overrunFrac = reliability?.overrunFrequency ?? 0;
  const variancePct = reliability?.averageVariancePercent ?? 0;
  const varianceDays =
    reliability?.averageVarianceDays ??
    (Number.isFinite(variancePct) ? (args.expectedMostLikely * variancePct) / 100 : 0);

  if (reliability && reliability.sampleSize >= MIN_PROFILE_SAMPLE) {
    const overrunInfluence = clamp01(overrunFrac);
    const dayAdjust = varianceDays;

    predictedMostLikely = Math.round(args.expectedMostLikely + dayAdjust);
    predictedMin = Math.round(args.expectedMin + dayAdjust);
    predictedMax = Math.round(args.expectedMax + dayAdjust * (0.5 + 0.5 * (1 - overrunInfluence)));

    reasoning.push(`Historical overrun frequency is ${Math.round(overrunFrac * 100)}%.`);
    reasoning.push(
      `Average variance is ${variancePct > 0 ? "+" : ""}${round1(variancePct)}%.`
    );
    if (reliability.reliabilityLabel) {
      reasoning.push(`Forecast reliability classified as ${reliability.reliabilityLabel}.`);
    }
    if (reliability.reliabilityBand === "HIGHLY_UNPREDICTABLE") {
      const spread = Math.round((predictedMax - predictedMin) * 0.12);
      predictedMin = Math.max(1, predictedMin - spread);
      predictedMax = predictedMax + spread;
      reasoning.push("Range widened due to high historical variability.");
    }
  } else if (knowledge?.medianDuration != null) {
    predictedMostLikely = Math.round(knowledge.medianDuration);
    predictedMin = Math.round(knowledge.minimumDuration ?? args.expectedMin);
    predictedMax = Math.round(knowledge.maximumDuration ?? args.expectedMax);
    reasoning.push(
      `Prediction anchored on historical median duration (${predictedMostLikely} days).`
    );
  } else {
    reasoning.push(
      "Prediction matches expected duration range (no planned-vs-actual reliability evidence yet)."
    );
  }

  predictedMin = Math.min(predictedMin, predictedMostLikely);
  predictedMax = Math.max(predictedMax, predictedMostLikely);
  predictedMin = Math.max(1, predictedMin);

  reasoning.push(
    `Evidence from ${args.evidenceCount} comparable deliverable${args.evidenceCount === 1 ? "" : "s"}.`
  );

  const reliabilityConfidence = reliability?.confidenceScore ?? args.expectedConfidenceScore;
  const predictionConfidenceScore = round1(
    clamp01(args.expectedConfidenceScore) * 0.5 +
      clamp01(reliabilityConfidence) * 0.3 +
      clamp01(args.evidenceCount / 20) * 0.2
  );

  return {
    predictedMinimumDuration: predictedMin,
    predictedMostLikelyDuration: predictedMostLikely,
    predictedMaximumDuration: predictedMax,
    rangeLabel: `${predictedMin}–${predictedMax} days`,
    predictionConfidenceLevel: confidenceLevelFromScore(predictionConfidenceScore),
    predictionConfidenceScore,
    evidenceCount: args.evidenceCount,
    reasoning,
  };
}

function mapRow(row: {
  id: string;
  classification: string;
  label: string;
  sampleSize: number;
  projectCount: number;
  predictedMinimumDuration: number | null;
  predictedMostLikelyDuration: number | null;
  predictedMaximumDuration: number | null;
  historicalAverageDuration: number | null;
  historicalMedianDuration: number | null;
  historicalOverrunFrequency: number;
  historicalAverageVariancePercent: number | null;
  predictionConfidenceLevel: string;
  predictionConfidenceScore: number;
  reasoningJson: unknown;
  lastUpdated: Date;
}): DeliverableOutcomeProfileDto {
  const reasoning = Array.isArray(row.reasoningJson)
    ? (row.reasoningJson as string[])
    : [];
  const min = row.predictedMinimumDuration;
  const max = row.predictedMaximumDuration;
  return {
    id: row.id,
    classification: row.classification,
    label: row.label,
    sampleSize: row.sampleSize,
    projectCount: row.projectCount,
    predictedMinimumDuration: min,
    predictedMostLikelyDuration: row.predictedMostLikelyDuration,
    predictedMaximumDuration: max,
    rangeLabel: min != null && max != null ? `${Math.round(min)}–${Math.round(max)} days` : null,
    historicalAverageDuration: row.historicalAverageDuration,
    historicalMedianDuration: row.historicalMedianDuration,
    historicalOverrunFrequency: round1(row.historicalOverrunFrequency * 100),
    historicalAverageVariancePercent: row.historicalAverageVariancePercent,
    predictionConfidenceLevel: row.predictionConfidenceLevel,
    predictionConfidenceScore: row.predictionConfidenceScore,
    reasoning,
    lastUpdated: row.lastUpdated.toISOString(),
  };
}

type ProfileRow = Awaited<
  ReturnType<typeof prisma.deliverableKnowledgeProfile.findUnique>
>;
type ReliabilityRow = Awaited<
  ReturnType<typeof prisma.deliverableReliabilityProfile.findUnique>
>;

type PredictionBuildResult = {
  prediction: OutcomePredictionResult;
  knowledge: ProfileRow;
  reliability: ReliabilityRow;
};

async function buildPredictionForClassification(
  companyId: string,
  classification: DeliverableClassification,
  ctx: {
    preloadedSamples: HistoricalDurationSampleWithMeta[];
    knowledgeByClass: Map<string, ProfileRow>;
    reliabilityByClass: Map<string, ReliabilityRow>;
  }
): Promise<PredictionBuildResult | null> {
  const knowledge = ctx.knowledgeByClass.get(classification) ?? null;
  const reliability = ctx.reliabilityByClass.get(classification) ?? null;

  const expected = await computeExpectedDuration({
    companyId,
    filters: { classification },
    preloadedSamples: ctx.preloadedSamples,
  });

  if (expected.evidenceCount === 0 && !knowledge) {
    return null;
  }

  const expectedMin = expected.minimumExpectedDays ?? knowledge?.minimumDuration;
  const expectedMax = expected.maximumExpectedDays ?? knowledge?.maximumDuration;
  const expectedMostLikely = expected.mostLikelyDays ?? knowledge?.medianDuration;

  if (expectedMin == null || expectedMax == null || expectedMostLikely == null) {
    return null;
  }

  const prediction = computeOutcomePrediction({
    expectedMin,
    expectedMax,
    expectedMostLikely,
    expectedConfidenceScore: expected.confidenceScore,
    evidenceCount: expected.evidenceCount || knowledge?.sampleSize || 0,
    knowledge: knowledge
      ? {
          averageDuration: knowledge.averageDuration,
          medianDuration: knowledge.medianDuration,
          minimumDuration: knowledge.minimumDuration,
          maximumDuration: knowledge.maximumDuration,
          sampleSize: knowledge.sampleSize,
          projectCount: knowledge.projectCount,
          confidenceScore: knowledge.confidenceScore,
        }
      : null,
    reliability: reliability
      ? {
          overrunFrequency: reliability.overrunFrequency,
          averageVariancePercent: reliability.averageVariancePercent,
          averageVarianceDays: reliability.averageVarianceDays,
          reliabilityBand: reliability.reliabilityBand,
          reliabilityLabel: reliability.reliabilityLabel,
          sampleSize: reliability.sampleSize,
          confidenceScore: reliability.confidenceScore,
        }
      : null,
  });

  return { prediction, knowledge, reliability };
}

/** Rebuild outcome profiles from knowledge, reliability, and historical evidence. */
export async function refreshDeliverableOutcomeProfiles(companyId: string): Promise<number> {
  const [preloadedSamples, knowledgeRows, reliabilityRows] = await Promise.all([
    loadCompanyHistoricalDurationSamples({ companyId }),
    prisma.deliverableKnowledgeProfile.findMany({ where: { companyId } }),
    prisma.deliverableReliabilityProfile.findMany({ where: { companyId } }),
  ]);
  const knowledgeByClass = new Map(knowledgeRows.map((r) => [r.classification, r]));
  const reliabilityByClass = new Map(reliabilityRows.map((r) => [r.classification, r]));
  const ctx = { preloadedSamples, knowledgeByClass, reliabilityByClass };

  const now = new Date();
  let updated = 0;

  for (const classification of Object.values(DeliverableClassification)) {
    const built = await buildPredictionForClassification(companyId, classification, ctx);
    if (!built || built.prediction.evidenceCount < MIN_PROFILE_SAMPLE) {
      await prisma.deliverableOutcomeProfile.deleteMany({
        where: { companyId, classification },
      });
      continue;
    }

    const { prediction, knowledge, reliability } = built;
    const sampleSize = Math.max(
      prediction.evidenceCount,
      knowledge?.sampleSize ?? 0,
      reliability?.sampleSize ?? 0
    );
    const projectCount = knowledge?.projectCount ?? reliability?.projectCount ?? 0;

    await prisma.deliverableOutcomeProfile.upsert({
      where: { companyId_classification: { companyId, classification } },
      create: {
        companyId,
        classification,
        label: formatClassificationLabel(classification),
        sampleSize,
        projectCount,
        predictedMinimumDuration: prediction.predictedMinimumDuration,
        predictedMostLikelyDuration: prediction.predictedMostLikelyDuration,
        predictedMaximumDuration: prediction.predictedMaximumDuration,
        historicalAverageDuration: knowledge?.averageDuration ?? null,
        historicalMedianDuration: knowledge?.medianDuration ?? null,
        historicalOverrunFrequency: reliability?.overrunFrequency ?? 0,
        historicalAverageVariancePercent: reliability?.averageVariancePercent ?? null,
        predictionConfidenceLevel: prediction.predictionConfidenceLevel,
        predictionConfidenceScore: prediction.predictionConfidenceScore,
        reasoningJson: prediction.reasoning,
        lastUpdated: now,
      },
      update: {
        label: formatClassificationLabel(classification),
        sampleSize,
        projectCount,
        predictedMinimumDuration: prediction.predictedMinimumDuration,
        predictedMostLikelyDuration: prediction.predictedMostLikelyDuration,
        predictedMaximumDuration: prediction.predictedMaximumDuration,
        historicalAverageDuration: knowledge?.averageDuration ?? null,
        historicalMedianDuration: knowledge?.medianDuration ?? null,
        historicalOverrunFrequency: reliability?.overrunFrequency ?? 0,
        historicalAverageVariancePercent: reliability?.averageVariancePercent ?? null,
        predictionConfidenceLevel: prediction.predictionConfidenceLevel,
        predictionConfidenceScore: prediction.predictionConfidenceScore,
        reasoningJson: prediction.reasoning,
        lastUpdated: now,
      },
    });
    updated += 1;
  }

  return updated;
}

export async function listOutcomeProfiles(companyId: string): Promise<DeliverableOutcomeProfileDto[]> {
  const rows = await prisma.deliverableOutcomeProfile.findMany({
    where: { companyId },
    orderBy: [{ sampleSize: "desc" }, { label: "asc" }],
  });
  return rows.map(mapRow);
}

export async function getOutcomeProfileByClassification(
  companyId: string,
  classification: string
): Promise<DeliverableOutcomeProfileDto | null> {
  const normalized = String(classification).trim().toUpperCase();
  if (!Object.values(DeliverableClassification).includes(normalized as DeliverableClassification)) {
    return null;
  }
  const row = await prisma.deliverableOutcomeProfile.findUnique({
    where: { companyId_classification: { companyId, classification: normalized as DeliverableClassification } },
  });
  return row ? mapRow(row) : null;
}

/** Combine live expected duration with reliability profile for deliverable comparison. */
export function computeOutcomePredictionFromLayers(args: {
  expected: ExpectedDurationResult;
  reliability: DeliverableReliabilityProfileDto | null;
  knowledge?: KnowledgeInputs | null;
}): OutcomePredictionResult | null {
  const expectedMin = args.expected.minimumExpectedDays;
  const expectedMax = args.expected.maximumExpectedDays;
  const expectedMostLikely = args.expected.mostLikelyDays;
  if (expectedMin == null || expectedMax == null || expectedMostLikely == null) {
    return null;
  }

  return computeOutcomePrediction({
    expectedMin,
    expectedMax,
    expectedMostLikely,
    expectedConfidenceScore: args.expected.confidenceScore,
    evidenceCount: args.expected.evidenceCount,
    knowledge: args.knowledge ?? null,
    reliability: args.reliability
      ? {
          overrunFrequency: args.reliability.overrunFrequency / 100,
          averageVariancePercent: args.reliability.averageVariancePercent,
          averageVarianceDays: args.reliability.averageVarianceDays,
          reliabilityBand: args.reliability.reliabilityBand,
          reliabilityLabel: args.reliability.reliabilityLabel,
          sampleSize: args.reliability.sampleSize,
          confidenceScore: args.reliability.confidenceScore,
        }
      : null,
  });
}

/** Live outcome prediction for deliverable comparison (uses stored profiles or computes on the fly). */
export async function getOutcomePredictionForClassification(
  companyId: string,
  classification: string | null | undefined
): Promise<OutcomePredictionResult | null> {
  if (!classification) return null;

  const stored = await getOutcomeProfileByClassification(companyId, classification);
  if (stored) {
    return {
      predictedMinimumDuration: stored.predictedMinimumDuration,
      predictedMostLikelyDuration: stored.predictedMostLikelyDuration,
      predictedMaximumDuration: stored.predictedMaximumDuration,
      rangeLabel: stored.rangeLabel,
      predictionConfidenceLevel: stored.predictionConfidenceLevel as "LOW" | "MEDIUM" | "HIGH",
      predictionConfidenceScore: stored.predictionConfidenceScore,
      evidenceCount: stored.sampleSize,
      reasoning: stored.reasoning,
    };
  }

  const normalized = String(classification).trim().toUpperCase();
  if (!Object.values(DeliverableClassification).includes(normalized as DeliverableClassification)) {
    return null;
  }
  const [preloadedSamples, knowledgeRows, reliabilityRows] = await Promise.all([
    loadCompanyHistoricalDurationSamples({ companyId }),
    prisma.deliverableKnowledgeProfile.findMany({ where: { companyId } }),
    prisma.deliverableReliabilityProfile.findMany({ where: { companyId } }),
  ]);
  const built = await buildPredictionForClassification(
    companyId,
    normalized as DeliverableClassification,
    {
      preloadedSamples,
      knowledgeByClass: new Map(knowledgeRows.map((r) => [r.classification, r])),
      reliabilityByClass: new Map(reliabilityRows.map((r) => [r.classification, r])),
    }
  );
  return built?.prediction ?? null;
}

export type OutcomePredictionInsightDraft = {
  title: string;
  summary: string;
  observation: string;
  classification: string;
  sampleSize: number;
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  confidenceScore: number;
  evidenceJson: Record<string, unknown>;
};

/** Build organisational OUTCOME_PREDICTION insight drafts from stored profiles. */
export function buildOutcomePredictionInsights(
  profiles: DeliverableOutcomeProfileDto[]
): OutcomePredictionInsightDraft[] {
  const drafts: OutcomePredictionInsightDraft[] = [];

  for (const p of profiles) {
    if (p.sampleSize < MIN_INSIGHT_SAMPLE) continue;
    if (p.predictionConfidenceLevel === "LOW") continue;
    if (p.predictedMinimumDuration == null || p.predictedMaximumDuration == null) continue;

    const rangeLabel = p.rangeLabel ?? `${Math.round(p.predictedMinimumDuration)}–${Math.round(p.predictedMaximumDuration)} days`;
    const mostLikely = p.predictedMostLikelyDuration != null ? Math.round(p.predictedMostLikelyDuration) : null;

    if (p.historicalOverrunFrequency >= 55 && p.historicalAverageVariancePercent != null && p.historicalAverageVariancePercent > 5) {
      drafts.push({
        title: `${p.label} Deliverables Typically Complete Beyond Original Estimates`,
        summary: `Historical outcomes suggest ${p.label.toLowerCase()} deliverables often finish later than originally planned.`,
        observation: `Predicted outcome ${rangeLabel}${mostLikely != null ? ` (most likely ${mostLikely} days)` : ""}. ${Math.round(p.historicalOverrunFrequency)}% historically exceeded estimates.`,
        classification: p.classification,
        sampleSize: p.sampleSize,
        confidenceLevel: p.predictionConfidenceLevel as "LOW" | "MEDIUM" | "HIGH",
        confidenceScore: p.predictionConfidenceScore,
        evidenceJson: {
          rangeLabel,
          mostLikelyDays: mostLikely,
          overrunFrequency: p.historicalOverrunFrequency,
          averageVariancePercent: p.historicalAverageVariancePercent,
        },
      });
    }

    if (
      p.historicalOverrunFrequency < 35 &&
      p.predictedMinimumDuration != null &&
      p.predictedMaximumDuration != null &&
      drafts.length < 8
    ) {
      drafts.push({
        title: `${p.label} Deliverables Frequently Finish Within ${Math.round(p.predictedMinimumDuration)}–${Math.round(p.predictedMaximumDuration)} Days`,
        summary: `Based on comparable project history, ${p.label.toLowerCase()} deliverables usually complete within a predictable window.`,
        observation: `Predicted outcome ${rangeLabel}${mostLikely != null ? ` with most likely duration ${mostLikely} days` : ""} across ${p.sampleSize} examples.`,
        classification: p.classification,
        sampleSize: p.sampleSize,
        confidenceLevel: p.predictionConfidenceLevel as "LOW" | "MEDIUM" | "HIGH",
        confidenceScore: p.predictionConfidenceScore,
        evidenceJson: {
          rangeLabel,
          mostLikelyDays: mostLikely,
          onTargetImplied: true,
        },
      });
    }

    if (
      p.historicalOverrunFrequency >= 45 &&
      p.historicalAverageVariancePercent != null &&
      p.historicalAverageVariancePercent >= 15 &&
      drafts.length < 8
    ) {
      drafts.push({
        title: `${p.label} Reviews Commonly Exceed Baseline Duration Expectations`,
        summary: `Outcome predictions for ${p.label.toLowerCase()} deliverables sit above typical baseline expectations.`,
        observation: `Average historical variance ${p.historicalAverageVariancePercent > 0 ? "+" : ""}${round1(p.historicalAverageVariancePercent)}%. Predicted ${rangeLabel}.`,
        classification: p.classification,
        sampleSize: p.sampleSize,
        confidenceLevel: p.predictionConfidenceLevel as "LOW" | "MEDIUM" | "HIGH",
        confidenceScore: p.predictionConfidenceScore,
        evidenceJson: {
          rangeLabel,
          averageVariancePercent: p.historicalAverageVariancePercent,
        },
      });
    }
  }

  return drafts.slice(0, 8);
}
