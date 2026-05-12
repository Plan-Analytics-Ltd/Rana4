import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../utils/prisma.js";
import { getAuthContext } from "../../utils/requestContext.js";
import { getApprovalSigningSecret } from "../security/secrets/index.js";
import { getRuntimeSecurityConfig } from "../security/runtimeConfig.js";
import {
  logAbuseSignal,
  logSensitiveAccess,
  safeLogImmutableAudit,
  sanitizeAuditMetadata,
} from "../audit/immutableAudit.service.js";
import { notifyApprovalProviders } from "./notificationProviders.js";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "revoked";

export type ApprovalScope = {
  userId: string;
  companyId: string;
  action: string;
  resourceCategory: string;
  resourceId?: string | null;
  resourceType?: string | null;
};

export type ApprovalPolicy = {
  resourceCategory: string;
  companyId: string;
  action: string;
  expiresInMinutes: number;
  maxDecryptCount: number;
  maxBatchSize: number;
};

export type ApprovalRequestRow = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  requestId: string | null;
  traceId: string | null;
  sessionId: string | null;
  requestingUserId: string;
  approverUserId: string | null;
  resourceCategory: string;
  resourceId: string | null;
  companyId: string;
  resourceType: string | null;
  requestedAction: string;
  status: ApprovalStatus;
  reason: string | null;
  expiresAt: Date | null;
  approvedAt: Date | null;
  deniedAt: Date | null;
  revokedAt: Date | null;
  usageCount: number;
  maxDecryptCount: number;
  maxBatchSize: number;
  metadata: unknown;
};

export class ApprovalRequiredError extends Error {
  status = 202;
  code = "APPROVAL_REQUIRED";
  approvalRequestId: string;

  constructor(approvalRequestId: string) {
    super("Sensitive decrypt approval required");
    this.approvalRequestId = approvalRequestId;
  }
}

export class ApprovalDeniedError extends Error {
  status = 403;
  code = "APPROVAL_DENIED";
}

const allowedTransitions: Record<ApprovalStatus, ApprovalStatus[]> = {
  pending: ["approved", "denied", "expired", "revoked"],
  approved: ["expired", "revoked"],
  denied: [],
  expired: [],
  revoked: [],
};

const denialAttempts = new Map<string, number[]>();
const approvalAttempts = new Map<string, number[]>();

function recent(values: number[], windowMs: number): number[] {
  const cutoff = Date.now() - windowMs;
  return values.filter((value) => value >= cutoff);
}

function hashToken(token: string): string {
  return createHmac("sha256", getApprovalSigningSecret()).update(token).digest("hex");
}

function issueToken(): string {
  return randomBytes(32).toString("base64url");
}

function tokenHashesEqual(candidate: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(candidate), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function defaultPolicy(scope: ApprovalScope, overrides?: Partial<ApprovalPolicy>): ApprovalPolicy {
  return {
    resourceCategory: scope.resourceCategory,
    companyId: scope.companyId,
    action: scope.action,
    expiresInMinutes: Math.min(Math.max(Number(overrides?.expiresInMinutes ?? 15), 1), 120),
    maxDecryptCount: Math.min(Math.max(Number(overrides?.maxDecryptCount ?? 25), 1), 250),
    maxBatchSize: Math.min(Math.max(Number(overrides?.maxBatchSize ?? 50), 1), 250),
  };
}

function pendingExpiresAt(): Date {
  return new Date(Date.now() + getRuntimeSecurityConfig().approvalPendingExpiresMinutes * 60_000);
}

function contextMetadata(extra?: Record<string, unknown>): Record<string, unknown> {
  const ctx = getAuthContext();
  return sanitizeAuditMetadata({
    ...extra,
    requestId: ctx?.requestId,
    traceId: ctx?.traceId,
    sessionId: ctx?.sessionId,
  });
}

function rowFromDb(row: any): ApprovalRequestRow {
  return {
    id: String(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requestId: row.request_id,
    traceId: row.trace_id,
    sessionId: row.session_id,
    requestingUserId: row.requesting_user_id,
    approverUserId: row.approver_user_id,
    resourceCategory: row.resource_category,
    resourceId: row.resource_id,
    companyId: row.company_id,
    resourceType: row.resource_type,
    requestedAction: row.requested_action,
    status: row.status,
    reason: row.reason,
    expiresAt: row.expires_at,
    approvedAt: row.approved_at,
    deniedAt: row.denied_at,
    revokedAt: row.revoked_at,
    usageCount: Number(row.usage_count ?? 0),
    maxDecryptCount: Number(row.max_decrypt_count ?? 0),
    maxBatchSize: Number(row.max_batch_size ?? 0),
    metadata: row.metadata,
  };
}

function assertTransition(from: ApprovalStatus, to: ApprovalStatus): void {
  if (!allowedTransitions[from]?.includes(to)) {
    const err = new Error(`Invalid approval transition: ${from} -> ${to}`);
    (err as any).status = 409;
    throw err;
  }
}

async function recordApprovalTransitionSignals(params: {
  row: ApprovalRequestRow;
  approverUserId: string;
  nextStatus: ApprovalStatus;
}): Promise<void> {
  const now = Date.now();
  if (params.nextStatus === "denied") {
    const key = `${params.row.companyId}:${params.row.requestingUserId}`;
    const values = recent(denialAttempts.get(key) ?? [], 60 * 60 * 1000);
    values.push(now);
    denialAttempts.set(key, values);
    if (values.length >= 3) {
      await logAbuseSignal({
        action: "REPEATED_APPROVAL_DENIALS",
        userId: params.approverUserId,
        companyId: params.row.companyId,
        resourceCategory: params.row.resourceCategory,
        resourceId: params.row.resourceId,
        resourceType: params.row.resourceType,
        accessGranted: false,
        metadata: { approvalRequestId: params.row.id, requestingUserId: params.row.requestingUserId, denialCountWindow: values.length },
      });
    }
  }

  if (params.nextStatus === "approved") {
    const key = `${params.row.companyId}:${params.approverUserId}`;
    const values = recent(approvalAttempts.get(key) ?? [], 10 * 60 * 1000);
    values.push(now);
    approvalAttempts.set(key, values);
    if (values.length >= 10) {
      await logAbuseSignal({
        action: "MASS_APPROVAL_ATTEMPTS",
        userId: params.approverUserId,
        companyId: params.row.companyId,
        resourceCategory: params.row.resourceCategory,
        resourceType: params.row.resourceType,
        accessGranted: true,
        metadata: { approvalCountWindow: values.length },
      });
    }
  }
}

async function latestPendingForScope(scope: ApprovalScope): Promise<ApprovalRequestRow | null> {
  const rows = await prisma.$queryRaw<any[]>(
    Prisma.sql`
      SELECT *
      FROM private_data.access_approval_requests
      WHERE company_id = ${scope.companyId}
        AND requesting_user_id = ${scope.userId}
        AND resource_category = ${scope.resourceCategory}
        AND requested_action = ${scope.action}
        AND (${scope.resourceId}::text IS NULL OR resource_id = ${scope.resourceId})
        AND (${scope.resourceType}::text IS NULL OR resource_type = ${scope.resourceType})
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `
  );
  return rows[0] ? rowFromDb(rows[0]) : null;
}

export async function createApprovalRequest(scope: ApprovalScope, metadata?: Record<string, unknown>): Promise<ApprovalRequestRow> {
  const existing = await latestPendingForScope(scope);
  if (existing) {
    if (existing.expiresAt && existing.expiresAt.getTime() <= Date.now()) {
      await expireApproval(existing, "pending_approval_expired");
    } else {
      return existing;
    }
  }

  const ctx = getAuthContext();
  const rows = await prisma.$queryRaw<any[]>(
    Prisma.sql`
      INSERT INTO private_data.access_approval_requests (
        request_id,
        trace_id,
        session_id,
        requesting_user_id,
        resource_category,
        resource_id,
        company_id,
        resource_type,
        requested_action,
        status,
        expires_at,
        metadata
      )
      VALUES (
        ${ctx?.requestId ?? null},
        ${ctx?.traceId ?? null},
        ${ctx?.sessionId ?? null},
        ${scope.userId},
        ${scope.resourceCategory},
        ${scope.resourceId ?? null},
        ${scope.companyId},
        ${scope.resourceType ?? null},
        ${scope.action},
        'pending',
        ${pendingExpiresAt()},
        ${JSON.stringify(contextMetadata(metadata))}::jsonb
      )
      RETURNING *
    `
  );
  const row = rowFromDb(rows[0]);

  await safeLogImmutableAudit({
    action: "APPROVAL_REQUESTED",
    userId: scope.userId,
    companyId: scope.companyId,
    resourceCategory: scope.resourceCategory,
    resourceId: scope.resourceId,
    resourceType: scope.resourceType,
    accessGranted: false,
    metadata: { approvalRequestId: row.id, requestedAction: scope.action },
  });
  await notifyApprovalProviders({
    event: "approval_requested",
    approvalRequestId: row.id,
    companyId: scope.companyId,
    requestingUserId: scope.userId,
    resourceCategory: scope.resourceCategory,
    resourceType: scope.resourceType,
    requestedAction: scope.action,
  });

  return row;
}

export async function transitionApproval(params: {
  id: string;
  companyId: string;
  approverUserId: string;
  nextStatus: ApprovalStatus;
  reason?: string;
  policy?: Partial<ApprovalPolicy>;
}): Promise<{ row: ApprovalRequestRow; token?: string }> {
  const rows = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT * FROM private_data.access_approval_requests WHERE id = ${params.id}::uuid AND company_id = ${params.companyId} LIMIT 1`
  );
  const current = rows[0] ? rowFromDb(rows[0]) : null;
  if (!current) {
    const err = new Error("Approval request not found");
    (err as any).status = 404;
    throw err;
  }
  if (current.expiresAt && current.expiresAt.getTime() <= Date.now() && current.status !== "expired") {
    await expireApproval(current, "approval_expired_before_transition");
    const err = new Error("Approval request has expired");
    (err as any).status = 409;
    throw err;
  }
  assertTransition(current.status, params.nextStatus);

  const policy = defaultPolicy(
    {
      userId: current.requestingUserId,
      companyId: current.companyId,
      action: current.requestedAction,
      resourceCategory: current.resourceCategory,
      resourceId: current.resourceId,
      resourceType: current.resourceType,
    },
    params.policy
  );
  const token = params.nextStatus === "approved" ? issueToken() : undefined;
  const tokenHash = token ? hashToken(token) : null;
  const expiresAt = params.nextStatus === "approved" ? new Date(Date.now() + policy.expiresInMinutes * 60_000) : null;
  const timestampColumn =
    params.nextStatus === "approved"
      ? Prisma.sql`approved_at = now(),`
      : params.nextStatus === "denied"
        ? Prisma.sql`denied_at = now(),`
        : params.nextStatus === "revoked"
          ? Prisma.sql`revoked_at = now(),`
          : Prisma.sql``;

  const updated = await prisma.$queryRaw<any[]>(
    Prisma.sql`
      UPDATE private_data.access_approval_requests
      SET
        status = ${params.nextStatus},
        approver_user_id = ${params.approverUserId},
        reason = ${params.reason ?? null},
        expires_at = ${expiresAt},
        approval_token_hash = ${tokenHash},
        max_decrypt_count = ${policy.maxDecryptCount},
        max_batch_size = ${policy.maxBatchSize},
        ${timestampColumn}
        metadata = metadata || ${JSON.stringify(contextMetadata({ policy }))}::jsonb
      WHERE id = ${params.id}::uuid
      RETURNING *
    `
  );
  const row = rowFromDb(updated[0]);
  const action =
    params.nextStatus === "approved"
      ? "APPROVAL_GRANTED"
      : params.nextStatus === "denied"
        ? "APPROVAL_DENIED"
        : params.nextStatus === "revoked"
          ? "APPROVAL_REVOKED"
          : "APPROVAL_EXPIRED";

  await safeLogImmutableAudit({
    action,
    userId: params.approverUserId,
    companyId: row.companyId,
    resourceCategory: row.resourceCategory,
    resourceId: row.resourceId,
    resourceType: row.resourceType,
    accessGranted: params.nextStatus === "approved",
    metadata: { approvalRequestId: row.id, requestingUserId: row.requestingUserId, reason: params.reason },
  });
  await recordApprovalTransitionSignals({ row, approverUserId: params.approverUserId, nextStatus: params.nextStatus });
  await notifyApprovalProviders({
    event:
      params.nextStatus === "approved"
        ? "approval_granted"
        : params.nextStatus === "denied"
          ? "approval_denied"
          : params.nextStatus === "revoked"
            ? "approval_revoked"
            : "approval_expired",
    approvalRequestId: row.id,
    companyId: row.companyId,
    requestingUserId: row.requestingUserId,
    resourceCategory: row.resourceCategory,
    resourceType: row.resourceType,
    requestedAction: row.requestedAction,
  });

  return { row, token };
}

async function expireApproval(row: ApprovalRequestRow, reason: string): Promise<void> {
  if (row.status !== "approved" && row.status !== "pending") return;
  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE private_data.access_approval_requests
      SET status = 'expired', reason = ${reason}, expires_at = COALESCE(expires_at, now())
      WHERE id = ${row.id}::uuid AND status IN ('approved', 'pending')
    `
  );
  await safeLogImmutableAudit({
    action: "APPROVAL_EXPIRED",
    userId: row.requestingUserId,
    companyId: row.companyId,
    resourceCategory: row.resourceCategory,
    resourceId: row.resourceId,
    resourceType: row.resourceType,
    accessGranted: false,
    metadata: { approvalRequestId: row.id, reason },
  });
}

async function expireStaleApprovals(companyId: string): Promise<void> {
  const rows = await prisma.$queryRaw<any[]>(
    Prisma.sql`
      SELECT *
      FROM private_data.access_approval_requests
      WHERE company_id = ${companyId}
        AND status IN ('pending', 'approved')
        AND expires_at IS NOT NULL
        AND expires_at <= now()
      LIMIT 100
    `
  );
  for (const row of rows.map(rowFromDb)) {
    await expireApproval(row, "approval_expired");
  }
}

export async function requireSensitiveApproval(params: {
  scope: ApprovalScope;
  approvalToken?: string;
  decryptCount: number;
  batchSize: number;
  metadata?: Record<string, unknown>;
}): Promise<{ approvalRequestId: string }> {
  const token = String(params.approvalToken ?? getAuthContext()?.approvalToken ?? "").trim();
  if (!token) {
    const pending = await createApprovalRequest(params.scope, params.metadata);
    throw new ApprovalRequiredError(pending.id);
  }

  const rows = await prisma.$queryRaw<any[]>(
    Prisma.sql`
      SELECT *
      FROM private_data.access_approval_requests
      WHERE requesting_user_id = ${params.scope.userId}
        AND company_id = ${params.scope.companyId}
        AND resource_category = ${params.scope.resourceCategory}
        AND requested_action = ${params.scope.action}
        AND (${params.scope.resourceId}::text IS NULL OR resource_id = ${params.scope.resourceId})
        AND (${params.scope.resourceType}::text IS NULL OR resource_type = ${params.scope.resourceType})
        AND approval_token_hash IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 25
    `
  );
  const rawRow = rows.find((candidate) => tokenHashesEqual(token, String(candidate.approval_token_hash ?? "")));
  const row = rawRow ? rowFromDb(rawRow) : null;
  if (!row) {
    await logAbuseSignal({
      action: "APPROVAL_BYPASS_ATTEMPT",
      userId: params.scope.userId,
      companyId: params.scope.companyId,
      resourceCategory: params.scope.resourceCategory,
      resourceId: params.scope.resourceId,
      resourceType: params.scope.resourceType,
      accessGranted: false,
      metadata: { reason: "invalid_approval_token" },
    });
    const pending = await createApprovalRequest(params.scope, params.metadata);
    throw new ApprovalRequiredError(pending.id);
  }
  if (row.status !== "approved") {
    throw new ApprovalDeniedError(`Approval is ${row.status}`);
  }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    await expireApproval(row, "approval_expired");
    await logAbuseSignal({
      action: "EXPIRED_APPROVAL_TOKEN_REUSE",
      userId: params.scope.userId,
      companyId: params.scope.companyId,
      resourceCategory: params.scope.resourceCategory,
      resourceId: params.scope.resourceId,
      resourceType: params.scope.resourceType,
      accessGranted: false,
      metadata: { approvalRequestId: row.id },
    });
    const pending = await createApprovalRequest(params.scope, params.metadata);
    throw new ApprovalRequiredError(pending.id);
  }
  if (params.batchSize > row.maxBatchSize || row.usageCount + params.decryptCount > row.maxDecryptCount) {
    await transitionApproval({
      id: row.id,
      companyId: row.companyId,
      approverUserId: row.approverUserId ?? "system",
      nextStatus: "revoked",
      reason: "approval_usage_limit_exceeded",
    });
    await logAbuseSignal({
      action: "APPROVAL_USAGE_LIMIT_EXCEEDED",
      userId: params.scope.userId,
      companyId: params.scope.companyId,
      resourceCategory: params.scope.resourceCategory,
      resourceId: params.scope.resourceId,
      resourceType: params.scope.resourceType,
      decryptCount: params.decryptCount,
      resultCount: params.batchSize,
      accessGranted: false,
      metadata: { approvalRequestId: row.id, usageCount: row.usageCount, maxDecryptCount: row.maxDecryptCount },
    });
    throw new ApprovalDeniedError("Approval usage limit exceeded");
  }

  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE private_data.access_approval_requests
      SET usage_count = usage_count + ${params.decryptCount}
      WHERE id = ${row.id}::uuid AND status = 'approved'
    `
  );
  await logSensitiveAccess({
    action: "DECRYPT_UNDER_APPROVAL",
    userId: params.scope.userId,
    companyId: params.scope.companyId,
    resourceCategory: params.scope.resourceCategory,
    resourceId: params.scope.resourceId,
    resourceType: params.scope.resourceType,
    decryptCount: params.decryptCount,
    resultCount: params.batchSize,
    accessGranted: true,
    metadata: { approvalRequestId: row.id },
  });

  return { approvalRequestId: row.id };
}

export async function searchApprovalRequests(filters: {
  companyId: string;
  status?: ApprovalStatus;
  requestingUserId?: string;
  resourceCategory?: string;
  resourceType?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ items: ApprovalRequestRow[]; nextCursor: string | null }> {
  await expireStaleApprovals(filters.companyId);
  const limit = Math.min(Math.max(Math.floor(filters.limit ?? 50), 1), 200);
  const where: Prisma.Sql[] = [Prisma.sql`company_id = ${filters.companyId}`];
  if (filters.status) where.push(Prisma.sql`status = ${filters.status}`);
  if (filters.requestingUserId) where.push(Prisma.sql`requesting_user_id = ${filters.requestingUserId}`);
  if (filters.resourceCategory) where.push(Prisma.sql`resource_category = ${filters.resourceCategory}`);
  if (filters.resourceType) where.push(Prisma.sql`resource_type = ${filters.resourceType}`);
  if (filters.cursor) {
    const cursorRows = await prisma.$queryRaw<{ created_at: Date; id: string }[]>(
      Prisma.sql`SELECT created_at, id::text FROM private_data.access_approval_requests WHERE id = ${filters.cursor}::uuid LIMIT 1`
    );
    const cursor = cursorRows[0];
    if (cursor) {
      where.push(Prisma.sql`(created_at < ${cursor.created_at} OR (created_at = ${cursor.created_at} AND id < ${cursor.id}::uuid))`);
    }
  }

  const rows = await prisma.$queryRaw<any[]>(
    Prisma.sql`
      SELECT *
      FROM private_data.access_approval_requests
      WHERE ${Prisma.join(where, " AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit + 1}
    `
  );
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map(rowFromDb);
  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
  };
}
