import type { SecureDbClient } from "../../services/encryption/index.js";
import {
  deleteSecurePayload,
  querySecurePayloads,
  readSecurePayload,
  upsertSecurePayload,
  type SecurePagination,
  type SecureQueryResult,
  type SecureRowMetadata,
} from "./secureTables.js";

export type SecureResourceMetadata = {
  id: string;
  companyId: string | null;
  resourceType: string | null;
  createdAt: Date | null;
};

export type SecureResourceRegistryEntry = {
  resourceType: string;
  resourceName: string;
  rsrcShortName: string;
};

export type SecureResourceRegistryPayload = {
  version: 1;
  companyId: string;
  prefix: string;
  lastNumber: number;
  resources: SecureResourceRegistryEntry[];
  updatedAt: string;
};

export type SecureResourceDto = SecureResourceMetadata & SecureResourceRegistryPayload;

export function secureResourceRegistryId(companyId: string, prefix: string): string {
  const company = String(companyId ?? "").trim();
  const cleanPrefix = String(prefix ?? "").trim();
  if (!company || !cleanPrefix) throw new Error("Secure resource registry requires companyId and prefix");
  return `company:${company}:resource-registry:${cleanPrefix}`;
}

function parseSecureResourcePayload(value: unknown): SecureResourceRegistryPayload {
  const payload = value as Partial<SecureResourceRegistryPayload> | null;
  if (
    !payload ||
    payload.version !== 1 ||
    typeof payload.companyId !== "string" ||
    typeof payload.prefix !== "string" ||
    !Array.isArray(payload.resources)
  ) {
    throw new Error("Secure resource registry payload is invalid");
  }

  const resources = payload.resources.map((resource) => {
    const r = resource as Partial<SecureResourceRegistryEntry>;
    if (typeof r.resourceType !== "string" || typeof r.resourceName !== "string" || typeof r.rsrcShortName !== "string") {
      throw new Error("Secure resource registry entry is invalid");
    }
    return {
      resourceType: r.resourceType,
      resourceName: r.resourceName,
      rsrcShortName: r.rsrcShortName,
    };
  });

  const lastNumber = Number(payload.lastNumber);
  return {
    version: 1,
    companyId: payload.companyId,
    prefix: payload.prefix,
    lastNumber: Number.isInteger(lastNumber) && lastNumber >= 0 ? lastNumber : 0,
    resources,
    updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : new Date(0).toISOString(),
  };
}

function metadataFromSecureRow(metadata: SecureRowMetadata): SecureResourceMetadata {
  return {
    id: metadata.id,
    companyId: metadata.companyId,
    resourceType: metadata.resourceType,
    createdAt: metadata.createdAt,
  };
}

export async function getSecureResourceById(id: string, client?: SecureDbClient): Promise<SecureResourceRegistryPayload | null> {
  const payload = await readSecurePayload<unknown>("resourceRegistry", id, "read", client);
  return payload ? parseSecureResourcePayload(payload) : null;
}

export async function getSecureResourceRegistryForCompany(
  companyId: string,
  prefix: string,
  client?: SecureDbClient
): Promise<SecureResourceRegistryPayload | null> {
  const result = await listSecureResourcesByType(companyId, prefix, { pageSize: 1, maxDecryptBatchSize: 1 }, client);
  return result.items[0]?.payload ?? null;
}

export async function listSecureResourcesByCompany(
  companyId: string,
  pagination?: SecurePagination,
  client?: SecureDbClient
): Promise<SecureQueryResult<SecureResourceRegistryPayload>> {
  const result = await querySecurePayloads<unknown>("resourceRegistry", { companyId }, pagination, "read", client);
  return {
    ...result,
    items: result.items.map((item) => ({
      metadata: metadataFromSecureRow(item.metadata),
      payload: parseSecureResourcePayload(item.payload),
    })),
  };
}

export async function listSecureResourcesByType(
  companyId: string,
  resourceType: string,
  pagination?: SecurePagination,
  client?: SecureDbClient
): Promise<SecureQueryResult<SecureResourceRegistryPayload>> {
  const result = await querySecurePayloads<unknown>("resourceRegistry", { companyId, resourceType }, pagination, "read", client);
  return {
    ...result,
    items: result.items.map((item) => ({
      metadata: metadataFromSecureRow(item.metadata),
      payload: parseSecureResourcePayload(item.payload),
    })),
  };
}

export async function upsertSecureResourceRegistry(payload: SecureResourceRegistryPayload, client?: SecureDbClient): Promise<void> {
  await upsertSecurePayload(
    "resourceRegistry",
    {
      id: secureResourceRegistryId(payload.companyId, payload.prefix),
      companyId: payload.companyId,
      resourceType: payload.prefix,
    },
    payload,
    client
  );
}

export async function deleteSecureResourceById(id: string, client?: SecureDbClient): Promise<void> {
  await deleteSecurePayload("resourceRegistry", id, client);
}
