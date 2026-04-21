/**
 * Audit diff tests (compute + auditUpdateIfChanged behavior).
 *
 * Run:
 *   npm run build && node --test scripts/audit-diff.test.mjs
 *
 * NOTE: requires a reachable DATABASE_URL and applied migrations.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../dist/utils/prisma.js";
import { runWithAuthContextAsync } from "../dist/utils/requestContext.js";
import { computeUpdateDiff, auditUpdateIfChanged } from "../dist/services/auditDiff.service.js";

test("computeUpdateDiff only includes changed allowlisted fields", () => {
  const before = { name: "A", description: "x", createdAt: new Date("2020-01-01T00:00:00.000Z") };
  const after = { name: "B", description: "x", createdAt: new Date("2020-01-02T00:00:00.000Z") };
  const details = computeUpdateDiff(before, after, ["name", "description"]);
  assert.equal(details.type, "update");
  assert.deepEqual(details.changes, { name: { from: "A", to: "B" } });
});

test("computeUpdateDiff returns null when no changes", () => {
  const before = { name: "A" };
  const after = { name: "A" };
  assert.equal(computeUpdateDiff(before, after, ["name"]), null);
});

test("auditUpdateIfChanged writes an audit log only when there are changes", async () => {
  const bootstrapCtx = { userId: "bootstrap", companyId: "bootstrap" };
  const company = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.company.create({
      data: {
        name: `Company AD ${Date.now()}`,
        joinCode: `JAD${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
      },
    })
  );
  const user = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.user.create({
      data: {
        email: `auditdiff_${Date.now()}@test.local`,
        passwordHash: "x",
        name: "AuditDiff",
        companyId: company.id,
        role: "ADMIN",
      },
    })
  );
  const project = await runWithAuthContextAsync({ userId: user.id, companyId: company.id }, async () =>
    prisma.project.create({ data: { name: "AD Project", companyId: company.id } })
  );

  const ctx = { userId: user.id, companyId: company.id };

  // No changes → no audit log
  const res1 = await runWithAuthContextAsync(ctx, async () =>
    auditUpdateIfChanged({
      userId: user.id,
      companyId: company.id,
      projectId: project.id,
      action: "UPDATE_STANDARD",
      entity: "Standard",
      entityId: "std1",
      before: { name: "Same" },
      after: { name: "Same" },
      fields: ["name"],
    })
  );
  assert.equal(res1.logged, false);

  // Changes → audit log written
  const res2 = await runWithAuthContextAsync(ctx, async () =>
    auditUpdateIfChanged({
      userId: user.id,
      companyId: company.id,
      projectId: project.id,
      action: "UPDATE_STANDARD",
      entity: "Standard",
      entityId: "std2",
      before: { name: "Before" },
      after: { name: "After" },
      fields: ["name"],
    })
  );
  assert.equal(res2.logged, true);
  assert.ok(res2.details);
  assert.equal(res2.details.type, "update");
  assert.deepEqual(res2.details.changes.name, { from: "Before", to: "After" });

  const logs = await runWithAuthContextAsync(ctx, async () =>
    prisma.auditLog.findMany({
      where: { companyId: company.id, projectId: project.id, entityId: "std2", action: "UPDATE_STANDARD" },
      orderBy: { createdAt: "desc" },
      take: 1,
    })
  );
  assert.equal(logs.length, 1);
  assert.equal(logs[0].details.type, "update");
  assert.deepEqual(logs[0].details.changes.name, { from: "Before", to: "After" });

  // cleanup
  await runWithAuthContextAsync(ctx, async () => {
    await prisma.auditLog.deleteMany({ where: { companyId: company.id } });
    await prisma.project.deleteMany({ where: { id: project.id } });
  });
  await runWithAuthContextAsync(bootstrapCtx, async () => {
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.company.deleteMany({ where: { id: company.id } });
  });
  await prisma.$disconnect();
});

