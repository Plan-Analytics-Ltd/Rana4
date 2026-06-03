import type { Response } from "express";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { isPrismaForeignKeyViolation } from "../utils/prismaErrors.js";
import { auditLog } from "../services/audit.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { auditUpdateIfChanged } from "../services/auditDiff.service.js";
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

export async function create(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const {
      fragnetId,
      predecessorActivityId,
      successorActivityId,
      relationshipType,
      lag: lagRaw,
    } = req.body as {
      fragnetId?: string;
      predecessorActivityId?: string;
      successorActivityId?: string;
      relationshipType?: string;
      lag?: number;
    };

    if (!fragnetId || String(fragnetId).trim() === "") {
      res.status(400).json({ error: "fragnetId is required" });
      return;
    }
    if (!predecessorActivityId || String(predecessorActivityId).trim() === "") {
      res.status(400).json({ error: "predecessorActivityId is required" });
      return;
    }
    if (!successorActivityId || String(successorActivityId).trim() === "") {
      res.status(400).json({ error: "successorActivityId is required" });
      return;
    }
    if (!isValidRelationshipType(relationshipType)) {
      res.status(400).json({ error: "relationshipType must be one of FS, SS, FF, SF" });
      return;
    }
    if (predecessorActivityId === successorActivityId) {
      res.status(400).json({ error: "predecessorActivityId and successorActivityId must be different" });
      return;
    }

    const fragnet = await prisma.fragnet.findFirst({ where: { id: fragnetId, companyId: req.user.companyId } });
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    const membership = await requireProjectAccess(fragnet.projectId, req.user);
    requirePermission(membership.role, "relationship", "create");

    const [predecessor, successor] = await Promise.all([
      prisma.activity.findFirst({
        where: { id: predecessorActivityId, companyId: req.user.companyId },
        select: { id: true, fragnetId: true, projectId: true },
      }),
      prisma.activity.findFirst({
        where: { id: successorActivityId, companyId: req.user.companyId },
        select: { id: true, fragnetId: true, projectId: true },
      }),
    ]);

    if (!predecessor) {
      res.status(400).json({ error: "Predecessor activity not found" });
      return;
    }
    if (!successor) {
      res.status(400).json({ error: "Successor activity not found" });
      return;
    }
    if (predecessor.projectId !== fragnet.projectId || successor.projectId !== fragnet.projectId) {
      res.status(400).json({ error: "Both activities must belong to the same project" });
      return;
    }
    const resolvedFragnetId = predecessor.fragnetId;

    const existingRel = await prisma.relationship.findFirst({
      where: {
        projectId: fragnet.projectId,
        predecessorActivityId: predecessor.id,
        successorActivityId: successor.id,
      },
    });
    if (existingRel) {
      res.status(400).json({ error: "Duplicate relationship: same predecessor and successor already exists for this fragnet" });
      return;
    }

    const relationship = await prisma.relationship.create({
      data: {
        fragnetId: resolvedFragnetId,
        predecessorActivityId: predecessor.id,
        successorActivityId: successor.id,
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
      action: "CREATE_RELATIONSHIP",
      entity: "Relationship",
      entityId: relationship.id,
    });
    await recalculateProjectScheduleAfterMutation(fragnet.projectId, req.user.companyId);
    res.status(201).json(relationship);
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create relationship" });
  }
}

export async function getByFragnetId(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId } = req.params;
    const fragnet = await prisma.fragnet.findUnique({
      where: { id: fragnetId },
      include: { relationships: { where: { companyId: req.user.companyId } } },
    });
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    await requireProjectAccess(fragnet.projectId, req.user);
    res.json(fragnet.relationships);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch relationships" });
  }
}

export async function remove(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const existing = await prisma.relationship.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!existing) {
      res.status(404).json({ error: "Relationship not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "relationship", "delete");
    await prisma.relationship.delete({ where: { id } });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "DELETE_RELATIONSHIP",
      entity: "Relationship",
      entityId: id,
    });
    await recalculateProjectScheduleAfterMutation(existing.projectId, req.user.companyId);
    res.status(204).send();
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete relationship" });
  }
}

export async function update(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const { relationshipType, lag: lagRaw } = req.body as { relationshipType?: string; lag?: number };

    if (relationshipType !== undefined && !isValidRelationshipType(relationshipType)) {
      res.status(400).json({ error: "relationshipType must be one of FS, SS, FF, SF" });
      return;
    }

    const existing = await prisma.relationship.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!existing) {
      res.status(404).json({ error: "Relationship not found" });
      return;
    }

    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "relationship", "update");

    const nextLag = lagRaw !== undefined ? parseLag(lagRaw) : undefined;
    const updated = await prisma.relationship.update({
      where: { id },
      data: {
        ...(relationshipType !== undefined && { relationshipType }),
        ...(nextLag !== undefined && { lag: nextLag }),
      },
    });

    await auditUpdateIfChanged({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "UPDATE_RELATIONSHIP",
      entity: "Relationship",
      entityId: id,
      before: existing as any,
      after: updated as any,
      fields: ["relationshipType", "lag"],
    });

    await recalculateProjectScheduleAfterMutation(existing.projectId, req.user.companyId);
    res.json(updated);
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update relationship" });
  }
}
