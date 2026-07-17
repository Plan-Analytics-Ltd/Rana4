import test from "node:test";
import assert from "node:assert/strict";
import { resolveEngineeringIdentity } from "../../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../../dist/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";
import {
  assessEngineeringTrust,
  engineeringIdentityFingerprint,
} from "../../dist/services/intelligence/taxonomy/engineeringTrust.service.js";
import { computeEngineeringBrainDiagnostics } from "../../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";

function validated(name, fragnetName = null, extra = {}) {
  return enforceEngineeringIdentityValidation(
    resolveEngineeringIdentity({ deliverableName: name, fragnetName, ...extra })
  );
}

function deliverable(name, overrides = {}) {
  return {
    key: overrides.key ?? `${overrides.projectId ?? "p1"}:${name}`,
    name,
    fragnetName: overrides.fragnetName ?? null,
    projectId: overrides.projectId ?? "p1",
    projectName: overrides.projectName ?? "Project One",
    importVersion: overrides.importVersion ?? 1,
    importedAt: overrides.importedAt ?? "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("a complete, validated, consistent identity auto-trusts", () => {
  const identity = validated("Reinforcement Detailing", "Structures");
  const assessment = assessEngineeringTrust({
    identity,
    validation: identity.validation,
    signal: { historicallyConsistent: true },
  });
  assert.equal(assessment.state, "TRUSTED");
  assert.deepEqual(assessment.reasons, []);
  assert.ok(assessment.confidence >= 80);
});

test("an unknown engineering object goes to review, never trusted", () => {
  const identity = validated("Cofferdam Installation Works");
  const assessment = assessEngineeringTrust({ identity, validation: identity.validation });
  assert.equal(assessment.state, "NEEDS_REVIEW");
  assert.ok(assessment.reasons.includes("UNKNOWN_ENGINEERING_OBJECT"));
});

test("a self-contradictory identity is CONTRADICTORY", () => {
  const base = validated("Fire Technical Note", "Fire Engineering");
  const contradictory = {
    ...base,
    discipline: { id: "mechanical", label: "Mechanical", evidence: base.discipline.evidence },
    engineeringObject: { id: "fire_safety", label: "Fire Safety", evidence: base.engineeringObject.evidence },
    validation: { valid: false, contradictions: [{ rule: "OBJECT_DISCIPLINE_INCOMPATIBLE", components: [], detail: "x" }] },
  };
  const assessment = assessEngineeringTrust({ identity: contradictory, validation: contradictory.validation });
  assert.equal(assessment.state, "CONTRADICTORY");
  assert.ok(assessment.reasons.includes("CONTRADICTORY_IDENTITY"));
});

test("historical disagreement forces review even for a resolved identity", () => {
  const identity = validated("Reinforcement Detailing", "Structures");
  const assessment = assessEngineeringTrust({
    identity,
    validation: identity.validation,
    signal: { historicallyConsistent: false },
  });
  assert.equal(assessment.state, "NEEDS_REVIEW");
  assert.ok(assessment.reasons.includes("REASONING_DISAGREEMENT"));
});

test("fingerprint is stable for identical reasoning and differs across concepts", () => {
  const a = validated("Reinforcement Detailing", "Structures");
  const fpA1 = engineeringIdentityFingerprint("reinforcement", a);
  const fpA2 = engineeringIdentityFingerprint("reinforcement", a);
  const b = validated("Fire Technical Note", "Fire Engineering");
  const fpB = engineeringIdentityFingerprint("fire", b);
  assert.equal(fpA1, fpA2);
  assert.notEqual(fpA1, fpB);
});

test("diagnostics splits auto-trusted knowledge from the brain inbox", async () => {
  const observed = [
    deliverable("Reinforcement Detailing", { fragnetName: "Structures", key: "a" }),
    deliverable("Public Health Technical Note", { fragnetName: "Public Health", key: "b" }),
    deliverable("Cofferdam Installation", { key: "c1", projectId: "p1" }),
    deliverable("Cofferdam Installation", { key: "c2", projectId: "p2", projectName: "P2" }),
  ];
  const report = await computeEngineeringBrainDiagnostics(observed);
  assert.ok(report.trustedKnowledge.length >= 2, "known work auto-trusts");
  assert.ok(report.brainInbox.length >= 1, "unknown cofferdam needs review");
  const inboxCofferdam = report.brainInbox.find((i) => /cofferdam/i.test(i.concept));
  assert.ok(inboxCofferdam);
  assert.equal(inboxCofferdam.state, "NEEDS_REVIEW");
  assert.ok(inboxCofferdam.reasons.includes("UNKNOWN_ENGINEERING_OBJECT"));
  assert.ok(report.maturity.trust.autoTrustedRate > 0);
  assert.ok(report.maturity.trust.reviewRate > 0);
});

test("a developer decision moves a fingerprint out of the inbox into trusted knowledge", async () => {
  const observed = [
    deliverable("Cofferdam Installation", { key: "c1", projectId: "p1" }),
    deliverable("Cofferdam Installation", { key: "c2", projectId: "p2", projectName: "P2" }),
  ];
  const baseline = await computeEngineeringBrainDiagnostics(observed);
  const item = baseline.brainInbox.find((i) => /cofferdam/i.test(i.concept));
  assert.ok(item, "cofferdam starts in the inbox");

  const decisions = new Map();
  decisions.set(item.fingerprint, {
    knowledgeEntryId: "ke-test-1",
    fingerprint: item.fingerprint,
    status: "DEVELOPER_MODIFIED",
    lastAction: "MODIFY",
    concept: "Cofferdam",
    identity: {
      discipline: "civil",
      engineeringObject: "cofferdam",
      engineeringWork: "design",
      deliverableType: null,
      lifecycleStage: null,
    },
    aliases: ["cofferdam"],
    evidence: [],
    reviewNotes: "Marine temporary works",
    reviewedBy: "dev@example.com",
    firstObservedAt: "2026-01-01T00:00:00.000Z",
    lastObservedAt: "2026-01-02T00:00:00.000Z",
    projectCount: 2,
    successfulComparisons: 1,
    versionHistory: [{ at: "now", action: "MODIFY", status: "DEVELOPER_MODIFIED", reviewedBy: "dev", identity: {}, notes: null }],
  });

  const after = await computeEngineeringBrainDiagnostics(observed, undefined, decisions, true);
  assert.ok(!after.brainInbox.some((i) => i.fingerprint === item.fingerprint), "no longer in inbox");
  const trusted = after.trustedKnowledge.find((t) => t.fingerprint === item.fingerprint);
  assert.ok(trusted, "now trusted knowledge");
  assert.equal(trusted.status, "DEVELOPER_MODIFIED");
  assert.equal(trusted.identity.engineeringObject, "cofferdam");
  assert.equal(after.maturity.trust.developerModificationRate, 100);
});

test("inbox cards carry review-grade detail: context, why, reasons, impact", async () => {
  const observed = [
    deliverable("Cofferdam Installation", {
      key: "c1",
      projectId: "p1",
      parentWbs: "Marine Works",
      wbsPath: "Site / Marine Works",
      discipline: "Civil",
      relatedActivityNames: ["Install cofferdam", "Dewater cofferdam"],
      neighbourNames: ["Sheet Pile Layout", "Dewatering Plan"],
    }),
    deliverable("Cofferdam Installation", {
      key: "c2",
      projectId: "p2",
      projectName: "P2",
      parentWbs: "Marine Works",
      wbsPath: "Site / Marine Works",
      discipline: "Civil",
      relatedActivityNames: ["Install cofferdam", "Dewater cofferdam"],
      neighbourNames: ["Sheet Pile Layout", "Dewatering Plan"],
    }),
  ];
  const report = await computeEngineeringBrainDiagnostics(observed);
  const item = report.brainInbox.find((i) => /cofferdam/i.test(i.concept));
  assert.ok(item);
  // Section A — original deliverable context
  assert.equal(item.context.parentWbs, "Marine Works");
  assert.ok(item.context.relatedActivities.includes("Install cofferdam"));
  assert.ok(item.context.neighbouringDeliverables.includes("Sheet Pile Layout"));
  // Section B — identity view with per-component confidence
  assert.ok(item.identityView.discipline.confidence > 0);
  assert.equal(item.identityView.engineeringObject.confidence, 0); // unknown object
  // Part 2 — exact reason detail
  const objectReason = item.reasonDetails.find((r) => r.reason === "UNKNOWN_ENGINEERING_OBJECT");
  assert.ok(objectReason);
  assert.equal(typeof objectReason.detail, "string");
  // Part 6 — grouped occurrences
  assert.equal(item.occurrences, 2);
  assert.equal(item.examples.length, 2);
  // Part 7 — developer impact preview
  assert.equal(item.impact.deliverables, 2);
  assert.ok(item.impact.futureComparisons >= 0);
});

test("known work surfaces historical duration matches for the review", async () => {
  const observed = [
    deliverable("Foundation Reinforcement Detailing", { key: "a1", fragnetName: "Structures", projectId: "p1", durationDays: 8 }),
    deliverable("Reinforcement Detailing", { key: "a2", fragnetName: "Structures", projectId: "p2", projectName: "Tilbury", durationDays: 6 }),
  ];
  const report = await computeEngineeringBrainDiagnostics(observed);
  const trusted = report.trustedKnowledge.find((t) => t.identity.engineeringObject);
  assert.ok(trusted, "reinforcement auto-trusts");
  // Each occurrence sees the other as equivalent historical evidence with a duration.
  assert.ok(trusted.historicalMatches.length >= 1);
  assert.ok(trusted.historicalMatches.some((m) => m.durationDays != null));
});

test("a rejected fingerprint never becomes trusted knowledge", async () => {
  const observed = [deliverable("Cofferdam Installation", { key: "c1" })];
  const baseline = await computeEngineeringBrainDiagnostics(observed);
  const item = baseline.brainInbox[0];
  const decisions = new Map();
  decisions.set(item.fingerprint, {
    knowledgeEntryId: "ke-test-2",
    fingerprint: item.fingerprint,
    status: "REJECTED",
    lastAction: "REJECT",
    concept: "Cofferdam",
    identity: { discipline: null, engineeringObject: null, engineeringWork: null, deliverableType: null, lifecycleStage: null },
    aliases: [],
    evidence: [],
    reviewNotes: null,
    reviewedBy: "dev@example.com",
    firstObservedAt: "2026-01-01T00:00:00.000Z",
    lastObservedAt: "2026-01-01T00:00:00.000Z",
    projectCount: 1,
    successfulComparisons: 0,
    versionHistory: [],
  });
  const after = await computeEngineeringBrainDiagnostics(observed, undefined, decisions, true);
  assert.ok(!after.trustedKnowledge.some((t) => t.fingerprint === item.fingerprint));
  assert.ok(!after.brainInbox.some((i) => i.fingerprint === item.fingerprint));
  assert.equal(after.maturity.trust.developerRejectionRate, 100);
});
