import test from "node:test";
import assert from "node:assert/strict";
import { classifyDisciplineCandidates, classifyDiscipline } from "../../dist/services/intelligence/taxonomy/disciplineClassifier.service.js";
import {
  resolveEngineeringIdentity,
  listEngineeringObjectCandidates,
} from "../../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";
import {
  resolveWorkPackageTaxonomy,
  listWorkPackageCandidatesInDiscipline,
} from "../../dist/services/intelligence/taxonomy/workPackageTaxonomy.service.js";
import { WORK_PACKAGE_TAXONOMY } from "../../dist/services/intelligence/taxonomy/workPackageTaxonomy.config.js";
import {
  IDENTITY_DEBUG_EXPORT_SCHEMA_VERSION,
  captureIdentityRuntimeConfiguration,
} from "../../dist/services/intelligence/diagnostics/engineeringIdentityDebugExport.service.js";
import {
  buildConfidenceBreakdown,
  detectDiagnosticContradictions,
  buildMissingEvidence,
  assessIdentityRisk,
  buildHumanSummary,
  validateExportRecord,
} from "../../dist/services/intelligence/diagnostics/engineeringIdentityDebugQuality.js";
import { enforceEngineeringIdentityValidation } from "../../dist/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";
import { assessEngineeringTrust } from "../../dist/services/intelligence/taxonomy/engineeringTrust.service.js";
import { buildIdentityView } from "../../dist/services/intelligence/diagnostics/engineeringBrainReview.js";
import {
  buildEngineeringBrainSummary,
} from "../../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";
import {
  mapDiagnosticsReportToBrainExportV2,
} from "../../dist/services/intelligence/diagnostics/engineeringBrainExportMapper.service.js";

test("debug export schema is versioned", () => {
  assert.equal(IDENTITY_DEBUG_EXPORT_SCHEMA_VERSION, "2.2.0");
});

test("runtime configuration snapshot reads live env values", () => {
  const config = captureIdentityRuntimeConfiguration();
  assert.equal(typeof config.aiEngineeringReasoningEnabled, "boolean");
  assert.ok(config.trustCriteria);
  assert.equal(config.trustCriteria.minimumSupportingEvidenceCount, 3);
  assert.ok(config.featureFlags);
  assert.ok(config.environment);
  assert.ok(config.identityEngineVersion.brain);
});

test("discipline candidate export returns the same winner as classifyDiscipline", () => {
  const input = {
    deliverableName: "Fire Technical Note",
    fragnetName: "Fire Engineering",
  };
  const winner = classifyDiscipline(input);
  const candidates = classifyDisciplineCandidates(input);
  assert.ok(candidates.length >= 1);
  assert.deepEqual(candidates[0], winner);
});

test("object candidate export includes competing scores and marks a winner", () => {
  const input = {
    deliverableName: "Foundation Reinforcement Detailing",
    fragnetName: "Structures",
  };
  const taxonomy = resolveWorkPackageTaxonomy(input);
  const candidates = listEngineeringObjectCandidates(input, taxonomy);
  assert.ok(candidates.length >= 1);
  assert.equal(candidates.filter((c) => c.winner).length, 1);
  assert.equal(candidates[0].winner, true);
  assert.ok(typeof candidates[0].score === "number");
  const identity = resolveEngineeringIdentity(input);
  if (identity.engineeringObject.id) {
    assert.equal(candidates[0].id, identity.engineeringObject.id);
  }
});

test("work package candidate export returns the same winner as taxonomy resolution", () => {
  const input = { deliverableName: "Reinforcement Detailing", fragnetName: "Structures" };
  const resolved = resolveWorkPackageTaxonomy(input);
  if (!resolved.disciplineId || resolved.isUnknownWorkPackage) return;
  const discipline = WORK_PACKAGE_TAXONOMY.find((d) => d.id === resolved.disciplineId);
  assert.ok(discipline);
  const candidates = listWorkPackageCandidatesInDiscipline(
    discipline,
    resolved.normalisedName,
    null
  );
  assert.ok(candidates.length >= 1);
  assert.equal(candidates[0].workPackageId, resolved.workPackageId);
});

test("quality diagnostics explain confidence, missing evidence, risk and summary", () => {
  const input = {
    deliverableName: "Cofferdam Installation",
    fragnetName: "Marine Works",
    relatedActivityNames: [],
  };
  const identity = enforceEngineeringIdentityValidation(resolveEngineeringIdentity(input));
  const taxonomy = resolveWorkPackageTaxonomy(input);
  const identityView = buildIdentityView(identity);
  const trust = assessEngineeringTrust({ identity, validation: identity.validation });
  const breakdown = buildConfidenceBreakdown({
    identityView,
    ruleTrace: [],
    validation: identity.validation,
  });
  assert.ok(breakdown.steps.length >= 2);
  assert.ok(breakdown.finalConfidence >= 0 && breakdown.finalConfidence <= 1);

  const contradictions = detectDiagnosticContradictions({ identity, validation: identity.validation, taxonomy });
  assert.ok(Array.isArray(contradictions));

  const missing = buildMissingEvidence({
    identity,
    trust,
    activityCount: 0,
    historicalMatchCount: 0,
    neighbourCount: 0,
    knowledgeMatched: 0,
  });
  assert.ok(missing.some((m) => /supporting activities/i.test(m) || /historical/i.test(m) || /object/i.test(m)));

  const risk = assessIdentityRisk({
    identity,
    trust,
    stability: { rating: "Medium", reason: "probe", sensitiveFields: [], probes: [] },
    contradictions,
    historicalMatchCount: 0,
    activityContributed: 0,
  });
  assert.ok(["Low", "Medium", "High", "Critical"].includes(risk.risk));

  const summary = buildHumanSummary({
    identity,
    trust,
    confidenceBreakdown: breakdown,
    missingEvidence: missing,
    contradictions,
    stability: { rating: "Medium", reason: "probe", sensitiveFields: [], probes: [] },
    historicalMatchCount: 0,
  });
  assert.ok(summary.length > 40);
  assert.ok(summary.split("\n\n").length <= 3);

  const validation = validateExportRecord({
    deliverableId: "d1",
    name: "x",
    decision: { trusted: false, fingerprint: "abc" },
    fingerprint: "abc",
    fingerprintDetails: {},
    currentIdentity: {},
    pipeline: [{ stage: "x" }],
    confidenceBreakdown: breakdown,
    stability: {},
    contradictions: [],
    missingEvidence: missing,
    riskAssessment: risk,
    knowledgeCoverage: {},
    nearestIdentities: [],
    summary,
    qualityWarnings: [],
    replay: {},
  });
  assert.equal(validation.valid, true);
});

test("export mapper uses pre-bucketed collections without recomputation", () => {
  const collections = {
    needsReview: [],
    autoApproved: [{ fingerprint: "a", concept: "A", status: "AUTO_APPROVED", identity: {}, identityView: null, context: null, aliases: [], evidence: [], examples: [], historicalMatches: [], firstObserved: "2026-01-01", lastObserved: "2026-01-01", projectCount: 1, successfulComparisons: 0, versionHistory: [], versionHistoryCount: 0, lastModificationReason: null }],
    developerApproved: [],
    developerModified: [],
    rejected: [],
  };
  const summary = buildEngineeringBrainSummary(collections);
  const report = { collections, summary, brainInbox: [], trustedKnowledge: collections.autoApproved };
  const exportBrain = mapDiagnosticsReportToBrainExportV2(report);
  assert.equal(exportBrain.autoApproved.length, 1);
  assert.equal(exportBrain.summary.autoApproved, summary.autoApproved);
  assert.equal(exportBrain.uiParity, true);
});
