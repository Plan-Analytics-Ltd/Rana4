import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEngineeringBrainSummary,
  computeEngineeringBrainDiagnostics,
} from "../../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";
import { mapDiagnosticsReportToBrainExportV2 } from "../../dist/services/intelligence/diagnostics/engineeringBrainExportMapper.service.js";
import { validateBrainUiParity } from "../../dist/services/intelligence/diagnostics/engineeringBrainParity.service.js";

function fixtureReport() {
  const inboxItem = {
    fingerprint: "fp-inbox",
    concept: "Fire Technical Note",
    state: "NEEDS_REVIEW",
    reasons: ["UNKNOWN_ENGINEERING_OBJECT"],
    reasonDetails: [{ reason: "UNKNOWN_ENGINEERING_OBJECT", detail: "No match" }],
    exampleDeliverableName: "Fire Technical Note",
    projectName: "Alpha",
    identity: {
      discipline: "fire",
      engineeringObject: null,
      engineeringWork: "design",
      deliverableType: "note",
      lifecycleStage: "design",
    },
    identityView: {
      status: "RESOLVED",
      overallConfidence: 72,
      discipline: { id: "fire", label: "Fire", confidence: 90, evidence: [] },
      engineeringObject: { id: null, label: null, confidence: 0, evidence: [] },
      engineeringWork: { id: "design", label: "Design", confidence: 80, evidence: [] },
      deliverableType: { id: "note", label: "Note", confidence: 75, evidence: [] },
      lifecycleStage: { id: "design", label: "Design", confidence: 70, evidence: [] },
      projectContext: { id: null, label: null, confidence: 0, evidence: [] },
      fragnetContext: { id: null, label: null, confidence: 0, evidence: [] },
    },
    context: {
      projectName: "Alpha",
      fragnetName: "Fire",
      parentWbs: null,
      wbsPath: null,
      deliverableName: "Fire Technical Note",
      neighbouringDeliverables: [],
      relatedActivities: [],
      disciplineMetadata: null,
      classificationTags: [],
      lifecycleStage: "design",
    },
    historicalMatches: [],
    why: [],
    impact: { futureComparisons: 1, historicalDurationMatches: 0, historicalMatchCount: 0 },
    examples: [],
    evidence: [],
    occurrences: 2,
    projects: 1,
    confidence: 55,
  };

  const trustedAuto = {
    fingerprint: "fp-auto",
    concept: "Reinforcement",
    status: "AUTO_APPROVED",
    identity: {
      discipline: "structures",
      engineeringObject: "reinforcement",
      engineeringWork: "detailing",
      deliverableType: "drawing",
      lifecycleStage: "design",
    },
    identityView: inboxItem.identityView,
    context: inboxItem.context,
    aliases: [],
    evidence: [],
    examples: [],
    historicalMatches: [],
    firstObserved: "2026-01-01T00:00:00.000Z",
    lastObserved: "2026-06-01T00:00:00.000Z",
    projectCount: 3,
    successfulComparisons: 1,
    versionHistory: [],
    versionHistoryCount: 0,
    lastModificationReason: null,
  };

  const trustedDev = {
    ...trustedAuto,
    fingerprint: "fp-dev-approved",
    concept: "Cofferdam",
    status: "DEVELOPER_APPROVED",
  };

  const trustedModified = {
    ...trustedAuto,
    fingerprint: "fp-dev-modified",
    concept: "Piling",
    status: "DEVELOPER_MODIFIED",
  };

  const rejected = {
    ...trustedAuto,
    fingerprint: "fp-rejected",
    concept: "Bad Identity",
    status: "REJECTED",
  };

  const collections = {
    needsReview: [inboxItem],
    autoApproved: [trustedAuto],
    developerApproved: [trustedDev],
    developerModified: [trustedModified],
    rejected: [rejected],
  };

  const summary = buildEngineeringBrainSummary(collections);

  return {
    generatedAt: new Date().toISOString(),
    collections,
    summary,
    brainInbox: collections.needsReview,
    trustedKnowledge: [trustedAuto, trustedDev, trustedModified],
  };
}

test("Test 1 — export total equals UI totalVisible", () => {
  const report = fixtureReport();
  const exportBrain = mapDiagnosticsReportToBrainExportV2(report);
  assert.equal(exportBrain.summary.total, report.summary.totalVisible);
  assert.equal(exportBrain.ui.totalVisible, report.summary.totalVisible);
});

test("Test 2 — every UI fingerprint appears exactly once in visible export", () => {
  const report = fixtureReport();
  const exportBrain = mapDiagnosticsReportToBrainExportV2(report);
  const uiFingerprints = new Set([
    ...report.collections.needsReview.map((e) => e.fingerprint),
    ...report.collections.autoApproved.map((e) => e.fingerprint),
    ...report.collections.developerApproved.map((e) => e.fingerprint),
    ...report.collections.developerModified.map((e) => e.fingerprint),
  ]);
  const exportVisible = new Set([
    ...exportBrain.needsReview.map((e) => e.fingerprint),
    ...exportBrain.autoApproved.map((e) => e.fingerprint),
    ...exportBrain.trustedKnowledge.map((e) => e.fingerprint),
    ...exportBrain.developerModified.map((e) => e.fingerprint),
  ]);
  assert.deepEqual(exportVisible, uiFingerprints);
});

test("Test 3 — bucket counts match canonical summary", () => {
  const report = fixtureReport();
  const exportBrain = mapDiagnosticsReportToBrainExportV2(report);
  assert.equal(exportBrain.summary.needsReview, report.summary.brainInbox);
  assert.equal(exportBrain.summary.autoApproved, report.summary.autoApproved);
  assert.equal(exportBrain.summary.trustedKnowledge, report.summary.developerApproved);
  assert.equal(exportBrain.summary.developerModified, report.summary.developerModified);
  assert.equal(exportBrain.summary.rejected, report.summary.rejected);
  assert.equal(exportBrain.ui.brainInbox, report.summary.brainInbox);
  assert.equal(exportBrain.ui.trustedKnowledge, report.summary.trustedKnowledge);
});

test("Test 4 — no duplicate fingerprints inside any export bucket", () => {
  const report = fixtureReport();
  const exportBrain = mapDiagnosticsReportToBrainExportV2(report);
  for (const bucket of [
    exportBrain.needsReview,
    exportBrain.autoApproved,
    exportBrain.trustedKnowledge,
    exportBrain.developerModified,
    exportBrain.rejected,
  ]) {
    const fps = bucket.map((e) => e.fingerprint);
    assert.equal(new Set(fps).size, fps.length);
  }
});

test("Test 5 — validateBrainUiParity returns valid", () => {
  const report = fixtureReport();
  const exportBrain = mapDiagnosticsReportToBrainExportV2(report);
  const parity = validateBrainUiParity(exportBrain, report);
  assert.equal(parity.valid, true);
  assert.equal(exportBrain.uiParity, true);
  assert.deepEqual(parity.errors, []);
});

test("computeEngineeringBrainDiagnostics summary matches collections lengths", async () => {
  const observed = [
    {
      key: "s1:d1",
      name: "Cofferdam Installation",
      fragnetName: "Marine",
      projectId: "p1",
      projectName: "Alpha",
      importVersion: 1,
      importedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      key: "s1:d2",
      name: "Foundation Reinforcement Detailing",
      fragnetName: "Structures",
      projectId: "p1",
      projectName: "Alpha",
      importVersion: 1,
      importedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const report = await computeEngineeringBrainDiagnostics(observed, [], new Map(), false);
  assert.equal(report.summary.brainInbox, report.collections.needsReview.length);
  assert.equal(report.summary.autoApproved, report.collections.autoApproved.length);
  assert.equal(report.summary.developerApproved, report.collections.developerApproved.length);
  assert.equal(report.summary.developerModified, report.collections.developerModified.length);
  assert.equal(report.summary.rejected, report.collections.rejected.length);
  assert.equal(report.summary.totalVisible, report.summary.brainInbox + report.summary.trustedKnowledge);
  assert.equal(report.brainInbox, report.collections.needsReview);
});
