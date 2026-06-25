import type { Response } from "express";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { isPrismaForeignKeyViolation } from "../utils/prismaErrors.js";
import { auditLog } from "../services/audit.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { auditUpdateIfChanged } from "../services/shared/auditDiff.service.js";

export async function create(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { standardId, noteText } = req.body as { standardId?: string; noteText?: string };
    if (noteText === undefined || noteText === null || String(noteText).trim() === "") {
      res.status(400).json({ error: "noteText is required" });
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
    requirePermission(membership.role, "assuranceNote", "create");
    const note = await prisma.assuranceNote.create({
      data: {
        standardId: standard.id,
        noteText: String(noteText).trim(),
        projectId: standard.projectId,
        companyId: req.user.companyId,
      },
    });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: standard.projectId,
      action: "CREATE_ASSURANCE_NOTE",
      entity: "AssuranceNote",
      entityId: note.id,
    });
    res.status(201).json(note);
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create assurance note" });
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
      include: { assuranceNotes: { where: { companyId: req.user.companyId }, orderBy: { createdAt: "desc" } } },
    });
    if (!standard) {
      res.status(404).json({ error: "Standard not found" });
      return;
    }
    await requireProjectAccess(standard.projectId, req.user);
    res.json(standard.assuranceNotes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch assurance notes" });
  }
}

export async function remove(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const existing = await prisma.assuranceNote.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!existing) {
      res.status(404).json({ error: "Assurance note not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "assuranceNote", "delete");
    await prisma.assuranceNote.delete({ where: { id } });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "DELETE_ASSURANCE_NOTE",
      entity: "AssuranceNote",
      entityId: id,
    });
    res.status(204).send();
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete assurance note" });
  }
}

export async function update(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const { noteText } = req.body as { noteText?: string };
    if (noteText === undefined) {
      res.status(400).json({ error: "noteText is required" });
      return;
    }

    const existing = await prisma.assuranceNote.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!existing) {
      res.status(404).json({ error: "Assurance note not found" });
      return;
    }

    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "assuranceNote", "update");

    const updated = await prisma.assuranceNote.update({
      where: { id },
      data: { noteText: String(noteText).trim() },
    });

    await auditUpdateIfChanged({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "UPDATE_ASSURANCE_NOTE",
      entity: "AssuranceNote",
      entityId: id,
      before: existing as any,
      after: updated as any,
      fields: ["noteText"],
    });

    res.json(updated);
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update assurance note" });
  }
}
