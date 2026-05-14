import type { Response } from "express";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { isPrismaUniqueViolation } from "../utils/prismaErrors.js";

export async function listByType(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const typeId = String(req.query.typeId ?? "").trim();
    const projectId = String(req.query.projectId ?? "").trim();
    if (!typeId || !projectId) {
      res.status(400).json({ error: "typeId and projectId query parameters are required" });
      return;
    }
    const membership = await requireProjectAccess(projectId, req.user);
    requirePermission(membership.role, "activityCode", "read");

    const type = await prisma.activityCodeType.findFirst({
      where: { id: typeId, companyId: req.user.companyId },
    });
    if (!type) {
      res.status(404).json({ error: "Activity code type not found" });
      return;
    }

    const codes = await prisma.activityCode.findMany({
      where: { companyId: req.user.companyId, typeId },
      orderBy: [{ seqNum: "asc" }, { name: "asc" }],
    });
    res.json(codes);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to list activity codes" });
  }
}

export async function create(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.body?.projectId ?? "").trim();
    const typeId = String(req.body?.typeId ?? "").trim();
    const name = String(req.body?.name ?? "").trim();
    const shortName = req.body?.shortName != null ? String(req.body.shortName).trim() : null;
    const parentId = req.body?.parentId != null && String(req.body.parentId).trim() !== "" ? String(req.body.parentId).trim() : null;
    const color = req.body?.color != null && String(req.body.color).trim() !== "" ? String(req.body.color).trim() : null;
    const seqNum = req.body?.seqNum != null ? Number(req.body.seqNum) : 0;

    if (!projectId || !typeId || !name) {
      res.status(400).json({ error: "projectId, typeId, and name are required" });
      return;
    }
    const membership = await requireProjectAccess(projectId, req.user);
    requirePermission(membership.role, "activityCode", "create");

    const type = await prisma.activityCodeType.findFirst({
      where: { id: typeId, companyId: req.user.companyId },
    });
    if (!type) {
      res.status(404).json({ error: "Activity code type not found" });
      return;
    }
    if (parentId) {
      const parent = await prisma.activityCode.findFirst({
        where: { id: parentId, companyId: req.user.companyId, typeId },
      });
      if (!parent) {
        res.status(400).json({ error: "parentId must reference a code in the same type" });
        return;
      }
    }

    const created = await prisma.activityCode.create({
      data: {
        companyId: req.user.companyId,
        typeId,
        parentId,
        name,
        shortName: shortName && shortName !== "" ? shortName : null,
        color,
        seqNum: Number.isFinite(seqNum) ? Math.trunc(seqNum) : 0,
      },
    });
    res.status(201).json(created);
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      res.status(400).json({ error: "A code with this name already exists for this type" });
      return;
    }
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create activity code" });
  }
}

export async function update(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const projectId = String(req.body?.projectId ?? "").trim();
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    const membership = await requireProjectAccess(projectId, req.user);
    requirePermission(membership.role, "activityCode", "update");

    const existing = await prisma.activityCode.findFirst({
      where: { id, companyId: req.user.companyId },
    });
    if (!existing) {
      res.status(404).json({ error: "Activity code not found" });
      return;
    }

    const name = req.body?.name != null ? String(req.body.name).trim() : undefined;
    const shortName =
      req.body?.shortName !== undefined ? (req.body.shortName == null ? null : String(req.body.shortName).trim()) : undefined;
    const parentId =
      req.body?.parentId !== undefined
        ? req.body.parentId == null || String(req.body.parentId).trim() === ""
          ? null
          : String(req.body.parentId).trim()
        : undefined;
    const color =
      req.body?.color !== undefined ? (req.body.color == null ? null : String(req.body.color).trim()) : undefined;
    const seqNum = req.body?.seqNum != null ? Number(req.body.seqNum) : undefined;

    if (parentId !== undefined && parentId !== null) {
      if (parentId === id) {
        res.status(400).json({ error: "parentId cannot equal id" });
        return;
      }
      const parent = await prisma.activityCode.findFirst({
        where: { id: parentId, companyId: req.user.companyId, typeId: existing.typeId },
      });
      if (!parent) {
        res.status(400).json({ error: "parentId must reference a code in the same type" });
        return;
      }
    }

    const updated = await prisma.activityCode.update({
      where: { id },
      data: {
        ...(name !== undefined && name !== "" && { name }),
        ...(shortName !== undefined && { shortName: shortName && shortName !== "" ? shortName : null }),
        ...(parentId !== undefined && { parentId }),
        ...(color !== undefined && { color }),
        ...(seqNum !== undefined && Number.isFinite(seqNum) && { seqNum: Math.trunc(seqNum) }),
      },
    });
    res.json(updated);
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      res.status(400).json({ error: "A code with this name already exists for this type" });
      return;
    }
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update activity code" });
  }
}

export async function remove(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const projectId = String(req.query.projectId ?? "").trim();
    if (!projectId) {
      res.status(400).json({ error: "projectId query parameter is required" });
      return;
    }
    const membership = await requireProjectAccess(projectId, req.user);
    requirePermission(membership.role, "activityCode", "delete");

    const existing = await prisma.activityCode.findFirst({
      where: { id, companyId: req.user.companyId },
    });
    if (!existing) {
      res.status(404).json({ error: "Activity code not found" });
      return;
    }

    await prisma.activityCode.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete activity code" });
  }
}
