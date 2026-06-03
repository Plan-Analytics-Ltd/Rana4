import type { Response } from "express";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { isPrismaForeignKeyViolation } from "../utils/prismaErrors.js";
import { auditLog } from "../services/audit.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { propagateDeliverableRelationshipsForProject } from "../services/deliverableRelationshipPropagation.service.js";
import { ensureProjectLevelActivityContext } from "../services/projectLevelActivityContext.service.js";
import { recalculateProjectScheduleAfterMutation } from "../services/scheduleAutoRecalc.service.js";

const RELATIONSHIP_TYPES = ["FS", "SS", "FF", "SF"] as const;

function isValidRelationshipType(value: unknown): value is "FS" | "SS" | "FF" | "SF" {
  return typeof value === "string" && RELATIONSHIP_TYPES.includes(value as (typeof RELATIONSHIP_TYPES)[number]);
}

function parseLag(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const n = Number(value);
  if (Number.isNaN(n) || !Number.isInteger(n)) return 0;
  return n;
}

async function getDeliverableContext(
  deliverableId: string,
  companyId: string
): Promise<{ id: string; fragnetId: string | null; projectId: string } | null> {
  const d = await prisma.deliverable.findFirst({
    where: { id: deliverableId, companyId },
    select: { id: true, fragnetId: true, projectId: true },
  });
  return d;
}

async function ensureDeliverableHasFragnet(
  deliverable: { id: string; fragnetId: string | null; projectId: string },
  companyId: string
): Promise<{ id: string; fragnetId: string; projectId: string }> {
  if (deliverable.fragnetId) {
    return { id: deliverable.id, fragnetId: deliverable.fragnetId, projectId: deliverable.projectId };
  }
  const ctx = await ensureProjectLevelActivityContext(deliverable.projectId, companyId);
  await prisma.deliverable.update({
    where: { id: deliverable.id },
    data: { fragnetId: ctx.fragnet.id },
  });
  return { id: deliverable.id, fragnetId: ctx.fragnet.id, projectId: deliverable.projectId };
}

export async function create(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const {
      predecessorDeliverableId,
      successorDeliverableId,
      relationshipType,
      lag: lagRaw,
    } = req.body as {
      predecessorDeliverableId?: string;
      successorDeliverableId?: string;
      relationshipType?: string;
      lag?: number;
    };

    if (!predecessorDeliverableId?.trim() || !successorDeliverableId?.trim()) {
      res.status(400).json({ error: "predecessorDeliverableId and successorDeliverableId are required" });
      return;
    }
    if (!isValidRelationshipType(relationshipType)) {
      res.status(400).json({ error: "relationshipType must be one of FS, SS, FF, SF" });
      return;
    }
    if (predecessorDeliverableId === successorDeliverableId) {
      res.status(400).json({ error: "Predecessor and successor must differ" });
      return;
    }

    const [predecessorRaw, successorRaw] = await Promise.all([
      getDeliverableContext(predecessorDeliverableId, req.user.companyId),
      getDeliverableContext(successorDeliverableId, req.user.companyId),
    ]);
    if (!predecessorRaw) {
      res.status(400).json({ error: "Predecessor deliverable not found" });
      return;
    }
    if (!successorRaw) {
      res.status(400).json({ error: "Successor deliverable not found" });
      return;
    }
    if (predecessorRaw.projectId !== successorRaw.projectId) {
      res.status(400).json({ error: "Both deliverables must belong to the same project" });
      return;
    }

    const membership = await requireProjectAccess(predecessorRaw.projectId, req.user);
    requirePermission(membership.role, "relationship", "create");

    const [predecessor, successor] = await Promise.all([
      ensureDeliverableHasFragnet(predecessorRaw, req.user.companyId),
      ensureDeliverableHasFragnet(successorRaw, req.user.companyId),
    ]);
    const resolvedFragnetId = predecessor.fragnetId;

    const fragnet = await prisma.fragnet.findFirst({
      where: { id: resolvedFragnetId, companyId: req.user.companyId },
      select: { id: true, projectId: true },
    });
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }

    const existingRel = await prisma.deliverableRelationship.findFirst({
      where: {
        fragnetId: resolvedFragnetId,
        predecessorDeliverableId,
        successorDeliverableId,
      },
    });
    if (existingRel) {
      res.status(400).json({ error: "Duplicate link: same predecessor and successor deliverables already exist" });
      return;
    }

    const relationship = await prisma.deliverableRelationship.create({
      data: {
        fragnetId: resolvedFragnetId,
        predecessorDeliverableId,
        successorDeliverableId,
        relationshipType,
        lag: parseLag(lagRaw),
        projectId: fragnet.projectId,
        companyId: req.user.companyId,
      },
    });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: fragnet.projectId,
      action: "CREATE_DELIVERABLE_RELATIONSHIP",
      entity: "DeliverableRelationship",
      entityId: relationship.id,
    });
    await propagateDeliverableRelationshipsForProject(fragnet.projectId, req.user.companyId);
    await recalculateProjectScheduleAfterMutation(fragnet.projectId, req.user.companyId);
    res.status(201).json(relationship);
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create deliverable relationship" });
  }
}

export async function getByFragnetId(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId } = req.params;
    const fragnet = await prisma.fragnet.findFirst({
      where: { id: fragnetId, companyId: req.user.companyId },
    });
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    await requireProjectAccess(fragnet.projectId, req.user);
    const rows = await prisma.deliverableRelationship.findMany({
      where: { fragnetId, companyId: req.user.companyId },
      orderBy: { id: "asc" },
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch deliverable relationships" });
  }
}

export async function remove(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const existing = await prisma.deliverableRelationship.findFirst({
      where: { id, companyId: req.user.companyId },
    });
    if (!existing) {
      res.status(404).json({ error: "Deliverable relationship not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "relationship", "delete");
    await prisma.deliverableRelationship.delete({ where: { id } });
    await propagateDeliverableRelationshipsForProject(existing.projectId, req.user.companyId);
    await recalculateProjectScheduleAfterMutation(existing.projectId, req.user.companyId);
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "DELETE_DELIVERABLE_RELATIONSHIP",
      entity: "DeliverableRelationship",
      entityId: id,
    });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete deliverable relationship" });
  }
}
