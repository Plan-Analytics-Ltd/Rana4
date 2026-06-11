/**
 * Project-level access tests (membership + admin override).
 *
 * Run:
 *   npm run build && node --test scripts/project-access.test.mjs
 *
 * NOTE: requires a reachable DATABASE_URL and applied migrations.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../dist/utils/prisma.js";
import { runWithAuthContextAsync } from "../dist/utils/requestContext.js";
import { requireProjectAccess } from "../dist/services/projectAccess.service.js";

let seed;

test.before(async () => {
  const bootstrapCtx = { userId: "bootstrap", companyId: "bootstrap" };

  const companyA = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.company.create({
      data: {
        name: "Company A",
        joinCode: `JPA${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
      },
    })
  );
  const companyB = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.company.create({
      data: {
        name: "Company B",
        joinCode: `JPB${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
      },
    })
  );

  const adminA = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.user.create({
      data: { email: `admina_${Date.now()}@test.local`, passwordHash: "x", name: "AdminA", companyId: companyA.id, role: "ADMIN" },
    })
  );
  const memberA = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.user.create({
      data: { email: `membera_${Date.now()}@test.local`, passwordHash: "x", name: "MemberA", companyId: companyA.id, role: "VIEWER" },
    })
  );
  const memberB = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.user.create({
      data: { email: `memberb_${Date.now()}@test.local`, passwordHash: "x", name: "MemberB", companyId: companyB.id, role: "VIEWER" },
    })
  );

  const projectA = await runWithAuthContextAsync({ userId: adminA.id, companyId: companyA.id }, async () =>
    prisma.project.create({ data: { name: "Project A", companyId: companyA.id } })
  );
  const projectB = await runWithAuthContextAsync({ userId: memberB.id, companyId: companyB.id }, async () =>
    prisma.project.create({ data: { name: "Project B", companyId: companyB.id } })
  );

  // MemberA is assigned to ProjectA as MEMBER.
  await runWithAuthContextAsync({ userId: adminA.id, companyId: companyA.id }, async () => {
    await prisma.projectMember.create({ data: { userId: memberA.id, projectId: projectA.id, role: "VIEWER" } });
  });

  seed = { companyA, companyB, adminA, memberA, memberB, projectA, projectB };
});

test.after(async () => {
  if (!seed) return;
  await runWithAuthContextAsync({ userId: seed.adminA.id, companyId: seed.companyA.id }, async () => {
    await prisma.projectMember.deleteMany({});
    await prisma.project.deleteMany({ where: { id: seed.projectA.id } });
  });
  await runWithAuthContextAsync({ userId: seed.memberB.id, companyId: seed.companyB.id }, async () => {
    await prisma.projectMember.deleteMany({});
    await prisma.project.deleteMany({ where: { id: seed.projectB.id } });
  });
  const bootstrapCtx = { userId: "bootstrap", companyId: "bootstrap" };
  await runWithAuthContextAsync(bootstrapCtx, async () => {
    await prisma.user.deleteMany({ where: { id: { in: [seed.adminA.id, seed.memberA.id, seed.memberB.id] } } });
    await prisma.company.deleteMany({ where: { id: { in: [seed.companyA.id, seed.companyB.id] } } });
  });
  await prisma.$disconnect();
});

test("Member assigned to project can access", async () => {
  const got = await runWithAuthContextAsync({ userId: seed.memberA.id, companyId: seed.companyA.id }, async () =>
    requireProjectAccess(seed.projectA.id, { id: seed.memberA.id, companyId: seed.companyA.id, role: "VIEWER" })
  );
  assert.equal(got.projectId, seed.projectA.id);
  assert.equal(got.userId, seed.memberA.id);
});

test("Member not assigned cannot access", async () => {
  await assert.rejects(() =>
    runWithAuthContextAsync({ userId: seed.memberA.id, companyId: seed.companyA.id }, async () =>
      requireProjectAccess(seed.projectB.id, { id: seed.memberA.id, companyId: seed.companyA.id, role: "VIEWER" })
    )
  );
});

test("Company ADMIN override works within company", async () => {
  const got = await runWithAuthContextAsync({ userId: seed.adminA.id, companyId: seed.companyA.id }, async () =>
    requireProjectAccess(seed.projectA.id, { id: seed.adminA.id, companyId: seed.companyA.id, role: "ADMIN" })
  );
  assert.equal(got.role, "ADMIN");
});

test("Company ADMIN override does not bypass cross-company", async () => {
  await assert.rejects(() =>
    runWithAuthContextAsync({ userId: seed.adminA.id, companyId: seed.companyA.id }, async () =>
      requireProjectAccess(seed.projectB.id, { id: seed.adminA.id, companyId: seed.companyA.id, role: "ADMIN" })
    )
  );
});

