import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import {
  askRana,
  getAskRanaLoadingHint,
  parseAskRanaRequestBody,
  parseSelectedProjectIds,
} from "../services/ask-rana/askRana.service.js";
import { resolveEvidenceDomains } from "../services/ask-rana/askRanaEvidenceScopeResolver.service.js";
import { interpretPlannerQuery } from "../services/ask-rana/askRanaPlannerQueryInterpreter.service.js";

/** POST /projects/:projectId/intelligence/ask-rana */
export async function postAskRana(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const projectId = String(req.params.projectId ?? "").trim();
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const parsed = parseAskRanaRequestBody(req.body);
    if (!parsed) {
      res.status(400).json({ error: "Invalid request. Required: question." });
      return;
    }

    const plannerQuery = interpretPlannerQuery(parsed.question, { pageContext: parsed.pageContext });
    const evidenceDomains = resolveEvidenceDomains(plannerQuery, parsed.question);

    const result = await askRana({
      projectId,
      companyId: req.user.companyId,
      deliverableId: parsed.deliverableId,
      question: parsed.question,
      conversation: parsed.conversation,
      selectedProjectIds: parseSelectedProjectIds(req.body),
      pageContext: parsed.pageContext,
    });

    res.json({
      ...result,
      loadingHint: getAskRanaLoadingHint(parsed.question, parsed.pageContext),
      evidenceDomains,
      plannerQuery,
    });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Ask Rana request failed" });
  }
}
