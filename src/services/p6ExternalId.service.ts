import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma.js";

export const P6_ENTITY_KIND = {
  ACTVTYPE: "ACTVTYPE",
  ACTVCODE: "ACTVCODE",
} as const;

export type P6EntityKind = (typeof P6_ENTITY_KIND)[keyof typeof P6_ENTITY_KIND];

const MIN_P6_ID = 2_000_000;

/** Batched inserts keep interactive transactions short (avoids P2028 after default timeouts). */
const CREATE_MANY_BATCH = 200;

const TX_OPTS: {
  isolationLevel: Prisma.TransactionIsolationLevel;
  maxWait: number;
  timeout: number;
} = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 20_000,
  timeout: 120_000,
};

function isRetryableTransactionError(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("code" in err)) return false;
  const code = (err as { code?: string }).code;
  return code === "P2028" || code === "P2034";
}

/**
 * Stable per-(company, project) numeric IDs for P6 workbook rows.
 * Allocates from max existing p6_numeric_id for that scope (>= MIN_P6_ID).
 */
export async function resolveP6NumericIds(params: {
  companyId: string;
  projectId: string;
  requests: { kind: P6EntityKind; key: string }[];
}): Promise<Map<string, number>> {
  const { companyId, projectId, requests } = params;
  const out = new Map<string, number>();
  const uniqueKeys = new Map<string, { kind: P6EntityKind; key: string }>();
  for (const r of requests) {
    const compound = `${r.kind}\0${r.key}`;
    if (!uniqueKeys.has(compound)) uniqueKeys.set(compound, r);
  }
  const keys = [...uniqueKeys.values()];
  if (keys.length === 0) return out;

  const existing = await prisma.p6ExternalId.findMany({
    where: {
      companyId,
      projectId,
      OR: keys.map((k) => ({ entityKind: k.kind, entityKey: k.key })),
    },
  });
  for (const row of existing) {
    out.set(`${row.entityKind}\0${row.entityKey}`, row.p6NumericId);
  }

  let pending = keys.filter((k) => !out.has(`${k.kind}\0${k.key}`));
  if (pending.length === 0) return out;

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (pending.length === 0) break;
    try {
      await prisma.$transaction(
        async (tx) => {
          const agg = await tx.p6ExternalId.aggregate({
            where: { companyId, projectId },
            _max: { p6NumericId: true },
          });
          const base = Math.max(MIN_P6_ID, (agg._max.p6NumericId ?? 0) + 1);
          for (let i = 0; i < pending.length; i += CREATE_MANY_BATCH) {
            const slice = pending.slice(i, i + CREATE_MANY_BATCH);
            await tx.p6ExternalId.createMany({
              data: slice.map((m, j) => ({
                companyId,
                projectId,
                entityKind: m.kind,
                entityKey: m.key,
                p6NumericId: base + i + j,
              })),
            });
          }
          for (let i = 0; i < pending.length; i++) {
            const m = pending[i]!;
            out.set(`${m.kind}\0${m.key}`, base + i);
          }
        },
        TX_OPTS
      );
      break;
    } catch (err) {
      if (!isRetryableTransactionError(err) || attempt === maxAttempts - 1) {
        throw err;
      }
      const refreshed = await prisma.p6ExternalId.findMany({
        where: {
          companyId,
          projectId,
          OR: pending.map((k) => ({ entityKind: k.kind, entityKey: k.key })),
        },
      });
      for (const row of refreshed) {
        out.set(`${row.entityKind}\0${row.entityKey}`, row.p6NumericId);
      }
      pending = pending.filter((k) => !out.has(`${k.kind}\0${k.key}`));
    }
  }

  return out;
}

export function compoundP6Key(kind: P6EntityKind, key: string): string {
  return `${kind}\0${key}`;
}

/** Generic clone activity rows use id `${deliverableId}-${originalActivityId}`. */
export function canonicalActivityIdForAssignmentLookup(exportActivityId: string, deliverableIdForBlock: string): string {
  const prefix = `${deliverableIdForBlock}-`;
  if (exportActivityId.startsWith(prefix)) {
    const rest = exportActivityId.slice(prefix.length);
    if (rest) return rest;
  }
  return exportActivityId;
}
