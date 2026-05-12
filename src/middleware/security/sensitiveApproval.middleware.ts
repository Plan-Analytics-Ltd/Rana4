import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../auth.middleware.js";
import {
  ApprovalDeniedError,
  ApprovalRequiredError,
  requireSensitiveApproval as requireApproval,
  type ApprovalScope,
} from "../../services/approvals/approval.service.js";

export function approvalRequiredResponse(res: Response, err: ApprovalRequiredError): void {
  res.status(202).json({
    error: "Sensitive decrypt approval required",
    code: err.code,
    approvalRequestId: err.approvalRequestId,
  });
}

export function requireSensitiveApproval(scopeForRequest: (req: AuthRequest) => Omit<ApprovalScope, "userId" | "companyId">) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      const scope = scopeForRequest(req);
      await requireApproval({
        scope: {
          ...scope,
          userId: req.user.id,
          companyId: req.user.companyId,
        },
        decryptCount: 0,
        batchSize: 0,
        metadata: { route: req.path, method: req.method },
      });
      next();
    } catch (err) {
      if (err instanceof ApprovalRequiredError) {
        approvalRequiredResponse(res, err);
        return;
      }
      if (err instanceof ApprovalDeniedError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      next(err);
    }
  };
}
