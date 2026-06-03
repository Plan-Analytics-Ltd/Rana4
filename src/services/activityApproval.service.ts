import { prisma } from "../utils/prisma.js";
import type { AuthedUser } from "./projectAccess.service.js";
import { requireProjectAccess } from "./projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { canTransition, type ActivityStatus } from "../workflows/activityWorkflow.js";
import { auditLog } from "./audit.service.js";

type ApprovalAction = "submit" | "approve" | "reject";

function actionToNextStatus(action: ApprovalAction): ActivityStatus {
  if (action === "submit") return "PENDING_APPROVAL";
  if (action === "approve") return "ACTIVE";
  return "DRAFT";
}

function actionToAudit(action: ApprovalAction): string {
  if (action === "submit") return "ACTIVITY_SUBMITTED";
  if (action === "approve") return "ACTIVITY_APPROVED";
  return "ACTIVITY_REJECTED";
}

export async function changeApprovalState(input: {
  activityId: string;
  action: ApprovalAction;
  actor: AuthedUser;
  comment?: string | null;
}): Promise<{ updated: unknown; from: ActivityStatus; to: ActivityStatus }> {
  const { activityId, action, actor } = input;
  const comment = input.comment != null ? String(input.comment).trim() : "";

  const existing = await prisma.activity.findFirst({ where: { id: activityId, companyId: actor.companyId } });
  if (!existing) {
    const err = new Error("Activity not found");
    (err as any).status = 404;
    throw err;
  }

  const membership = await requireProjectAccess(existing.projectId, actor);

  if (action === "submit") {
    // Requires EDITOR (ADMIN also allowed by role map; explicit check keeps intent clear).
    if (membership.role !== "EDITOR" && membership.role !== "ADMIN") {
      const err = new Error("Forbidden");
      (err as any).status = 403;
      throw err;
    }
  } else {
    // Approve / reject require ADMIN.
    if (membership.role !== "ADMIN") {
      const err = new Error("Forbidden");
      (err as any).status = 403;
      throw err;
    }
  }

  // Transition is still an update, but must bypass "DRAFT-only edit" rule.
  requirePermission(membership.role, "activity", "update", { status: existing.status, operation: "transition" });

  const from = existing.status as ActivityStatus;
  const to = actionToNextStatus(action);

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
    action: actionToAudit(action),
    entity: "Activity",
    entityId: activityId,
    details: { from, to, ...(comment ? { comment } : {}) },
  });

  return { updated, from, to };
}
