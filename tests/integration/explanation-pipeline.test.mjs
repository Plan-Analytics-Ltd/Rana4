/**
 * Explanation pipeline unit checks (no database, no external APIs).
 * Run: npm run build && node --test scripts/explanation-pipeline.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildExplanationPrompt, DEFAULT_SYSTEM_PROMPT } from "../../dist/services/explanation/prompt/explanationPrompt.builder.js";
import { buildExplanationCitations, resetCitationCounter } from "../../dist/services/explanation/citations/explanationCitations.js";
import { parseExplanationType } from "../../dist/services/explanation/types/explanationTypes.js";
import { mockLlmProvider } from "../../dist/services/explanation/providers/mockLlmProvider.js";

const sampleAnalysis = {
  deliverable: { id: "d1", name: "Design Review", classification: "DESIGN_REVIEW" },
  currentDurationDays: 45,
  benchmark: {
    averageDuration: 40,
    medianDuration: 38,
    minimumDuration: 20,
    maximumDuration: 60,
    sampleSize: 12,
    confidenceLevel: "MEDIUM",
    confidenceScore: 0.65,
    notes: [],
    expectedDuration: null,
    forecastReliability: null,
    predictedOutcome: null,
  },
  outlier: { status: "SLIGHTLY_HIGH", currentDurationDays: 45, differenceFromAveragePercent: 12 },
  evidence: { sampleSize: 12, matchedDeliverables: [], matchedProjects: [] },
  observations: [
    {
      findingType: "DURATION_HIGH",
      severity: "MEDIUM",
      confidence: "MEDIUM",
      title: "Above average",
      summary: "Duration is above historical average.",
      reasoning: [],
      evidence: [],
    },
  ],
  keyFactors: [],
  reliability: {
    reliabilityLabel: "Moderately reliable",
    reliabilityBand: "MODERATE",
    overrunFrequency: 40,
    sampleSize: 8,
    confidenceLevel: "MEDIUM",
    confidenceScore: 0.5,
  },
  predictedOutcome: {
    rangeLabel: "35–55 days",
    predictedMinimumDuration: 35,
    predictedMostLikelyDuration: 42,
    predictedMaximumDuration: 55,
    predictionConfidenceLevel: "MEDIUM",
    predictionConfidenceScore: 0.55,
    evidenceCount: 12,
    reasoning: ["Based on historical evidence."],
  },
  recommendations: [],
  trust: {
    trustScore: 0.6,
    trustBand: "MODERATE",
    trustLabel: "Moderate trust",
    evidenceStrength: {
      strengthLabel: "Moderate",
      sampleSize: 12,
      projectCount: 4,
      benchmarkConfidence: "MEDIUM",
      benchmarkConfidenceScore: 0.65,
      layersAvailable: ["benchmark"],
    },
    knowledgeCoverage: {
      coverageLabel: "Moderate",
      coverageScore: 0.5,
      sampleSize: 12,
      projectCount: 4,
      learningMaturity: "MODERATE",
      hasReliabilityEvidence: true,
      hasOutcomePrediction: true,
    },
    recommendationTraceability: {
      traceChain: [],
      sourceLayers: [],
      recommendationCount: 0,
      recommendations: [],
    },
    whySeeingThis: [],
    supportingEvidence: [{ label: "Sample size", value: 12 }],
  },
};

test("parseExplanationType accepts known types", () => {
  assert.equal(parseExplanationType("benchmark"), "BENCHMARK");
  assert.equal(parseExplanationType("deliverable-summary"), "DELIVERABLE_SUMMARY");
  assert.equal(parseExplanationType("invalid"), null);
});

test("buildExplanationCitations traces intelligence layers", () => {
  resetCitationCounter();
  const citations = buildExplanationCitations(sampleAnalysis);
  const layers = citations.map((c) => c.layer);
  assert.ok(layers.includes("BENCHMARK"));
  assert.ok(layers.includes("HISTORICAL_EVIDENCE"));
  assert.ok(layers.includes("TRUST"));
});

test("buildExplanationPrompt includes validation warnings when LIMITED", () => {
  const pkg = {
    deliverable: sampleAnalysis.deliverable,
    currentDurationDays: sampleAnalysis.currentDurationDays,
    benchmark: sampleAnalysis.benchmark,
    outlier: sampleAnalysis.outlier,
    evidence: sampleAnalysis.evidence,
    observations: sampleAnalysis.observations,
    keyFactors: sampleAnalysis.keyFactors,
    forecastReliability: sampleAnalysis.reliability,
    outcomePrediction: sampleAnalysis.predictedOutcome,
    recommendations: sampleAnalysis.recommendations,
    trust: sampleAnalysis.trust,
    evidenceSummary: { sampleSize: 12, matchedDeliverableCount: 0, matchedProjectCount: 0, classificationMatchRate: null },
    citationChain: [],
  };
  const prompt = buildExplanationPrompt({
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    explanationType: "BENCHMARK",
    question: null,
    intelligencePackage: pkg,
    validationWarnings: ["Historical sample size is low.", "Prediction confidence is medium."],
  });
  assert.ok(prompt.user.includes("Validation warnings"));
  assert.ok(prompt.user.includes("Historical sample size is low."));
});

test("buildExplanationPrompt is provider-independent", () => {
  const pkg = {
    deliverable: sampleAnalysis.deliverable,
    currentDurationDays: sampleAnalysis.currentDurationDays,
    benchmark: sampleAnalysis.benchmark,
    outlier: sampleAnalysis.outlier,
    evidence: sampleAnalysis.evidence,
    observations: sampleAnalysis.observations,
    keyFactors: sampleAnalysis.keyFactors,
    forecastReliability: sampleAnalysis.reliability,
    outcomePrediction: sampleAnalysis.predictedOutcome,
    recommendations: sampleAnalysis.recommendations,
    trust: sampleAnalysis.trust,
    evidenceSummary: { sampleSize: 12, matchedDeliverableCount: 0, matchedProjectCount: 0, classificationMatchRate: null },
    citationChain: [],
  };
  const prompt = buildExplanationPrompt({
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    explanationType: "BENCHMARK",
    question: "Why is this high?",
    intelligencePackage: pkg,
  });
  assert.ok(prompt.system.includes("do not invent facts"));
  assert.ok(prompt.user.includes("Benchmark comparison"));
  assert.ok(prompt.user.includes("Design Review"));
});

test("mock provider returns not_configured without external API", async () => {
  const result = await mockLlmProvider.complete({
    system: "test",
    user: "test",
    model: "mock",
    temperature: 0,
    maxTokens: 100,
  });
  assert.equal(result.status, "not_configured");
  assert.ok(result.text?.includes("unavailable"));
});
