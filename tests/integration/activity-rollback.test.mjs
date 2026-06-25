/**
 * Activity version reconstruction + rollback tests.
 *
 * Run:
 *   npm run build && node --test scripts/activity-rollback.test.mjs
 *
 * NOTE: requires a reachable DATABASE_URL and applied migrations.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../dist/utils/prisma.js";
import { runWithAuthContextAsync } from "../../dist/utils/requestContext.js";
import { getActivityVersions } from "../../dist/services/activityVersions.service.js";
import { rollbackActivityToVersion } from "../../dist/services/activityRollback.service.js";
import { transitionActivityStatus } from "../../dist/services/activityStatus.service.js";

let seed;

test.before(async () => {
  const bootstrapCtx = { userId: "bootstrap", companyId: "bootstrap" };

  const company = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.company.create({
      data: {
        name: `Company RB ${Date.now()}`,
        joinCode: `JRB${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
      },
    })
  );

  const admin = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.user.create({
      data: {
        email: `rb_admin_${Date.now()}@test.local`,
        passwordHash: "x",
        name: "RB Admin",
        companyId: company.id,
        role: "ADMIN",
      },
    })
  );

  const project = await runWithAuthContextAsync({ userId: admin.id, companyId: company.id }, async () =>
    prisma.project.create({ data: { name: "RB Project", companyId: company.id } })
  );

  const standard = await runWithAuthContextAsync({ userId: admin.id, companyId: company.id }, async () =>
    prisma.standard.create({ data: { name: "RB Standard", description: null, projectId: project.id, companyId: company.id } })
  );
  const fragnet = await runWithAuthContextAsync({ userId: admin.id, companyId: company.id }, async () =>
    prisma.fragnet.create({
      data: { name: "RB Fragnet", description: null, standardId: standard.id, projectId: project.id, companyId: company.id },
    })
  );
  const deliverable = await runWithAuthContextAsync({ userId: admin.id, companyId: company.id }, async () =>
    prisma.deliverable.create({
      data: {
        name: "RB Deliverable",
        bestDuration: 1,
        likelyDuration: 1,
        fragnetId: fragnet.id,
        assignedResources: [],
        projectId: project.id,
        companyId: company.id,
      },
    })
  );
  const activity = await runWithAuthContextAsync({ userId: admin.id, companyId: company.id }, async () =>
    prisma.activity.create({
      data: {
        fragnetId: fragnet.id,
        deliverableId: deliverable.id,
        activityCode: `RB-${Date.now()}`,
        name: "Name v1",
        bestDuration: 1,
        likelyDuration: 1,
        assignedResources: [],
        projectId: project.id,
        companyId: company.id,
      },
    })
  );

  seed = { company, admin, project, standard, fragnet, deliverable, activity };
});

test.after(async () => {
  if (!seed) return;
  await runWithAuthContextAsync({ userId: seed.admin.id, companyId: seed.company.id }, async () => {
    await prisma.auditLog.deleteMany({ where: { companyId: seed.company.id } });
    await prisma.relationship.deleteMany({ where: { companyId: seed.company.id } });
    await prisma.activity.deleteMany({ where: { id: seed.activity.id } });
    await prisma.deliverable.deleteMany({ where: { id: seed.deliverable.id } });
    await prisma.fragnet.deleteMany({ where: { id: seed.fragnet.id } });
    await prisma.standard.deleteMany({ where: { id: seed.standard.id } });
    await prisma.project.deleteMany({ where: { id: seed.project.id } });
  });
  const bootstrapCtx = { userId: "bootstrap", companyId: "bootstrap" };
  await runWithAuthContextAsync(bootstrapCtx, async () => {
    await prisma.user.deleteMany({ where: { id: seed.admin.id } });
    await prisma.company.deleteMany({ where: { id: seed.company.id } });
  });
  await prisma.$disconnect();
});

test("reconstructs history from diffs and rollbacks to target version", async () => {
  const actor = { id: seed.admin.id, companyId: seed.company.id, role: "ADMIN" };
  const ctx = { userId: seed.admin.id, companyId: seed.company.id };

  // Update name to v2 then v3 (creates diffs).
  await runWithAuthContextAsync(ctx, async () =>
    prisma.activity.update({ where: { id: seed.activity.id }, data: { name: "Name v2" } })
  );
  await runWithAuthContextAsync(ctx, async () =>
    prisma.auditLog.create({
      data: {
        userId: seed.admin.id,
        companyId: seed.company.id,
        projectId: seed.project.id,
        action: "UPDATE_ACTIVITY",
        entity: "Activity",
        entityId: seed.activity.id,
        details: { type: "update", changes: { name: { from: "Name v1", to: "Name v2" } } },
      },
    })
  );
  await runWithAuthContextAsync(ctx, async () =>
    prisma.activity.update({ where: { id: seed.activity.id }, data: { name: "Name v3" } })
  );
  await runWithAuthContextAsync(ctx, async () =>
    prisma.auditLog.create({
      data: {
        userId: seed.admin.id,
        companyId: seed.company.id,
        projectId: seed.project.id,
        action: "UPDATE_ACTIVITY",
        entity: "Activity",
        entityId: seed.activity.id,
        details: { type: "update", changes: { name: { from: "Name v2", to: "Name v3" } } },
      },
    })
  );

  const versions = await runWithAuthContextAsync(ctx, async () => getActivityVersions(seed.activity.id, actor));
  assert.ok(versions.length >= 3);
  assert.equal(versions[0].state.name, "Name v1");
  assert.equal(versions.at(-1).state.name, "Name v3");

  // Roll back to version where name was v1.
  const toVersion = 1;
  const rb = await runWithAuthContextAsync(ctx, async () =>
    rollbackActivityToVersion({ activityId: seed.activity.id, targetVersion: toVersion, actor })
  );
  assert.equal(rb.toVersion, toVersion);

  const now = await runWithAuthContextAsync(ctx, async () =>
    prisma.activity.findFirst({ where: { id: seed.activity.id, companyId: seed.company.id } })
  );
  assert.equal(now.name, "Name v1");

  const rollbackLogs = await runWithAuthContextAsync(ctx, async () =>
    prisma.auditLog.findMany({ where: { companyId: seed.company.id, action: "ACTIVITY_ROLLBACK", entityId: seed.activity.id } })
  );
  assert.ok(rollbackLogs.length >= 1);
});

test("cannot rollback locked activity", async () => {
  const actor = { id: seed.admin.id, companyId: seed.company.id, role: "ADMIN" };
  const ctx = { userId: seed.admin.id, companyId: seed.company.id };

  // Transition through approval flow to reach ACTIVE, then LOCKED.
  await runWithAuthContextAsync(ctx, async () =>
    transitionActivityStatus({ activityId: seed.activity.id, nextStatus: "PENDING_APPROVAL", actor })
  );
  await runWithAuthContextAsync(ctx, async () =>
    transitionActivityStatus({ activityId: seed.activity.id, nextStatus: "ACTIVE", actor })
  );
  await runWithAuthContextAsync(ctx, async () =>
    transitionActivityStatus({ activityId: seed.activity.id, nextStatus: "LOCKED", actor })
  );

  await assert.rejects(
    () => runWithAuthContextAsync(ctx, async () => rollbackActivityToVersion({ activityId: seed.activity.id, targetVersion: 1, actor })),
    (err) => {
      assert.equal(err.status, 409);
      return true;
    }
  );
});

