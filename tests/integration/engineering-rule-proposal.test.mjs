/**
 * Engineering Brain — rule proposal generation (spec section 5, Phase 2).
 *
 * Two layers are tested:
 *  - Pure scoring/gating logic (computeEngineeringRuleProposalCandidates,
 *    and its wiring into computeEngineeringBrainDiagnostics) — no DB needed.
 *  - Persistence (persistEngineeringRuleProposals) against a real
 *    EngineeringRuleProposal table — requires a reachable DATABASE_URL, same
 *    precondition as tests/integration/tenant-isolation.test.mjs.
 *
 * Run: npm run build && node --test tests/integration/engineering-rule-proposal.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  computeEngineeringRuleProposalCandidates,
  mineObjectPattern,
  persistEngineeringRuleProposals,
  approveRuleProposal,
  rejectRuleProposal,
} from "../../dist/services/intelligence/diagnostics/engineeringRuleProposal.service.js";
import { loadActiveLearnedObjectRules } from "../../dist/services/intelligence/diagnostics/engineeringLearnedRule.service.js";
import { computeEngineeringBrainDiagnostics } from "../../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";
import { engineeringIdentityFingerprint } from "../../dist/services/intelligence/taxonomy/engineeringTrust.service.js";
import { resolveEngineeringIdentity } from "../../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";
import { conceptSubject } from "../../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";
import { prisma } from "../../dist/utils/prisma.js";
import { runWithAuthContextAsync } from "../../dist/utils/requestContext.js";

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

/** Build the exact fingerprint the diagnostics pipeline would compute for an
 * unresolved "Combined MEP Coordination" deliverable, so a synthetic decisions
 * Map can be pre-populated as if a developer had already reviewed it. */
function unresolvedMepFingerprint(name, fragnetName) {
  const identity = resolveEngineeringIdentity({ deliverableName: name, fragnetName });
  const subject = conceptSubject(name);
  return { fingerprint: engineeringIdentityFingerprint(subject.key, identity), subjectKey: subject.key, label: subject.label };
}

/* -------------------------------------------------------------------------- */
/* Pure scoring / gating                                                     */
/* -------------------------------------------------------------------------- */

test("computeEngineeringRuleProposalCandidates: NO proposal when a cluster has zero confirmed decisions", () => {
  const candidates = computeEngineeringRuleProposalCandidates({
    clusters: [
      {
        subjectKey: "combined mep coordination",
        conceptLabel: "Combined Mep Coordination",
        occurrences: 12,
        projectCount: 4,
        members: Array.from({ length: 12 }, (_, i) => ({
          fingerprint: `fp-${i}`,
          deliverableName: "Combined MEP Coordination",
          projectId: `p${i % 4}`,
        })),
      },
    ],
    decisions: new Map(), // no developer has ever confirmed anything for this cluster
  });

  assert.equal(
    candidates.length,
    0,
    "a cluster with high occurrences/projects but zero confirmed ground truth must never draft a proposal"
  );
});

test("computeEngineeringRuleProposalCandidates: drafts a proposal once ground truth + volume + threshold line up", () => {
  const confirmedFingerprint = "fp-confirmed-0";
  const decisions = new Map([
    [
      confirmedFingerprint,
      {
        knowledgeEntryId: "kentry-1",
        fingerprint: confirmedFingerprint,
        status: "DEVELOPER_APPROVED",
        lastAction: "APPROVE",
        concept: "Combined Mep Coordination",
        identity: {
          discipline: "mechanical",
          engineeringObject: "combined_mep",
          engineeringWork: "coordination",
          deliverableType: null,
          lifecycleStage: null,
        },
        aliases: [],
        evidence: [],
        reviewNotes: null,
        reviewedBy: "dev@example.com",
        firstObservedAt: "2026-01-01T00:00:00.000Z",
        lastObservedAt: "2026-01-01T00:00:00.000Z",
        projectCount: 1,
        successfulComparisons: 0,
        versionHistory: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  ]);

  const members = [
    { fingerprint: confirmedFingerprint, deliverableName: "Combined MEP Coordination", projectId: "p0" },
    { fingerprint: "fp-1", deliverableName: "Combined MEP Coordination Review", projectId: "p1" },
    { fingerprint: "fp-2", deliverableName: "Combined MEP Coordination Model", projectId: "p2" },
    { fingerprint: "fp-3", deliverableName: "Combined MEP Coordination", projectId: "p3" },
  ];

  const candidates = computeEngineeringRuleProposalCandidates({
    clusters: [
      {
        subjectKey: "combined mep coordination",
        conceptLabel: "Combined Mep Coordination",
        occurrences: members.length,
        projectCount: 4,
        members,
      },
    ],
    decisions,
  });

  assert.equal(candidates.length, 1, JSON.stringify(candidates));
  const proposal = candidates[0];
  assert.equal(proposal.kind, "OBJECT");
  assert.equal(proposal.targetId, "combined_mep");
  assert.equal(proposal.confirmedDecisionCount, 1);
  assert.equal(proposal.consistency, 1, "a single confirmed decision is unanimous with itself");
  assert.equal(proposal.occurrences, 4);
  assert.equal(proposal.projectCount, 4);
  // confidenceScore = min(1,4/20)*0.3 + min(1,4/3)*0.3 + 1*0.4 = 0.06 + 0.3 + 0.4 = 0.76
  assert.ok(Math.abs(proposal.confidenceScore - 0.76) < 1e-9, proposal.confidenceScore);
  assert.ok(proposal.confidenceScore >= 0.5);
  assert.match(proposal.proposedPattern, /mep/i);
  assert.ok(proposal.rationale.includes("4 time(s)"));
  assert.deepEqual(proposal.supportingFingerprints, [confirmedFingerprint]);
});

test("computeEngineeringRuleProposalCandidates: disagreement among confirmed members suppresses via consistency, not confirmedDecisionCount", () => {
  const members = [
    { fingerprint: "a", deliverableName: "Combined MEP Coordination", projectId: "p0" },
    { fingerprint: "b", deliverableName: "Combined MEP Coordination", projectId: "p1" },
  ];
  const decisions = new Map([
    [
      "a",
      {
        fingerprint: "a",
        status: "DEVELOPER_APPROVED",
        concept: "Combined Mep Coordination",
        identity: { discipline: "mechanical", engineeringObject: "combined_mep", engineeringWork: null, deliverableType: null, lifecycleStage: null },
        aliases: [], evidence: [], reviewNotes: null, reviewedBy: null,
        firstObservedAt: "2026-01-01T00:00:00.000Z", lastObservedAt: "2026-01-01T00:00:00.000Z",
        projectCount: 1, successfulComparisons: 0, versionHistory: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        knowledgeEntryId: null, lastAction: "APPROVE",
      },
    ],
    [
      "b",
      {
        fingerprint: "b",
        status: "DEVELOPER_MODIFIED",
        concept: "Combined Mep Coordination",
        identity: { discipline: "electrical", engineeringObject: "electrical_systems", engineeringWork: null, deliverableType: null, lifecycleStage: null },
        aliases: [], evidence: [], reviewNotes: null, reviewedBy: null,
        firstObservedAt: "2026-01-01T00:00:00.000Z", lastObservedAt: "2026-01-01T00:00:00.000Z",
        projectCount: 1, successfulComparisons: 0, versionHistory: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        knowledgeEntryId: null, lastAction: "MODIFY",
      },
    ],
  ]);

  const candidates = computeEngineeringRuleProposalCandidates({
    clusters: [
      {
        subjectKey: "combined mep coordination",
        conceptLabel: "Combined Mep Coordination",
        occurrences: 2,
        projectCount: 2,
        members,
      },
    ],
    decisions,
  });

  // confirmedDecisionCount = 2, but the two confirmed members disagree
  // (mechanical/combined_mep vs electrical/electrical_systems), so
  // consistency = 1/2 = 0.5. confidenceScore = min(1,2/20)*0.3 +
  // min(1,2/3)*0.3 + 0.5*0.4 = 0.03 + 0.2 + 0.2 = 0.43 < 0.5 threshold.
  assert.equal(candidates.length, 0, JSON.stringify(candidates));
});

test("mineObjectPattern derives a hand-written-style regex from shared cluster vocabulary", () => {
  const pattern = mineObjectPattern("Combined Mep Coordination", [
    "Combined MEP Coordination",
    "Combined MEP Coordination Review",
    "Combined MEP Coordination Model",
  ]);
  const re = new RegExp(pattern, "i");
  assert.match("Combined MEP Coordination Drawings", re);
  assert.match("combined mep coordination", re);
  assert.doesNotMatch("Structural Steelwork", re);
});

/* -------------------------------------------------------------------------- */
/* End-to-end wiring inside computeEngineeringBrainDiagnostics                */
/* -------------------------------------------------------------------------- */

test("computeEngineeringBrainDiagnostics populates ruleProposalCandidates for a confirmed, multi-project OBJECT gap", async () => {
  // "Cofferdam Installation" is used deliberately -- confirmed genuinely
  // unresolved (engineeringObject.id === null) against the current taxonomy,
  // unlike an earlier version of this fixture ("Combined MEP Coordination")
  // which turned out to already resolve via a discipline fallback and so
  // never entered the unresolved bucket this test needs to exercise.
  const name = "Cofferdam Installation";
  const fragnetName = null;
  const targetObjectId = "temporary_marine_works";
  const { fingerprint, subjectKey } = unresolvedMepFingerprint(name, fragnetName);

  const observed = [
    deliverable(name, { key: "d0", projectId: "p0", projectName: "Project Zero", fragnetName }),
    deliverable(name, { key: "d1", projectId: "p1", projectName: "Project One", fragnetName }),
    deliverable(`${name} Review`, { key: "d2", projectId: "p2", projectName: "Project Two", fragnetName }),
    deliverable(`${name} Model`, { key: "d3", projectId: "p3", projectName: "Project Three", fragnetName }),
  ];

  const decisions = new Map([
    [
      fingerprint,
      {
        knowledgeEntryId: "kentry-1",
        fingerprint,
        status: "DEVELOPER_MODIFIED",
        lastAction: "MODIFY",
        concept: subjectKey,
        identity: {
          discipline: "civil",
          engineeringObject: targetObjectId,
          engineeringWork: "installation",
          deliverableType: null,
          lifecycleStage: null,
        },
        aliases: [],
        evidence: [],
        reviewNotes: "Confirmed: this is temporary marine works.",
        reviewedBy: "dev@example.com",
        firstObservedAt: "2026-01-01T00:00:00.000Z",
        lastObservedAt: "2026-01-01T00:00:00.000Z",
        projectCount: 1,
        successfulComparisons: 0,
        versionHistory: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  ]);

  const report = await computeEngineeringBrainDiagnostics(observed, [], decisions, true);

  assert.ok(Array.isArray(report.ruleProposalCandidates));
  const proposal = report.ruleProposalCandidates.find((p) => p.targetId === targetObjectId);
  assert.ok(proposal, JSON.stringify(report.ruleProposalCandidates));
  assert.equal(proposal.kind, "OBJECT");
  assert.equal(proposal.confirmedDecisionCount, 1);
  assert.equal(proposal.projectCount, 4);
  assert.ok(proposal.confidenceScore >= 0.5);
});

test("computeEngineeringBrainDiagnostics: an unresolved OBJECT gap with NO developer decisions never appears in ruleProposalCandidates", async () => {
  const observed = [];
  for (let i = 0; i < 6; i += 1) {
    observed.push(
      deliverable("Cofferdam Installation", { key: `c-${i}`, projectId: `p${i % 3}`, projectName: `P${i % 3}` })
    );
  }
  const report = await computeEngineeringBrainDiagnostics(observed, [], new Map(), true);
  // Sanity: the underlying candidateLearning entry does exist (this concept
  // is genuinely observed) — but with no confirmed decisions backing it, no
  // rule proposal may be drafted from it.
  const candidate = report.candidateLearning.find((c) => /cofferdam/i.test(c.candidate));
  assert.ok(candidate, JSON.stringify(report.candidateLearning));
  const proposal = report.ruleProposalCandidates.find((p) => /cofferdam/i.test(p.targetLabel) || /cofferdam/i.test(p.rationale));
  assert.equal(proposal, undefined, JSON.stringify(report.ruleProposalCandidates));
});

/* -------------------------------------------------------------------------- */
/* Persistence — requires a reachable DATABASE_URL (same precondition as     */
/* tests/integration/tenant-isolation.test.mjs).                             */
/* -------------------------------------------------------------------------- */

test("persistEngineeringRuleProposals: creates a real EngineeringRuleProposal row, is idempotent, and never resurfaces a rejected proposal", async () => {
  const bootstrapCtx = { userId: "bootstrap", companyId: "bootstrap" };
  const company = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.company.create({
      data: {
        name: "Rule Proposal Test Co",
        joinCode: `RPT${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
      },
    })
  );

  const candidate = {
    kind: "OBJECT",
    targetId: "combined_mep",
    targetLabel: "Combined MEP",
    proposedPattern: "\\bcombined\\s+mep\\s+coordinations?\\b",
    rationale: "Seen 4 time(s) across 4 project(s); 1 developer decision confirms this resolves to Combined MEP.",
    supportingFingerprints: ["fp-confirmed-0"],
    occurrences: 4,
    projectCount: 4,
    confirmedDecisionCount: 1,
    consistency: 1,
    confidenceScore: 0.76,
  };

  try {
    const first = await runWithAuthContextAsync({ userId: "bootstrap", companyId: company.id }, async () =>
      persistEngineeringRuleProposals({ companyId: company.id, candidates: [candidate] })
    );
    assert.equal(first.created, 1);
    assert.equal(first.updated, 0);
    assert.equal(first.skippedRejected, 0);

    const rows = await runWithAuthContextAsync({ userId: "bootstrap", companyId: company.id }, async () =>
      prisma.engineeringRuleProposal.findMany({ where: { companyId: company.id } })
    );
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.kind, "OBJECT");
    assert.equal(row.targetId, "combined_mep");
    assert.equal(row.targetLabel, "Combined MEP");
    assert.equal(row.proposedPattern, candidate.proposedPattern);
    assert.equal(row.status, "PENDING");
    assert.equal(row.occurrences, 4);
    assert.equal(row.projectCount, 4);
    assert.equal(row.confirmedDecisionCount, 1);
    assert.equal(row.consistency, 1);
    assert.ok(Math.abs(row.confidenceScore - 0.76) < 1e-9);
    assert.deepEqual(row.supportingFingerprints, ["fp-confirmed-0"]);

    // Re-running with the same candidate (as a second diagnostics run would)
    // must not create a duplicate row — it updates the existing one via the
    // (companyId, kind, targetId, proposedPattern) unique constraint.
    const second = await runWithAuthContextAsync({ userId: "bootstrap", companyId: company.id }, async () =>
      persistEngineeringRuleProposals({
        companyId: company.id,
        candidates: [{ ...candidate, occurrences: 5 }],
      })
    );
    assert.equal(second.created, 0);
    assert.equal(second.updated, 1);
    const rowsAfterRerun = await runWithAuthContextAsync({ userId: "bootstrap", companyId: company.id }, async () =>
      prisma.engineeringRuleProposal.findMany({ where: { companyId: company.id } })
    );
    assert.equal(rowsAfterRerun.length, 1, "duplicate proposals must never be created on repeated runs");
    assert.equal(rowsAfterRerun[0].occurrences, 5, "evidence numbers refresh on an existing PENDING proposal");

    // Simulate a developer rejecting the proposal, then re-run diagnostics
    // with the identical evidence cluster again.
    await runWithAuthContextAsync({ userId: "bootstrap", companyId: company.id }, async () =>
      prisma.engineeringRuleProposal.update({
        where: { id: rowsAfterRerun[0].id },
        data: { status: "REJECTED", reviewedBy: "dev@example.com", reviewedAt: new Date() },
      })
    );

    const third = await runWithAuthContextAsync({ userId: "bootstrap", companyId: company.id }, async () =>
      persistEngineeringRuleProposals({
        companyId: company.id,
        candidates: [{ ...candidate, occurrences: 99 }],
      })
    );
    assert.equal(third.created, 0);
    assert.equal(third.updated, 0);
    assert.equal(third.skippedRejected, 1, "a rejected proposal for the same evidence must never resurface");

    const rowsAfterReject = await runWithAuthContextAsync({ userId: "bootstrap", companyId: company.id }, async () =>
      prisma.engineeringRuleProposal.findMany({ where: { companyId: company.id } })
    );
    assert.equal(rowsAfterReject.length, 1);
    assert.equal(rowsAfterReject[0].status, "REJECTED", "status must not be reset to PENDING");
    assert.equal(rowsAfterReject[0].occurrences, 5, "a rejected proposal's evidence must not be silently refreshed either");
  } finally {
    await runWithAuthContextAsync(bootstrapCtx, async () => {
      await prisma.engineeringRuleProposal.deleteMany({ where: { companyId: company.id } });
      await prisma.company.delete({ where: { id: company.id } });
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Review UI backend — Phase 3 (spec section 6): approve / reject / load.    */
/* -------------------------------------------------------------------------- */

test("approveRuleProposal creates a real EngineeringLearnedRule and it loads via loadActiveLearnedObjectRules; rejectRuleProposal marks REJECTED without creating one", async () => {
  const bootstrapCtx = { userId: "bootstrap", companyId: "bootstrap" };
  const company = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.company.create({
      data: {
        name: "Rule Proposal Review Test Co",
        joinCode: `RPR${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
      },
    })
  );

  try {
    const approveCandidate = {
      kind: "OBJECT",
      targetId: "temporary_marine_works",
      targetLabel: "Temporary Marine Works",
      proposedPattern: "\\bcofferdam\\b",
      rationale: "test fixture",
      supportingFingerprints: ["fp-a"],
      occurrences: 4,
      projectCount: 2,
      confirmedDecisionCount: 1,
      consistency: 1,
      confidenceScore: 0.6,
    };
    const rejectCandidate = {
      ...approveCandidate,
      targetId: "should_not_learn",
      targetLabel: "Should Not Learn",
      proposedPattern: "\\bshould-not-learn\\b",
    };

    await runWithAuthContextAsync({ userId: "bootstrap", companyId: company.id }, async () =>
      persistEngineeringRuleProposals({ companyId: company.id, candidates: [approveCandidate, rejectCandidate] })
    );
    const [pendingApprove, pendingReject] = await runWithAuthContextAsync(
      { userId: "bootstrap", companyId: company.id },
      async () =>
        Promise.all([
          prisma.engineeringRuleProposal.findFirst({ where: { companyId: company.id, targetId: approveCandidate.targetId } }),
          prisma.engineeringRuleProposal.findFirst({ where: { companyId: company.id, targetId: rejectCandidate.targetId } }),
        ])
    );
    assert.ok(pendingApprove);
    assert.ok(pendingReject);

    // Approve.
    const approveResult = await runWithAuthContextAsync({ userId: "bootstrap", companyId: company.id }, async () =>
      approveRuleProposal({ companyId: company.id, proposalId: pendingApprove.id, reviewedBy: "dev@example.com" })
    );
    assert.equal(approveResult.ok, true, JSON.stringify(approveResult));
    assert.equal(approveResult.proposal.status, "APPROVED");
    assert.equal(approveResult.proposal.reviewedBy, "dev@example.com");

    const learnedRows = await runWithAuthContextAsync({ userId: "bootstrap", companyId: company.id }, async () =>
      prisma.engineeringLearnedRule.findMany({ where: { companyId: company.id } })
    );
    assert.equal(learnedRows.length, 1, "approving must create exactly one EngineeringLearnedRule row");
    assert.equal(learnedRows[0].targetId, "temporary_marine_works");
    assert.equal(learnedRows[0].pattern, "\\bcofferdam\\b");
    assert.equal(learnedRows[0].sourceProposalId, pendingApprove.id);
    assert.equal(learnedRows[0].active, true);

    // Re-approving an already-APPROVED proposal must fail cleanly, not double-create.
    const doubleApprove = await runWithAuthContextAsync({ userId: "bootstrap", companyId: company.id }, async () =>
      approveRuleProposal({ companyId: company.id, proposalId: pendingApprove.id, reviewedBy: "dev@example.com" })
    );
    assert.equal(doubleApprove.ok, false);
    const learnedRowsAfterDouble = await runWithAuthContextAsync({ userId: "bootstrap", companyId: company.id }, async () =>
      prisma.engineeringLearnedRule.findMany({ where: { companyId: company.id } })
    );
    assert.equal(learnedRowsAfterDouble.length, 1, "re-approving must never create a second learned rule");

    // The approved rule now loads as an EngineeringObjectRule ready to merge in.
    const activeRules = await loadActiveLearnedObjectRules(company.id);
    assert.equal(activeRules.length, 1);
    assert.equal(activeRules[0].id, "temporary_marine_works");
    assert.equal(activeRules[0].label, "Temporary Marine Works");
    assert.deepEqual(activeRules[0].patterns, ["\\bcofferdam\\b"]);
    assert.equal(activeRules[0].origin, "LEARNED_RULE");

    // Reject the other proposal.
    const rejectResult = await runWithAuthContextAsync({ userId: "bootstrap", companyId: company.id }, async () =>
      rejectRuleProposal({ companyId: company.id, proposalId: pendingReject.id, reviewedBy: "dev@example.com", notes: "not a real gap" })
    );
    assert.equal(rejectResult.ok, true, JSON.stringify(rejectResult));
    assert.equal(rejectResult.proposal.status, "REJECTED");
    assert.equal(rejectResult.proposal.reviewNotes, "not a real gap");

    const learnedRowsAfterReject = await runWithAuthContextAsync({ userId: "bootstrap", companyId: company.id }, async () =>
      prisma.engineeringLearnedRule.findMany({ where: { companyId: company.id } })
    );
    assert.equal(learnedRowsAfterReject.length, 1, "rejecting must never create a learned rule");

    // Tenant isolation: a different company can never approve/reject this company's proposal.
    const otherCompany = await runWithAuthContextAsync(bootstrapCtx, async () =>
      prisma.company.create({
        data: {
          name: "Rule Proposal Review Test Co 2",
          joinCode: `RPR2${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
        },
      })
    );
    try {
      const crossTenantResult = await runWithAuthContextAsync({ userId: "bootstrap", companyId: otherCompany.id }, async () =>
        approveRuleProposal({ companyId: otherCompany.id, proposalId: pendingReject.id, reviewedBy: "attacker@example.com" })
      );
      assert.equal(crossTenantResult.ok, false, "a proposal must never be actionable from a different company");
      assert.equal(crossTenantResult.error, "Proposal not found");
    } finally {
      await runWithAuthContextAsync(bootstrapCtx, async () => {
        await prisma.company.delete({ where: { id: otherCompany.id } });
      });
    }
  } finally {
    await runWithAuthContextAsync(bootstrapCtx, async () => {
      await prisma.engineeringLearnedRule.deleteMany({ where: { companyId: company.id } });
      await prisma.engineeringRuleProposal.deleteMany({ where: { companyId: company.id } });
      await prisma.company.delete({ where: { id: company.id } });
    });
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
