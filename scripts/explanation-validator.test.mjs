/**
 * Explanation validator unit checks (no database, no external APIs).
 * Run: npm run test:explanation-validator
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  NOT_READY_EXPLANATION_MESSAGE,
  shouldInvokeExplanationProvider,
  validateExplanationContext,
} from "../dist/services/explanation/explanationValidator.service.js";

function buildPackage(overrides = {}) {
  const base = {
    deliverable: { id: "d1", name: "Design Review", classification: "DESIGN_REVIEW" },
    currentDurationDays: 45,
    benchmark: {
      averageDuration: 40,
      medianDuration: 38,
      minimumDuration: 20,
      maximumDuration: 60,
      sampleSize: 12,
      confidenceLevel: "HIGH",
      confidenceScore: 0.85,
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
    keyFactors: [{ factor: "Complexity", impact: "HIGH", summary: "High complexity" }],
    forecastReliability: {
      reliabilityLabel: "Reliable",
      reliabilityBand: "HIGH",
      overrunFrequency: 20,
      sampleSize: 10,
      confidenceLevel: "HIGH",
      confidenceScore: 0.8,
    },
    outcomePrediction: {
      rangeLabel: "35–55 days",
      predictedMinimumDuration: 35,
      predictedMostLikelyDuration: 42,
      predictedMaximumDuration: 55,
      predictionConfidenceLevel: "HIGH",
      predictionConfidenceScore: 0.85,
      evidenceCount: 12,
      reasoning: ["Based on historical evidence."],
    },
    recommendations: [
      {
        id: "rec-1",
        type: "DURATION",
        priority: "MEDIUM",
        title: "Review duration",
        summary: "Consider reducing duration.",
        reasoning: [],
        evidence: [],
      },
    ],
    trust: {
      trustScore: 0.85,
      trustBand: "HIGH",
      trustLabel: "High trust",
      evidenceStrength: {
        strengthLabel: "Strong",
        sampleSize: 12,
        projectCount: 4,
        benchmarkConfidence: "HIGH",
        benchmarkConfidenceScore: 0.85,
        layersAvailable: ["benchmark"],
      },
      knowledgeCoverage: {
        coverageLabel: "Strong",
        coverageScore: 0.8,
        sampleSize: 12,
        projectCount: 4,
        learningMaturity: "MATURE",
        hasReliabilityEvidence: true,
        hasOutcomePrediction: true,
      },
      recommendationTraceability: {
        traceChain: [],
        sourceLayers: [],
        recommendationCount: 1,
        recommendations: [],
      },
      whySeeingThis: [],
      supportingEvidence: [{ label: "Sample size", value: 12 }],
    },
    evidenceSummary: {
      sampleSize: 12,
      matchedDeliverableCount: 8,
      matchedProjectCount: 4,
      classificationMatchRate: 0.9,
    },
    citationChain: [],
  };
  return { ...base, ...overrides };
}

test("READY when intelligence is sufficient for BENCHMARK", () => {
  const report = validateExplanationContext(buildPackage(), "BENCHMARK");
  assert.equal(report.readiness, "READY");
  assert.ok(report.score >= 0.85);
  assert.equal(report.failedChecks.length, 0);
  assert.ok(shouldInvokeExplanationProvider(report.readiness));
});

test("LIMITED when sample size is low but benchmark exists", () => {
  const pkg = buildPackage({
    benchmark: {
      averageDuration: 40,
      medianDuration: 38,
      minimumDuration: 20,
      maximumDuration: 60,
      sampleSize: 2,
      confidenceLevel: "MEDIUM",
      confidenceScore: 0.5,
      notes: [],
      expectedDuration: null,
      forecastReliability: null,
      predictedOutcome: null,
    },
    evidenceSummary: { sampleSize: 2, matchedDeliverableCount: 2, matchedProjectCount: 1, classificationMatchRate: 0.5 },
  });
  const report = validateExplanationContext(pkg, "BENCHMARK");
  assert.equal(report.readiness, "LIMITED");
  assert.ok(report.warningChecks.some((c) => c.id === "sample_size_sufficient"));
  assert.ok(shouldInvokeExplanationProvider(report.readiness));
});

test("NOT_READY when benchmark is missing", () => {
  const pkg = buildPackage({
    benchmark: null,
    evidenceSummary: { sampleSize: 0, matchedDeliverableCount: 0, matchedProjectCount: 0, classificationMatchRate: null },
  });
  const report = validateExplanationContext(pkg, "BENCHMARK");
  assert.equal(report.readiness, "NOT_READY");
  assert.ok(report.failedChecks.some((c) => c.id === "benchmark_available"));
  assert.equal(shouldInvokeExplanationProvider(report.readiness), false);
});

test("NOT_READY when prediction is missing for PREDICTED_OUTCOME", () => {
  const pkg = buildPackage({ outcomePrediction: null });
  const report = validateExplanationContext(pkg, "PREDICTED_OUTCOME");
  assert.equal(report.readiness, "NOT_READY");
  assert.ok(report.failedChecks.some((c) => c.id === "prediction_available"));
});

test("NOT_READY when recommendation is missing for RECOMMENDATION", () => {
  const pkg = buildPackage({ recommendations: [] });
  const report = validateExplanationContext(pkg, "RECOMMENDATION");
  assert.equal(report.readiness, "NOT_READY");
  assert.ok(report.failedChecks.some((c) => c.id === "recommendation_available"));
});

test("LIMITED when prediction confidence is low", () => {
  const pkg = buildPackage({
    outcomePrediction: {
      rangeLabel: "35–55 days",
      predictedMinimumDuration: 35,
      predictedMostLikelyDuration: 42,
      predictedMaximumDuration: 55,
      predictionConfidenceLevel: "LOW",
      predictionConfidenceScore: 0.3,
      evidenceCount: 12,
      reasoning: [],
    },
  });
  const report = validateExplanationContext(pkg, "PREDICTED_OUTCOME");
  assert.equal(report.readiness, "LIMITED");
  assert.ok(report.warningChecks.some((c) => c.id === "prediction_confidence"));
});

test("NOT_READY when sample size is zero", () => {
  const pkg = buildPackage({
    benchmark: null,
    observations: [],
    keyFactors: [],
    recommendations: [],
    trust: null,
    forecastReliability: null,
    outcomePrediction: null,
    evidenceSummary: { sampleSize: 0, matchedDeliverableCount: 0, matchedProjectCount: 0, classificationMatchRate: null },
  });
  const report = validateExplanationContext(pkg, "DELIVERABLE_SUMMARY");
  assert.equal(report.readiness, "NOT_READY");
  assert.ok(report.issues.length > 0);
});

test("provider bypass when NOT_READY", () => {
  const pkg = buildPackage({ benchmark: null, evidenceSummary: { sampleSize: 0, matchedDeliverableCount: 0, matchedProjectCount: 0, classificationMatchRate: null } });
  const report = validateExplanationContext(pkg, "BENCHMARK");
  assert.equal(report.readiness, "NOT_READY");
  assert.equal(shouldInvokeExplanationProvider(report.readiness), false);
  assert.equal(
    NOT_READY_EXPLANATION_MESSAGE,
    "Rana4 does not currently have enough historical evidence to generate a reliable explanation for this deliverable."
  );
});
