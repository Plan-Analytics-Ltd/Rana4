import { prisma } from "../utils/prisma.js";
import type { Prisma } from "@prisma/client";
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

export async function ensurePersistentResourceShortNamesTx(
  tx: Prisma.TransactionClient,
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

  // Ensure sequence row exists WITHOUT triggering a constraint violation that would abort the transaction.
  await tx.companyResourceSequence.upsert({
    where: { companyId_prefix: { companyId, prefix } },
    create: { companyId, prefix, lastNumber: 0 },
    update: {},
  });

  // Lock the sequence row (prevents concurrent uploads from racing).
  const locked = (await tx.$queryRaw<
    { id: string; last_number: number }[]
  >`SELECT id, last_number FROM company_resource_sequences WHERE company_id = ${companyId} AND prefix = ${prefix} FOR UPDATE`) as {
    id: string;
    last_number: number;
  }[];
  const seq = locked[0];
  if (!seq) throw new Error("ensurePersistentResourceShortNames: sequence row missing after create");

  // Fetch existing registry for this company+prefix.
  const existing = await tx.resourceRegistry.findMany({
    where: { companyId, prefix },
    select: { resourceType: true, resourceName: true, rsrcShortName: true },
  });
  const existingByKey = new Map<string, string>();
  for (const r of existing) {
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

  const startingFrom = seq.last_number + 1;
  const generated: { resourceType: string; resourceName: string; rsrcShortName: string }[] = [];

  if (missing.length > 0) {
    let next = seq.last_number;
    for (const r of missing) {
      next += 1;
      const short = `${prefix}-${next}`;
      generated.push({ ...r, rsrcShortName: short });
      outMap.set(resourceKey(prefix, r.resourceType, r.resourceName), short);
    }

    // Insert registry rows first; unique constraint will guard against any unexpected collision.
    await tx.resourceRegistry.createMany({
      data: generated.map((g) => ({
        companyId,
        prefix,
        rsrcShortName: g.rsrcShortName,
        resourceType: g.resourceType,
        resourceName: g.resourceName,
      })),
    });

    // Advance sequence to the last reserved number.
    await tx.companyResourceSequence.update({
      where: { companyId_prefix: { companyId, prefix } },
      data: { lastNumber: seq.last_number + missing.length },
    });
  }

  return { prefix, startingFrom, generated, map: outMap };
}

/**
 * Ensure every (resourceType, resourceName) has a persistent P6 short name for this company+prefix.
 *
 * Guarantees:
 * - Never reuses numbers (monotonic per company+prefix)
 * - Transactional + row-level locking on the sequence row
 * - Reuses existing registry mapping for previously seen resources (no churn across uploads)
 */
export async function ensurePersistentResourceShortNames(params: {
  companyId: string;
  prefix?: string;
  resources: { resourceType: string; resourceName: string }[];
}): Promise<EnsureShortNamesResult> {
  return await prisma.$transaction(async (tx) => await ensurePersistentResourceShortNamesTx(tx, params));
}

