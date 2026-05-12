import type { SecureDbClient } from "../../services/encryption/index.js";
import {
  deleteSecurePayload,
  deleteSecurePayloadsByMetadata,
  querySecurePayloads,
  readSecurePayload,
  upsertSecurePayload,
  type SecurePagination,
  type SecureQueryResult,
  type SecureRowMetadata,
} from "./secureTables.js";

export type SecureRateCardMetadata = {
  id: string;
  companyId: string | null;
  resourceType: string | null;
  createdAt: Date | null;
};

export type SecureRateCardEntry = {
  resourceType: string;
  resourceName: string;
  unit: string;
  rate: number;
  rsrcShortName: string;
};

export type SecureRateCardPayload = {
  version: 1;
  companyId: string;
  resourceType: string;
  entries: SecureRateCardEntry[];
  updatedAt: string;
};

export type SecureRateCardDto = SecureRateCardMetadata & SecureRateCardPayload;

export function secureRateCardId(companyId: string): string {
  const id = String(companyId ?? "").trim();
  if (!id) throw new Error("Secure rate card requires companyId");
  return `company:${id}:rate-card`;
}

export function secureRateCardTypeId(companyId: string, resourceType: string): string {
  const company = String(companyId ?? "").trim();
  const type = String(resourceType ?? "").trim();
  if (!company || !type) throw new Error("Secure rate card requires companyId and resourceType");
  return `company:${company}:rate-card:${Buffer.from(type, "utf8").toString("base64url")}`;
}

function parseSecureRateCardPayload(value: unknown): SecureRateCardPayload {
  const payload = value as Partial<SecureRateCardPayload> | null;
  if (!payload || payload.version !== 1 || typeof payload.companyId !== "string" || !Array.isArray(payload.entries)) {
    throw new Error("Secure rate card payload is invalid");
  }

  const entries = payload.entries.map((entry) => {
    const e = entry as Partial<SecureRateCardEntry>;
    if (
      typeof e.resourceType !== "string" ||
      typeof e.resourceName !== "string" ||
      typeof e.unit !== "string" ||
      typeof e.rsrcShortName !== "string" ||
      typeof e.rate !== "number" ||
      !Number.isFinite(e.rate)
    ) {
      throw new Error("Secure rate card entry is invalid");
    }
    return {
      resourceType: e.resourceType,
      resourceName: e.resourceName,
      unit: e.unit,
      rate: e.rate,
      rsrcShortName: e.rsrcShortName,
    };
  });

  return {
    version: 1,
    companyId: payload.companyId,
    resourceType: typeof payload.resourceType === "string" ? payload.resourceType : entries[0]?.resourceType ?? "rateCard",
    entries,
    updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : new Date(0).toISOString(),
  };
}

function metadataFromSecureRow(metadata: SecureRowMetadata): SecureRateCardMetadata {
  return {
    id: metadata.id,
    companyId: metadata.companyId,
    resourceType: metadata.resourceType,
    createdAt: metadata.createdAt,
  };
}

export async function getSecureRateCardById(id: string, client?: SecureDbClient): Promise<SecureRateCardPayload | null> {
  const payload = await readSecurePayload<unknown>("rateCard", id, "read", client);
  return payload ? parseSecureRateCardPayload(payload) : null;
}

export async function getSecureRateCardForCompany(
  companyId: string,
  client?: SecureDbClient
): Promise<SecureRateCardPayload | null> {
  const result = await listSecureRateCardsByCompany(companyId, { pageSize: 100, maxDecryptBatchSize: 100 }, client);
  if (result.page.hasMore) {
    throw new Error("Secure rate card requires pagination before decryption");
  }
  if (result.items.length === 0) return null;

  const entries = result.items.flatMap((item) => item.payload.entries);
  return {
    version: 1,
    companyId,
    resourceType: "rateCard",
    entries,
    updatedAt: result.items.reduce(
      (latest, item) => (item.payload.updatedAt > latest ? item.payload.updatedAt : latest),
      new Date(0).toISOString()
    ),
  };
}

export async function listSecureRateCardsByCompany(
  companyId: string,
  pagination?: SecurePagination,
  client?: SecureDbClient
): Promise<SecureQueryResult<SecureRateCardPayload>> {
  const result = await querySecurePayloads<unknown>("rateCard", { companyId }, pagination, "read", client);
  return {
    ...result,
    items: result.items.map((item) => ({
      metadata: metadataFromSecureRow(item.metadata),
      payload: parseSecureRateCardPayload(item.payload),
    })),
  };
}

export async function listSecureRateCardsByType(
  companyId: string,
  resourceType: string,
  pagination?: SecurePagination,
  client?: SecureDbClient
): Promise<SecureQueryResult<SecureRateCardPayload>> {
  const result = await querySecurePayloads<unknown>("rateCard", { companyId, resourceType }, pagination, "read", client);
  return {
    ...result,
    items: result.items.map((item) => ({
      metadata: metadataFromSecureRow(item.metadata),
      payload: parseSecureRateCardPayload(item.payload),
    })),
  };
}

export async function upsertSecureRateCard(payload: SecureRateCardPayload, client?: SecureDbClient): Promise<void> {
  await upsertSecurePayload(
    "rateCard",
    {
      id: secureRateCardTypeId(payload.companyId, payload.resourceType),
      companyId: payload.companyId,
      resourceType: payload.resourceType,
    },
    payload,
    client
  );
}

export async function deleteSecureRateCardById(id: string, client?: SecureDbClient): Promise<void> {
  await deleteSecurePayload("rateCard", id, client);
}

export async function deleteSecureRateCardsByCompany(companyId: string, client?: SecureDbClient): Promise<number> {
  return await deleteSecurePayloadsByMetadata("rateCard", { companyId }, client);
}
