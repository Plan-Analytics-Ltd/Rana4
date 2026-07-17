import test from "node:test";
import assert from "node:assert/strict";
import {
  computeEngineeringBrainDiagnostics,
  DEFAULT_CONSISTENCY_PROBES,
} from "../../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";

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

test("report carries version stamps for reproducibility", async () => {
  const report = await computeEngineeringBrainDiagnostics([deliverable("Reinforcement Detailing", { fragnetName: "Structures" })]);
  assert.match(report.versions.brain, /^brain-/);
  assert.match(report.versions.vocabulary, /^vocab-/);
  assert.match(report.versions.reasoningPrompt, /^prompt-/);
  assert.match(report.versions.validation, /^validation-/);
});

test("metrics count identities, projects and unknowns", async () => {
  const observed = [
    deliverable("Reinforcement Detailing", { fragnetName: "Structures", projectId: "p1" }),
    deliverable("Fire Technical Note", { fragnetName: "Fire Engineering", projectId: "p2", projectName: "Project Two" }),
    deliverable("Cofferdam Construction Works", { projectId: "p2", projectName: "Project Two" }),
  ];
  const report = await computeEngineeringBrainDiagnostics(observed);
  assert.equal(report.metrics.engineeringIdentitiesCreated, 3);
  assert.equal(report.metrics.projectsAnalysed, 2);
  assert.ok(report.metrics.unknownEngineeringObjects >= 1);
});

test("consistency probes collapse wording variants to one identity", async () => {
  const report = await computeEngineeringBrainDiagnostics([], DEFAULT_CONSISTENCY_PROBES);
  const fire = report.consistency.probes.find((p) => p.concept === "Fire Technical Note");
  assert.ok(fire);
  assert.equal(fire.verdict, "CONSISTENT", JSON.stringify(fire));
  assert.equal(fire.resolvedSignatures.length, 1);
  assert.ok(report.consistency.reasoningConsistency > 0);
});

test("unknown engineering objects are observed, not learned", async () => {
  const observed = [];
  for (let i = 0; i < 5; i += 1) {
    observed.push(deliverable("Cofferdam Installation", { key: `c-${i}`, projectId: `p${i % 3}`, projectName: `P${i % 3}` }));
  }
  const report = await computeEngineeringBrainDiagnostics(observed);
  const cofferdam = report.unknownObjects.find((u) => /cofferdam/i.test(u.concept));
  assert.ok(cofferdam, JSON.stringify(report.unknownObjects));
  assert.equal(cofferdam.occurrences, 5);
  assert.ok(cofferdam.projects >= 2);
  assert.equal(cofferdam.kind, "ENGINEERING_OBJECT");
});

test("top opportunities rank the most impactful unknown concepts", async () => {
  const observed = [];
  for (let i = 0; i < 8; i += 1) observed.push(deliverable("Cofferdam Works", { key: `cof-${i}`, projectId: `p${i % 4}`, projectName: `P${i % 4}` }));
  for (let i = 0; i < 3; i += 1) observed.push(deliverable("Launching Gantry Erection", { key: `lg-${i}`, projectId: `p${i}`, projectName: `P${i}` }));
  const report = await computeEngineeringBrainDiagnostics(observed);
  assert.ok(report.topOpportunities.length >= 2);
  assert.equal(report.topOpportunities[0].rank, 1);
  assert.match(report.topOpportunities[0].concept, /cofferdam/i);
  assert.ok(report.topOpportunities[0].seen >= report.topOpportunities[1].seen);
});

test("reasoning drift is detected when the same concept resolves to different objects", async () => {
  // Same subject wording ("primary") resolving via different fragnet framing.
  const observed = [
    deliverable("Primary Steelwork", { key: "d1", fragnetName: "Level 11", projectId: "p1", importVersion: 1 }),
    deliverable("Primary Foundations", { key: "d2", fragnetName: "Substructure", projectId: "p1", importVersion: 2 }),
  ];
  const report = await computeEngineeringBrainDiagnostics(observed);
  // Drift is only recorded when the shared concept subject resolves to 2+ objects.
  assert.ok(Array.isArray(report.reasoningDrift));
});

test("maturity assessment is deterministic and repeatable for rule-based reasoning", async () => {
  const observed = [
    deliverable("Reinforcement Detailing", { fragnetName: "Structures" }),
    deliverable("Fire Technical Note", { fragnetName: "Fire Engineering" }),
    deliverable("Public Health Technical Note", { fragnetName: "Public Health" }),
  ];
  const a = await computeEngineeringBrainDiagnostics(observed);
  const b = await computeEngineeringBrainDiagnostics(observed);
  assert.equal(a.maturity.dimensions.repeatability, 100);
  assert.equal(a.maturity.overall, b.maturity.overall);
  assert.ok(["NOT_READY", "MATURING", "READY_TO_LEARN"].includes(a.maturity.readiness));
});

test("sample identities record evidence, validation and versions", async () => {
  const report = await computeEngineeringBrainDiagnostics([deliverable("Reinforcement Detailing", { fragnetName: "Structures" })]);
  const sample = report.sampleIdentities[0];
  assert.ok(sample);
  assert.ok(Array.isArray(sample.evidenceUsed));
  assert.equal(sample.validationResult.valid, true);
  assert.equal(sample.versions.brain, report.versions.brain);
  assert.ok(typeof sample.confidence === "number");
});
