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

function stableBrainReport(report) {
  const copy = structuredClone(report);
  delete copy.generatedAt;
  delete copy.recentReasoningEvents;
  for (const sample of copy.sampleIdentities ?? []) {
    delete sample.timestamp;
    delete sample.reasoningDurationMs;
  }
  return copy;
}

const FIXTURE_OBSERVED = [
  deliverable("Reinforcement Detailing", { fragnetName: "Structures", key: "a" }),
  deliverable("Public Health Technical Note", { fragnetName: "Public Health", key: "b" }),
  deliverable("Cofferdam Installation", { key: "c1", projectId: "p1" }),
  deliverable("Cofferdam Installation", { key: "c2", projectId: "p2", projectName: "P2" }),
  deliverable("Enabling Works", {
    key: "m1",
    fragnetName: "GET Milestones",
    relatedActivityNames: ["Confirm enabling works receipt"],
  }),
  deliverable("BWIC", {
    key: "m2",
    fragnetName: "GET Milestones",
    relatedActivityNames: ["Confirm BWIC receipt"],
  }),
];

test("kill switch: forceRuleBased reproduces deterministic rule-based output", async () => {
  const baseline = await computeEngineeringBrainDiagnostics(FIXTURE_OBSERVED, DEFAULT_CONSISTENCY_PROBES, new Map(), false, {
    forceRuleBased: true,
  });
  const repeat = await computeEngineeringBrainDiagnostics(FIXTURE_OBSERVED, DEFAULT_CONSISTENCY_PROBES, new Map(), false, {
    forceRuleBased: true,
  });
  assert.deepEqual(stableBrainReport(repeat), stableBrainReport(baseline));
});

test("kill switch: AI_ENGINEERING_REASONING_ENABLED=false matches forceRuleBased", async () => {
  const previous = process.env.AI_ENGINEERING_REASONING_ENABLED;
  process.env.AI_ENGINEERING_REASONING_ENABLED = "false";
  try {
    const baseline = await computeEngineeringBrainDiagnostics(
      FIXTURE_OBSERVED,
      DEFAULT_CONSISTENCY_PROBES,
      new Map(),
      false,
      { forceRuleBased: true }
    );
    const killSwitch = await computeEngineeringBrainDiagnostics(
      FIXTURE_OBSERVED,
      DEFAULT_CONSISTENCY_PROBES,
      new Map(),
      false
    );
    assert.deepEqual(stableBrainReport(killSwitch), stableBrainReport(baseline));
  } finally {
    if (previous === undefined) delete process.env.AI_ENGINEERING_REASONING_ENABLED;
    else process.env.AI_ENGINEERING_REASONING_ENABLED = previous;
  }
});

test("consistency probes stay CONSISTENT under kill switch", async () => {
  const report = await computeEngineeringBrainDiagnostics([], DEFAULT_CONSISTENCY_PROBES, new Map(), false, {
    forceRuleBased: true,
  });
  for (const probe of report.consistency.probes) {
    assert.equal(probe.verdict, "CONSISTENT", `${probe.concept}: ${JSON.stringify(probe)}`);
    assert.equal(probe.resolvedSignatures.length, 1, `${probe.concept} should collapse to one signature`);
  }
});
