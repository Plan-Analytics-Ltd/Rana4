import type { Response } from "express";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { buildXerPreview } from "../services/import/xerEntityPlan.service.js";
import { importProjectFromXer } from "../services/import/xerProjectBootstrap.service.js";
import { runWithAuthContextAsync } from "../utils/requestContext.js";

export async function previewXerProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    requirePermission(req.user.role as "ADMIN" | "EDITOR" | "VIEWER", "project", "create");

    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({ error: "Upload a Primavera .xer file." });
      return;
    }

    const projects = await runWithAuthContextAsync(
      { userId: req.user.id, companyId: req.user.companyId },
      () =>
        prisma.project.findMany({
          where: { companyId: req.user!.companyId, archivedAt: null },
          select: { name: true },
        })
    );

    const preview = buildXerPreview(file.buffer, file.originalname ?? "import.xer", {
      existingProjectNames: projects.map((p) => p.name),
    });

    res.json(preview);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to preview XER file" });
  }
}

export async function createProjectFromXer(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    requirePermission(req.user.role as "ADMIN" | "EDITOR" | "VIEWER", "project", "create");

    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({ error: "Upload a Primavera .xer file." });
      return;
    }

    const body = req.body as Record<string, string | undefined>;
    const name = body.name != null ? String(body.name).trim() : "";
    if (!name) {
      res.status(400).json({ error: "Project name is required." });
      return;
    }

    const result = await runWithAuthContextAsync(
      { userId: req.user.id, companyId: req.user.companyId },
      () =>
        importProjectFromXer(
          file.buffer,
          file.originalname ?? "import.xer",
          req.user!.companyId,
          req.user!.id,
          {
            name,
            clientType: body.clientType ?? null,
            projectType: body.projectType ?? null,
            stage: body.stage ?? null,
            complexity: body.complexity ?? null,
            description: body.description ?? null,
          }
        )
    );

    res.status(201).json(result);
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    if (status === 400 || status === 409) {
      res.status(status).json({ error: (err as Error).message });
      return;
    }
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: (err as Error).message || "Failed to create project from XER" });
  }
}
