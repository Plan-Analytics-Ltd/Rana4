/**
 * Self-contained Project Evolution test fixture.
 *
 * Replaces a hardcoded live-project ID (a previous session pointed 3 test
 * files directly at a real, mutable project in the dev database — the exact
 * project this whole engagement has been actively re-importing/modifying —
 * so the tests silently skipped forever the moment that project got
 * re-imported under a new ID). This creates its own throwaway Company /
 * Project / Standard / Fragnet / Deliverables / ProgrammeSnapshots /
 * DeliverableSnapshots / ActivitySnapshots, runs the real DB-backed services
 * against them, and tears everything down afterward — same pattern already
 * used in tests/integration/engineering-rule-proposal.test.mjs.
 *
 * Revision history (5 snapshots, deliberately NOT the 10/5/13 numbers reused
 * everywhere else in this suite, so nothing here can coincidentally pass
 * against a hardcoded literal):
 *   1. APPROVED_BASELINE  2025-01-01  remaining=20  original=20
 *   2. LIVE_UPDATE        2025-02-01  remaining=15  original=20 (progress, -5)
 *   3. LIVE_UPDATE        2025-03-01  remaining=15  original=20 (stable, 0)
 *   4. LIVE_UPDATE        2025-04-01  remaining=8   original=20 (sudden, -7 — dominant step)
 *   5. FINAL_AS_BUILT     2025-05-01  remaining=5   original=20 (progress, -3)
 * Net change: 20 -> 5 (a real reduction), for exercising the "false increase
 * assumption" correction without depending on any one magic number.
 */
import { prisma } from "../../../dist/utils/prisma.js";
import { runWithAuthContextAsync } from "../../../dist/utils/requestContext.js";

export const REVISION_PLAN = [
  { role: "BASELINE", state: "APPROVED_BASELINE", importedAt: "2025-01-01T00:00:00.000Z", remaining: 20, original: 20 },
  { role: "LIVE_IMPORT", state: "LIVE_UPDATE", importedAt: "2025-02-01T00:00:00.000Z", remaining: 15, original: 20 },
  { role: "LIVE_IMPORT", state: "LIVE_UPDATE", importedAt: "2025-03-01T00:00:00.000Z", remaining: 15, original: 20 },
  { role: "LIVE_IMPORT", state: "LIVE_UPDATE", importedAt: "2025-04-01T00:00:00.000Z", remaining: 8, original: 20 },
  { role: "AS_BUILT", state: "FINAL_AS_BUILT", importedAt: "2025-05-01T00:00:00.000Z", remaining: 5, original: 20 },
];

export const FIXTURE_DELIVERABLE_NAMES = {
  detailedDesign: "Detailed Design",
  reinforcement: "Reinforcement Detailing",
  drainage: "Drainage Strategy",
};

/**
 * Creates a fully self-contained fixture project with real revision history
 * for 3 deliverables (one on a real fragnet, two bare). Returns everything a
 * test needs plus a `teardown()` that deletes all of it.
 */
export async function createProjectEvolutionFixture() {
  const bootstrapCtx = { userId: "bootstrap", companyId: "bootstrap" };
  const uniqueSuffix = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

  const company = await runWithAuthContextAsync(bootstrapCtx, () =>
    prisma.company.create({
      data: {
        name: "Project Evolution Fixture Co",
        joinCode: `PEF${uniqueSuffix}`.toUpperCase().slice(0, 32),
      },
    })
  );
  const ctx = { userId: "bootstrap", companyId: company.id };

  const project = await runWithAuthContextAsync(ctx, () =>
    prisma.project.create({
      data: { name: "Fixture Hospital Programme", companyId: company.id },
    })
  );

  const standard = await runWithAuthContextAsync(ctx, () =>
    prisma.standard.create({
      data: { name: "Fixture Standard", projectId: project.id, companyId: company.id },
    })
  );

  const fragnet = await runWithAuthContextAsync(ctx, () =>
    prisma.fragnet.create({
      data: { name: "Level 9", standardId: standard.id, projectId: project.id, companyId: company.id },
    })
  );

  const deliverables = {};
  deliverables.detailedDesign = await runWithAuthContextAsync(ctx, () =>
    prisma.deliverable.create({
      data: {
        name: FIXTURE_DELIVERABLE_NAMES.detailedDesign,
        classification: "DESIGN",
        bestDuration: 20,
        likelyDuration: 20,
        fragnetId: fragnet.id,
        projectId: project.id,
        companyId: company.id,
      },
    })
  );
  deliverables.reinforcement = await runWithAuthContextAsync(ctx, () =>
    prisma.deliverable.create({
      data: {
        name: FIXTURE_DELIVERABLE_NAMES.reinforcement,
        classification: "CONSTRUCTION",
        bestDuration: 20,
        likelyDuration: 20,
        projectId: project.id,
        companyId: company.id,
      },
    })
  );
  deliverables.drainage = await runWithAuthContextAsync(ctx, () =>
    prisma.deliverable.create({
      data: {
        name: FIXTURE_DELIVERABLE_NAMES.drainage,
        classification: "DESIGN",
        bestDuration: 20,
        likelyDuration: 20,
        projectId: project.id,
        companyId: company.id,
      },
    })
  );

  const snapshots = [];
  for (const rev of REVISION_PLAN) {
    const snapshot = await runWithAuthContextAsync(ctx, () =>
      prisma.programmeSnapshot.create({
        data: {
          projectId: project.id,
          companyId: company.id,
          importedAt: new Date(rev.importedAt),
          sourceType: "RANA4_EXPORT",
          snapshotRole: rev.role,
          programmeState: rev.state,
        },
      })
    );
    snapshots.push(snapshot);

    for (const [key, deliverable] of Object.entries(deliverables)) {
      await runWithAuthContextAsync(ctx, () =>
        prisma.deliverableSnapshot.create({
          data: {
            snapshotId: snapshot.id,
            deliverableId: deliverable.id,
            name: deliverable.name,
            classification: deliverable.classification,
            fragnetId: deliverable.fragnetId,
            workPackageDurationDays: rev.remaining,
          },
        })
      );
      await runWithAuthContextAsync(ctx, () =>
        prisma.activitySnapshot.create({
          data: {
            snapshotId: snapshot.id,
            activityCode: `${key.toUpperCase().slice(0, 4)}-${rev.state}`,
            deliverableId: deliverable.id,
            name: `${deliverable.name} activity`,
            originalDuration: rev.original,
            remainingDuration: rev.remaining,
          },
        })
      );
    }
  }

  async function teardown() {
    await runWithAuthContextAsync(bootstrapCtx, async () => {
      await prisma.activitySnapshot.deleteMany({ where: { snapshot: { companyId: company.id } } });
      await prisma.deliverableSnapshot.deleteMany({ where: { snapshot: { companyId: company.id } } });
      await prisma.programmeSnapshot.deleteMany({ where: { companyId: company.id } });
      await prisma.deliverable.deleteMany({ where: { companyId: company.id } });
      await prisma.fragnet.deleteMany({ where: { companyId: company.id } });
      await prisma.standard.deleteMany({ where: { companyId: company.id } });
      await prisma.project.deleteMany({ where: { companyId: company.id } });
      await prisma.company.delete({ where: { id: company.id } });
    });
  }

  return {
    company,
    project,
    fragnet,
    deliverables,
    snapshots,
    projectId: project.id,
    companyId: company.id,
    teardown,
  };
}
