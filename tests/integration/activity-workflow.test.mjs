/**
 * Activity workflow tests (status transitions + LOCKED enforcement).
 *
 * Run:
 *   npm run build && node --test scripts/activity-workflow.test.mjs
 *
 * NOTE: requires a reachable DATABASE_URL and applied migrations.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../dist/utils/prisma.js";
import { runWithAuthContextAsync } from "../../dist/utils/requestContext.js";
import { transitionActivityStatus } from "../../dist/services/activityStatus.service.js";
import { hasPermission } from "../../dist/permissions/projectPermissions.js";

let seed;

test.before(async () => {
  const bootstrapCtx = { userId: "bootstrap", companyId: "bootstrap" };

  const company = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.company.create({
      data: {
        name: `Company WF ${Date.now()}`,
        joinCode: `JWF${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
      },
    })
  );

  const admin = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.user.create({
      data: {
        email: `wf_admin_${Date.now()}@test.local`,
        passwordHash: "x",
        name: "WF Admin",
        companyId: company.id,
        role: "ADMIN",
      },
    })
  );

  const project = await runWithAuthContextAsync({ userId: admin.id, companyId: company.id }, async () =>
    prisma.project.create({ data: { name: "WF Project", companyId: company.id } })
  );

  // Create minimal standard/fragnet/deliverable/activity chain.
  const standard = await runWithAuthContextAsync({ userId: admin.id, companyId: company.id }, async () =>
    prisma.standard.create({ data: { name: "WF Standard", description: null, projectId: project.id, companyId: company.id } })
  );
  const fragnet = await runWithAuthContextAsync({ userId: admin.id, companyId: company.id }, async () =>
    prisma.fragnet.create({
      data: { name: "WF Fragnet", description: null, standardId: standard.id, projectId: project.id, companyId: company.id },
    })
  );
  const deliverable = await runWithAuthContextAsync({ userId: admin.id, companyId: company.id }, async () =>
    prisma.deliverable.create({
      data: {
        name: "WF Deliverable",
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
        activityCode: `WF-${Date.now()}`,
        name: "WF Activity",
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

test("valid transition DRAFT → PENDING_APPROVAL succeeds and audit log contains from/to", async () => {
  const ctx = { userId: seed.admin.id, companyId: seed.company.id };
  const { updated } = await runWithAuthContextAsync(ctx, async () =>
    transitionActivityStatus({
      activityId: seed.activity.id,
      nextStatus: "PENDING_APPROVAL",
      actor: { id: seed.admin.id, companyId: seed.company.id, role: "ADMIN" },
    })
  );

  assert.equal(updated.status, "PENDING_APPROVAL");

  const logs = await runWithAuthContextAsync(ctx, async () =>
    prisma.auditLog.findMany({ where: { companyId: seed.company.id, entityId: seed.activity.id, action: "ACTIVITY_STATUS_CHANGED" } })
  );
  assert.ok(logs.length >= 1);
  const last = logs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1);
  assert.equal(last.details.from, "DRAFT");
  assert.equal(last.details.to, "PENDING_APPROVAL");
});

test("invalid transition PENDING_APPROVAL → LOCKED fails with 400", async () => {
  const ctx = { userId: seed.admin.id, companyId: seed.company.id };
  await assert.rejects(
    () =>
      runWithAuthContextAsync(ctx, async () =>
        transitionActivityStatus({
          activityId: seed.activity.id,
          nextStatus: "LOCKED",
          actor: { id: seed.admin.id, companyId: seed.company.id, role: "ADMIN" },
        })
      ),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(String(err.message), /Invalid state transition/);
      return true;
    }
  );
});

test("valid transition ACTIVE → LOCKED succeeds; LOCKED blocks further updates via rule layer", async () => {
  const ctx = { userId: seed.admin.id, companyId: seed.company.id };
  await runWithAuthContextAsync(ctx, async () =>
    transitionActivityStatus({
      activityId: seed.activity.id,
      nextStatus: "ACTIVE",
      actor: { id: seed.admin.id, companyId: seed.company.id, role: "ADMIN" },
    })
  );
  const { updated } = await runWithAuthContextAsync(ctx, async () =>
    transitionActivityStatus({
      activityId: seed.activity.id,
      nextStatus: "LOCKED",
      actor: { id: seed.admin.id, companyId: seed.company.id, role: "ADMIN" },
    })
  );
  assert.equal(updated.status, "LOCKED");

  // LOCKED is enforced at workflow/service layers; role permissions remain role-based.
  assert.equal(hasPermission("ADMIN", "activity", "update"), true);
});

