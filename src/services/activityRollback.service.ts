import { prisma } from "../utils/prisma.js";
import type { AuthedUser } from "./projectAccess.service.js";
import { requireProjectAccess } from "./projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { auditLog } from "./audit.service.js";
import { auditUpdateIfChanged } from "./auditDiff.service.js";
import { getActivityVersions } from "./activityVersions.service.js";

const ROLLBACK_FIELDS = ["name", "deliverableId", "bestDuration", "likelyDuration", "assuranceNoteId", "assignedResources"] as const;

export async function rollbackActivityToVersion(input: {
  activityId: string;
  targetVersion: number;
  actor: AuthedUser;
}): Promise<{ updated: unknown; fromVersion: number; toVersion: number }> {
  const { activityId, targetVersion, actor } = input;

  const current = await prisma.activity.findFirst({ where: { id: activityId, companyId: actor.companyId } });
  if (!current) {
    const err = new Error("Activity not found");
    (err as any).status = 404;
    throw err;
  }

  const membership = await requireProjectAccess(current.projectId, actor);
  // Admin-only rollback (frontend requirement backed by backend enforcement).
  if (membership.role !== "ADMIN") {
    const err = new Error("Forbidden");
    (err as any).status = 403;
    throw err;
  }

  // Respect contextual rules: cannot rollback LOCKED.
  requirePermission(membership.role, "activity", "update", { status: current.status, operation: "rollback" });

  const versions = await getActivityVersions(activityId, actor);
  const fromVersion = versions.length;
  const toVersion = Math.floor(Number(targetVersion));
  if (!Number.isFinite(toVersion) || toVersion < 1 || toVersion > versions.length) {
    const err = new Error("Invalid targetVersion");
    (err as any).status = 400;
    throw err;
  }

  const target = versions[toVersion - 1]!;
  const desiredState: any = target.state;

  // Do not rollback workflow status via this endpoint (keeps state machine authoritative).
  // Rollback focuses on meaningful editable fields only.
  const data: any = {};
  for (const f of ROLLBACK_FIELDS) data[f] = desiredState[f];

  const before = await prisma.activity.findFirst({ where: { id: activityId, companyId: actor.companyId } });
  const updated = await prisma.activity.update({ where: { id: activityId }, data });

  await auditUpdateIfChanged({
    userId: actor.id,
    companyId: actor.companyId,
    projectId: current.projectId,
    action: "UPDATE_ACTIVITY",
    entity: "Activity",
    entityId: activityId,
    before: before as any,
    after: updated as any,
    fields: ROLLBACK_FIELDS as unknown as string[],
  });

  await auditLog({
    userId: actor.id,
    companyId: actor.companyId,
    projectId: current.projectId,
    action: "ACTIVITY_ROLLBACK",
    entity: "Activity",
    entityId: activityId,
    details: { type: "activity.rollback", fromVersion, toVersion },
  });

  return { updated, fromVersion, toVersion };
}

