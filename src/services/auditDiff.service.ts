import { auditLog } from "./audit.service.js";

export type AuditUpdateDiff = {
  type: "update";
  changes: Record<string, { from: unknown; to: unknown }>;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && (v as any).constructor === Object;
}

function normalizeValue(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number" && Number.isNaN(v)) return "NaN";
  return v;
}

function stableStringify(v: unknown): string {
  const norm = normalizeValue(v);
  if (norm === null || norm === undefined) return String(norm);
  if (typeof norm !== "object") return JSON.stringify(norm);
  if (Array.isArray(norm)) return `[${norm.map((x) => stableStringify(x)).join(",")}]`;
  if (isPlainObject(norm)) {
    const keys = Object.keys(norm).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((norm as any)[k])}`).join(",")}}`;
  }
  // Fallback for Prisma JsonValue objects etc.
  try {
    return JSON.stringify(norm);
  } catch {
    return String(norm);
  }
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

export function computeUpdateDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[]
): AuditUpdateDiff | null {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(after, field) && !Object.prototype.hasOwnProperty.call(before, field)) {
      continue;
    }
    const from = normalizeValue((before as any)[field]);
    const to = normalizeValue((after as any)[field]);
    if (!valuesEqual(from, to)) {
      changes[field] = { from, to };
    }
  }
  if (Object.keys(changes).length === 0) return null;
  return { type: "update", changes };
}

export async function auditUpdateIfChanged(input: {
  userId: string;
  companyId: string;
  projectId: string;
  action: string;
  entity: string;
  entityId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  fields: readonly string[];
}): Promise<{ logged: boolean; details: AuditUpdateDiff | null }> {
  const details = computeUpdateDiff(input.before, input.after, input.fields);
  if (!details) return { logged: false, details: null };

  await auditLog({
    userId: input.userId,
    companyId: input.companyId,
    projectId: input.projectId,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    details,
  });

  return { logged: true, details };
}

