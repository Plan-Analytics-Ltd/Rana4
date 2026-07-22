import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { computeProjectEvolutionIntelligence } from "../../dist/services/intelligence/shared/projectEvolutionIntelligence.service.js";
import { getDeliverableProjectEvolution } from "../../dist/services/intelligence/shared/deliverableProjectEvolution.service.js";
import { prisma } from "../../dist/utils/prisma.js";
import { createProjectEvolutionFixture, REVISION_PLAN } from "./fixtures/projectEvolutionFixture.mjs";

const EXPECTED_REVISIONS = REVISION_PLAN.length;

let fixture;

before(async () => {
  fixture = await createProjectEvolutionFixture();
});

after(async () => {
  if (fixture) await fixture.teardown();
  await prisma.$disconnect();
});

test("gradual reduction produces distinct intelligence fields", () => {
  const revisions = [
    { label: "Baseline", role: "BASELINE", importedAt: "2025-01-01", durationDays: 20, durationChangeDays: null },
    { label: "Update 1", role: "LIVE_IMPORT", importedAt: "2025-02-01", durationDays: 18, durationChangeDays: -2 },
    { label: "Update 2", role: "LIVE_IMPORT", importedAt: "2025-03-01", durationDays: 15, durationChangeDays: -3 },
    { label: "Update 3", role: "LIVE_IMPORT", importedAt: "2025-04-01", durationDays: 12, durationChangeDays: -3 },
    { label: "As Built", role: "AS_BUILT", importedAt: "2025-05-01", durationDays: 10, durationChangeDays: -2 },
  ];

  const intel = computeProjectEvolutionIntelligence(revisions);

  assert.equal(intel.baseline, 20);
  assert.equal(intel.latest, 10);
  assert.equal(intel.netChange, -10);
  assert.equal(intel.changePattern, "GRADUAL");
  assert.equal(intel.changePace, "MOSTLY_DECREASED");
  assert.ok(intel.plannerObservations.some((o) => o.includes("steadily")));
  assert.ok(intel.howChangedSummary?.includes("does not record why"));
  assert.ok(intel.revisionHighlights.length >= 2);
  assert.ok(intel.timelineHighlights.length >= 2);
});

test("sudden reduction identifies dominant revision step", () => {
  const revisions = [
    { label: "Baseline", role: "BASELINE", importedAt: "2025-01-01", durationDays: 20, durationChangeDays: null },
    { label: "Update 1", role: "LIVE_IMPORT", importedAt: "2025-02-01", durationDays: 20, durationChangeDays: 0 },
    { label: "Update 2", role: "LIVE_IMPORT", importedAt: "2025-03-01", durationDays: 8, durationChangeDays: -12 },
    { label: "As Built", role: "AS_BUILT", importedAt: "2025-04-01", durationDays: 8, durationChangeDays: 0 },
  ];

  const intel = computeProjectEvolutionIntelligence(revisions);

  assert.equal(intel.changePattern, "SUDDEN");
  assert.equal(intel.largestSingleRevisionChange?.revisionLabel, "Update 2");
  assert.ok(intel.plannerObservations.some((o) => o.includes("single revision")));
  assert.ok(intel.howChangedSummary?.includes("Update 2"));
});

test("stable history reports low volatility and stable pattern", () => {
  const revisions = Array.from({ length: 6 }, (_, i) => ({
    label: `Rev ${i + 1}`,
    role: "LIVE_IMPORT",
    importedAt: `2025-0${i + 1}-01`,
    durationDays: 15,
    durationChangeDays: 0,
  }));

  const intel = computeProjectEvolutionIntelligence(revisions);

  assert.equal(intel.changePattern, "STABLE");
  assert.equal(intel.volatility, "LOW");
  assert.equal(intel.netChange, 0);
  assert.ok(intel.stablePeriods.length >= 1);
  assert.ok(intel.plannerObservations[0]?.includes("stayed at 15 days"));
});

test("fixture Detailed Design exposes projectEvolutionIntelligence on API report", async () => {
  const report = await getDeliverableProjectEvolution({
    projectId: fixture.projectId,
    companyId: fixture.companyId,
    deliverableId: fixture.deliverables.detailedDesign.id,
  });

  assert.ok(report.projectEvolutionIntelligence);
  assert.equal(report.projectEvolutionIntelligence.revisionCount, report.revisions.length);
  assert.equal(report.revisions.length, EXPECTED_REVISIONS);
  assert.ok(report.projectEvolutionIntelligence.summary.length > 0);
  assert.ok(Array.isArray(report.projectEvolutionIntelligence.plannerObservations));
  assert.ok(Array.isArray(report.projectEvolutionIntelligence.timelineHighlights));
});

test("fixture evolution intelligence differs across question evidence slices", async () => {
  const report = await getDeliverableProjectEvolution({
    projectId: fixture.projectId,
    companyId: fixture.companyId,
    deliverableId: fixture.deliverables.detailedDesign.id,
  });
  const intel = report.projectEvolutionIntelligence;

  const whatChangedEvidence = {
    summary: intel.summary,
    netChange: intel.netChange,
    highlights: intel.timelineHighlights,
    revisions: intel.revisionHighlights.map((h) => h.revisionLabel),
  };
  const whyEvidence = {
    howChanged: intel.howChangedSummary,
    pattern: intel.changePattern,
    steps: [intel.firstMeaningfulChange?.revisionLabel, intel.largestSingleRevisionChange?.revisionLabel],
  };
  const historyEvidence = {
    revisionLabels: report.revisions.map((r) => r.label),
  };
  const whichRevisionEvidence = {
    largest: intel.largestSingleRevisionChange?.revisionLabel,
    increase: intel.largestIncrease?.revisionLabel,
    reduction: intel.largestReduction?.revisionLabel,
  };
  const stableEvidence = {
    periods: intel.stablePeriods.length,
    volatility: intel.volatility,
    trend: intel.trend,
  };
  const summaryEvidence = {
    observations: intel.plannerObservations,
    highlights: intel.timelineHighlights,
  };

  const payloads = [
    whatChangedEvidence,
    whyEvidence,
    historyEvidence,
    whichRevisionEvidence,
    stableEvidence,
    summaryEvidence,
  ];
  const serialized = payloads.map((p) => JSON.stringify(p));
  const unique = new Set(serialized);
  assert.ok(unique.size >= 5, `expected mostly distinct evidence payloads, got ${unique.size}`);
});
