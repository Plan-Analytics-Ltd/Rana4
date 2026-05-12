import { prisma } from "../utils/prisma.js";
import type { SecureDbClient } from "./encryption/index.js";
import {
  getSecureResourceRegistryForCompany,
  secureResourceRegistryId,
  upsertSecureResourceRegistry,
  type SecureResourceRegistryPayload,
} from "../repositories/secureData/resource.repository.js";
import { lockSecureRecord } from "../repositories/secureData/secureTables.js";
import { compareResourcesForP6Order } from "./p6ResourceSort.js";

export const DEFAULT_RESOURCE_PREFIX = "PLARES";

function norm(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

function resourceKey(prefix: string, resourceType: string, resourceName: string): string {
  return `${norm(prefix)}|${norm(resourceType)}|${norm(resourceName)}`;
}

export type EnsureShortNamesResult = {
  prefix: string;
  startingFrom: number;
  generated: { resourceType: string; resourceName: string; rsrcShortName: string }[];
  map: Map<string, string>; // key(prefix|type|name) -> rsrcShortName
};

function parseShortNameNumber(prefix: string, value: string): number {
  const cleanPrefix = `${prefix}-`;
  if (!value.startsWith(cleanPrefix)) return 0;
  const n = Number(value.slice(cleanPrefix.length));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function emptyRegistry(companyId: string, prefix: string): SecureResourceRegistryPayload {
  return {
    version: 1,
    companyId,
    prefix,
    lastNumber: 0,
    resources: [],
    updatedAt: new Date().toISOString(),
  };
}

export async function ensurePersistentResourceShortNamesTx(
  tx: SecureDbClient,
  params: {
    companyId: string;
    prefix?: string;
    resources: { resourceType: string; resourceName: string }[];
  }
): Promise<EnsureShortNamesResult> {
  const companyId = String(params.companyId ?? "").trim();
  if (!companyId) throw new Error("ensurePersistentResourceShortNames: companyId is required");
  const prefix = String(params.prefix ?? DEFAULT_RESOURCE_PREFIX).trim() || DEFAULT_RESOURCE_PREFIX;
  const resources = params.resources.map((r) => ({
    resourceType: String(r.resourceType ?? "").trim(),
    resourceName: String(r.resourceName ?? "").trim(),
  }));
  if (resources.some((r) => !r.resourceType || !r.resourceName)) {
    throw new Error("ensurePersistentResourceShortNames: resourceType and resourceName are required");
  }

  await lockSecureRecord(tx, secureResourceRegistryId(companyId, prefix));

  const registry = (await getSecureResourceRegistryForCompany(companyId, prefix, tx)) ?? emptyRegistry(companyId, prefix);
  const existingByKey = new Map<string, string>();
  for (const r of registry.resources) {
    existingByKey.set(resourceKey(prefix, r.resourceType, r.resourceName), r.rsrcShortName);
  }

  const missing: { resourceType: string; resourceName: string }[] = [];
  const outMap = new Map<string, string>(existingByKey);

  for (const r of resources) {
    const k = resourceKey(prefix, r.resourceType, r.resourceName);
    if (outMap.has(k)) continue;
    missing.push(r);
  }

  // New PLARES-N IDs follow P6 alphabetical order (not file upload row order) so RSRC /
  // TASKRSRC short names match how P6 lists resources by name.
  missing.sort(compareResourcesForP6Order);

  const maxExistingNumber = registry.resources.reduce(
    (max, r) => Math.max(max, parseShortNameNumber(prefix, r.rsrcShortName)),
    registry.lastNumber
  );
  const startingFrom = maxExistingNumber + 1;
  const generated: { resourceType: string; resourceName: string; rsrcShortName: string }[] = [];

  if (missing.length > 0) {
    let next = maxExistingNumber;
    for (const r of missing) {
      next += 1;
      const short = `${prefix}-${next}`;
      generated.push({ ...r, rsrcShortName: short });
      outMap.set(resourceKey(prefix, r.resourceType, r.resourceName), short);
    }

    const nextRegistry: SecureResourceRegistryPayload = {
      ...registry,
      companyId,
      prefix,
      lastNumber: next,
      resources: [...registry.resources, ...generated].sort(compareResourcesForP6Order),
      updatedAt: new Date().toISOString(),
    };
    await upsertSecureResourceRegistry(nextRegistry, tx);
  } else if (registry.updatedAt === new Date(0).toISOString()) {
    await upsertSecureResourceRegistry({
      ...registry,
      updatedAt: new Date().toISOString(),
    }, tx);
  }

  if (missing.length === 0 && registry.lastNumber < maxExistingNumber) {
    await upsertSecureResourceRegistry({
      ...registry,
      lastNumber: maxExistingNumber,
      updatedAt: new Date().toISOString(),
    }, tx);
  }

  return { prefix, startingFrom, generated, map: outMap };
}

/**
 * Ensure every (resourceType, resourceName) has a persistent P6 short name for this company+prefix.
 *
 * Guarantees:
 * - Never reuses numbers (monotonic per company+prefix)
 * - Transactional + advisory locking on the secure registry id
 * - Reuses existing registry mapping for previously seen resources (no churn across uploads)
 */
export async function ensurePersistentResourceShortNames(params: {
  companyId: string;
  prefix?: string;
  resources: { resourceType: string; resourceName: string }[];
}): Promise<EnsureShortNamesResult> {
  return await prisma.$transaction(async (tx) => await ensurePersistentResourceShortNamesTx(tx, params));
}

