import { createHmac, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../utils/prisma.js";
import { getAuthContext } from "../../utils/requestContext.js";
import { getAuditSigningSecret } from "../security/secrets/index.js";

export type ImmutableAuditAction =
  | "SENSITIVE_ACCESS"
  | "DECRYPT_OPERATION"
  | "ACCESS_DENIED"
  | "DECRYPT_BATCH_LIMIT_EXCEEDED"
  | "UNAUTHORIZED_ACCESS_ATTEMPT"
  | "ABUSE_SIGNAL"
  | string;

export type ImmutableAuditInput = {
  action: ImmutableAuditAction;
  resourceCategory: string;
  resourceId?: string | null;
  companyId?: string | null;
  userId?: string | null;
  requestId?: string | null;
  traceId?: string | null;
  sessionId?: string | null;
  resourceType?: string | null;
  decryptCount?: number;
  resultCount?: number;
  queryDurationMs?: number;
  accessGranted: boolean;
  metadata?: Record<string, unknown>;
};

export type ImmutableAuditSearchFilters = {
  companyId: string;
  userId?: string;
  requestId?: string;
  action?: string;
  resourceCategory?: string;
  resourceType?: string;
  accessGranted?: boolean;
  limit?: number;
  cursor?: string;
};

export type ImmutableAuditRow = {
  id: string;
  createdAt: Date;
  userId: string | null;
  requestId: string | null;
  traceId: string | null;
  sessionId: string | null;
  action: string;
  resourceCategory: string;
  resourceId: string | null;
  companyId: string | null;
  resourceType: string | null;
  decryptCount: number;
  resultCount: number;
  queryDurationMs: number;
  accessGranted: boolean;
  hash: string | null;
  previousHash: string | null;
  metadata: unknown;
};

const MAX_METADATA_BYTES = 8192;
const MAX_STRING_LENGTH = 512;
const SENSITIVE_KEY_PATTERN =
  /(payload|payload_enc|decrypted|plaintext|plain_text|secret|token|password|authorization|cookie|key|sql|query|stack|error_stack)/i;

const recentDeniedByUser = new Map<string, number[]>();

function nowWindow(values: number[], windowMs: number): number[] {
  const cutoff = Date.now() - windowMs;
  return values.filter((value) => value >= cutoff);
}

function boundedNumber(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[redacted:max-depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.slice(0, MAX_STRING_LENGTH);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return "[redacted:binary]";
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = sanitizeValue(nested, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, MAX_STRING_LENGTH);
}

export function sanitizeAuditMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const sanitized = (sanitizeValue(metadata ?? {}) ?? {}) as Record<string, unknown>;
  const json = JSON.stringify(sanitized);
  if (Buffer.byteLength(json, "utf8") <= MAX_METADATA_BYTES) return sanitized;
  return {
    truncated: true,
    originalBytes: Buffer.byteLength(json, "utf8"),
  };
}

function contextDefaults(input: ImmutableAuditInput): Required<Omit<ImmutableAuditInput, "metadata">> & {
  metadata: Record<string, unknown>;
} {
  const ctx = getAuthContext();
  return {
    action: input.action,
    resourceCategory: input.resourceCategory,
    resourceId: input.resourceId ?? null,
    companyId: input.companyId ?? ctx?.companyId ?? null,
    userId: input.userId ?? ctx?.userId ?? null,
    requestId: input.requestId ?? ctx?.requestId ?? null,
    traceId: input.traceId ?? ctx?.traceId ?? null,
    sessionId: input.sessionId ?? ctx?.sessionId ?? null,
    resourceType: input.resourceType ?? null,
    decryptCount: boundedNumber(input.decryptCount),
    resultCount: boundedNumber(input.resultCount),
    queryDurationMs: boundedNumber(input.queryDurationMs),
    accessGranted: Boolean(input.accessGranted),
    metadata: sanitizeAuditMetadata({
      ...input.metadata,
      ...(ctx?.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
      ...(ctx?.userAgent ? { userAgent: ctx.userAgent } : {}),
    }),
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
}

async function previousAuditHash(companyId: string | null): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ hash: string | null }[]>(
    Prisma.sql`
      SELECT hash
      FROM private_data.audit_log
      WHERE (${companyId}::text IS NULL OR company_id = ${companyId})
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `
  );
  return rows[0]?.hash ?? null;
}

async function insertImmutableAudit(input: ImmutableAuditInput): Promise<void> {
  const event = contextDefaults(input);
  const previousHash = await previousAuditHash(event.companyId);
  const id = randomUUID();
  const createdAt = new Date();
  const hashMaterial = stableJson({ id, createdAt: createdAt.toISOString(), ...event, previousHash });
  const hash = createHmac("sha256", getAuditSigningSecret()).update(hashMaterial).digest("hex");

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO private_data.audit_log (
        id,
        created_at,
        user_id,
        request_id,
        trace_id,
        session_id,
        action,
        resource_category,
        resource_id,
        company_id,
        resource_type,
        decrypt_count,
        result_count,
        query_duration_ms,
        access_granted,
        hash,
        previous_hash,
        metadata
      )
      VALUES (
        ${id}::uuid,
        ${createdAt},
        ${event.userId},
        ${event.requestId},
        ${event.traceId},
        ${event.sessionId},
        ${event.action},
        ${event.resourceCategory},
        ${event.resourceId},
        ${event.companyId},
        ${event.resourceType},
        ${event.decryptCount},
        ${event.resultCount},
        ${event.queryDurationMs},
        ${event.accessGranted},
        ${hash},
        ${previousHash},
        ${JSON.stringify(event.metadata)}::jsonb
      )
    `
  );
}

export async function safeLogImmutableAudit(input: ImmutableAuditInput): Promise<void> {
  try {
    await insertImmutableAudit(input);
  } catch {
    console.warn("[secure-audit] immutable audit write failed");
  }
}

export async function logSensitiveAccess(input: Omit<ImmutableAuditInput, "action"> & { action?: string }): Promise<void> {
  await safeLogImmutableAudit({ ...input, action: input.action ?? "SENSITIVE_ACCESS" });
}

export async function logDecryptOperation(input: Omit<ImmutableAuditInput, "action" | "accessGranted">): Promise<void> {
  await safeLogImmutableAudit({ ...input, action: "DECRYPT_OPERATION", accessGranted: true });
}

export async function logAccessDenied(input: Omit<ImmutableAuditInput, "action" | "accessGranted">): Promise<void> {
  await safeLogImmutableAudit({ ...input, action: "ACCESS_DENIED", accessGranted: false });
}

export async function logAbuseSignal(input: Omit<ImmutableAuditInput, "action"> & { action?: string }): Promise<void> {
  await safeLogImmutableAudit({ ...input, action: input.action ?? "ABUSE_SIGNAL" });
}

export function recordDeniedAccessSignal(userId: string | null | undefined): { count: number; suspicious: boolean } {
  const key = String(userId || "anonymous");
  const recent = nowWindow(recentDeniedByUser.get(key) ?? [], 5 * 60 * 1000);
  recent.push(Date.now());
  recentDeniedByUser.set(key, recent);
  return { count: recent.length, suspicious: recent.length >= 5 };
}

export async function searchImmutableAuditLogs(filters: ImmutableAuditSearchFilters): Promise<{
  items: ImmutableAuditRow[];
  nextCursor: string | null;
}> {
  const limit = Math.min(Math.max(Math.floor(filters.limit ?? 50), 1), 200);
  const where: Prisma.Sql[] = [Prisma.sql`company_id = ${filters.companyId}`];
  if (filters.userId) where.push(Prisma.sql`user_id = ${filters.userId}`);
  if (filters.requestId) where.push(Prisma.sql`request_id = ${filters.requestId}`);
  if (filters.action) where.push(Prisma.sql`action = ${filters.action}`);
  if (filters.resourceCategory) where.push(Prisma.sql`resource_category = ${filters.resourceCategory}`);
  if (filters.resourceType) where.push(Prisma.sql`resource_type = ${filters.resourceType}`);
  if (filters.accessGranted !== undefined) where.push(Prisma.sql`access_granted = ${filters.accessGranted}`);
  if (filters.cursor) {
    const cursorRows = await prisma.$queryRaw<{ created_at: Date; id: string }[]>(
      Prisma.sql`SELECT created_at, id::text FROM private_data.audit_log WHERE id = ${filters.cursor}::uuid LIMIT 1`
    );
    const cursor = cursorRows[0];
    if (cursor) {
      where.push(Prisma.sql`(created_at < ${cursor.created_at} OR (created_at = ${cursor.created_at} AND id < ${cursor.id}::uuid))`);
    }
  }

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      created_at: Date;
      user_id: string | null;
      request_id: string | null;
      trace_id: string | null;
      session_id: string | null;
      action: string;
      resource_category: string;
      resource_id: string | null;
      company_id: string | null;
      resource_type: string | null;
      decrypt_count: number;
      result_count: number;
      query_duration_ms: number;
      access_granted: boolean;
      hash: string | null;
      previous_hash: string | null;
      metadata: unknown;
    }>
  >(
    Prisma.sql`
      SELECT
        id::text,
        created_at,
        user_id,
        request_id,
        trace_id,
        session_id,
        action,
        resource_category,
        resource_id,
        company_id,
        resource_type,
        decrypt_count,
        result_count,
        query_duration_ms,
        access_granted,
        hash,
        previous_hash,
        metadata
      FROM private_data.audit_log
      WHERE ${Prisma.join(where, " AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit + 1}
    `
  );

  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    userId: row.user_id,
    requestId: row.request_id,
    traceId: row.trace_id,
    sessionId: row.session_id,
    action: row.action,
    resourceCategory: row.resource_category,
    resourceId: row.resource_id,
    companyId: row.company_id,
    resourceType: row.resource_type,
    decryptCount: row.decrypt_count,
    resultCount: row.result_count,
    queryDurationMs: row.query_duration_ms,
    accessGranted: row.access_granted,
    hash: row.hash,
    previousHash: row.previous_hash,
    metadata: sanitizeValue(row.metadata),
  }));

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
  };
}
