#!/usr/bin/env node
/**
 * Standalone repro for the engineering-trust.test.mjs failures:
 *   - "diagnostics splits auto-trusted knowledge from the brain inbox"
 *   - "inbox cards carry review-grade detail"
 *
 * Both assert the "Cofferdam Installation" fixture stays an UNKNOWN_ENGINEERING_OBJECT
 * with confidence 0, but the real run shows it resolving with confidence 73 and no
 * UNKNOWN_ENGINEERING_OBJECT reason. This script isolates the exact same fixture and
 * times the call, so we can see what's actually happening instead of guessing.
 */
import { computeEngineeringBrainDiagnostics } from "../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";

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

const observed = [
  deliverable("Reinforcement Detailing", { fragnetName: "Structures", key: "a" }),
  deliverable("Public Health Technical Note", { fragnetName: "Public Health", key: "b" }),
  deliverable("Cofferdam Installation", { key: "c1", projectId: "p1" }),
  deliverable("Cofferdam Installation", { key: "c2", projectId: "p2", projectName: "P2" }),
];

const startedAt = Date.now();
const report = await computeEngineeringBrainDiagnostics(observed);
const elapsedMs = Date.now() - startedAt;

const inboxCofferdam = report.brainInbox.find((i) => /cofferdam/i.test(i.concept));
const trustedCofferdam = report.trustedKnowledge.find((t) => /cofferdam/i.test(t.concept ?? ""));

console.log(`computeEngineeringBrainDiagnostics took ${elapsedMs}ms`);
console.log("--- brainInbox entries ---");
console.log(JSON.stringify(report.brainInbox, null, 2));
console.log("--- trustedKnowledge entries ---");
console.log(JSON.stringify(report.trustedKnowledge, null, 2));
console.log("--- cofferdam in inbox? ---", !!inboxCofferdam);
console.log("--- cofferdam in trustedKnowledge? ---", !!trustedCofferdam);
if (inboxCofferdam) {
  console.log("--- inbox cofferdam reasons ---", inboxCofferdam.reasons);
}
console.log("--- ruleProposalCandidates ---");
console.log(JSON.stringify(report.ruleProposalCandidates ?? null, null, 2));

process.exit(0);
