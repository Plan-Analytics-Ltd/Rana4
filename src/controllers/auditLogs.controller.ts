import type { Response } from "express";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { isDevPanelEmail } from "../utils/devPanelAccess.js";
import { searchImmutableAuditLogs, type ImmutableAuditSearchFilters } from "../services/audit/immutableAudit.service.js";
import { enrichAuditLogsForSummary } from "../services/audit/auditLogPresentation.service.js";

function parseLimit(limitRaw: unknown): number {
  const n = typeof limitRaw === "string" ? Number(limitRaw) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(Math.floor(n), 200);
}

function queryString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function requireSecureAuditAdmin(req: AuthRequest, res: Response): boolean {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  if (!isDevPanelEmail(req.user.email) && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

async function searchSecureAudit(req: AuthRequest, res: Response, defaults: Partial<ImmutableAuditSearchFilters> = {}): Promise<void> {
  try {
    if (!requireSecureAuditAdmin(req, res)) return;
    const user = req.user;
    if (!user) return;
    const filters: ImmutableAuditSearchFilters = {
      companyId: user.companyId,
      ...defaults,
      ...(queryString(req.query.userId) ? { userId: queryString(req.query.userId) } : {}),
      ...(queryString(req.query.requestId) ? { requestId: queryString(req.query.requestId) } : {}),
      ...(queryString(req.query.action) ? { action: queryString(req.query.action) } : {}),
      ...(queryString(req.query.resourceCategory) ? { resourceCategory: queryString(req.query.resourceCategory) } : {}),
      ...(queryString(req.query.resourceType) ? { resourceType: queryString(req.query.resourceType) } : {}),
      ...(parseBoolean(req.query.accessGranted) !== undefined ? { accessGranted: parseBoolean(req.query.accessGranted) } : {}),
      ...(queryString(req.query.cursor) ? { cursor: queryString(req.query.cursor) } : {}),
      limit: parseLimit(req.query.limit),
    };

    const result = await searchImmutableAuditLogs(filters);
    res.json(result);
  } catch {
    console.error("[audit] Failed to load immutable audit logs");
    res.status(500).json({ error: "Failed to load immutable audit logs" });
  }
}

export async function list(req: AuthRequest, res: Response): Promise<void> {
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
    // Audit logs are sensitive: only company ADMIN or dev-panel users may read them.
    if (!isDevPanelEmail(req.user.email)) {
      requirePermission(membership.role, "auditLog", "read");
      if (req.user.role !== "ADMIN") {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
    const action = typeof req.query.action === "string" ? req.query.action.trim() : "";
    const entity = typeof req.query.entity === "string" ? req.query.entity.trim() : "";
    const entityId = typeof req.query.entityId === "string" ? req.query.entityId.trim() : "";
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor.trim() : "";
    const limit = parseLimit(req.query.limit);
    const view = typeof req.query.view === "string" ? req.query.view.trim().toLowerCase() : "";

    const rows = await prisma.auditLog.findMany({
      where: {
        companyId: req.user.companyId,
        projectId,
        ...(userId ? { userId } : {}),
        ...(action ? { action } : {}),
        ...(entity ? { entity } : {}),
        ...(entityId ? { entityId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    if (view === "summary") {
      res.json({ items: await enrichAuditLogsForSummary(items), nextCursor });
      return;
    }

    res.json({ items, nextCursor });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to load audit logs" });
  }
}

export async function secureSearch(req: AuthRequest, res: Response): Promise<void> {
  await searchSecureAudit(req, res);
}

export async function accessHistory(req: AuthRequest, res: Response): Promise<void> {
  await searchSecureAudit(req, res, { action: "SENSITIVE_ACCESS" });
}

export async function decryptActivity(req: AuthRequest, res: Response): Promise<void> {
  await searchSecureAudit(req, res, { action: "DECRYPT_OPERATION" });
}

export async function deniedAccess(req: AuthRequest, res: Response): Promise<void> {
  await searchSecureAudit(req, res, { accessGranted: false });
}

