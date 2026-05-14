import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import { parseAndValidateAssignedResources } from "../services/rateCard.js";
import { assertDeliverableOnFragnet } from "../services/deliverableActivityLink.service.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { isPrismaForeignKeyViolation } from "../utils/prismaErrors.js";
import { auditLog } from "../services/audit.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { transitionActivityStatus } from "../services/activityStatus.service.js";
import { auditUpdateIfChanged } from "../services/auditDiff.service.js";
import { getActivityVersions } from "../services/activityVersions.service.js";
import { rollbackActivityToVersion } from "../services/activityRollback.service.js";
import { changeApprovalState } from "../services/activityApproval.service.js";
import { replaceActivityCodeAssignmentsForActivity } from "../services/activityCodeAssignments.service.js";

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

function parseDuration(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (Number.isNaN(n) || !Number.isInteger(n)) return null;
  return n;
}

export async function create(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const {
      fragnetId,
      deliverableId: deliverableIdRaw,
      activityCode,
      name,
      bestDuration: bestDurationRaw,
      likelyDuration: likelyDurationRaw,
      assuranceNoteId,
      assignedResources: assignedResourcesRaw,
      activityCodeByTypeId,
    } = req.body as {
      fragnetId?: string;
      deliverableId?: string;
      activityCode?: string;
      name?: string;
      bestDuration?: number;
      likelyDuration?: number;
      assuranceNoteId?: string | null;
      assignedResources?: unknown;
      activityCodeByTypeId?: Record<string, string | null>;
    };

    if (!fragnetId || String(fragnetId).trim() === "") {
      res.status(400).json({ error: "fragnetId is required" });
      return;
    }
    if (!deliverableIdRaw || String(deliverableIdRaw).trim() === "") {
      res.status(400).json({ error: "deliverableId is required" });
      return;
    }
    const deliverableId = String(deliverableIdRaw).trim();
    if (activityCode === undefined || activityCode === null || String(activityCode).trim() === "") {
      res.status(400).json({ error: "activityCode is required" });
      return;
    }
    if (name === undefined || name === null || String(name).trim() === "") {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const bestDuration = parseDuration(bestDurationRaw);
    const likelyDuration = parseDuration(likelyDurationRaw);
    if (bestDuration === null || bestDuration < 1) {
      res.status(400).json({ error: "bestDuration must be a positive integer" });
      return;
    }
    if (likelyDuration === null || likelyDuration < 1) {
      res.status(400).json({ error: "likelyDuration must be a positive integer" });
      return;
    }

    const fragnet = (await prisma.fragnet.findFirst({
      where: { id: fragnetId, companyId: req.user.companyId },
    })) as
      | {
          id: string;
          standardId: string;
          projectId: string;
        }
      | null;
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    const membership = await requireProjectAccess(fragnet.projectId, req.user);
    requirePermission(membership.role, "activity", "create");

    const deliverableCheck = await assertDeliverableOnFragnet(fragnet.id, deliverableId);
    if (!deliverableCheck.ok) {
      if (deliverableCheck.mismatch.kind === "not_found") {
        res.status(400).json({ error: "Deliverable not found" });
        return;
      }
      res.status(400).json({ error: "Deliverable must belong to the same fragnet as the activity" });
      return;
    }
    const { deliverable } = deliverableCheck;
    if (deliverable.projectId !== fragnet.projectId) {
      res.status(400).json({ error: "Deliverable must belong to the same project as the fragnet" });
      return;
    }

    const assuranceNoteIdTrimmed =
      assuranceNoteId != null && String(assuranceNoteId).trim() !== ""
        ? String(assuranceNoteId).trim()
        : null;
    if (assuranceNoteIdTrimmed) {
      const note = (await prisma.assuranceNote.findFirst({
        where: { id: assuranceNoteIdTrimmed, companyId: req.user.companyId },
      })) as { id: string; standardId: string; projectId: string } | null;
      if (!note) {
        res.status(400).json({ error: "Assurance note not found" });
        return;
      }
      if (note.standardId !== fragnet.standardId) {
        res.status(400).json({ error: "Assurance note must belong to the same standard as the fragnet" });
        return;
      }
    }

    const assignedParsed = await parseAndValidateAssignedResources(req.user.companyId, assignedResourcesRaw);
    if (!assignedParsed.ok) {
      res.status(400).json({ error: assignedParsed.error });
      return;
    }

    const createData = {
      fragnetId: fragnet.id,
      deliverableId: deliverable.id,
      activityCode: String(activityCode).trim(),
      name: String(name).trim(),
      bestDuration,
      likelyDuration,
      assuranceNoteId: assuranceNoteIdTrimmed,
      assignedResources: assignedParsed.assignments as Prisma.InputJsonValue,
      projectId: fragnet.projectId,
      companyId: req.user.companyId,
    };
    const activity = await prisma.activity.create({ data: createData });
    try {
      await replaceActivityCodeAssignmentsForActivity({
        companyId: req.user.companyId,
        activityId: activity.id,
        byTypeId: activityCodeByTypeId,
      });
    } catch (e) {
      const st = e && typeof e === "object" && "status" in e ? Number((e as any).status) : undefined;
      if (st === 400) {
        await prisma.activity.delete({ where: { id: activity.id } });
        res.status(400).json({ error: (e as Error).message || "Invalid activity codes" });
        return;
      }
      throw e;
    }
    const activityWithCodes = await prisma.activity.findFirstOrThrow({
      where: { id: activity.id, companyId: req.user.companyId },
      include: { activityCodeAssignments: { include: { type: true, code: true } } },
    });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: fragnet.projectId,
      action: "CREATE_ACTIVITY",
      entity: "Activity",
      entityId: activity.id,
    });
    res.status(201).json(activityWithCodes);
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      res.status(400).json({ error: "activityCode already exists for this fragnet" });
      return;
    }
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create activity" });
  }
}

export async function getByFragnetId(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId } = req.params;
    const fragnet = (await prisma.fragnet.findFirst({
      where: { id: fragnetId, companyId: req.user.companyId },
      include: { activities: { where: { companyId: req.user.companyId }, orderBy: { activityCode: "asc" }, include: { activityCodeAssignments: { include: { type: true, code: true } } } } },
    })) as ({ projectId: string; activities: unknown[] } & Record<string, unknown>) | null;
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    await requireProjectAccess(fragnet.projectId, req.user);
    res.json(fragnet.activities);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
}

export async function getById(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const activity = (await prisma.activity.findFirst({
      where: { id, companyId: req.user.companyId },
      include: { activityCodeAssignments: { include: { type: true, code: true } } },
    })) as { projectId: string } | null;
    if (!activity) {
      res.status(404).json({ error: "Activity not found" });
      return;
    }
    await requireProjectAccess(activity.projectId, req.user);
    res.json(activity);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
}

export async function update(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const {
      name,
      deliverableId: deliverableIdRaw,
      bestDuration: bestDurationRaw,
      likelyDuration: likelyDurationRaw,
      assuranceNoteId,
      assignedResources: assignedResourcesRaw,
      activityCodeByTypeId,
    } = req.body as {
      name?: string;
      deliverableId?: string;
      bestDuration?: number;
      likelyDuration?: number;
      assuranceNoteId?: string | null;
      assignedResources?: unknown;
      activityCodeByTypeId?: Record<string, string | null>;
    };

    const existing = (await prisma.activity.findFirst({
      where: { id, companyId: req.user.companyId },
    })) as { id: string; fragnetId: string; projectId: string; status: string } | null;
    if (!existing) {
      res.status(404).json({ error: "Activity not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "activity", "update", { status: existing.status, operation: "edit" });

    if (bestDurationRaw !== undefined) {
      const bestDuration = parseDuration(bestDurationRaw);
      if (bestDuration === null || bestDuration < 1) {
        res.status(400).json({ error: "bestDuration must be a positive integer" });
        return;
      }
    }
    if (likelyDurationRaw !== undefined) {
      const likelyDuration = parseDuration(likelyDurationRaw);
      if (likelyDuration === null || likelyDuration < 1) {
        res.status(400).json({ error: "likelyDuration must be a positive integer" });
        return;
      }
    }

    const assuranceNoteIdTrimmed =
      assuranceNoteId !== undefined
        ? assuranceNoteId != null && String(assuranceNoteId).trim() !== ""
          ? String(assuranceNoteId).trim()
          : null
        : undefined;
    if (assuranceNoteIdTrimmed !== undefined && assuranceNoteIdTrimmed !== null) {
      const fragnet = (await prisma.fragnet.findFirst({
        where: { id: existing.fragnetId, companyId: req.user.companyId },
      })) as { id: string; standardId: string } | null;
      const note = (await prisma.assuranceNote.findFirst({
        where: { id: assuranceNoteIdTrimmed, companyId: req.user.companyId },
      })) as { id: string; standardId: string; projectId: string } | null;
      if (!note || !fragnet || note.standardId !== fragnet.standardId) {
        res.status(400).json({ error: "Assurance note must belong to the same standard as the fragnet" });
        return;
      }
      if (note.projectId !== existing.projectId) {
        res.status(400).json({ error: "Assurance note must belong to the same project as the activity" });
        return;
      }
    }

    let resolvedDeliverableId: string | undefined;
    if (deliverableIdRaw !== undefined) {
      if (deliverableIdRaw === null || String(deliverableIdRaw).trim() === "") {
        res.status(400).json({ error: "deliverableId cannot be empty" });
        return;
      }
      const nextDeliverableId = String(deliverableIdRaw).trim();
      const deliverableCheck = await assertDeliverableOnFragnet(existing.fragnetId, nextDeliverableId);
      if (!deliverableCheck.ok) {
        if (deliverableCheck.mismatch.kind === "not_found") {
          res.status(400).json({ error: "Deliverable not found" });
          return;
        }
        res.status(400).json({ error: "Deliverable must belong to the same fragnet as the activity" });
        return;
      }
      resolvedDeliverableId = nextDeliverableId;
    }

    let assignedUpdate: Prisma.InputJsonValue | undefined;
    if (assignedResourcesRaw !== undefined) {
      const assignedParsed = await parseAndValidateAssignedResources(req.user.companyId, assignedResourcesRaw);
      if (!assignedParsed.ok) {
        res.status(400).json({ error: assignedParsed.error });
        return;
      }
      assignedUpdate = assignedParsed.assignments as Prisma.InputJsonValue;
    }

    const updateData = {
      ...(name !== undefined && { name: String(name).trim() }),
      ...(resolvedDeliverableId !== undefined && { deliverableId: resolvedDeliverableId }),
      ...(bestDurationRaw !== undefined && { bestDuration: parseDuration(bestDurationRaw)! }),
      ...(likelyDurationRaw !== undefined && { likelyDuration: parseDuration(likelyDurationRaw)! }),
      ...(assuranceNoteId !== undefined && { assuranceNoteId: assuranceNoteIdTrimmed ?? null }),
      ...(assignedUpdate !== undefined && { assignedResources: assignedUpdate }),
    };
    // Axios omits undefined JSON keys; the client may send only activityCodeByTypeId. Prisma rejects update({ data: {} }).
    const activity =
      Object.keys(updateData).length > 0
        ? await prisma.activity.update({
            where: { id },
            data: updateData,
          })
        : await prisma.activity.findFirstOrThrow({
            where: { id, companyId: req.user.companyId },
          });
    if (activityCodeByTypeId !== undefined) {
      try {
        await replaceActivityCodeAssignmentsForActivity({
          companyId: req.user.companyId,
          activityId: id,
          byTypeId: activityCodeByTypeId,
        });
      } catch (e) {
        const st = e && typeof e === "object" && "status" in e ? Number((e as any).status) : undefined;
        if (st === 400) {
          res.status(400).json({ error: (e as Error).message || "Invalid activity codes" });
          return;
        }
        throw e;
      }
    }

    const activityOut = await prisma.activity.findFirstOrThrow({
      where: { id: activity.id, companyId: req.user.companyId },
      include: { activityCodeAssignments: { include: { type: true, code: true } } },
    });
    await auditUpdateIfChanged({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "UPDATE_ACTIVITY",
      entity: "Activity",
      entityId: id,
      before: existing as any,
      after: activity as any,
      fields: ["name", "deliverableId", "bestDuration", "likelyDuration", "assuranceNoteId", "assignedResources"],
    });
    res.json(activityOut);
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update activity" });
  }
}

export async function remove(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const existing = (await prisma.activity.findFirst({
      where: { id, companyId: req.user.companyId },
    })) as { id: string; projectId: string; status: string } | null;
    if (!existing) {
      res.status(404).json({ error: "Activity not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    const dependencyCount = await prisma.relationship.count({
      where: {
        companyId: req.user.companyId,
        OR: [{ predecessorActivityId: id }, { successorActivityId: id }],
      },
    });
    requirePermission(membership.role, "activity", "delete", {
      status: existing.status,
      hasDependencies: dependencyCount > 0,
    });
    await prisma.activity.delete({ where: { id } });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "DELETE_ACTIVITY",
      entity: "Activity",
      entityId: id,
    });
    res.status(204).send();
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : undefined;
    if (status === 409) {
      res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
      return;
    }
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete activity" });
  }
}

export async function updateStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const { status } = req.body as { status?: string };
    const nextStatus = status != null ? String(status).trim() : "";
    if (nextStatus !== "DRAFT" && nextStatus !== "ACTIVE" && nextStatus !== "LOCKED") {
      res.status(400).json({ error: "status must be DRAFT, ACTIVE, or LOCKED" });
      return;
    }

    const { updated } = await transitionActivityStatus({
      activityId: id,
      nextStatus: nextStatus as any,
      actor: req.user,
    });
    res.json(updated);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : undefined;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    if (status === 409) {
      res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
      return;
    }
    if (status === 400) {
      res.status(400).json({ error: (err as Error).message || "Invalid state transition" });
      return;
    }
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Activity not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update activity status" });
  }
}

export async function getVersions(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const versions = await getActivityVersions(id, req.user);
    res.json({ versions });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Activity not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to load activity versions" });
  }
}

export async function rollback(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const { targetVersion } = req.body as { targetVersion?: number };
    const n = Number(targetVersion);
    if (!Number.isFinite(n)) {
      res.status(400).json({ error: "targetVersion is required" });
      return;
    }

    const result = await rollbackActivityToVersion({
      activityId: id,
      targetVersion: n,
      actor: req.user,
    });
    res.json(result);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 400) {
      res.status(400).json({ error: (err as Error).message || "Invalid targetVersion" });
      return;
    }
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Activity not found" });
      return;
    }
    if (status === 409) {
      res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to rollback activity" });
  }
}

export async function submit(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const { comment } = req.body as { comment?: string | null };
    const { updated } = await changeApprovalState({ activityId: id, action: "submit", actor: req.user, comment });
    res.json(updated);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 400) return void res.status(400).json({ error: (err as Error).message || "Invalid state transition" });
    if (status === 403) return void res.status(403).json({ error: (err as Error).message || "Forbidden" });
    if (status === 404) return void res.status(404).json({ error: (err as Error).message || "Activity not found" });
    if (status === 409) return void res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
    console.error(err);
    res.status(500).json({ error: "Failed to submit activity" });
  }
}

export async function approve(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const { comment } = req.body as { comment?: string | null };
    const { updated } = await changeApprovalState({ activityId: id, action: "approve", actor: req.user, comment });
    res.json(updated);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 400) return void res.status(400).json({ error: (err as Error).message || "Invalid state transition" });
    if (status === 403) return void res.status(403).json({ error: (err as Error).message || "Forbidden" });
    if (status === 404) return void res.status(404).json({ error: (err as Error).message || "Activity not found" });
    if (status === 409) return void res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
    console.error(err);
    res.status(500).json({ error: "Failed to approve activity" });
  }
}

export async function reject(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const { comment } = req.body as { comment?: string | null };
    const { updated } = await changeApprovalState({ activityId: id, action: "reject", actor: req.user, comment });
    res.json(updated);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 400) return void res.status(400).json({ error: (err as Error).message || "Invalid state transition" });
    if (status === 403) return void res.status(403).json({ error: (err as Error).message || "Forbidden" });
    if (status === 404) return void res.status(404).json({ error: (err as Error).message || "Activity not found" });
    if (status === 409) return void res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
    console.error(err);
    res.status(500).json({ error: "Failed to reject activity" });
  }
}
