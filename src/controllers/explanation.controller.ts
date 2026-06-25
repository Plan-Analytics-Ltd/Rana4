import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import {
  generateDeliverableExplanation,
  parseExplanationRequestBody,
  validateDeliverableExplanation,
} from "../services/explanation/explanation.service.js";

function parseSelectedProjectIds(body: unknown): string[] | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw = (body as Record<string, unknown>).projectIds;
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.map((id) => String(id).trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

/** POST /projects/:projectId/intelligence/explain/validate */
export async function postValidateDeliverableExplanation(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const parsed = parseExplanationRequestBody(req.body);
    if (!parsed) {
      res.status(400).json({
        error: "Invalid request. Required: deliverableId, explanationType.",
      });
      return;
    }

    const result = await validateDeliverableExplanation({
      projectId,
      companyId: req.user.companyId,
      deliverableId: parsed.deliverableId,
      explanationType: parsed.explanationType,
      selectedProjectIds: parseSelectedProjectIds(req.body),
    });

    res.json(result);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Explanation validation failed" });
  }
}

/** POST /projects/:projectId/intelligence/explain */
export async function postDeliverableExplanation(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const parsed = parseExplanationRequestBody(req.body);
    if (!parsed) {
      res.status(400).json({
        error: "Invalid request. Required: deliverableId, explanationType. Optional: question, projectIds.",
      });
      return;
    }

    const result = await generateDeliverableExplanation({
      projectId,
      companyId: req.user.companyId,
      deliverableId: parsed.deliverableId,
      explanationType: parsed.explanationType,
      question: parsed.question,
      selectedProjectIds: parseSelectedProjectIds(req.body),
    });

    res.json(result);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Explanation request failed" });
  }
}
