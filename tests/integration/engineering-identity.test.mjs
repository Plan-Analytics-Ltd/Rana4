import test from "node:test";
import assert from "node:assert/strict";
import {
  compareEngineeringIdentities,
  resolveEngineeringIdentity,
} from "../../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";

function identity(name, fragnetName = null, extra = {}) {
  return resolveEngineeringIdentity({
    deliverableName: name,
    fragnetName,
    ...extra,
  });
}

function compare(targetName, candidateName, targetFragnet = null, candidateFragnet = null) {
  const target = identity(targetName, targetFragnet);
  const candidate = identity(candidateName, candidateFragnet);
  return {
    target,
    candidate,
    comparison: compareEngineeringIdentities(target, candidate),
  };
}

test("equivalent work matches on discipline, engineering object, and engineering work", () => {
  const cases = [
    ["Reinforcement Detailing", "Produce Reinforcement Detailing", "Structures", "Foundations"],
    ["Updated Technical Note - Fire", "FSE Technical Note", "Fire Engineering", "Fire Safety Engineering"],
    ["Public Health Technical Note", "Technical Notes - Public Health", "Public Health", "Public Health"],
    ["Meetings", "Design Meetings", "Project Management", "Project Management"],
    ["Milestones", "Key Milestones", "Project Management", "Project Management"],
  ];

  for (const [targetName, candidateName, targetFragnet, candidateFragnet] of cases) {
    const { target, candidate, comparison } = compare(
      targetName,
      candidateName,
      targetFragnet,
      candidateFragnet
    );
    assert.equal(target.status, "RESOLVED", targetName);
    assert.equal(candidate.status, "RESOLVED", candidateName);
    assert.equal(comparison.equivalent, true, `${targetName} → ${candidateName}`);
    assert.deepEqual(comparison.matchedIdentityComponents, [
      "DISCIPLINE",
      "ENGINEERING_OBJECT",
      "ENGINEERING_WORK",
    ]);
    assert.deepEqual(comparison.rejectedBy, []);
  }
});

test("resolved identity components always retain supporting evidence", () => {
  const resolved = identity(
    "VI-052 Link Bridge - Option 1 (Early Stage 3 Structural Analysis)",
    "Link Structure",
    {
      lifecycleStage: "Stage 3",
      projectContext: { projectType: "Healthcare" },
      relatedActivityNames: ["Develop link bridge structural model"],
    }
  );

  for (const component of [
    resolved.discipline,
    resolved.engineeringObject,
    resolved.engineeringWork,
    resolved.deliverableType,
    resolved.lifecycleStage,
    resolved.projectContext,
    resolved.fragnetContext,
  ]) {
    if (component.id) assert.ok(component.evidence.length > 0, component.id);
  }
  assert.ok(resolved.supportingEvidence.length >= 7);
});

test("different engineering objects reject otherwise similar work", () => {
  const cases = [
    {
      target: "Primary Steelwork (Plant Screen)",
      candidate:
        "TC-314 - EI-613 - Conventional station steelwork and cladding - EoP Lifts Cladding",
      targetFragnet: "Level 11",
      candidateFragnet: null,
      rejectedBy: ["ENGINEERING_OBJECT"],
    },
    {
      target: "VI-052 Link Bridge - Option 1 (Early Stage 3 Structural Analysis)",
      candidate: "Detailed Design - Southern Stockpile Benefits Analysis",
      targetFragnet: "Link Structure",
      candidateFragnet: "Detailed Design",
      rejectedBy: ["ENGINEERING_OBJECT"],
    },
    {
      target: "Core General Arrangements",
      candidate: "Detailed Design - Foundation Drawing Pack",
      targetFragnet: "Structural Design",
      candidateFragnet: "Detailed Design",
      // deliverableType is now a soft-identity gate: "General Arrangement" vs
      // "Drawing" is a real, resolved conflict here, so it rejects alongside
      // object/work rather than being silently ignored as a mere descriptor.
      rejectedBy: ["ENGINEERING_OBJECT", "ENGINEERING_WORK", "DELIVERABLE_TYPE"],
    },
  ];

  for (const item of cases) {
    const { comparison } = compare(
      item.target,
      item.candidate,
      item.targetFragnet,
      item.candidateFragnet
    );
    assert.equal(comparison.equivalent, false);
    assert.equal(comparison.reason, "CONTRADICTORY_IDENTITY");
    assert.deepEqual(comparison.rejectedBy, item.rejectedBy);
  }
});

test("specialist technical notes reject on discipline and engineering object", () => {
  const cases = [
    ["Mechanical Technical Note", "Fire Technical Note", "Mechanical", "Fire Engineering"],
    ["Acoustic Technical Note", "Public Health Technical Note", "Acoustics", "Public Health"],
  ];

  for (const args of cases) {
    const { comparison } = compare(...args);
    assert.equal(comparison.equivalent, false);
    assert.deepEqual(comparison.rejectedBy, ["DISCIPLINE", "ENGINEERING_OBJECT"]);
    assert.ok(comparison.matchedIdentityComponents.includes("ENGINEERING_WORK"));
  }
});

test("insufficient core identity fails closed", () => {
  const target = identity("Unclassified Output");
  const candidate = identity("Unclassified Output");
  const comparison = compareEngineeringIdentities(target, candidate);

  assert.equal(target.status, "INSUFFICIENT");
  assert.equal(candidate.status, "INSUFFICIENT");
  assert.equal(comparison.equivalent, false);
  assert.equal(comparison.reason, "INSUFFICIENT_IDENTITY");
});

test("Phase 3: learned object rules merge in alongside the hand-authored taxonomy", () => {
  // "Cofferdam Installation" is the same genuinely-unresolved fixture used in
  // tests/integration/engineering-rule-proposal.test.mjs (confirmed there:
  // resolves with engineeringObject.id === null against the current taxonomy,
  // unlike "Combined MEP Coordination" which turns out to resolve via a
  // discipline fallback and so isn't a useful "before" case).
  const before = resolveEngineeringIdentity({ deliverableName: "Cofferdam Installation" });
  assert.equal(before.engineeringObject.id, null, JSON.stringify(before.engineeringObject));

  const learnedRule = {
    id: "temporary_marine_works",
    label: "Temporary Marine Works",
    patterns: ["\\bcofferdam\\b"],
    origin: "LEARNED_RULE",
  };
  const after = resolveEngineeringIdentity(
    { deliverableName: "Cofferdam Installation" },
    { objectRules: [learnedRule] }
  );
  assert.equal(after.engineeringObject.id, "temporary_marine_works");
  assert.equal(after.engineeringObject.label, "Temporary Marine Works");
  assert.equal(
    after.engineeringObject.evidence[0]?.ruleOrigin,
    "LEARNED_RULE",
    "a resolution driven by a learned rule must be tagged distinctly from hand-authored TAXONOMY rules"
  );
});

test("Phase 3: omitting learnedRules entirely reproduces pre-Phase-3 behavior exactly", () => {
  const withoutArg = resolveEngineeringIdentity({ deliverableName: "Reinforcement Detailing" });
  const withEmptyOverlay = resolveEngineeringIdentity({ deliverableName: "Reinforcement Detailing" }, {});
  const withEmptyArray = resolveEngineeringIdentity(
    { deliverableName: "Reinforcement Detailing" },
    { objectRules: [] }
  );
  assert.deepEqual(withEmptyOverlay, withoutArg);
  assert.deepEqual(withEmptyArray, withoutArg);
  assert.equal(withoutArg.engineeringObject.evidence[0]?.ruleOrigin, "TAXONOMY");
});

test("descriptor differences cannot override matching core engineering identity", () => {
  const target = identity("Reinforcement Detailing - Stage 3", "Structures", {
    lifecycleStage: "Stage 3",
    projectContext: { projectType: "Healthcare" },
  });
  const candidate = identity("Reinforcement Detailing - IFC", "Foundations", {
    lifecycleStage: "IFC",
    projectContext: { projectType: "Rail" },
  });
  const comparison = compareEngineeringIdentities(target, candidate);

  assert.equal(comparison.equivalent, true);
  assert.deepEqual(comparison.matchedIdentityComponents, [
    "DISCIPLINE",
    "ENGINEERING_OBJECT",
    "ENGINEERING_WORK",
  ]);
  assert.equal(
    comparison.checks.find((check) => check.component === "LIFECYCLE_STAGE")?.result,
    "MISMATCH"
  );
  assert.equal(
    comparison.checks.find((check) => check.component === "PROJECT_CONTEXT")?.result,
    "MISMATCH"
  );
});
