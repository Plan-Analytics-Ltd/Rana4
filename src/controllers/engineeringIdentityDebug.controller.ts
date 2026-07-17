import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import {
  buildIdentityReviewDebugExport,
  type IdentityDebugExportFilters,
} from "../services/intelligence/diagnostics/engineeringIdentityDebugExport.service.js";

function queryString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * GET /api/debug/identity-review
 *
 * Developer-only complete dump of the Engineering Identity resolution pipeline.
 * Optional filters: projectId, fragnetId, deliverableId.
 * Zero effect on production identity behaviour.
 */
export async function exportIdentityReviewDebug(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const filters: IdentityDebugExportFilters = {
      projectId: queryString(req.query.projectId),
      fragnetId: queryString(req.query.fragnetId),
      deliverableId: queryString(req.query.deliverableId),
    };

    const report = await buildIdentityReviewDebugExport({
      companyId: req.user.companyId,
      filters,
    });

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="identity-review-${date}.json"`
    );
    res.status(200).json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to export identity review debug",
    });
  }
}
