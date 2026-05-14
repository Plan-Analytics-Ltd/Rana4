import type { Response } from "express";
import { getRateCardEntries, getRateCardSummary, replaceRateCardEntries } from "../services/rateCard.js";
import { parseRateCardSpreadsheet } from "../services/rateCard.parser.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { auditLog } from "../services/audit.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { requireSensitiveAccess } from "../middleware/security/sensitiveAccess.middleware.js";
import {
  listSecureRateCardsByCompany,
  listSecureRateCardsByType,
  secureRateCardId,
} from "../repositories/secureData/rateCard.repository.js";

/** GET /rate-card — current uploaded rate card (may be empty) */
export async function listRateCard(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    requireSensitiveAccess(req.user, { resourceType: "rateCard", operation: "read" });
    const entries = await getRateCardEntries(req.user.companyId);
    const summary = await getRateCardSummary(req.user.companyId);
    const types = [...new Set(entries.map((e) => e.resourceType))].sort();
    res.json({ entries, types, summary });
  } catch (err) {
    console.error("[rate-card] Failed to load rate card");
    res.status(500).json({ error: "Failed to load rate card" });
  }
}

function optionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** GET /rate-card/secure/current — example secure endpoint flow */
export async function getSecureRateCardExample(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    requireSensitiveAccess(req.user, { resourceType: "rateCard", operation: "read" });
    const resourceType = typeof req.query.resourceType === "string" ? req.query.resourceType.trim() : "";
    const pagination = {
      page: optionalPositiveInt(req.query.page),
      pageSize: optionalPositiveInt(req.query.pageSize),
      offset: optionalPositiveInt(req.query.offset),
      order: "desc" as const,
    };
    const result = resourceType
      ? await listSecureRateCardsByType(req.user.companyId, resourceType, pagination)
      : await listSecureRateCardsByCompany(req.user.companyId, pagination);
    const entries = result.items.flatMap((item) =>
      item.payload.entries.map((entry) => ({
        resourceType: entry.resourceType,
        resourceName: entry.resourceName,
        unit: entry.unit,
        rate: entry.rate,
        rsrcShortName: entry.rsrcShortName,
      }))
    );

    res.json({
      id: secureRateCardId(req.user.companyId),
      page: result.page,
      metrics: result.metrics,
      count: entries.length,
      entries,
    });
  } catch (err) {
    console.error("[rate-card] Failed to load secure rate card");
    res.status(500).json({ error: "Failed to load secure rate card" });
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

    requireSensitiveAccess(req.user, { resourceType: "rateCard", operation: "update" });
    await replaceRateCardEntries(req.user.companyId, parsed.entries);
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
    console.error("[rate-card] Failed to upload rate card");
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
    requireSensitiveAccess(req.user, { resourceType: "rateCard", operation: "delete" });
    await replaceRateCardEntries(req.user.companyId, []);
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
    console.error("[rate-card] Failed to clear rate card");
    res.status(500).json({ error: "Failed to remove rate card" });
  }
}
