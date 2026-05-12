import { Prisma } from "@prisma/client";
import { decryptPayload, encryptPayload, type EncryptedPayload, type SecureDbClient } from "../../services/encryption/index.js";
import { auditSecureDecryptAccess, auditSecureQueryMetrics } from "../../services/audit/secureAudit.service.js";
import { logAbuseSignal } from "../../services/audit/immutableAudit.service.js";
import { requireSensitiveApproval } from "../../services/approvals/approval.service.js";
import { getRuntimeSecurityConfig } from "../../services/security/runtimeConfig.js";
import { requireSensitiveAccess, type SensitiveAccessAction } from "../../middleware/security/sensitiveAccess.middleware.js";
import { getAuthContext } from "../../utils/requestContext.js";
import { prisma } from "../../utils/prisma.js";

export type SecureTable = "rateCard" | "resourceRegistry";

type SecureRow = {
  id: string;
  company_id: string | null;
  resource_type: string | null;
  created_at: Date | string | null;
  payload_enc: EncryptedPayload;
};

export type SecureRowMetadata = {
  id: string;
  companyId: string | null;
  resourceType: string | null;
  createdAt: Date | null;
};

export type SecureMetadataFilter = {
  id?: string;
  companyId: string;
  resourceType?: string;
};

export type SecurePagination = {
  page?: number;
  pageSize?: number;
  offset?: number;
  cursor?: {
    createdAt: Date | string;
    id?: string;
  };
  order?: "asc" | "desc";
  maxDecryptBatchSize?: number;
};

export type SecureQueryMetrics = {
  durationMs: number;
  filteredCount: number;
  returnedCount: number;
  decryptCount: number;
};

export type SecureQueryResult<T> = {
  items: Array<{ metadata: SecureRowMetadata; payload: T }>;
  page: {
    limit: number;
    offset: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
  metrics: SecureQueryMetrics;
};

export type SecurePayloadMetadataInput = {
  id: string;
  companyId: string;
  resourceType: string;
  createdAt?: Date;
};

const ABSOLUTE_MAX_DECRYPT_BATCH_SIZE = 250;

function secureTableSql(table: SecureTable): Prisma.Sql {
  switch (table) {
    case "rateCard":
      return Prisma.raw('"private_data"."rate_card_secure"');
    case "resourceRegistry":
      return Prisma.raw('"private_data"."resource_registry_secure"');
  }
}

export function companyMetadataFilter(companyId: string): SecureMetadataFilter {
  return { companyId };
}

export function resourceTypeMetadataFilter(companyId: string, resourceType: string): SecureMetadataFilter {
  return { companyId, resourceType };
}

export function createdAtPagination(pagination?: Omit<SecurePagination, "order">, order: "asc" | "desc" = "desc"): SecurePagination {
  return { ...pagination, order };
}

function sensitiveAction(table: SecureTable, operation: SensitiveAccessAction["operation"], resourceId?: string): SensitiveAccessAction {
  return {
    resourceType: table === "rateCard" ? "rateCard" : "resourceRegistry",
    operation,
    resourceId,
  };
}

function assertSensitiveAccess(table: SecureTable, operation: SensitiveAccessAction["operation"], resourceId: string) {
  const auth = getAuthContext();
  return requireSensitiveAccess(auth ? { id: auth.userId, companyId: auth.companyId } : null, sensitiveAction(table, operation, resourceId));
}

function db(client?: SecureDbClient): SecureDbClient {
  return client ?? (prisma as unknown as SecureDbClient);
}

function configuredMaxDecryptBatchSize(): number {
  return Math.min(getRuntimeSecurityConfig().maxDecryptBatchSize, ABSOLUTE_MAX_DECRYPT_BATCH_SIZE);
}

function normalizePagination(pagination?: SecurePagination): { limit: number; offset: number; order: "asc" | "desc"; cursor?: SecurePagination["cursor"] } {
  const max = pagination?.maxDecryptBatchSize ?? configuredMaxDecryptBatchSize();
  const pageSize = pagination?.pageSize ?? configuredMaxDecryptBatchSize();
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("Secure query pageSize must be a positive integer");
  }
  if (pageSize > max) {
    void logAbuseSignal({
      action: "DECRYPT_BATCH_LIMIT_EXCEEDED",
      resourceCategory: "secureData",
      resourceType: "secureData",
      accessGranted: false,
      metadata: { requestedPageSize: pageSize, maxDecryptBatchSize: max },
    });
    throw new Error("Secure query pageSize exceeds MAX_DECRYPT_BATCH_SIZE");
  }

  const page = pagination?.page;
  const offset = pagination?.offset ?? (page && page > 1 ? (page - 1) * pageSize : 0);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("Secure query offset must be a non-negative integer");
  }

  return {
    limit: pageSize,
    offset,
    order: pagination?.order ?? "desc",
    cursor: pagination?.cursor,
  };
}

function buildWhere(filters: SecureMetadataFilter, order: "asc" | "desc", cursor?: SecurePagination["cursor"]): Prisma.Sql {
  const companyId = String(filters.companyId ?? "").trim();
  if (!companyId) {
    throw new Error("Secure metadata queries require companyId");
  }

  const parts: Prisma.Sql[] = [Prisma.sql`company_id = ${companyId}`];
  if (filters.id) {
    parts.push(Prisma.sql`id = ${filters.id}`);
  }
  if (filters.resourceType) {
    parts.push(Prisma.sql`resource_type = ${filters.resourceType}`);
  }
  if (cursor?.createdAt) {
    const createdAt = cursor.createdAt instanceof Date ? cursor.createdAt : new Date(cursor.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error("Secure query cursor.createdAt is invalid");
    }
    if (cursor.id) {
      parts.push(
        order === "desc"
          ? Prisma.sql`(created_at < ${createdAt} OR (created_at = ${createdAt} AND id < ${cursor.id}))`
          : Prisma.sql`(created_at > ${createdAt} OR (created_at = ${createdAt} AND id > ${cursor.id}))`
      );
    } else {
      parts.push(order === "desc" ? Prisma.sql`created_at < ${createdAt}` : Prisma.sql`created_at > ${createdAt}`);
    }
  }

  return Prisma.sql`WHERE ${Prisma.join(parts, " AND ")}`;
}

function metadataFromRow(row: SecureRow): SecureRowMetadata {
  return {
    id: row.id,
    companyId: row.company_id,
    resourceType: row.resource_type,
    createdAt: row.created_at ? new Date(row.created_at) : null,
  };
}

async function auditDecrypt(table: SecureTable, operation: SensitiveAccessAction["operation"], resourceId: string): Promise<void> {
  const grant = assertSensitiveAccess(table, operation, resourceId);
  await auditSecureDecryptAccess({
    userId: grant.userId,
    companyId: grant.companyId,
    resourceType: grant.action.resourceType,
    resourceId,
    action: String(operation),
  });
}

async function assertApprovalForDecrypt(params: {
  table: SecureTable;
  grant: ReturnType<typeof assertSensitiveAccess>;
  operation: SensitiveAccessAction["operation"];
  resourceId: string;
  resourceType?: string | null;
  decryptCount: number;
  batchSize: number;
}): Promise<{ approvalRequestId: string }> {
  return await requireSensitiveApproval({
    scope: {
      userId: params.grant.userId,
      companyId: params.grant.companyId,
      action: String(params.operation),
      resourceCategory: params.table,
      resourceId: params.resourceId,
      resourceType: params.resourceType ?? params.table,
    },
    decryptCount: params.decryptCount,
    batchSize: params.batchSize,
    metadata: {
      table: params.table,
      resourceId: params.resourceId,
      resourceType: params.resourceType ?? params.table,
    },
  });
}

export async function lockSecureRecord(client: SecureDbClient, lockKey: string): Promise<void> {
  await client.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
}

export async function readSecurePayload<T>(
  table: SecureTable,
  id: string,
  operation: SensitiveAccessAction["operation"] = "read",
  client?: SecureDbClient
): Promise<T | null> {
  const grant = assertSensitiveAccess(table, operation, id);
  const rows = await db(client).$queryRaw<SecureRow[]>(
    Prisma.sql`SELECT id, company_id, resource_type, created_at, payload_enc FROM ${secureTableSql(table)} WHERE id = ${id}`
  );
  const row = rows[0];
  if (!row) return null;

  await assertApprovalForDecrypt({
    table,
    grant,
    operation,
    resourceId: id,
    resourceType: row.resource_type,
    decryptCount: 1,
    batchSize: 1,
  });
  await auditDecrypt(table, operation, id);
  return await decryptPayload<T>(row.payload_enc, client);
}

export async function querySecurePayloads<T>(
  table: SecureTable,
  filters: SecureMetadataFilter,
  pagination?: SecurePagination,
  operation: SensitiveAccessAction["operation"] = "read",
  client?: SecureDbClient
): Promise<SecureQueryResult<T>> {
  const start = Date.now();
  const paging = normalizePagination(pagination);
  const where = buildWhere(filters, paging.order, paging.cursor);
  const orderBy = paging.order === "desc" ? Prisma.raw("created_at DESC, id DESC") : Prisma.raw("created_at ASC, id ASC");
  const grant = assertSensitiveAccess(table, operation, `${table}:${filters.companyId}`);

  const countRows = await db(client).$queryRaw<{ count: number | bigint }[]>(
    Prisma.sql`SELECT COUNT(*) AS count FROM ${secureTableSql(table)} ${where}`
  );
  const filteredCount = Number(countRows[0]?.count ?? 0);
  const rows = await db(client).$queryRaw<SecureRow[]>(
    Prisma.sql`
      SELECT id, company_id, resource_type, created_at, payload_enc
      FROM ${secureTableSql(table)}
      ${where}
      ORDER BY ${orderBy}
      LIMIT ${paging.limit}
      OFFSET ${paging.offset}
    `
  );

  const out: Array<{ metadata: SecureRowMetadata; payload: T }> = [];
  if (rows.length > 0) {
    await assertApprovalForDecrypt({
      table,
      grant,
      operation,
      resourceId: `${table}:${filters.companyId}`,
      resourceType: filters.resourceType ?? table,
      decryptCount: rows.length,
      batchSize: rows.length,
    });
  }
  for (const row of rows) {
    await auditDecrypt(table, operation, row.id);
    out.push({ metadata: metadataFromRow(row), payload: await decryptPayload<T>(row.payload_enc, client) });
  }

  const metrics: SecureQueryMetrics = {
    durationMs: Date.now() - start,
    filteredCount,
    returnedCount: rows.length,
    decryptCount: rows.length,
  };
  await auditSecureQueryMetrics({
    userId: grant.userId,
    companyId: grant.companyId,
    table,
    action: String(operation),
    ...metrics,
  });

  return {
    items: out,
    page: {
      limit: paging.limit,
      offset: paging.offset,
      hasMore: paging.offset + rows.length < filteredCount,
      nextOffset: paging.offset + rows.length < filteredCount ? paging.offset + rows.length : null,
    },
    metrics,
  };
}

export async function upsertSecurePayload(
  table: SecureTable,
  metadata: SecurePayloadMetadataInput,
  payload: unknown,
  client?: SecureDbClient
): Promise<void> {
  if (!metadata.id || !metadata.companyId || !metadata.resourceType) {
    throw new Error("Secure payload writes require id, companyId, and resourceType metadata");
  }
  const encrypted = await encryptPayload(payload, client);
  await db(client).$executeRaw(
    Prisma.sql`
      INSERT INTO ${secureTableSql(table)} (id, company_id, resource_type, created_at, payload_enc)
      VALUES (${metadata.id}, ${metadata.companyId}, ${metadata.resourceType}, ${metadata.createdAt ?? new Date()}, ${encrypted})
      ON CONFLICT (id) DO UPDATE
      SET
        company_id = EXCLUDED.company_id,
        resource_type = EXCLUDED.resource_type,
        created_at = EXCLUDED.created_at,
        payload_enc = EXCLUDED.payload_enc
    `
  );
}

export async function deleteSecurePayload(table: SecureTable, id: string, client?: SecureDbClient): Promise<void> {
  await db(client).$executeRaw(Prisma.sql`DELETE FROM ${secureTableSql(table)} WHERE id = ${id}`);
}

export async function deleteSecurePayloadsByMetadata(
  table: SecureTable,
  filters: SecureMetadataFilter,
  client?: SecureDbClient
): Promise<number> {
  const where = buildWhere(filters, "desc");
  return await db(client).$executeRaw(Prisma.sql`DELETE FROM ${secureTableSql(table)} ${where}`);
}
