import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { generateImportTemplate } from "../services/import/templateGenerator.service.js";
import { importFullTemplate } from "../services/import/fullImport.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { auditLog } from "../services/audit.service.js";
import { captureLiveBaselineSnapshot } from "../services/intelligence/shared/programmeSnapshotCapture.service.js";

type RequestWithFile = AuthRequest & { file?: Express.Multer.File };

/** GET /import/template — downloadable Hybrid Import workbook (.xlsx). */
export async function downloadImportTemplate(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const buf = await generateImportTemplate();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="import-template.xlsx"');
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate import template" });
  }
}

/** POST /projects/:projectId/import — import full Hybrid workbook (.xlsx). */
export async function importProjectTemplate(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const projectId = String((req.params as any)?.projectId ?? "").trim();
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const dryRun =
      req.query.dryRun === "true" ||
      req.query.dryRun === "1" ||
      String(req.query.dryRun ?? "").toLowerCase() === "yes";

    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    // Require create permissions for all entity types we will create.
    requirePermission(membership.role, "standard", "create");
    requirePermission(membership.role, "fragnet", "create");
    requirePermission(membership.role, "deliverable", "create");
    requirePermission(membership.role, "activity", "create");

    const file = (req as unknown as RequestWithFile).file;
    if (!file?.buffer) {
      res.status(400).json({ error: 'No file uploaded. Use multipart field "file" with a .xlsx.' });
      return;
    }

    const result = await importFullTemplate(file.buffer, projectId, req.user.companyId, dryRun);

    if (!dryRun) {
      try {
        await captureLiveBaselineSnapshot(projectId, req.user.companyId, req.user.id, "Excel/Hybrid import");
      } catch (snapshotErr) {
        console.error(
          `[import.controller] Failed to capture programme snapshot after Excel/Hybrid import (projectId=${projectId})`,
          snapshotErr
        );
      }
    }

    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId,
      action: dryRun ? "DRY_RUN_IMPORT_PROJECT_TEMPLATE" : "IMPORT_PROJECT_TEMPLATE",
      entity: "Project",
      entityId: projectId,
      details: result,
    });

    res.status(dryRun ? 200 : 201).json(result);
  } catch (err) {
    console.error(err);
    const msg = err instanceof Error ? err.message : "Import failed";
    res.status(400).json({ error: msg });
  }
}
