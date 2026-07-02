import test from "node:test";
import assert from "node:assert/strict";
import { buildDeliverableFingerprint } from "../../dist/services/intelligence/matching/deliverableFingerprint.service.js";
import { computeWeightedDeliverableSimilarity } from "../../dist/services/intelligence/matching/weightedDeliverableSimilarity.service.js";
import { deduplicateBenchmarkSamples } from "../../dist/services/intelligence/matching/revisionGrouping.service.js";
import { selectBenchmarkEvidence } from "../../dist/services/intelligence/matching/evidenceSelection.service.js";
import { computeDeliverableEvolution } from "../../dist/services/intelligence/matching/deliverableEvolution.service.js";
import { DEFAULT_MIN_COMPARABLE_SIMILARITY } from "../../dist/services/intelligence/matching/similarityWeights.config.js";

test("weighted similarity ranks identical deliverables highly", () => {
  const base = buildDeliverableFingerprint({
    deliverableName: "Ground Investigation",
    classification: "OTHER",
    fragnetId: "frag-1",
    stage: "Construction",
    activities: [
      { activityCode: "A100", originalDuration: 20, isCritical: true },
      { activityCode: "A110", originalDuration: 15, isCritical: false },
    ],
  });
  const match = buildDeliverableFingerprint({
    deliverableName: "Ground Investigation",
    classification: "OTHER",
    fragnetId: "frag-1",
    stage: "Construction",
    activities: [
      { activityCode: "A100", originalDuration: 22, isCritical: true },
      { activityCode: "A110", originalDuration: 14, isCritical: false },
    ],
  });
  const unrelated = buildDeliverableFingerprint({
    deliverableName: "Reinforcement Detailing",
    classification: "OTHER",
    fragnetId: "frag-9",
    activities: [{ activityCode: "Z900", originalDuration: 20, isCritical: false }],
  });

  const strong = computeWeightedDeliverableSimilarity(base, match);
  const weak = computeWeightedDeliverableSimilarity(base, unrelated);

  assert.ok(strong.overallScore >= DEFAULT_MIN_COMPARABLE_SIMILARITY);
  assert.ok(weak.overallScore < strong.overallScore);
  assert.ok(weak.overallScore < DEFAULT_MIN_COMPARABLE_SIMILARITY);
});

test("revision deduplication keeps best programme state per deliverable", () => {
  const deduped = deduplicateBenchmarkSamples([
    {
      snapshotId: "s1",
      snapshotVersion: 1,
      snapshotRole: "BASELINE",
      programmeState: "APPROVED_BASELINE",
      projectId: "p1",
      deliverableId: "d1",
      deliverableName: "Design",
      importedAt: new Date("2024-01-01"),
      durationDays: 30,
      fingerprintKey: "design|design|",
    },
    {
      snapshotId: "s2",
      snapshotVersion: 2,
      snapshotRole: "AS_BUILT",
      programmeState: "AS_BUILT",
      projectId: "p1",
      deliverableId: "d1",
      deliverableName: "Design",
      importedAt: new Date("2024-06-01"),
      durationDays: 25,
      fingerprintKey: "design|design|",
    },
  ]);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.programmeState, "AS_BUILT");
  assert.equal(deduped[0]?.durationDays, 25);
});

test("evidence selection excludes low similarity matches", () => {
  const result = selectBenchmarkEvidence([
    {
      snapshotId: "s1",
      projectId: "p1",
      projectName: "Hospital A",
      deliverableId: "d1",
      deliverableName: "Ground Investigation",
      classification: "OTHER",
      programmeState: "AS_BUILT",
      durationDays: 20,
      similarityScore: 95,
      evidenceWeight: 1,
      fingerprintKey: "a",
    },
    {
      snapshotId: "s2",
      projectId: "p1",
      projectName: "Hospital A",
      deliverableId: "d2",
      deliverableName: "Reinforcement",
      classification: "OTHER",
      programmeState: "AS_BUILT",
      durationDays: 18,
      similarityScore: 41,
      evidenceWeight: 0.4,
      fingerprintKey: "b",
    },
  ]);

  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0]?.deliverableName, "Ground Investigation");
  assert.equal(result.excludedLowSimilarity, 1);
});

test("deliverable evolution detects growing trend", () => {
  const evolution = computeDeliverableEvolution([
    {
      snapshotId: "s1",
      snapshotVersion: 1,
      snapshotRole: "BASELINE",
      programmeState: "APPROVED_BASELINE",
      projectId: "p1",
      deliverableId: "d1",
      deliverableName: "Concrete",
      importedAt: new Date("2024-01-01"),
      durationDays: 20,
      fingerprintKey: "c",
    },
    {
      snapshotId: "s2",
      snapshotVersion: 2,
      snapshotRole: "LIVE_IMPORT",
      programmeState: "LIVE_UPDATE",
      projectId: "p1",
      deliverableId: "d1",
      deliverableName: "Concrete",
      importedAt: new Date("2024-03-01"),
      durationDays: 35,
      fingerprintKey: "c",
    },
    {
      snapshotId: "s3",
      snapshotVersion: 3,
      snapshotRole: "AS_BUILT",
      programmeState: "AS_BUILT",
      projectId: "p1",
      deliverableId: "d1",
      deliverableName: "Concrete",
      importedAt: new Date("2024-06-01"),
      durationDays: 28,
      fingerprintKey: "c",
    },
  ]);

  assert.equal(evolution.trend, "GROWING");
  assert.ok((evolution.growthPercent ?? 0) > 0);
});
