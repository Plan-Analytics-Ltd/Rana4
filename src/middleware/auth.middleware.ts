import type { Request, Response, NextFunction } from "express";
import { getBearerToken, verifyToken } from "../utils/auth.js";
import { prisma } from "../utils/prisma.js";
import { runWithAuthContext } from "../utils/requestContext.js";
import { logAccessDenied } from "../services/audit/immutableAudit.service.js";

export interface AuthRequest extends Request {
  user?: { id: string; email: string; name: string | null; companyId: string; role: "ADMIN" | "EDITOR" | "VIEWER" };
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    void logAccessDenied({
      resourceCategory: "auth",
      resourceType: "auth",
      metadata: { reason: "missing_bearer_token", path: req.path, method: req.method },
    });
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const payload = verifyToken(token);
  if (!payload?.userId) {
    void logAccessDenied({
      resourceCategory: "auth",
      resourceType: "auth",
      metadata: { reason: "invalid_or_expired_token", path: req.path, method: req.method },
    });
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const user = (await (prisma as any).user.findUnique({
    where: { id: payload.userId },
  })) as any;
  if (!user) {
    void logAccessDenied({
      userId: payload.userId,
      resourceCategory: "auth",
      resourceType: "auth",
      metadata: { reason: "token_user_not_found", path: req.path, method: req.method },
    });
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const companyId = user.companyId != null ? String(user.companyId).trim() : "";
  if (!companyId) {
    void logAccessDenied({
      userId: user.id,
      resourceCategory: "auth",
      resourceType: "auth",
      metadata: { reason: "missing_company", path: req.path, method: req.method },
    });
    res.status(403).json({ error: "Account is not associated with a company" });
    return;
  }
  req.user = user as any;
  runWithAuthContext({ userId: user.id, companyId }, () => next());
}

export function requireRole(role: "ADMIN" | "EDITOR") {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      void logAccessDenied({
        resourceCategory: "auth",
        resourceType: "auth",
        metadata: { reason: "missing_authenticated_user_for_role" },
      });
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (req.user.role !== role) {
      void logAccessDenied({
        userId: req.user.id,
        companyId: req.user.companyId,
        resourceCategory: "auth",
        resourceType: "auth",
        metadata: { reason: "role_denied", requiredRole: role },
      });
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
