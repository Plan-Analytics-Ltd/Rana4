/**
 * Prompt hygiene checks for LLM context sanitisation.
 * Run: npm run test:explanation-prompt-hygiene
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildExplanationPrompt } from "../../dist/services/explanation/prompt/explanationPrompt.builder.js";
import {
  buildLegacyJsonContextBlock,
  buildLlmBriefingContext,
  containsInternalIdentifiers,
  estimatePromptTokens,
  formatPlannerLabel,
} from "../../dist/services/explanation/prompt/explanationPromptSanitizer.js";

const samplePackage = {
  deliverable: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Design Review",
    classification: "DESIGN_REVIEW",
  },
  currentDurationDays: 45,
  benchmark: {
    averageDuration: 40,
    medianDuration: 38,
    minimumDuration: 20,
    maximumDuration: 60,
    sampleSize: 12,
    confidenceLevel: "MEDIUM",
    confidenceScore: 0.65,
    notes: ["Based on approved baseline programmes."],
    expectedDuration: null,
    forecastReliability: null,
    predictedOutcome: null,
  },
  outlier: {
    status: "SLIGHTLY_HIGH",
    currentDurationDays: 45,
    differenceFromAveragePercent: 12,
    differenceFromMedianPercent: 10,
    zScore: 1.1,
  },
  evidence: {
    sampleSize: 12,
    matchedDeliverables: [
      {
        projectId: "proj-uuid-1111",
        projectName: "Alpha Campus",
        deliverableId: "del-uuid-2222",
        deliverableName: "Design Review Gate 1",
        classification: "DESIGN_REVIEW",
        programmeState: "APPROVED_BASELINE",
        durationDays: 38,
        similarityScore: 82,
      },
    ],
    matchedProjects: [{ projectId: "proj-uuid", projectName: "Alpha Campus" }],
  },
  observations: [
    {
      findingType: "DURATION_HIGH",
      severity: "MEDIUM",
      confidence: "MEDIUM",
      title: "Above average",
      summary: "Duration is above historical average.",
      reasoning: ["Current duration exceeds the median."],
      evidence: [{ label: "Sample size", value: 12 }],
    },
  ],
  keyFactors: [
    {
      driverType: "COMPLEXITY",
      confidence: "MEDIUM",
      confidenceScore: 0.5,
      impactLevel: "HIGH",
      title: "Design complexity",
      summary: "High complexity is associated with longer durations.",
      reasoning: ["Complexity correlate observed in historical data."],
      evidence: [{ label: "Correlation", value: "0.62" }],
    },
  ],
  forecastReliability: {
    reliabilityLabel: "Moderately reliable",
    reliabilityBand: "MODERATE",
    overrunFrequency: 40,
    sampleSize: 8,
    confidenceLevel: "MEDIUM",
    confidenceScore: 0.5,
  },
  outcomePrediction: {
    rangeLabel: "35–55 days",
    predictedMinimumDuration: 35,
    predictedMostLikelyDuration: 42,
    predictedMaximumDuration: 55,
    predictionConfidenceLevel: "MEDIUM",
    predictionConfidenceScore: 0.55,
    evidenceCount: 12,
    reasoning: ["Based on historical evidence."],
  },
  recommendations: [
    {
      recommendationType: "DURATION_BUFFER",
      title: "Review duration",
      summary: "Consider a modest buffer.",
      recommendation: "Add contingency aligned with historical overrun frequency.",
      severity: "MEDIUM",
      confidenceLevel: "MEDIUM",
      confidenceScore: 0.55,
      evidenceCount: 12,
      supportingEvidence: [{ label: "Overrun frequency", value: "40%" }],
    },
  ],
  trust: {
    trustScore: 0.6,
    trustBand: "MODERATE_TRUST",
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
      sourceLayers: [{ layer: "Benchmark", status: "available", evidenceCount: 12, summary: "12 samples" }],
      recommendationCount: 1,
      recommendations: [],
    },
    whySeeingThis: ["Historical sample size is moderate."],
    supportingEvidence: [{ label: "Sample size", value: 12 }],
  },
  evidenceSummary: {
    sampleSize: 12,
    matchedDeliverableCount: 1,
    matchedProjectCount: 1,
    classificationMatchRate: 0.9,
  },
  citationChain: [{ id: "benchmark-1", layer: "BENCHMARK", label: "Benchmark", summary: "test" }],
};

test("formatPlannerLabel converts enums to readable text", () => {
  assert.equal(formatPlannerLabel("APPROVED_BASELINE"), "Approved Baseline");
  assert.equal(formatPlannerLabel("HIGH_CONFIDENCE"), "High Confidence");
});

test("buildLlmBriefingContext excludes UUIDs and internal IDs", () => {
  const briefing = buildLlmBriefingContext(samplePackage);
  assert.equal(containsInternalIdentifiers(briefing), false);
  assert.ok(briefing.includes("Design Review"));
  assert.ok(briefing.includes("Alpha Campus"));
  assert.ok(briefing.includes("Approved Baseline"));
  assert.ok(!briefing.includes("aaaaaaaa-aaaa"));
  assert.ok(!briefing.includes("proj-uuid"));
  assert.ok(!briefing.includes("findingType"));
});

test("buildExplanationPrompt uses briefing not JSON dumps", () => {
  const prompt = buildExplanationPrompt({
    systemPrompt: "system",
    explanationType: "BENCHMARK",
    question: "Why is this high?",
    intelligencePackage: samplePackage,
  });
  assert.equal(containsInternalIdentifiers(prompt.user), false);
  assert.ok(prompt.user.includes("Benchmark comparison"));
  assert.ok(!prompt.user.includes("BENCHMARK"));
  assert.ok(!prompt.user.includes('"deliverableId"'));
  assert.ok(prompt.user.includes("## Historical Benchmark"));
});

test("briefing is smaller than legacy JSON context", () => {
  const legacy = buildLegacyJsonContextBlock(samplePackage);
  const briefing = buildLlmBriefingContext(samplePackage);
  const legacyTokens = estimatePromptTokens(legacy);
  const briefingTokens = estimatePromptTokens(briefing);
  assert.ok(briefingTokens < legacyTokens);
  assert.ok(briefing.length < legacy.length);
});
