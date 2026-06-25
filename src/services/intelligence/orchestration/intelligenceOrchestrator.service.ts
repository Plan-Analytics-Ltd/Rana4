import { getDeliverableBenchmark, type BenchmarkReport } from "../benchmark/benchmark.service.js";
import { buildKeyFactorsFromReport, type DriverFinding } from "../drivers/driverAnalysis.service.js";
import { generateFindings, type IntelligenceFinding } from "../findings/findings.service.js";
import { buildTrustExplanation, type IntelligenceTrustExplanation } from "../trust/intelligenceTrust.service.js";
import {
  generateRecommendations,
  type IntelligenceRecommendation,
} from "../recommendations/recommendationEngine.service.js";

export type DeliverableIntelligenceContext = {
  report: BenchmarkReport;
  observations: IntelligenceFinding[];
  keyFactors: DriverFinding[];
  recommendations: IntelligenceRecommendation[];
  trust: IntelligenceTrustExplanation;
};

export type DeliverableIntelligenceAnalysis = {
  deliverable: BenchmarkReport["deliverable"];
  currentDurationDays: BenchmarkReport["currentDurationDays"];
  benchmark: BenchmarkReport["benchmark"];
  outlier: BenchmarkReport["outlier"];
  evidence: BenchmarkReport["evidence"];
  observations: IntelligenceFinding[];
  keyFactors: DriverFinding[];
  reliability: BenchmarkReport["benchmark"]["forecastReliability"];
  predictedOutcome: BenchmarkReport["benchmark"]["predictedOutcome"];
  recommendations: IntelligenceRecommendation[];
  trust: IntelligenceTrustExplanation;
};

/**
 * Run the full deliverable intelligence pipeline once and reuse the shared context
 * for observations, key factors, recommendations, and trust.
 */
export async function runDeliverableIntelligencePipeline(args: {
  projectId: string;
  companyId: string;
  deliverableId: string;
  selectedProjectIds?: string[];
  /** When provided, skips benchmark execution (for tests or nested orchestration). */
  benchmarkReport?: BenchmarkReport;
}): Promise<DeliverableIntelligenceContext> {
  const report = args.benchmarkReport ?? (await getDeliverableBenchmark(args));
  const observations = generateFindings(report);
  const keyFactors = await buildKeyFactorsFromReport(report, {
    companyId: args.companyId,
    projectId: args.projectId,
  });
  const recommendations = generateRecommendations(report, observations);
  const trust = buildTrustExplanation({
    classification: report.deliverable.classification,
    report,
    findingsCount: observations.length,
    driverCount: keyFactors.length,
    recommendations,
  });

  return {
    report,
    observations,
    keyFactors,
    recommendations,
    trust,
  };
}

/** Unified deliverable analysis: single benchmark execution, all intelligence layers. */
export async function getDeliverableIntelligenceAnalysis(args: {
  projectId: string;
  companyId: string;
  deliverableId: string;
  selectedProjectIds?: string[];
}): Promise<DeliverableIntelligenceAnalysis> {
  const ctx = await runDeliverableIntelligencePipeline(args);
  const { report } = ctx;

  return {
    deliverable: report.deliverable,
    currentDurationDays: report.currentDurationDays,
    benchmark: report.benchmark,
    outlier: report.outlier,
    evidence: report.evidence,
    observations: ctx.observations,
    keyFactors: ctx.keyFactors,
    reliability: report.benchmark.forecastReliability,
    predictedOutcome: report.benchmark.predictedOutcome,
    recommendations: ctx.recommendations,
    trust: ctx.trust,
  };
}
