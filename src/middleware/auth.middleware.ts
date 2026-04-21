import type { Request, Response, NextFunction } from "express";
import { getBearerToken, verifyToken } from "../utils/auth.js";
import { prisma } from "../utils/prisma.js";
import { runWithAuthContext } from "../utils/requestContext.js";

export interface AuthRequest extends Request {
  user?: { id: string; email: string; name: string | null; companyId: string; role: "ADMIN" | "EDITOR" | "VIEWER" };
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const payload = verifyToken(token);
  if (!payload?.userId) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const user = (await (prisma as any).user.findUnique({
    where: { id: payload.userId },
  })) as any;
  if (!user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const companyId = user.companyId != null ? String(user.companyId).trim() : "";
  if (!companyId) {
    res.status(403).json({ error: "Account is not associated with a company" });
    return;
  }
  req.user = user as any;
  runWithAuthContext({ userId: user.id, companyId }, () => next());
}

export function requireRole(role: "ADMIN" | "EDITOR") {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (req.user.role !== role) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
