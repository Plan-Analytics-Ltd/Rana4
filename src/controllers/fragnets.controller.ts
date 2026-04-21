import type { Response } from "express";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { isPrismaForeignKeyViolation } from "../utils/prismaErrors.js";
import { auditLog } from "../services/audit.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { auditUpdateIfChanged } from "../services/auditDiff.service.js";

export async function create(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { standardId, name, description } = req.body as {
      standardId?: string;
      name?: string;
      description?: string;
    };
    if (name === undefined || name === null || String(name).trim() === "") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (!standardId || String(standardId).trim() === "") {
      res.status(400).json({ error: "standardId is required" });
      return;
    }
    const standard = await prisma.standard.findFirst({ where: { id: standardId, companyId: req.user.companyId } });
    if (!standard) {
      res.status(404).json({ error: "Standard not found" });
      return;
    }
    const membership = await requireProjectAccess(standard.projectId, req.user);
    requirePermission(membership.role, "fragnet", "create");
    const fragnet = await prisma.fragnet.create({
      data: {
        standardId: standard.id,
        name: String(name).trim(),
        description: description != null ? String(description) : null,
        projectId: standard.projectId,
        companyId: req.user.companyId,
      },
    });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: standard.projectId,
      action: "CREATE_FRAGNET",
      entity: "Fragnet",
      entityId: fragnet.id,
    });
    res.status(201).json(fragnet);
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create fragnet" });
  }
}

export async function getByStandardId(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { standardId } = req.params;
    const standard = await prisma.standard.findUnique({
      where: { id: standardId },
      include: { fragnets: { where: { companyId: req.user.companyId }, orderBy: { createdAt: "desc" } } },
    });
    if (!standard) {
      res.status(404).json({ error: "Standard not found" });
      return;
    }
    await requireProjectAccess(standard.projectId, req.user);
    res.json(standard.fragnets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch fragnets" });
  }
}

export async function getById(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const fragnet = await prisma.fragnet.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    await requireProjectAccess(fragnet.projectId, req.user);
    res.json(fragnet);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch fragnet" });
  }
}

export async function update(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const { name, description } = req.body as { name?: string; description?: string };
    const existing = await prisma.fragnet.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!existing) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "fragnet", "update");
    const fragnet = await prisma.fragnet.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(description !== undefined && { description: String(description) }),
      },
    });
    await auditUpdateIfChanged({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "UPDATE_FRAGNET",
      entity: "Fragnet",
      entityId: id,
      before: existing as any,
      after: fragnet as any,
      fields: ["name", "description"],
    });
    res.json(fragnet);
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update fragnet" });
  }
}

export async function remove(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const existing = await prisma.fragnet.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!existing) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "fragnet", "delete");
    await prisma.fragnet.delete({ where: { id } });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "DELETE_FRAGNET",
      entity: "Fragnet",
      entityId: id,
    });
    res.status(204).send();
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete fragnet" });
  }
}
