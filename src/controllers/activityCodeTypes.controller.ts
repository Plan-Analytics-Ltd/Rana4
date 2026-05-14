import type { Response } from "express";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { isPrismaUniqueViolation } from "../utils/prismaErrors.js";

function slugify(input: string): string {
  const s = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 64) || "type";
}

export async function list(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.query.projectId ?? "").trim();
    if (!projectId) {
      res.status(400).json({ error: "projectId query parameter is required" });
      return;
    }
    const membership = await requireProjectAccess(projectId, req.user);
    requirePermission(membership.role, "activityCode", "read");

    const types = await prisma.activityCodeType.findMany({
      where: { companyId: req.user.companyId },
      orderBy: [{ seqNum: "asc" }, { name: "asc" }],
      include: {
        codes: { orderBy: [{ seqNum: "asc" }, { name: "asc" }] },
      },
    });
    res.json(types);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to list activity code types" });
  }
}

export async function create(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.body?.projectId ?? "").trim();
    const name = String(req.body?.name ?? "").trim();
    const slugRaw = req.body?.slug != null ? String(req.body.slug).trim() : "";
    const shortName = req.body?.shortName != null ? String(req.body.shortName).trim() : null;
    const seqNum = req.body?.seqNum != null ? Number(req.body.seqNum) : 0;

    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const membership = await requireProjectAccess(projectId, req.user);
    requirePermission(membership.role, "activityCode", "create");

    const slug = slugRaw ? slugify(slugRaw) : slugify(name);

    const created = await prisma.activityCodeType.create({
      data: {
        companyId: req.user.companyId,
        slug,
        name,
        shortName: shortName && shortName !== "" ? shortName : null,
        seqNum: Number.isFinite(seqNum) ? Math.trunc(seqNum) : 0,
      },
      include: { codes: true },
    });
    res.status(201).json(created);
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      res.status(400).json({ error: "slug already exists for this company" });
      return;
    }
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create activity code type" });
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

    const existing = await prisma.activityCodeType.findFirst({
      where: { id, companyId: req.user.companyId },
    });
    if (!existing) {
      res.status(404).json({ error: "Activity code type not found" });
      return;
    }

    const name = req.body?.name != null ? String(req.body.name).trim() : undefined;
    const slugRaw = req.body?.slug != null ? String(req.body.slug).trim() : undefined;
    const shortName = req.body?.shortName !== undefined ? (req.body.shortName == null ? null : String(req.body.shortName).trim()) : undefined;
    const seqNum = req.body?.seqNum != null ? Number(req.body.seqNum) : undefined;

    const updated = await prisma.activityCodeType.update({
      where: { id },
      data: {
        ...(name !== undefined && name !== "" && { name }),
        ...(slugRaw !== undefined && { slug: slugify(slugRaw) }),
        ...(shortName !== undefined && { shortName: shortName && shortName !== "" ? shortName : null }),
        ...(seqNum !== undefined && Number.isFinite(seqNum) && { seqNum: Math.trunc(seqNum) }),
      },
      include: { codes: true },
    });
    res.json(updated);
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      res.status(400).json({ error: "slug already exists for this company" });
      return;
    }
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update activity code type" });
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

    const existing = await prisma.activityCodeType.findFirst({
      where: { id, companyId: req.user.companyId },
    });
    if (!existing) {
      res.status(404).json({ error: "Activity code type not found" });
      return;
    }

    await prisma.activityCodeType.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete activity code type" });
  }
}
