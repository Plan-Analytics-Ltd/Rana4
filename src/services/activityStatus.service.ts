import { prisma } from "../utils/prisma.js";
import type { AuthedUser } from "./projectAccess.service.js";
import { auditLog } from "./audit.service.js";
import { requireProjectAccess } from "./projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { canTransition, type ActivityStatus } from "../workflows/activityWorkflow.js";

export async function transitionActivityStatus(input: {
  activityId: string;
  nextStatus: ActivityStatus;
  actor: AuthedUser;
}): Promise<{ updated: unknown; from: ActivityStatus; to: ActivityStatus; projectId: string }> {
  const { activityId, nextStatus, actor } = input;

  const existing = await prisma.activity.findFirst({ where: { id: activityId, companyId: actor.companyId } });
  if (!existing) {
    const err = new Error("Activity not found");
    (err as any).status = 404;
    throw err;
  }

  const membership = await requireProjectAccess(existing.projectId, actor);
  // Transition is an update, and contextual rules depend on the current status.
  requirePermission(membership.role, "activity", "update", { status: existing.status, operation: "transition" });

  const from = existing.status as ActivityStatus;
  const to = nextStatus;
  if (!canTransition(from, to)) {
    const err = new Error("Invalid state transition");
    (err as any).status = 400;
    throw err;
  }

  const updated = await prisma.activity.update({
    where: { id: activityId },
    data: { status: to as any },
  });

  await auditLog({
    userId: actor.id,
    companyId: actor.companyId,
    projectId: existing.projectId,
    action: "ACTIVITY_STATUS_CHANGED",
    entity: "Activity",
    entityId: activityId,
    details: { from, to },
  });

  return { updated, from, to, projectId: existing.projectId };
}

