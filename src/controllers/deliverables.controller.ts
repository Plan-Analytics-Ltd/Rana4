import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import { parseAndValidateAssignedResources } from "../services/rateCard.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { isPrismaForeignKeyViolation } from "../utils/prismaErrors.js";
import { auditLog } from "../services/audit.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { auditUpdateIfChanged } from "../services/auditDiff.service.js";

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
      projectId: projectIdRaw,
      externalProjectId: externalProjectIdRaw,
      name,
      bestDuration: bestDurationRaw,
      likelyDuration: likelyDurationRaw,
      assignedResources: assignedResourcesRaw,
    } = req.body as {
      fragnetId?: string;
      projectId?: string;
      externalProjectId?: string | null;
      name?: string;
      bestDuration?: number;
      likelyDuration?: number;
      assignedResources?: unknown;
    };

    const fragnetIdTrimmed =
      fragnetId !== undefined && fragnetId !== null && String(fragnetId).trim() !== ""
        ? String(fragnetId).trim()
        : null;

    const projectIdStr = projectIdRaw != null ? String(projectIdRaw).trim() : "";
    if (!projectIdStr) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    const membership = await requireProjectAccess(projectIdStr, req.user);
    requirePermission(membership.role, "deliverable", "create");

    if (fragnetIdTrimmed !== null) {
      const fragnet = await prisma.fragnet.findFirst({ where: { id: fragnetIdTrimmed, companyId: req.user.companyId } });
      if (!fragnet) {
        res.status(404).json({ error: "Fragnet not found" });
        return;
      }
      if (fragnet.projectId !== projectIdStr) {
        res.status(400).json({ error: "Fragnet must belong to the same project" });
        return;
      }
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

    const assignedParsed = await parseAndValidateAssignedResources(req.user.companyId, assignedResourcesRaw);
    if (!assignedParsed.ok) {
      res.status(400).json({ error: assignedParsed.error });
      return;
    }

    const externalProjectIdTrimmed =
      externalProjectIdRaw !== undefined && externalProjectIdRaw !== null && String(externalProjectIdRaw).trim() !== ""
        ? String(externalProjectIdRaw).trim()
        : null;

    const createData: Prisma.DeliverableUncheckedCreateInput = {
      fragnetId: fragnetIdTrimmed,
      projectId: projectIdStr,
      externalProjectId: externalProjectIdTrimmed,
      name: String(name).trim(),
      bestDuration,
      likelyDuration,
      assignedResources: assignedParsed.assignments as Prisma.InputJsonValue,
      companyId: req.user.companyId,
    };
    const deliverable = await prisma.deliverable.create({ data: createData });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: projectIdStr,
      action: "CREATE_DELIVERABLE",
      entity: "Deliverable",
      entityId: deliverable.id,
    });
    res.status(201).json(deliverable);
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create deliverable" });
  }
}

export async function getAll(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId.trim() : "";
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    await requireProjectAccess(projectId, req.user);
    const fragnetId = typeof req.query.fragnetId === "string" ? req.query.fragnetId.trim() : undefined;
    const deliverables = await prisma.deliverable.findMany({
      where: fragnetId ? { companyId: req.user.companyId, projectId, fragnetId } : { companyId: req.user.companyId, projectId },
      orderBy: { createdAt: "desc" },
    });
    res.json(deliverables);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch deliverables" });
  }
}

/** GET /deliverables/fragnet/:fragnetId – list deliverables for that fragnet */
export async function getByFragnetId(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId } = req.params;
    const fragnet = await prisma.fragnet.findFirst({ where: { id: fragnetId, companyId: req.user.companyId } });
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    await requireProjectAccess(fragnet.projectId, req.user);
    const deliverables = await prisma.deliverable.findMany({
      where: { companyId: req.user.companyId, projectId: fragnet.projectId, fragnetId },
      orderBy: { createdAt: "asc" },
    });
    res.json(deliverables);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch deliverables for fragnet" });
  }
}

export async function getById(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const deliverable = await prisma.deliverable.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!deliverable) {
      res.status(404).json({ error: "Deliverable not found" });
      return;
    }
    await requireProjectAccess(deliverable.projectId, req.user);
    res.json(deliverable);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch deliverable" });
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
      fragnetId: fragnetIdRaw,
      externalProjectId: externalProjectIdRaw,
      name,
      bestDuration: bestDurationRaw,
      likelyDuration: likelyDurationRaw,
      assignedResources: assignedResourcesRaw,
    } = req.body as {
      fragnetId?: string;
      externalProjectId?: string | null;
      name?: string;
      bestDuration?: number;
      likelyDuration?: number;
      assignedResources?: unknown;
    };

    const existing = await prisma.deliverable.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!existing) {
      res.status(404).json({ error: "Deliverable not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "deliverable", "update");

    const fragnetIdTrimmed =
      fragnetIdRaw !== undefined && fragnetIdRaw !== null
        ? (String(fragnetIdRaw).trim() || null)
        : undefined;
    if (fragnetIdTrimmed !== undefined) {
      if (fragnetIdTrimmed !== null) {
        const fragnet = await prisma.fragnet.findFirst({ where: { id: fragnetIdTrimmed, companyId: req.user.companyId } });
        if (!fragnet) {
          res.status(404).json({ error: "Fragnet not found" });
          return;
        }
        if (fragnet.projectId !== existing.projectId) {
          res.status(400).json({ error: "Fragnet must belong to the same project" });
          return;
        }
      }
    }

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

    let assignedUpdate: Prisma.InputJsonValue | undefined;
    if (assignedResourcesRaw !== undefined) {
      const assignedParsed = await parseAndValidateAssignedResources(req.user.companyId, assignedResourcesRaw);
      if (!assignedParsed.ok) {
        res.status(400).json({ error: assignedParsed.error });
        return;
      }
      assignedUpdate = assignedParsed.assignments as Prisma.InputJsonValue;
    }

    const externalProjectIdTrimmed =
      externalProjectIdRaw !== undefined
        ? externalProjectIdRaw != null && String(externalProjectIdRaw).trim() !== ""
          ? String(externalProjectIdRaw).trim()
          : null
        : undefined;

    const updateData: Prisma.DeliverableUncheckedUpdateInput = {
      ...(fragnetIdTrimmed !== undefined && { fragnetId: fragnetIdTrimmed }),
      ...(externalProjectIdTrimmed !== undefined && { externalProjectId: externalProjectIdTrimmed }),
      ...(name !== undefined && { name: String(name).trim() }),
      ...(bestDurationRaw !== undefined && { bestDuration: parseDuration(bestDurationRaw)! }),
      ...(likelyDurationRaw !== undefined && { likelyDuration: parseDuration(likelyDurationRaw)! }),
      ...(assignedUpdate !== undefined && { assignedResources: assignedUpdate }),
    };
    const deliverable = await prisma.deliverable.update({
      where: { id },
      data: updateData,
    });
    await auditUpdateIfChanged({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "UPDATE_DELIVERABLE",
      entity: "Deliverable",
      entityId: id,
      before: existing as any,
      after: deliverable as any,
      fields: ["name", "fragnetId", "bestDuration", "likelyDuration", "assignedResources", "externalProjectId"],
    });
    res.json(deliverable);
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update deliverable" });
  }
}

export async function remove(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const existing = await prisma.deliverable.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!existing) {
      res.status(404).json({ error: "Deliverable not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "deliverable", "delete");
    await prisma.deliverable.delete({ where: { id } });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "DELETE_DELIVERABLE",
      entity: "Deliverable",
      entityId: id,
    });
    res.status(204).send();
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete deliverable" });
  }
}
