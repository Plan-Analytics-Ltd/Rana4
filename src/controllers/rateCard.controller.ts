import type { Response } from "express";
import { getRateCardEntries, getRateCardSummary, replaceRateCardEntries } from "../services/rateCard.js";
import { parseRateCardSpreadsheet } from "../services/rateCard.parser.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { auditLog } from "../services/audit.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";

/** GET /rate-card — current uploaded rate card (may be empty) */
export async function listRateCard(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const entries = await getRateCardEntries(req.user.companyId);
    const summary = await getRateCardSummary(req.user.companyId);
    const types = [...new Set(entries.map((e) => e.resourceType))].sort();
    console.log("[rate-card] Loaded entries:", entries.length, summary);
    res.json({ entries, types, summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load rate card" });
  }
}

type RequestWithFile = Request & { file?: Express.Multer.File };

/** POST /rate-card/upload — multipart field "file" (.csv or .xlsx), replaces entire rate card */
export async function uploadRateCard(req: AuthRequest, res: Response): Promise<void> {
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
    const membership = await requireProjectAccess(projectId, req.user);
    requirePermission(membership.role, "rateCard", "update");
    const file = (req as unknown as RequestWithFile).file;
    if (!file?.buffer) {
      res.status(400).json({ error: 'No file uploaded. Use form field "file" with a .csv or .xlsx file.' });
      return;
    }

    const parsed = parseRateCardSpreadsheet(file.buffer);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    await replaceRateCardEntries(req.user.companyId, parsed.entries);
    console.log("[rate-card] Upload replaced card with", parsed.entries.length, "rows");
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId,
      action: "UPLOAD_RATE_CARD",
      entity: "RateCardEntry",
      entityId: null,
    });
    res.status(201).json({ ok: true, count: parsed.entries.length, message: "Rate card updated." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to upload rate card" });
  }
}

/** DELETE /rate-card — remove all uploaded entries (same as an empty replace) */
export async function clearRateCard(req: AuthRequest, res: Response): Promise<void> {
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
    const membership = await requireProjectAccess(projectId, req.user);
    requirePermission(membership.role, "rateCard", "delete");
    await replaceRateCardEntries(req.user.companyId, []);
    console.log("[rate-card] Cleared all entries");
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId,
      action: "CLEAR_RATE_CARD",
      entity: "RateCardEntry",
      entityId: null,
    });
    res.json({ ok: true, message: "Rate card removed." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove rate card" });
  }
}
