/**
 * Project Evolution identity resolution — unit + seeded integration checks.
 * Run: npm run build && node --test tests/integration/deliverable-project-evolution-identity.test.mjs
 */
import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../dist/utils/prisma.js";
import {
  buildProjectEvolutionSnapshotWhere,
  getDeliverableProjectEvolution,
  oneDeliverableSnapshotPerProgrammeRevision,
} from "../../dist/services/intelligence/shared/deliverableProjectEvolution.service.js";

const projectId = "cmr1ztdj50001sybs8jbn4qf4";
const companyId = "cmo8dvlc10000syx0861h1zr5";
const EXPECTED_REVISIONS = 13;

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

describe("seeded healthcare project evolution identity", () => {
  it("Detailed Design (Level 9) returns 13 unique programme revisions", async (t) => {
    const deliverable = await prisma.deliverable.findFirst({
      where: { projectId, companyId, name: "Detailed Design", fragnet: { name: "Level 9" } },
      select: { id: true },
    });
    if (!deliverable) return t.skip("requires seeded healthcare project in database");

    const report = await getDeliverableProjectEvolution({
      projectId,
      companyId,
      deliverableId: deliverable.id,
    });

    assert.equal(report.revisions.length, EXPECTED_REVISIONS);
    const snapIds = report.revisions.map((r) => r.snapshotId);
    assert.equal(new Set(snapIds).size, EXPECTED_REVISIONS);
  });

  it("Reinforcement Detailing returns 13 unique programme revisions", async (t) => {
    const deliverable = await prisma.deliverable.findFirst({
      where: { projectId, companyId, name: "Reinforcement Detailing" },
      select: { id: true },
    });
    if (!deliverable) return t.skip("requires seeded healthcare project in database");

    const report = await getDeliverableProjectEvolution({
      projectId,
      companyId,
      deliverableId: deliverable.id,
    });

    assert.equal(report.revisions.length, EXPECTED_REVISIONS);
    const snapIds = report.revisions.map((r) => r.snapshotId);
    assert.equal(new Set(snapIds).size, EXPECTED_REVISIONS);
  });

  it("random sample deliverables retain full revision history without duplicate snapshotIds", async (t) => {
    const all = await prisma.deliverable.findMany({
      where: { projectId, companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    if (all.length === 0) return t.skip("requires seeded healthcare project in database");
    const picks = [0, 7, 17, 31, 52]
      .map((i) => all[i])
      .filter(Boolean);

    for (const d of picks) {
      const report = await getDeliverableProjectEvolution({
        projectId,
        companyId,
        deliverableId: d.id,
      });
      const snapIds = report.revisions.map((r) => r.snapshotId);
      assert.equal(
        report.revisions.length,
        new Set(snapIds).size,
        `${d.name}: duplicate programme snapshotIds in revisions`
      );
      assert.equal(
        report.revisions.length,
        EXPECTED_REVISIONS,
        `${d.name}: expected ${EXPECTED_REVISIONS} revisions, got ${report.revisions.length}`
      );
    }
  });
});

test.after(async () => {
  await prisma.$disconnect();
});
