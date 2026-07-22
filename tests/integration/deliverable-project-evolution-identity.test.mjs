/**
 * Project Evolution identity resolution — unit + fixture-backed integration checks.
 * Run: npm run build && node --test tests/integration/deliverable-project-evolution-identity.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../dist/utils/prisma.js";
import {
  buildProjectEvolutionSnapshotWhere,
  getDeliverableProjectEvolution,
  oneDeliverableSnapshotPerProgrammeRevision,
} from "../../dist/services/intelligence/shared/deliverableProjectEvolution.service.js";
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

describe("buildProjectEvolutionSnapshotWhere", () => {
  it("uses deliverableId OR fragnetId+name when fragnet is known", () => {
    const where = buildProjectEvolutionSnapshotWhere({
      projectId: "p1",
      companyId: "c1",
      anchor: { deliverableId: "d1", name: "Detailed Design", fragnetId: "f1" },
    });
    assert.deepEqual(where.snapshot, { projectId: "p1", companyId: "c1" });
    assert.equal(where.OR?.length, 2);
    assert.deepEqual(where.OR[0], { deliverableId: "d1" });
    assert.deepEqual(where.OR[1], {
      AND: [
        { fragnetId: "f1" },
        { name: { equals: "Detailed Design", mode: "insensitive" } },
      ],
    });
    assert.equal(where.name, undefined);
  });

  it("falls back to deliverableId only when fragnet is unknown", () => {
    const where = buildProjectEvolutionSnapshotWhere({
      projectId: "p1",
      companyId: "c1",
      anchor: { deliverableId: "d1", name: "Milestone", fragnetId: null },
    });
    assert.deepEqual(where, {
      snapshot: { projectId: "p1", companyId: "c1" },
      deliverableId: "d1",
    });
  });
});

describe("oneDeliverableSnapshotPerProgrammeRevision", () => {
  it("keeps the first row per programme snapshot id", () => {
    const rows = [
      { snapshot: { id: "s1" }, n: 1 },
      { snapshot: { id: "s1" }, n: 2 },
      { snapshot: { id: "s2" }, n: 3 },
    ];
    const out = oneDeliverableSnapshotPerProgrammeRevision(rows);
    assert.equal(out.length, 2);
    assert.equal(out[0].n, 1);
    assert.equal(out[1].n, 3);
  });
});

describe("fixture project evolution identity", () => {
  it("Detailed Design (on a fragnet) returns the full set of unique programme revisions", async () => {
    const report = await getDeliverableProjectEvolution({
      projectId: fixture.projectId,
      companyId: fixture.companyId,
      deliverableId: fixture.deliverables.detailedDesign.id,
    });

    assert.equal(report.revisions.length, EXPECTED_REVISIONS);
    const snapIds = report.revisions.map((r) => r.snapshotId);
    assert.equal(new Set(snapIds).size, EXPECTED_REVISIONS);
  });

  it("Reinforcement Detailing (bare, no fragnet) returns the full set of unique programme revisions", async () => {
    const report = await getDeliverableProjectEvolution({
      projectId: fixture.projectId,
      companyId: fixture.companyId,
      deliverableId: fixture.deliverables.reinforcement.id,
    });

    assert.equal(report.revisions.length, EXPECTED_REVISIONS);
    const snapIds = report.revisions.map((r) => r.snapshotId);
    assert.equal(new Set(snapIds).size, EXPECTED_REVISIONS);
  });

  it("every fixture deliverable retains full revision history without duplicate snapshotIds", async () => {
    for (const [key, deliverable] of Object.entries(fixture.deliverables)) {
      const report = await getDeliverableProjectEvolution({
        projectId: fixture.projectId,
        companyId: fixture.companyId,
        deliverableId: deliverable.id,
      });
      const snapIds = report.revisions.map((r) => r.snapshotId);
      assert.equal(
        report.revisions.length,
        new Set(snapIds).size,
        `${key}: duplicate programme snapshotIds in revisions`
      );
      assert.equal(
        report.revisions.length,
        EXPECTED_REVISIONS,
        `${key}: expected ${EXPECTED_REVISIONS} revisions, got ${report.revisions.length}`
      );
    }
  });
});
