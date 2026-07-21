/**
 * Debug script — find exactly which field(s) differ between two
 * back-to-back calls to computeEngineeringBrainDiagnostics with
 * byte-identical inputs (forceRuleBased: true).
 *
 * This reproduces the exact fixture from
 * tests/integration/engineering-reasoning-activation.test.mjs and does a
 * deep field-by-field diff of the two `stableBrainReport()` outputs, so we
 * can see the real offending path instead of guessing.
 *
 * Usage (after `npm run build`):
 *   node scripts/debug-brain-diagnostics-determinism.mjs
 */
import {
  computeEngineeringBrainDiagnostics,
  DEFAULT_CONSISTENCY_PROBES,
} from "../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";

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

// Same stableBrainReport() as the test file — deliberately NOT extended to
// strip ruleProposalCandidates, so we can see whether it (or anything else)
// is the real source of non-determinism.
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

function diff(a, b, path = "") {
  const diffs = [];
  if (a === b) return diffs;
  const aIsObj = a && typeof a === "object";
  const bIsObj = b && typeof b === "object";
  if (!aIsObj || !bIsObj) {
    diffs.push({ path, a, b });
    return diffs;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const childPath = Array.isArray(a) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
    const av = a[key];
    const bv = b[key];
    if (av === bv) continue;
    if (av && bv && typeof av === "object" && typeof bv === "object") {
      diffs.push(...diff(av, bv, childPath));
    } else {
      diffs.push({ path: childPath, a: av, b: bv });
    }
  }
  return diffs;
}

async function main() {
  const baseline = await computeEngineeringBrainDiagnostics(
    FIXTURE_OBSERVED,
    DEFAULT_CONSISTENCY_PROBES,
    new Map(),
    false,
    { forceRuleBased: true }
  );
  const repeat = await computeEngineeringBrainDiagnostics(
    FIXTURE_OBSERVED,
    DEFAULT_CONSISTENCY_PROBES,
    new Map(),
    false,
    { forceRuleBased: true }
  );

  const stableBaseline = stableBrainReport(baseline);
  const stableRepeat = stableBrainReport(repeat);

  const fieldDiffs = diff(stableBaseline, stableRepeat);

  if (fieldDiffs.length === 0) {
    console.log("NO DIFFERENCE — reports are identical after stableBrainReport() stripping.");
    return;
  }

  console.log(`Found ${fieldDiffs.length} differing field(s):\n`);
  for (const d of fieldDiffs) {
    console.log(`  path: ${d.path}`);
    console.log(`    baseline: ${JSON.stringify(d.a)}`);
    console.log(`    repeat:   ${JSON.stringify(d.b)}`);
  }

  console.log("\nruleProposalCandidates (baseline):", JSON.stringify(stableBaseline.ruleProposalCandidates));
  console.log("ruleProposalCandidates (repeat):  ", JSON.stringify(stableRepeat.ruleProposalCandidates));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
