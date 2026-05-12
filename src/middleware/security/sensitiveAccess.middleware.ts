import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../auth.middleware.js";
import { logAbuseSignal, logAccessDenied, recordDeniedAccessSignal } from "../../services/audit/immutableAudit.service.js";

export type SensitiveOperation = "read" | "create" | "update" | "delete" | "decrypt" | string;

export type SensitiveAccessAction = {
  resourceType: "rateCard" | "resourceRegistry" | string;
  operation: SensitiveOperation;
  resourceId?: string;
};

export type SensitiveAccessUser = {
  id: string;
  companyId: string;
  role?: string;
};

export type SensitiveAccessGrant = {
  userId: string;
  companyId: string;
  action: SensitiveAccessAction;
  grantedAt: string;
};

export type SensitiveAccessAuthorizer = (params: {
  user: SensitiveAccessUser;
  action: SensitiveAccessAction;
}) => boolean | { ok: boolean; reason?: string };

const authorizers: SensitiveAccessAuthorizer[] = [];

export function registerSensitiveAccessAuthorizer(authorizer: SensitiveAccessAuthorizer): void {
  authorizers.push(authorizer);
}

export function requireSensitiveAccess(
  user: SensitiveAccessUser | null | undefined,
  action: SensitiveAccessAction
): SensitiveAccessGrant {
  if (!user?.id || !user.companyId) {
    void logAccessDenied({
      userId: user?.id ?? null,
      companyId: user?.companyId ?? null,
      resourceCategory: action.resourceType,
      resourceId: action.resourceId ?? null,
      resourceType: action.resourceType,
      metadata: { operation: action.operation, reason: "missing_authenticated_user" },
    });
    const err = new Error("Sensitive data access requires authentication");
    (err as any).status = 401;
    throw err;
  }

  for (const authorizer of authorizers) {
    const decision = authorizer({ user, action });
    const ok = typeof decision === "boolean" ? decision : decision.ok;
    if (!ok) {
      const signal = recordDeniedAccessSignal(user.id);
      void logAccessDenied({
        userId: user.id,
        companyId: user.companyId,
        resourceCategory: action.resourceType,
        resourceId: action.resourceId ?? null,
        resourceType: action.resourceType,
        metadata: {
          operation: action.operation,
          reason: typeof decision === "object" && decision.reason ? decision.reason : "authorizer_denied",
          deniedCountWindow: signal.count,
        },
      });
      if (signal.suspicious) {
        void logAbuseSignal({
          userId: user.id,
          companyId: user.companyId,
          resourceCategory: action.resourceType,
          resourceId: action.resourceId ?? null,
          resourceType: action.resourceType,
          accessGranted: false,
          metadata: { reason: "repeated_denied_access", deniedCountWindow: signal.count },
        });
      }
      const err = new Error(typeof decision === "object" && decision.reason ? decision.reason : "Sensitive data access denied");
      (err as any).status = 403;
      throw err;
    }
  }

  return {
    userId: user.id,
    companyId: user.companyId,
    action,
    grantedAt: new Date().toISOString(),
  };
}

export function requireSensitiveAccessMiddleware(action: SensitiveAccessAction) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    try {
      requireSensitiveAccess(req.user, action);
      next();
    } catch (err) {
      const status = typeof (err as any)?.status === "number" ? (err as any).status : 403;
      res.status(status).json({ error: status === 401 ? "Authentication required" : "Forbidden" });
    }
  };
}
