import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import {
  autoPopulateFromImportedProgrammeMetadata,
  getProfile,
  updateProfile,
} from "../services/intelligence/profiles/intelligenceProfile.service.js";
import { getSimilarDeliverables, getSimilarProjects } from "../services/intelligence/shared/similarity.service.js";
import { getDeliverableBenchmark } from "../services/intelligence/benchmark/benchmark.service.js";
import { getDeliverableFindings } from "../services/intelligence/findings/findings.service.js";
import { getDeliverableDrivers } from "../services/intelligence/drivers/driverAnalysis.service.js";
import { getDeliverableIntelligenceAnalysis } from "../services/intelligence/orchestration/intelligenceOrchestrator.service.js";
import { getDeliverableRecommendations } from "../services/intelligence/recommendations/recommendationEngine.service.js";
import { getDeliverableProjectEvolution } from "../services/intelligence/shared/deliverableProjectEvolution.service.js";
import { buildProgrammeReviewPresentation } from "../services/intelligence/presentation/programmeReviewPresentation.service.js";
import {
  getProjectIntelligence,
} from "../services/intelligence/project/projectIntelligence.service.js";

/** GET /projects/:projectId/intelligence/profile */
export async function getIntelligenceProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const profile = await autoPopulateFromImportedProgrammeMetadata(projectId, req.user.companyId);
    res.json({ profile });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to load intelligence profile" });
  }
}

/** PUT /projects/:projectId/intelligence/profile */
export async function putIntelligenceProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "update");

    const body = req.body ?? {};
    const profile = await updateProfile(projectId, req.user.companyId, {
      sector: body.sector,
      projectType: body.projectType,
      procurementRoute: body.procurementRoute,
      stage: body.stage,
      region: body.region,
      clientType: body.clientType,
      complexity: body.complexity,
      classificationTags: body.classificationTags ?? body.classificationTagsList,
      disciplineTags: body.disciplineTags,
    });

    res.json({ profile });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 400;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Not found" });
      return;
    }
    console.error(err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Update failed" });
  }
}

/** GET /projects/:projectId/intelligence/similar-projects */
export async function getSimilarProjectsForProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    // Ensure profile exists even if empty.
    await getProfile(projectId, req.user.companyId);

    const report = await getSimilarProjects({
      projectId,
      companyId: req.user.companyId,
      limit: req.query.limit != null ? Number(req.query.limit) : undefined,
    });

    res.json({ matches: report.matches, confidence: report.confidence, explanations: report.explanations });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Similarity computation failed" });
  }
}

/** GET /projects/:projectId/intelligence/similar-deliverables/:deliverableId */
export async function getSimilarDeliverablesForDeliverable(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const deliverableId = String(req.params.deliverableId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const report = await getSimilarDeliverables({
      projectId,
      companyId: req.user.companyId,
      deliverableId,
      limit: req.query.limit != null ? Number(req.query.limit) : undefined,
    });

    res.json({ matches: report.matches, confidence: report.confidence, explanations: report.explanations });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Similarity computation failed" });
  }
}

function parseSelectedProjectIds(req: AuthRequest): string[] | undefined {
  const projectIdsRaw = String(req.query.projectIds ?? "").trim();
  return projectIdsRaw && projectIdsRaw !== "null" && projectIdsRaw !== "undefined"
    ? projectIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
}

/** GET /projects/:projectId/intelligence/project-evolution/:deliverableId */
export async function getDeliverableProjectEvolutionForDeliverable(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const deliverableId = String(req.params.deliverableId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const report = await getDeliverableProjectEvolution({
      projectId,
      companyId: req.user.companyId,
      deliverableId,
    });

    res.json(report);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to load project evolution" });
  }
}

/** GET /projects/:projectId/intelligence/analysis/:deliverableId */
export async function getDeliverableIntelligenceAnalysisForDeliverable(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const deliverableId = String(req.params.deliverableId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const analysis = await getDeliverableIntelligenceAnalysis({
      projectId,
      companyId: req.user.companyId,
      deliverableId,
      selectedProjectIds: parseSelectedProjectIds(req),
    });

    res.json(analysis);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Intelligence analysis failed" });
  }
}

/** GET /projects/:projectId/intelligence/benchmark/:deliverableId */
export async function getDeliverableBenchmarkForDeliverable(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const deliverableId = String(req.params.deliverableId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const projectIdsRaw = String(req.query.projectIds ?? "").trim();
    const selectedProjectIds =
      projectIdsRaw && projectIdsRaw !== "null" && projectIdsRaw !== "undefined"
        ? projectIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

    const report = await getDeliverableBenchmark({
      projectId,
      companyId: req.user.companyId,
      deliverableId,
      selectedProjectIds,
    });

    res.json({
      benchmark: report.benchmark,
      outlier: report.outlier,
      evidence: report.evidence,
    });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Benchmark computation failed" });
  }
}

/** GET /projects/:projectId/intelligence/findings/:deliverableId */
export async function getDeliverableFindingsForDeliverable(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const deliverableId = String(req.params.deliverableId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const projectIdsRaw = String(req.query.projectIds ?? "").trim();
    const selectedProjectIds =
      projectIdsRaw && projectIdsRaw !== "null" && projectIdsRaw !== "undefined"
        ? projectIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

    const result = await getDeliverableFindings({
      projectId,
      companyId: req.user.companyId,
      deliverableId,
      selectedProjectIds,
    });

    res.json(result);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Findings generation failed" });
  }
}

/** GET /projects/:projectId/intelligence/trust/:deliverableId */
export async function getDeliverableTrustForDeliverable(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const deliverableId = String(req.params.deliverableId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const analysis = await getDeliverableIntelligenceAnalysis({
      projectId,
      companyId: req.user.companyId,
      deliverableId,
      selectedProjectIds: parseSelectedProjectIds(req),
    });

    res.json({ trust: analysis.trust });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Trust explanation failed" });
  }
}

/** GET /projects/:projectId/intelligence/recommendations/:deliverableId */
export async function getDeliverableRecommendationsForDeliverable(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const deliverableId = String(req.params.deliverableId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const projectIdsRaw = String(req.query.projectIds ?? "").trim();
    const selectedProjectIds =
      projectIdsRaw && projectIdsRaw !== "null" && projectIdsRaw !== "undefined"
        ? projectIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

    const result = await getDeliverableRecommendations({
      projectId,
      companyId: req.user.companyId,
      deliverableId,
      selectedProjectIds,
    });

    res.json(result);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Recommendation generation failed" });
  }
}

/** GET /projects/:projectId/intelligence/drivers/:deliverableId */
export async function getDeliverableDriversForDeliverable(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const deliverableId = String(req.params.deliverableId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const projectIdsRaw = String(req.query.projectIds ?? "").trim();
    const selectedProjectIds =
      projectIdsRaw && projectIdsRaw !== "null" && projectIdsRaw !== "undefined"
        ? projectIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

    const result = await getDeliverableDrivers({
      projectId,
      companyId: req.user.companyId,
      deliverableId,
      selectedProjectIds,
    });

    res.json(result);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Driver analysis failed" });
  }
}

/** GET /projects/:projectId/intelligence/programme-review */
export async function getProgrammeReview(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const report = await buildProgrammeReviewPresentation({
      projectId,
      companyId: req.user.companyId,
    });
    res.json(report);
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load programme review" });
  }
}

/** GET /projects/:projectId/project-intelligence */
export async function getProjectIntelligenceForProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const report = await getProjectIntelligence({
      projectId,
      companyId: req.user.companyId,
    });
    res.json(report);
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message });
      return;
    }
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load project intelligence",
    });
  }
}

