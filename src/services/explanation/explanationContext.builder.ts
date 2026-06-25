import { getDeliverableIntelligenceAnalysis } from "../intelligence/intelligenceOrchestrator.service.js";
import type { DeliverableIntelligenceAnalysis } from "../intelligence/intelligenceOrchestrator.service.js";
import { buildExplanationCitations } from "./explanationCitations.js";
import type { ExplanationCitation, ExplanationContextSummary } from "./explanationTypes.js";

export type ExplanationIntelligencePackage = {
  deliverable: DeliverableIntelligenceAnalysis["deliverable"];
  currentDurationDays: DeliverableIntelligenceAnalysis["currentDurationDays"];
  benchmark: DeliverableIntelligenceAnalysis["benchmark"];
  outlier: DeliverableIntelligenceAnalysis["outlier"];
  evidence: DeliverableIntelligenceAnalysis["evidence"];
  observations: DeliverableIntelligenceAnalysis["observations"];
  keyFactors: DeliverableIntelligenceAnalysis["keyFactors"];
  forecastReliability: DeliverableIntelligenceAnalysis["reliability"];
  outcomePrediction: DeliverableIntelligenceAnalysis["predictedOutcome"];
  recommendations: DeliverableIntelligenceAnalysis["recommendations"];
  trust: DeliverableIntelligenceAnalysis["trust"];
  evidenceSummary: {
    sampleSize: number;
    matchedDeliverableCount: number;
    matchedProjectCount: number;
    classificationMatchRate: number | null;
  };
  citationChain: ExplanationCitation[];
};

/**
 * Builds the complete intelligence package for explanation.
 * Consumes the intelligence orchestrator only — no direct database access.
 */
export async function buildExplanationIntelligencePackage(args: {
  projectId: string;
  companyId: string;
  deliverableId: string;
  selectedProjectIds?: string[];
}): Promise<ExplanationIntelligencePackage> {
  const analysis = await getDeliverableIntelligenceAnalysis(args);
  const citations = buildExplanationCitations(analysis);

  const matchedDeliverables = analysis.evidence?.matchedDeliverables ?? [];
  const matchedProjects = analysis.evidence?.matchedProjects ?? [];

  return {
    deliverable: analysis.deliverable,
    currentDurationDays: analysis.currentDurationDays,
    benchmark: analysis.benchmark,
    outlier: analysis.outlier,
    evidence: analysis.evidence,
    observations: analysis.observations,
    keyFactors: analysis.keyFactors,
    forecastReliability: analysis.reliability,
    outcomePrediction: analysis.predictedOutcome,
    recommendations: analysis.recommendations,
    trust: analysis.trust,
    evidenceSummary: {
      sampleSize: analysis.benchmark?.sampleSize ?? analysis.evidence?.sampleSize ?? 0,
      matchedDeliverableCount: matchedDeliverables.length,
      matchedProjectCount: matchedProjects.length,
      classificationMatchRate: analysis.evidence?.classificationMatchRate ?? null,
    },
    citationChain: citations,
  };
}

export function buildContextSummary(pkg: ExplanationIntelligencePackage): ExplanationContextSummary {
  return {
    deliverableId: pkg.deliverable.id,
    deliverableName: pkg.deliverable.name,
    classification: pkg.deliverable.classification,
    currentDurationDays: pkg.currentDurationDays,
    outlierStatus: pkg.outlier?.status ?? null,
    benchmarkSampleSize: pkg.evidenceSummary.sampleSize,
    observationCount: pkg.observations.length,
    keyFactorCount: pkg.keyFactors.length,
    recommendationCount: pkg.recommendations.length,
    trustBand: pkg.trust?.trustBand ?? null,
    trustScore: pkg.trust?.trustScore ?? null,
    hasForecastReliability: pkg.forecastReliability != null,
    hasPredictedOutcome: pkg.outcomePrediction != null,
  };
}
