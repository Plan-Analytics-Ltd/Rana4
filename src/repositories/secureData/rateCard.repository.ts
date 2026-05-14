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

/** `company:{id}:rate-card` or `company:{id}:rate-card:{typeKey}` */
export function inferCompanyIdFromRateCardRowId(id: string): string | null {
  const m = /^company:([^:]+):rate-card(?:$|:)/.exec(String(id ?? "").trim());
  return m?.[1] ?? null;
}

type ParseRateCardDefaults = {
  companyId: string;
  resourceType?: string | null;
};

function parseEntryRate(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.trim().replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function parseSecureRateCardPayload(value: unknown, defaults: ParseRateCardDefaults): SecureRateCardPayload {
  let record: Record<string, unknown>;
  let entriesRaw: unknown[];

  if (Array.isArray(value)) {
    record = {};
    entriesRaw = value;
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    record = value as Record<string, unknown>;
    const ent = record.entries;
    if (Array.isArray(ent)) entriesRaw = ent;
    else if (ent === null || ent === undefined) entriesRaw = [];
    else throw new Error("Secure rate card payload is invalid");
  } else {
    throw new Error("Secure rate card payload is invalid");
  }

  const rawVersion = record.version;
  const versionRecognized =
    rawVersion === 1 ||
    rawVersion === "1" ||
    rawVersion === undefined ||
    rawVersion === null;
  if (!versionRecognized) {
    throw new Error("Secure rate card payload is invalid");
  }

  const companyIdFromPayload = typeof record.companyId === "string" ? record.companyId.trim() : "";
  const companyId = companyIdFromPayload || String(defaults.companyId ?? "").trim();
  if (!companyId) {
    throw new Error("Secure rate card payload is invalid");
  }

  const resourceTypeFromPayload = typeof record.resourceType === "string" ? record.resourceType.trim() : "";
  const resourceTypeFromMeta = defaults.resourceType != null ? String(defaults.resourceType).trim() : "";

  const entries = entriesRaw.map((entry) => {
    const e = entry as Partial<SecureRateCardEntry>;
    const rate = parseEntryRate(e.rate);
    if (
      typeof e.resourceType !== "string" ||
      typeof e.resourceName !== "string" ||
      typeof e.unit !== "string" ||
      typeof e.rsrcShortName !== "string" ||
      !Number.isFinite(rate)
    ) {
      throw new Error("Secure rate card entry is invalid");
    }
    return {
      resourceType: e.resourceType,
      resourceName: e.resourceName,
      unit: e.unit,
      rate,
      rsrcShortName: e.rsrcShortName,
    };
  });

  const resourceType =
    resourceTypeFromPayload ||
    resourceTypeFromMeta ||
    entries[0]?.resourceType ||
    "rateCard";

  return {
    version: 1,
    companyId,
    resourceType,
    entries,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
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
  if (!payload) return null;
  const inferred = inferCompanyIdFromRateCardRowId(id);
  return parseSecureRateCardPayload(payload, { companyId: inferred ?? "" });
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
      payload: parseSecureRateCardPayload(item.payload, {
        companyId: String(item.metadata.companyId ?? companyId).trim() || companyId,
        resourceType: item.metadata.resourceType,
      }),
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
      payload: parseSecureRateCardPayload(item.payload, {
        companyId: String(item.metadata.companyId ?? companyId).trim() || companyId,
        resourceType: item.metadata.resourceType ?? resourceType,
      }),
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
