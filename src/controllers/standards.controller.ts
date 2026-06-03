import type { Response } from "express";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { auditLog } from "../services/audit.service.js";
import { isPrismaForeignKeyViolation } from "../utils/prismaErrors.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { auditUpdateIfChanged } from "../services/auditDiff.service.js";
import { importAssignmentsSheetForStandard } from "../services/import/assignmentsImport.service.js";
import { PROJECT_LEVEL_STANDARD_NAME } from "../services/projectLevelActivityContext.service.js";

type RequestWithAssignmentFile = AuthRequest & { file?: Express.Multer.File };

export async function create(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { projectId, name, description } = req.body as { projectId?: string; name?: string; description?: string };
    const projectIdStr = projectId != null ? String(projectId).trim() : "";
    if (!projectIdStr) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    if (name === undefined || name === null || String(name).trim() === "") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const membership = await requireProjectAccess(projectIdStr, req.user);
    requirePermission(membership.role, "standard", "create");
    const standard = await prisma.standard.create({
      data: {
        name: String(name).trim(),
        description: description != null ? String(description) : null,
        projectId: projectIdStr,
        companyId: req.user.companyId,
      },
    });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: projectIdStr,
      action: "CREATE_STANDARD",
      entity: "Standard",
      entityId: standard.id,
    });
    res.status(201).json(standard);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create standard" });
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
    const standards = await prisma.standard.findMany({
      where: { companyId: req.user.companyId, projectId },
      orderBy: { createdAt: "desc" },
    });
    res.json(standards.filter((standard) => standard.name !== PROJECT_LEVEL_STANDARD_NAME));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch standards" });
  }
}

export async function getById(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const standard = await prisma.standard.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!standard) {
      res.status(404).json({ error: "Standard not found" });
      return;
    }
    await requireProjectAccess(standard.projectId, req.user);
    res.json(standard);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch standard" });
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
    const existing = await prisma.standard.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!existing) {
      res.status(404).json({ error: "Standard not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "standard", "update");
    const standard = await prisma.standard.update({
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
      action: "UPDATE_STANDARD",
      entity: "Standard",
      entityId: id,
      before: existing as any,
      after: standard as any,
      fields: ["name", "description"],
    });
    res.json(standard);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update standard" });
  }
}

export async function remove(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const existing = await prisma.standard.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!existing) {
      res.status(404).json({ error: "Standard not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "standard", "delete");
    await prisma.standard.delete({ where: { id } });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "DELETE_STANDARD",
      entity: "Standard",
      entityId: id,
    });
    res.status(204).send();
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete standard" });
  }
}

/**
 * POST /standards/:id/import-assignments
 * multipart field `file` (.xlsx). Optional query dryRun=true validates only.
 */
export async function importAssignmentsSheet(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const dryRun =
      req.query.dryRun === "true" ||
      req.query.dryRun === "1" ||
      String(req.query.dryRun ?? "").toLowerCase() === "yes";

    const existing = await prisma.standard.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!existing) {
      res.status(404).json({ error: "Standard not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "standard", "update");

    const file = (req as unknown as RequestWithAssignmentFile).file;
    if (!file?.buffer) {
      res.status(400).json({
        error: 'No file uploaded. Use form field "file" with an .xlsx containing sheet "Assignments".',
      });
      return;
    }

    const result = await importAssignmentsSheetForStandard({
      companyId: req.user.companyId,
      standardId: id,
      buffer: file.buffer,
      dryRun,
    });

    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: dryRun ? "DRY_RUN_IMPORT_ASSIGNMENTS" : "IMPORT_ASSIGNMENTS_SHEET",
      entity: "Standard",
      entityId: id,
      details: {
        parsedRowCount: result.parsedRowCount,
        applied: result.applied ?? null,
      },
    });

    res.status(dryRun ? 200 : 201).json({
      dryRun,
      parsedRowCount: result.parsedRowCount,
      groupedDeliverableEntityCount: result.groupedDeliverableEntityCount,
      groupedActivityEntityCount: result.groupedActivityEntityCount,
      deliverableIdsUpdated: [...result.byDeliverableId.keys()],
      activityIdsUpdated: [...result.byActivityId.keys()],
      applied: result.applied ?? null,
    });
  } catch (err) {
    console.error(err);
    const msg = err instanceof Error ? err.message : "Assignment import failed";
    res.status(400).json({ error: msg });
  }
}
