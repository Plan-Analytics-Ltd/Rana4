/**
 * Tenant isolation security tests (company-based).
 *
 * Uses Node's built-in test runner:
 *   npm run test:tenant-isolation
 *
 * NOTE: requires a reachable DATABASE_URL.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../dist/utils/prisma.js";
import { runWithAuthContextAsync } from "../dist/utils/requestContext.js";

async function seed() {
  // Company/User models are not company-scoped in the Prisma extension, but we still
  // wrap ALL Prisma calls in a context to match real application behavior.
  const bootstrapCtx = { userId: "bootstrap", companyId: "bootstrap" };

  const companyA = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.company.create({
      data: {
        name: "Company A",
        joinCode: `JTA${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
      },
    })
  );
  const companyB = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.company.create({
      data: {
        name: "Company B",
        joinCode: `JTB${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
      },
    })
  );

  const userA = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.user.create({
      data: { email: `a_${Date.now()}@test.local`, passwordHash: "x", name: "A", companyId: companyA.id },
    })
  );
  const userB = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.user.create({
      data: { email: `b_${Date.now()}@test.local`, passwordHash: "x", name: "B", companyId: companyB.id },
    })
  );

  const projectA = await runWithAuthContextAsync({ userId: userA.id, companyId: companyA.id }, async () =>
    prisma.project.create({ data: { name: "Project A", companyId: companyA.id } })
  );
  const projectB = await runWithAuthContextAsync({ userId: userB.id, companyId: companyB.id }, async () =>
    prisma.project.create({ data: { name: "Project B", companyId: companyB.id } })
  );

  const standardA = await runWithAuthContextAsync({ userId: userA.id, companyId: companyA.id }, async () =>
    prisma.standard.create({ data: { name: "StdA", description: null, projectId: projectA.id } })
  );
  const standardB = await runWithAuthContextAsync({ userId: userB.id, companyId: companyB.id }, async () =>
    prisma.standard.create({ data: { name: "StdB", description: null, projectId: projectB.id } })
  );

  const fragnetA = await runWithAuthContextAsync({ userId: userA.id, companyId: companyA.id }, async () =>
    prisma.fragnet.create({ data: { name: "FragA", description: null, standardId: standardA.id, projectId: projectA.id } })
  );
  const fragnetB = await runWithAuthContextAsync({ userId: userB.id, companyId: companyB.id }, async () =>
    prisma.fragnet.create({ data: { name: "FragB", description: null, standardId: standardB.id, projectId: projectB.id } })
  );

  const deliverableA = await runWithAuthContextAsync({ userId: userA.id, companyId: companyA.id }, async () =>
    prisma.deliverable.create({
      data: { name: "DelA", bestDuration: 1, likelyDuration: 1, fragnetId: fragnetA.id, assignedResources: [], projectId: projectA.id, externalProjectId: null },
    })
  );
  const deliverableB = await runWithAuthContextAsync({ userId: userB.id, companyId: companyB.id }, async () =>
    prisma.deliverable.create({
      data: { name: "DelB", bestDuration: 1, likelyDuration: 1, fragnetId: fragnetB.id, assignedResources: [], projectId: projectB.id, externalProjectId: null },
    })
  );

  const activityA = await runWithAuthContextAsync({ userId: userA.id, companyId: companyA.id }, async () =>
    prisma.activity.create({
      data: {
        fragnetId: fragnetA.id,
        deliverableId: deliverableA.id,
        activityCode: "A1",
        name: "ActA",
        bestDuration: 1,
        likelyDuration: 1,
        assuranceNoteId: null,
        assignedResources: [],
        projectId: projectA.id,
      },
    })
  );
  const activityB = await runWithAuthContextAsync({ userId: userB.id, companyId: companyB.id }, async () =>
    prisma.activity.create({
      data: {
        fragnetId: fragnetB.id,
        deliverableId: deliverableB.id,
        activityCode: "B1",
        name: "ActB",
        bestDuration: 1,
        likelyDuration: 1,
        assuranceNoteId: null,
        assignedResources: [],
        projectId: projectB.id,
      },
    })
  );

  const assuranceNoteA = await runWithAuthContextAsync({ userId: userA.id, companyId: companyA.id }, async () =>
    prisma.assuranceNote.create({
      data: { noteText: "Note A", standardId: standardA.id, projectId: projectA.id },
    })
  );
  const assuranceNoteB = await runWithAuthContextAsync({ userId: userB.id, companyId: companyB.id }, async () =>
    prisma.assuranceNote.create({
      data: { noteText: "Note B", standardId: standardB.id, projectId: projectB.id },
    })
  );

  return {
    companyA,
    companyB,
    userA,
    userB,
    projectA,
    projectB,
    standardA,
    standardB,
    fragnetA,
    fragnetB,
    deliverableA,
    deliverableB,
    activityA,
    activityB,
    assuranceNoteA,
    assuranceNoteB,
  };
}

async function cleanup(seedData) {
  // Delete tenant-owned rows in their own contexts (middleware requires company context).
  await runWithAuthContextAsync({ userId: seedData.userA.id, companyId: seedData.companyA.id }, async () => {
    await prisma.relationship.deleteMany({});
    await prisma.activity.deleteMany({});
    await prisma.deliverable.deleteMany({});
    await prisma.fragnet.deleteMany({});
    await prisma.assuranceNote.deleteMany({});
    await prisma.standard.deleteMany({});
    await prisma.project.deleteMany({});
  });
  await runWithAuthContextAsync({ userId: seedData.userB.id, companyId: seedData.companyB.id }, async () => {
    await prisma.relationship.deleteMany({});
    await prisma.activity.deleteMany({});
    await prisma.deliverable.deleteMany({});
    await prisma.fragnet.deleteMany({});
    await prisma.assuranceNote.deleteMany({});
    await prisma.standard.deleteMany({});
    await prisma.project.deleteMany({});
  });

  // Users/companies are not company-scoped in Prisma extension, so can delete directly.
  const bootstrapCtx = { userId: "bootstrap", companyId: "bootstrap" };
  await runWithAuthContextAsync(bootstrapCtx, async () => {
    await prisma.user.deleteMany({ where: { id: { in: [seedData.userA.id, seedData.userB.id] } } });
    await prisma.company.deleteMany({ where: { id: { in: [seedData.companyA.id, seedData.companyB.id] } } });
  });
}

let seedData;
test.before(async () => {
  seedData = await seed();
});
test.after(async () => {
  if (seedData) await cleanup(seedData);
  await prisma.$disconnect();
});

test("Test 1: cross-company READ must fail", async () => {
  const got = await runWithAuthContextAsync({ userId: seedData.userA.id, companyId: seedData.companyA.id }, async () =>
    prisma.standard.findFirst({ where: { id: seedData.standardB.id } })
  );
  assert.equal(got, null);
});

test("Test 2: cross-company UPDATE must fail", async () => {
  const result = await runWithAuthContextAsync({ userId: seedData.userA.id, companyId: seedData.companyA.id }, async () =>
    prisma.standard.updateMany({ where: { id: seedData.standardB.id }, data: { name: "HACK" } })
  );
  assert.equal(result.count, 0);
});

test("Test 3: cross-company DELETE must fail", async () => {
  const result = await runWithAuthContextAsync({ userId: seedData.userA.id, companyId: seedData.companyA.id }, async () =>
    prisma.assuranceNote.deleteMany({ where: { id: seedData.assuranceNoteB.id } })
  );
  assert.equal(result.count, 0);
});

test("Test 4: cross-company CREATE with foreign ID must fail (no silent mismatch)", async () => {
  // Attack scenario: create a Company A row that points at a Company B foreign key.
  // This must be rejected (ideally by a DB FK constraint), not silently accepted.
  await assert.rejects(() =>
    runWithAuthContextAsync({ userId: seedData.userA.id, companyId: seedData.companyA.id }, async () =>
      prisma.activity.create({
        data: {
          fragnetId: seedData.fragnetA.id,
          deliverableId: seedData.deliverableB.id, // foreign-company deliverable
          projectId: seedData.projectA.id,
          activityCode: "X-TENANT-FK",
          name: "Cross-tenant FK attempt",
          bestDuration: 1,
          likelyDuration: 1,
          assignedResources: [],
        },
      })
    )
  );
});

test("Test 5: findUnique bypass test (must be scoped)", async () => {
  const got = await runWithAuthContextAsync({ userId: seedData.userA.id, companyId: seedData.companyA.id }, async () =>
    prisma.activity.findUnique({ where: { id: seedData.activityB.id } })
  );
  assert.equal(got, null);
});

test("Test 6: nested relation leak test (include activities)", async () => {
  const got = await runWithAuthContextAsync({ userId: seedData.userA.id, companyId: seedData.companyA.id }, async () =>
    prisma.fragnet.findFirst({ where: { id: seedData.fragnetA.id }, include: { activities: true } })
  );
  assert.ok(got);
  assert.equal(got.activities.every((a) => a.companyId === seedData.companyA.id), true);
});

test("Test 7: createMany enforcement (companyId injected)", async () => {
  const created = await runWithAuthContextAsync({ userId: seedData.userA.id, companyId: seedData.companyA.id }, async () =>
    prisma.assuranceNote.createMany({
      data: [
        {
          noteText: "Bulk note 1",
          standardId: seedData.standardA.id,
          projectId: seedData.projectA.id,
        },
        {
          noteText: "Bulk note 2",
          standardId: seedData.standardA.id,
          projectId: seedData.projectA.id,
        },
      ],
    })
  );
  assert.equal(created.count, 2);

  const rows = await runWithAuthContextAsync({ userId: seedData.userA.id, companyId: seedData.companyA.id }, async () =>
    prisma.assuranceNote.findMany({ where: { noteText: { in: ["Bulk note 1", "Bulk note 2"] } } })
  );
  assert.equal(rows.length, 2);
  assert.equal(rows.every((r) => r.companyId === seedData.companyA.id), true);
});

