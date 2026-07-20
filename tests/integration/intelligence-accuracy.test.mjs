import test from "node:test";
import assert from "node:assert/strict";
import { resolveCurrentDeliverableDuration } from "../../dist/services/intelligence/shared/durationSource.service.js";
import {
  classifyDurationPosition,
  computeOutlier,
  plannerPositionLabel,
  positionToLegacyStatus,
} from "../../dist/services/intelligence/shared/outlier.service.js";
import {
  computeRobustBenchmarkStats,
  detectIqrOutliers,
  percentileRank,
} from "../../dist/services/intelligence/shared/robustStatistics.service.js";
import { percentile } from "../../dist/services/intelligence/shared/durationEvidence.service.js";
import { checkIntelligenceConsistency } from "../../dist/services/intelligence/shared/intelligenceConsistency.service.js";
import { generateFindings } from "../../dist/services/intelligence/findings/findings.service.js";
import { prisma } from "../../dist/utils/prisma.js";

test.after(async () => {
  await prisma.$disconnect();
});

test("resolveCurrentDeliverableDuration prefers likelyDuration over activity span", async () => {
  const result = await resolveCurrentDeliverableDuration({
    projectId: "nonexistent",
    companyId: "nonexistent",
    deliverableId: "nonexistent",
  });
  assert.equal(result.durationDays, null);
  assert.equal(result.source, "LIKELY_DURATION");
});

test("classifyDurationPosition uses percentile bands", () => {
  assert.equal(classifyDurationPosition(5, null), "WELL_BELOW");
  assert.equal(classifyDurationPosition(20, null), "SLIGHTLY_BELOW");
  assert.equal(classifyDurationPosition(50, null), "TYPICAL");
  assert.equal(classifyDurationPosition(80, null), "SLIGHTLY_ABOVE");
  assert.equal(classifyDurationPosition(95, null), "WELL_ABOVE");
});

test("computeOutlier produces bidirectional position — no NORMAL when well below", () => {
  const result = computeOutlier({
    currentDurationDays: 1,
    medianDurationDays: 17,
    historicalDurations: [0, 5, 10, 15, 17, 20, 25, 30, 270, 486],
  });
  assert.equal(result.position, "WELL_BELOW");
  assert.equal(result.status, "WELL_BELOW");
  assert.notEqual(result.positionLabel, "Within normal range");
  assert.ok(result.percentilePosition != null && result.percentilePosition < 25);
});

test("computeOutlier high duration maps above benchmark", () => {
  const sorted = [5, 10, 15, 17, 20, 25, 30];
  const result = computeOutlier({
    currentDurationDays: 50,
    medianDurationDays: 17,
    historicalDurations: sorted,
  });
  assert.ok(result.position === "WELL_ABOVE" || result.position === "SLIGHTLY_ABOVE");
  assert.notEqual(result.position, "TYPICAL");
  assert.notEqual(result.status, "NORMAL");
});

test("robust statistics prefer median and detect outliers without removal", () => {
  const stats = computeRobustBenchmarkStats([5, 10, 15, 17, 20, 25, 30, 270, 486]);
  assert.equal(stats.primaryReference, "median");
  assert.equal(stats.medianDuration, 20);
  assert.ok(stats.historicalOutliers.count >= 2);
  assert.ok(stats.statisticsNote?.includes("median"));
  assert.ok(stats.percentile25 != null && stats.percentile75 != null);
});

test("findings align with outlier position — no below finding when typical", () => {
  const report = {
    deliverable: { id: "d1", name: "Test", classification: "OTHER" },
    currentDurationDays: 17,
    currentDurationSource: {
      source: "LIKELY_DURATION",
      sourceTable: "deliverables",
      sourceFields: ["likelyDuration"],
      definition: "test",
    },
    benchmark: {
      sampleSize: 10,
      medianDuration: 17,
      percentile25: 10,
      percentile75: 25,
      minimumDuration: 5,
      maximumDuration: 30,
      averageDuration: 17,
      confidenceLevel: "MEDIUM",
      confidenceScore: 0.6,
      allSampleDurations: [5, 10, 15, 17, 20, 25, 30],
      historicalOutlierCount: 0,
      historicalOutlierValues: [],
      benchmarkQuality: { distinctProjects: 2, distinctSnapshots: 10, revisionRatio: 5, sampleSize: 10 },
    },
    outlier: computeOutlier({
      currentDurationDays: 17,
      medianDurationDays: 17,
      historicalDurations: [5, 10, 15, 17, 20, 25, 30],
    }),
    evidence: { sampleSize: 10, matchedDeliverables: [], matchedProjects: [], projectBreakdown: {} },
  };
  const findings = generateFindings(report);
  assert.equal(findings.some((f) => f.findingType === "DURATION_TOO_LOW"), false);
  assert.equal(findings.some((f) => f.findingType === "DURATION_TOO_HIGH"), false);
});

test("findings emit DURATION_TOO_LOW when position is below", () => {
  const outlier = computeOutlier({
    currentDurationDays: 1,
    medianDurationDays: 17,
    historicalDurations: [5, 10, 15, 17, 20, 25, 30],
  });
  const report = {
    deliverable: { id: "d1", name: "Test", classification: "OTHER" },
    currentDurationDays: 1,
    benchmark: {
      sampleSize: 7,
      medianDuration: 17,
      percentile25: 10,
      percentile75: 25,
      minimumDuration: 5,
      maximumDuration: 30,
      averageDuration: 17,
      confidenceLevel: "MEDIUM",
      allSampleDurations: [5, 10, 15, 17, 20, 25, 30],
      historicalOutlierCount: 0,
      historicalOutlierValues: [],
    },
    outlier,
    evidence: { sampleSize: 7 },
  };
  const findings = generateFindings(report);
  const low = findings.find((f) => f.findingType === "DURATION_TOO_LOW");
  assert.ok(low);
  assert.ok(low.title.toLowerCase().includes("below"));
  assert.ok(!low.summary.toLowerCase().includes("within normal"));
});

test("consistency check flags position vs finding mismatch", () => {
  const report = {
    benchmark: { sampleSize: 5 },
    outlier: {
      position: "TYPICAL",
      status: "NORMAL",
      currentDurationDays: 17,
    },
  };
  const findings = [
    {
      findingType: "DURATION_TOO_LOW",
      severity: "MEDIUM",
      confidence: "MEDIUM",
      title: "Below",
      summary: "",
      reasoning: [],
      evidence: [],
    },
  ];
  const result = checkIntelligenceConsistency({
    report,
    findings,
    recommendations: [],
  });
  assert.equal(result.consistent, false);
  assert.ok(result.warnings.some((w) => w.code === "POSITION_VS_FINDING"));
});

test("percentileRank and IQR outlier detection", () => {
  const sorted = [5, 10, 15, 17, 20, 25, 30, 270, 486];
  assert.equal(percentileRank(sorted, 1), 0);
  assert.ok(percentileRank(sorted, 17) != null && percentileRank(sorted, 17) > 30);
  const outliers = detectIqrOutliers(sorted);
  assert.ok(outliers.count >= 1);
  assert.ok(outliers.values.includes(270) || outliers.values.includes(486));
});

test("positionToLegacyStatus maps low positions", () => {
  assert.equal(positionToLegacyStatus("WELL_BELOW", -80), "WELL_BELOW");
  assert.equal(positionToLegacyStatus("SLIGHTLY_BELOW", -30), "SLIGHTLY_LOW");
  assert.equal(positionToLegacyStatus("TYPICAL", 0), "NORMAL");
});

test("capPositionForSampleSize mirrors status capping for limited evidence", async () => {
  const { capPositionForSampleSize } = await import(
    "../../dist/services/intelligence/shared/outlier.service.js"
  );
  assert.equal(capPositionForSampleSize(1, "WELL_BELOW"), "SLIGHTLY_BELOW");
  assert.equal(capPositionForSampleSize(2, "WELL_ABOVE"), "SLIGHTLY_ABOVE");
  assert.equal(capPositionForSampleSize(10, "WELL_BELOW"), "WELL_BELOW");
});

test("plannerPositionLabel avoids statistical jargon", () => {
  const label = plannerPositionLabel("WELL_BELOW");
  assert.ok(!label.includes("%"));
  assert.ok(label.toLowerCase().includes("below"));
});

// --- Phase 9.1 edge-case coverage ---

test("percentile interpolation — odd and even sample sizes", () => {
  const odd = [1, 2, 3, 4, 5];
  assert.equal(percentile(odd, 0.5), 3);
  assert.equal(percentile(odd, 0.25), 2);
  const even = [2, 4, 6, 8];
  assert.equal(percentile(even, 0.5), 5);
  assert.equal(percentile(even, 0.25), 3.5);
});

test("percentileRank handles ties and boundaries deterministically", () => {
  const sorted = [10, 10, 20, 20, 30];
  assert.equal(percentileRank(sorted, 5), 0);
  assert.equal(percentileRank(sorted, 10), 20);
  assert.equal(percentileRank(sorted, 20), 60);
  assert.equal(percentileRank(sorted, 40), 100);
});

test("IQR fences — Tukey convention with documented bounds", () => {
  const sorted = [5, 10, 15, 17, 20, 25, 30, 270, 486];
  const o = detectIqrOutliers(sorted);
  assert.equal(o.lowerBound, -7.5);
  assert.equal(o.upperBound, 52.5);
  assert.deepEqual(o.values, [270, 486]);
});

test("IQR returns no outliers when sample too small or IQR is zero", () => {
  assert.equal(detectIqrOutliers([1, 2, 3]).count, 0);
  assert.equal(detectIqrOutliers([5, 5, 5, 5]).count, 0);
});

test("robust stats — identical durations", () => {
  const stats = computeRobustBenchmarkStats([7, 7, 7, 7]);
  assert.equal(stats.medianDuration, 7);
  assert.equal(stats.historicalOutliers.count, 0);
  assert.equal(stats.primaryReference, "median");
});

test("robust stats — single and two-value samples", () => {
  const one = computeRobustBenchmarkStats([12]);
  assert.equal(one.medianDuration, 12);
  assert.equal(one.historicalOutliers.count, 0);
  const two = computeRobustBenchmarkStats([8, 16]);
  assert.equal(two.medianDuration, 12);
});

test("robust stats — extreme outlier retained in sample size", () => {
  const stats = computeRobustBenchmarkStats([10, 12, 14, 16, 500]);
  assert.equal(stats.sampleSize, 5);
  assert.equal(stats.medianDuration, 14);
  assert.ok(stats.historicalOutliers.count >= 1);
  assert.ok(stats.historicalOutliers.values.includes(500));
});

test("computeOutlier — zero-duration milestone classified by percentile", () => {
  const result = computeOutlier({
    currentDurationDays: 0,
    medianDurationDays: 17,
    historicalDurations: [5, 10, 15, 17, 20, 25, 30],
  });
  assert.equal(result.position, "WELL_BELOW");
  assert.equal(result.percentilePosition, 0);
});

test("classifyDurationPosition — boundary values are stable", () => {
  assert.equal(classifyDurationPosition(10, null), "WELL_BELOW");
  assert.equal(classifyDurationPosition(10.1, null), "SLIGHTLY_BELOW");
  assert.equal(classifyDurationPosition(25, null), "SLIGHTLY_BELOW");
  assert.equal(classifyDurationPosition(25.1, null), "TYPICAL");
  assert.equal(classifyDurationPosition(74.9, null), "TYPICAL");
  assert.equal(classifyDurationPosition(75, null), "SLIGHTLY_ABOVE");
  assert.equal(classifyDurationPosition(90, null), "WELL_ABOVE");
});

test("computeOutlier rejects negative current duration", () => {
  const result = computeOutlier({
    currentDurationDays: -5,
    medianDurationDays: 10,
    historicalDurations: [5, 10, 15],
  });
  assert.equal(result.position, "TYPICAL");
  assert.equal(result.currentDurationDays, null);
});
