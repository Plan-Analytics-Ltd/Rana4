/**
 * Activity approval workflow tests.
 *
 * Run:
 *   npm run build && node --test scripts/activity-approval.test.mjs
 *
 * NOTE: requires a reachable DATABASE_URL and applied migrations.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../dist/utils/prisma.js";
import { runWithAuthContextAsync } from "../../dist/utils/requestContext.js";
import { changeApprovalState } from "../../dist/services/activityApproval.service.js";
import { hasPermission } from "../../dist/permissions/projectPermissions.js";

let seed;

test.before(async () => {
  const bootstrapCtx = { userId: "bootstrap", companyId: "bootstrap" };
  const company = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.company.create({
      data: {
        name: `Company AP ${Date.now()}`,
        joinCode: `JAP${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32),
      },
    })
  );
  const admin = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.user.create({
      data: {
        email: `ap_admin_${Date.now()}@test.local`,
        passwordHash: "x",
        name: "AP Admin",
        companyId: company.id,
        role: "ADMIN",
      },
    })
  );
  const editorUser = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.user.create({
      data: {
        email: `ap_editor_${Date.now()}@test.local`,
        passwordHash: "x",
        name: "AP Editor",
        companyId: company.id,
        role: "EDITOR",
      },
    })
  );
  const project = await runWithAuthContextAsync({ userId: admin.id, companyId: company.id }, async () =>
    prisma.project.create({ data: { name: "AP Project", companyId: company.id } })
  );
  await runWithAuthContextAsync({ userId: admin.id, companyId: company.id }, async () =>
    prisma.projectMember.create({ data: { userId: editorUser.id, projectId: project.id, role: "EDITOR" } })
  );

  const standard = await runWithAuthContextAsync({ userId: admin.id, companyId: company.id }, async () =>
    prisma.standard.create({ data: { name: "AP Standard", description: null, projectId: project.id, companyId: company.id } })
  );
  const fragnet = await runWithAuthContextAsync({ userId: admin.id, companyId: company.id }, async () =>
    prisma.fragnet.create({
      data: { name: "AP Fragnet", description: null, standardId: standard.id, projectId: project.id, companyId: company.id },
    })
  );
  const deliverable = await runWithAuthContextAsync({ userId: admin.id, companyId: company.id }, async () =>
    prisma.deliverable.create({
      data: {
        name: "AP Deliverable",
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
        activityCode: `AP-${Date.now()}`,
        name: "AP Activity",
        bestDuration: 1,
        likelyDuration: 1,
        assignedResources: [],
        projectId: project.id,
        companyId: company.id,
        status: "DRAFT",
      },
    })
  );

  seed = { company, admin, editorUser, project, standard, fragnet, deliverable, activity };
});

test.after(async () => {
  if (!seed) return;
  await runWithAuthContextAsync({ userId: seed.admin.id, companyId: seed.company.id }, async () => {
    await prisma.auditLog.deleteMany({ where: { companyId: seed.company.id } });
    await prisma.activity.deleteMany({ where: { id: seed.activity.id } });
    await prisma.deliverable.deleteMany({ where: { id: seed.deliverable.id } });
    await prisma.fragnet.deleteMany({ where: { id: seed.fragnet.id } });
    await prisma.standard.deleteMany({ where: { id: seed.standard.id } });
    await prisma.projectMember.deleteMany({ where: { projectId: seed.project.id } });
    await prisma.project.deleteMany({ where: { id: seed.project.id } });
  });
  const bootstrapCtx = { userId: "bootstrap", companyId: "bootstrap" };
  await runWithAuthContextAsync(bootstrapCtx, async () => {
    await prisma.user.deleteMany({ where: { id: { in: [seed.admin.id, seed.editorUser.id] } } });
    await prisma.company.deleteMany({ where: { id: seed.company.id } });
  });
  await prisma.$disconnect();
});

test("EDITOR can submit DRAFT → PENDING_APPROVAL", async () => {
  const ctx = { userId: seed.editorUser.id, companyId: seed.company.id };
  const actor = { id: seed.editorUser.id, companyId: seed.company.id, role: "EDITOR" };
  const { updated, from, to } = await runWithAuthContextAsync(ctx, async () =>
    changeApprovalState({ activityId: seed.activity.id, action: "submit", actor })
  );
  assert.equal(from, "DRAFT");
  assert.equal(to, "PENDING_APPROVAL");
  assert.equal(updated.status, "PENDING_APPROVAL");
});

test("ADMIN can approve PENDING_APPROVAL → ACTIVE", async () => {
  const ctx = { userId: seed.admin.id, companyId: seed.company.id };
  const actor = { id: seed.admin.id, companyId: seed.company.id, role: "ADMIN" };
  const { updated, to } = await runWithAuthContextAsync(ctx, async () =>
    changeApprovalState({ activityId: seed.activity.id, action: "approve", actor, comment: "LGTM" })
  );
  assert.equal(to, "ACTIVE");
  assert.equal(updated.status, "ACTIVE");
});

test("EDITOR retains role-based update permission while PENDING_APPROVAL", async () => {
  // Activity contextual rules were simplified to role-based permissions; approval gates live in workflow services.
  assert.equal(hasPermission("EDITOR", "activity", "update"), true);
});

