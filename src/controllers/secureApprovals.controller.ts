import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import {
  searchApprovalRequests,
  transitionApproval,
  type ApprovalPolicy,
  type ApprovalStatus,
} from "../services/approvals/approval.service.js";

function queryString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseLimit(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(Math.floor(n), 200);
}

function parsePolicy(body: unknown): Partial<ApprovalPolicy> | undefined {
  if (!body || typeof body !== "object") return undefined;
  const input = body as Record<string, unknown>;
  return {
    ...(Number.isFinite(Number(input.expiresInMinutes)) ? { expiresInMinutes: Number(input.expiresInMinutes) } : {}),
    ...(Number.isFinite(Number(input.maxDecryptCount)) ? { maxDecryptCount: Number(input.maxDecryptCount) } : {}),
    ...(Number.isFinite(Number(input.maxBatchSize)) ? { maxBatchSize: Number(input.maxBatchSize) } : {}),
  };
}

function reasonFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const reason = String((body as Record<string, unknown>).reason ?? "").trim();
  return reason || undefined;
}

async function listByStatus(req: AuthRequest, res: Response, status?: ApprovalStatus): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const result = await searchApprovalRequests({
      companyId: req.user.companyId,
      status,
      requestingUserId: queryString(req.query.requestingUserId) || undefined,
      resourceCategory: queryString(req.query.resourceCategory) || undefined,
      resourceType: queryString(req.query.resourceType) || undefined,
      cursor: queryString(req.query.cursor) || undefined,
      limit: parseLimit(req.query.limit),
    });
    res.json(result);
  } catch {
    console.error("[approvals] Failed to list approval requests");
    res.status(500).json({ error: "Failed to list approval requests" });
  }
}

export async function pending(req: AuthRequest, res: Response): Promise<void> {
  await listByStatus(req, res, "pending");
}

export async function history(req: AuthRequest, res: Response): Promise<void> {
  const status = queryString(req.query.status) as ApprovalStatus | "";
  await listByStatus(req, res, status || undefined);
}

async function transition(req: AuthRequest, res: Response, nextStatus: ApprovalStatus): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const id = queryString(req.params.id);
    if (!id) {
      res.status(400).json({ error: "id is required" });
      return;
    }

    const result = await transitionApproval({
      id,
      companyId: req.user.companyId,
      approverUserId: req.user.id,
      nextStatus,
      reason: reasonFromBody(req.body),
      policy: nextStatus === "approved" ? parsePolicy(req.body) : undefined,
    });

    res.json({
      ok: true,
      approval: result.row,
      ...(result.token ? { approvalToken: result.token } : {}),
    });
  } catch (err) {
    const status = typeof (err as any)?.status === "number" ? (err as any).status : 500;
    if (status !== 500) {
      res.status(status).json({ error: (err as Error).message });
      return;
    }
    console.error("[approvals] Failed to transition approval");
    res.status(500).json({ error: "Failed to transition approval" });
  }
}

export async function approve(req: AuthRequest, res: Response): Promise<void> {
  await transition(req, res, "approved");
}

export async function deny(req: AuthRequest, res: Response): Promise<void> {
  await transition(req, res, "denied");
}

export async function revoke(req: AuthRequest, res: Response): Promise<void> {
  await transition(req, res, "revoked");
}
