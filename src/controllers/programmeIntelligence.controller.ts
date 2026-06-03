import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { auditLog } from "../services/audit.service.js";
import { importProgrammeSchedule } from "../services/intelligence/programmeImport.service.js";
import {
  captureLiveBaselineSnapshot,
  listProjectSnapshots,
} from "../services/intelligence/programmeSnapshotCapture.service.js";
import {
  compareBaselineToLive,
  compareSnapshots,
} from "../services/intelligence/plannedVsActual.service.js";
import {
  getProjectIntelligenceProfile,
  refreshProjectIntelligenceMetadata,
  upsertProjectIntelligenceProfile,
} from "../services/intelligence/intelligenceMetadata.service.js";
import { computePortfolioBenchmarks } from "../services/intelligence/portfolioBenchmark.service.js";
import {
  generateLessonsLearned,
  listLessonsLearned,
} from "../services/intelligence/lessonsLearned.service.js";
import { buildRana4ProgrammeExport } from "../services/intelligence/rana4ScheduleExport.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { prisma } from "../utils/prisma.js";
import type { ProgrammeSnapshotRole } from "@prisma/client";

type RequestWithFile = AuthRequest & { file?: Express.Multer.File };

function parseSnapshotRole(v: unknown): ProgrammeSnapshotRole | undefined {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "BASELINE" || s === "LIVE_IMPORT" || s === "AS_BUILT" || s === "COMPARISON") {
    return s as ProgrammeSnapshotRole;
  }
  return undefined;
}

/** POST /projects/:projectId/programme-import */
export async function importProgramme(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "update");

    const file = (req as RequestWithFile).file;
    if (!file?.buffer) {
      res.status(400).json({ error: 'Upload .xer or Rana4 programme .json using field "file".' });
      return;
    }

    const snapshotRole = parseSnapshotRole(req.body?.snapshotRole ?? req.query.snapshotRole);
    const label = String(req.body?.label ?? req.query.label ?? "").trim() || undefined;

    const result = await importProgrammeSchedule(file.buffer, file.originalname ?? "import.xer", {
      projectId,
      companyId: req.user.companyId,
      userId: req.user.id,
      sourceFileName: file.originalname,
      snapshotRole,
      label,
    });

    await refreshProjectIntelligenceMetadata(projectId, req.user.companyId);

    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId,
      action: "IMPORT_PROGRAMME_SNAPSHOT",
      entity: "ProgrammeSnapshot",
      entityId: result.snapshotId,
      details: { matchResult: result.matchResult, summary: result.summary },
    });

    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Programme import failed" });
  }
}

/** GET /projects/:projectId/programme-snapshots */
export async function listSnapshots(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const snapshots = await listProjectSnapshots(projectId, req.user.companyId);
    res.json({ snapshots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list snapshots" });
  }
}

/** POST /projects/:projectId/programme-snapshots/baseline */
export async function createBaselineSnapshot(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "update");

    const label = String(req.body?.label ?? "Generated baseline").trim();
    const result = await captureLiveBaselineSnapshot(
      projectId,
      req.user.companyId,
      req.user.id,
      label
    );

    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId,
      action: "CREATE_BASELINE_SNAPSHOT",
      entity: "ProgrammeSnapshot",
      entityId: result.snapshotId,
      details: result.summary,
    });

    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to create baseline" });
  }
}

/** GET /projects/:projectId/planned-vs-actual */
export async function getPlannedVsActual(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const baselineId = String(req.query.baselineSnapshotId ?? "").trim();
    const comparisonId = String(req.query.comparisonSnapshotId ?? "").trim();
    const compareToLive = req.query.compareToLive === "true" || req.query.compareToLive === "1";

    if (!baselineId) {
      res.status(400).json({ error: "baselineSnapshotId is required" });
      return;
    }

    if (!compareToLive && !comparisonId) {
      res.status(400).json({ error: "comparisonSnapshotId is required unless compareToLive=true" });
      return;
    }

    const report = compareToLive
      ? await compareBaselineToLive(baselineId, projectId, req.user.companyId)
      : await compareSnapshots(baselineId, comparisonId, req.user.companyId);

    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Comparison failed" });
  }
}

/** GET /projects/:projectId/intelligence-profile */
export async function getIntelligenceProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const profile = await getProjectIntelligenceProfile(projectId, req.user.companyId);
    res.json({ profile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load intelligence profile" });
  }
}

/** PUT /projects/:projectId/intelligence-profile */
export async function updateIntelligenceProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "update");

    const body = req.body ?? {};
    const profile = await upsertProjectIntelligenceProfile(projectId, req.user.companyId, {
      projectType: body.projectType,
      ribaStage: body.primaryRibaStage ?? body.ribaStage,
      disciplineCategories: body.disciplineCategories,
      approvalRouteCategories: body.approvalRouteCategories,
      healthcareDepartments: body.healthcareDepartments,
      deliverableClassifications: body.deliverableClassifications,
      complexityScore: body.complexityScore,
    });

    res.json({ profile });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Update failed" });
  }
}

/** GET /projects/:projectId/programme-export */
export async function exportProgrammeJson(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: req.user.companyId },
    });
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const activities = await prisma.activity.findMany({
      where: { projectId, companyId: req.user.companyId },
      select: {
        id: true,
        activityCode: true,
        name: true,
        deliverableId: true,
        fragnetId: true,
        bestDuration: true,
        likelyDuration: true,
        plannedStartDate: true,
        plannedFinishDate: true,
        earlyStart: true,
        earlyFinish: true,
        lateStart: true,
        lateFinish: true,
        totalFloat: true,
        freeFloat: true,
        isCritical: true,
        status: true,
      },
    });

    const deliverables = await prisma.deliverable.findMany({
      where: { projectId, companyId: req.user.companyId },
      select: { id: true, name: true },
    });

    const relationships = await prisma.relationship.findMany({
      where: { projectId, companyId: req.user.companyId },
      include: {
        predecessorActivity: { select: { activityCode: true } },
        successorActivity: { select: { activityCode: true } },
      },
    });

    const payload = buildRana4ProgrammeExport({
      projectId,
      projectName: project.name,
      scheduleStartDate: project.scheduleStartDate,
      activities,
      deliverables,
      relationships: relationships.map((r) => ({
        predecessorActivityCode: r.predecessorActivity.activityCode,
        successorActivityCode: r.successorActivity.activityCode,
        relationshipType: r.relationshipType,
        lag: r.lag,
      })),
    });

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="rana4-programme-${projectId.slice(0, 8)}.json"`
    );
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Export failed" });
  }
}

/** GET /intelligence/portfolio-benchmarks */
export async function getPortfolioBenchmarks(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const report = await computePortfolioBenchmarks(req.user.companyId, {
      projectType: String(req.query.projectType ?? "").trim() || undefined,
      ribaStage: String(req.query.ribaStage ?? "").trim() || undefined,
    });
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Benchmark computation failed" });
  }
}

/** GET /intelligence/lessons-learned */
export async function getLessonsLearned(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const refresh = req.query.refresh === "true" || req.query.refresh === "1";
    const findings = refresh
      ? await generateLessonsLearned(req.user.companyId)
      : await listLessonsLearned(req.user.companyId);
    res.json({ findings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load lessons learned" });
  }
}

/** POST /intelligence/lessons-learned/generate */
export async function postGenerateLessons(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (req.user.role !== "ADMIN") {
      res.status(403).json({ error: "Admin role required to regenerate portfolio findings" });
      return;
    }
    const findings = await generateLessonsLearned(req.user.companyId);
    res.json({ findings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Generation failed" });
  }
}
