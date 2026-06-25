import type { DeliverableIntelligenceAnalysis } from "../intelligence/intelligenceOrchestrator.service.js";
import type { ExplanationCitation, ExplanationSource } from "./explanationTypes.js";

let citationCounter = 0;

function nextCitationId(layer: string): string {
  citationCounter += 1;
  return `${layer.toLowerCase()}-${citationCounter}`;
}

/** Reset counter between requests (test isolation). */
export function resetCitationCounter(): void {
  citationCounter = 0;
}

/**
 * Citation chain: Historical Evidence → Benchmark → Reliability → Outcome → Recommendations → Trust
 * Traceable back to intelligence engine outputs only.
 */
export function buildExplanationCitations(
  analysis: DeliverableIntelligenceAnalysis
): ExplanationCitation[] {
  resetCitationCounter();
  const citations: ExplanationCitation[] = [];

  const sampleSize = analysis.benchmark?.sampleSize ?? analysis.evidence?.sampleSize ?? 0;
  if (sampleSize > 0 || (analysis.evidence?.matchedDeliverables?.length ?? 0) > 0) {
    citations.push({
      id: nextCitationId("evidence"),
      layer: "HISTORICAL_EVIDENCE",
      label: "Historical evidence",
      summary: `${sampleSize} comparable deliverable observation(s) across ${analysis.evidence?.matchedProjects?.length ?? 0} project(s).`,
      evidenceCount: sampleSize,
    });
  }

  if (analysis.benchmark) {
    citations.push({
      id: nextCitationId("benchmark"),
      layer: "BENCHMARK",
      label: "Benchmark comparison",
      summary: `Average ${analysis.benchmark.averageDuration ?? "—"} days, median ${analysis.benchmark.medianDuration ?? "—"} days (${sampleSize} samples).`,
      evidenceCount: sampleSize,
      confidenceLevel: analysis.benchmark.confidenceLevel ?? null,
      confidenceScore: analysis.benchmark.confidenceScore ?? null,
    });
  }

  if (analysis.reliability) {
    citations.push({
      id: nextCitationId("reliability"),
      layer: "FORECAST_RELIABILITY",
      label: analysis.reliability.reliabilityLabel ?? "Forecast reliability",
      summary: `Overrun frequency ${analysis.reliability.overrunFrequency ?? 0}% with ${analysis.reliability.sampleSize ?? 0} planned-vs-actual samples.`,
      evidenceCount: analysis.reliability.sampleSize ?? null,
      confidenceLevel: analysis.reliability.confidenceLevel ?? null,
      confidenceScore: analysis.reliability.confidenceScore ?? null,
    });
  }

  if (analysis.predictedOutcome) {
    citations.push({
      id: nextCitationId("outcome"),
      layer: "OUTCOME_PREDICTION",
      label: "Outcome prediction",
      summary: analysis.predictedOutcome.rangeLabel ?? "Predicted outcome range available.",
      evidenceCount: analysis.predictedOutcome.evidenceCount ?? null,
      confidenceLevel: analysis.predictedOutcome.predictionConfidenceLevel ?? null,
      confidenceScore: analysis.predictedOutcome.predictionConfidenceScore ?? null,
    });
  }

  for (const obs of analysis.observations) {
    citations.push({
      id: nextCitationId("obs"),
      layer: "OBSERVATION",
      label: obs.title,
      summary: obs.summary,
      confidenceLevel: obs.confidence,
      relatedIds: [obs.findingType],
    });
  }

  for (const driver of analysis.keyFactors) {
    citations.push({
      id: nextCitationId("factor"),
      layer: "KEY_FACTOR",
      label: driver.title,
      summary: driver.summary,
      confidenceLevel: driver.confidence,
      confidenceScore: driver.confidenceScore,
    });
  }

  for (const rec of analysis.recommendations) {
    citations.push({
      id: nextCitationId("rec"),
      layer: "RECOMMENDATION",
      label: rec.title,
      summary: rec.summary,
      evidenceCount: rec.evidenceCount,
      confidenceLevel: rec.confidenceLevel,
      confidenceScore: rec.confidenceScore,
      relatedIds: [rec.recommendationType],
    });
  }

  if (analysis.trust) {
    citations.push({
      id: nextCitationId("trust"),
      layer: "TRUST",
      label: analysis.trust.trustLabel ?? "Trust assessment",
      summary: `Trust band ${analysis.trust.trustBand} (score ${analysis.trust.trustScore}).`,
      confidenceScore: analysis.trust.trustScore,
    });
  }

  return citations;
}

export function buildExplanationSources(citations: ExplanationCitation[]): ExplanationSource[] {
  return citations.map((c) => ({
    layer: c.layer,
    reference: c.id,
    detail: c.label,
  }));
}

export function flattenSupportingEvidence(
  analysis: DeliverableIntelligenceAnalysis
): { label: string; value: string | number }[] {
  const items: { label: string; value: string | number }[] = [];

  if (analysis.trust?.supportingEvidence) {
    items.push(...analysis.trust.supportingEvidence);
  }
  for (const rec of analysis.recommendations) {
    items.push(...rec.supportingEvidence.map((e) => ({ ...e, label: `Recommendation: ${e.label}` })));
  }
  for (const driver of analysis.keyFactors) {
    items.push(...driver.evidence.map((e) => ({ ...e, label: `Key factor: ${e.label}` })));
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.label}:${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
