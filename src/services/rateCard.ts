import { prisma } from "../utils/prisma.js";
import type { RateCardEntry as ParsedRateCardEntry } from "./rateCard.parser.js";
import { ensurePersistentResourceShortNamesTx, DEFAULT_RESOURCE_PREFIX } from "./resourceShortName.service.js";
import {
  deleteSecureRateCardsByCompany,
  getSecureRateCardForCompany,
  secureRateCardId,
  upsertSecureRateCard,
  type SecureRateCardPayload,
} from "../repositories/secureData/rateCard.repository.js";
import { lockSecureRecord } from "../repositories/secureData/secureTables.js";

export type RateCardEntry = ParsedRateCardEntry & { rsrcShortName: string };

/** Stored on Activity / Deliverable after validation */
export type AssignedResourceStored = {
  resourceType: string;
  resourceName: string;
  rate: number;
  unit: string;
  /** Optional override; if omitted, export uses activity duration → hours */
  units?: number;
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

const lookupKey = (type: string, name: string) => `${norm(type)}|${norm(name)}`;

function buildLookup(entries: RateCardEntry[]): Map<string, RateCardEntry> {
  const m = new Map<string, RateCardEntry>();
  for (const e of entries) {
    m.set(lookupKey(e.resourceType, e.resourceName), e);
  }
  return m;
}

export async function getRateCardEntries(companyId: string): Promise<RateCardEntry[]> {
  const payload = await getSecureRateCardForCompany(companyId);
  return [...(payload?.entries ?? [])].sort((a, b) => {
    const type = a.resourceType.localeCompare(b.resourceType);
    return type !== 0 ? type : a.resourceName.localeCompare(b.resourceName);
  });
}

export async function getRateCardSummary(companyId: string): Promise<{ type: string; count: number }[]> {
  const entries = await getRateCardEntries(companyId);
  const byType = new Map<string, number>();
  for (const e of entries) {
    byType.set(e.resourceType, (byType.get(e.resourceType) ?? 0) + 1);
  }
  return [...byType.entries()].map(([type, count]) => ({ type, count }));
}

export async function replaceRateCardEntries(companyId: string, entries: ParsedRateCardEntry[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockSecureRecord(tx, secureRateCardId(companyId));
    const ensured = await ensurePersistentResourceShortNamesTx(tx, {
      companyId,
      prefix: DEFAULT_RESOURCE_PREFIX,
      resources: entries.map((e) => ({ resourceType: e.resourceType, resourceName: e.resourceName })),
    });
    const shortByKey = ensured.map;
    const key = (type: string, name: string) =>
      `${DEFAULT_RESOURCE_PREFIX.toLowerCase()}|${type.trim().toLowerCase()}|${name.trim().toLowerCase()}`;

    const secureEntries: RateCardEntry[] = entries.map((e) => ({
      resourceType: e.resourceType.trim(),
      resourceName: e.resourceName.trim(),
      rsrcShortName: (() => {
        const v = shortByKey.get(key(e.resourceType, e.resourceName));
        if (!v) throw new Error("rate card: missing persistent rsrc_short_name");
        return v;
      })(),
      unit: e.unit.trim(),
      rate: e.rate,
    }));

    await deleteSecureRateCardsByCompany(companyId, tx);
    const updatedAt = new Date().toISOString();
    const entriesByType = new Map<string, RateCardEntry[]>();
    for (const entry of secureEntries) {
      const group = entriesByType.get(entry.resourceType) ?? [];
      group.push(entry);
      entriesByType.set(entry.resourceType, group);
    }

    for (const [resourceType, groupedEntries] of entriesByType.entries()) {
      const payload: SecureRateCardPayload = {
        version: 1,
        companyId,
        resourceType,
        entries: groupedEntries,
        updatedAt,
      };
      await upsertSecureRateCard(payload, tx);
    }
  });
}

export type ParseAssignmentsResult =
  | { ok: true; assignments: AssignedResourceStored[] }
  | { ok: false; error: string };

/**
 * Validates assignments against the uploaded rate card. Ignores client-supplied rate; always from DB.
 */
export async function parseAndValidateAssignedResources(
  companyId: string,
  raw: unknown,
  cardEntries?: RateCardEntry[]
): Promise<ParseAssignmentsResult> {
  if (raw === undefined || raw === null) {
    return { ok: true, assignments: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, error: "assignedResources must be an array" };
  }
  if (raw.length > 30) {
    return { ok: false, error: "Too many resource assignments (max 30)" };
  }

  /** No decrypt / rate-card read when there is nothing to validate (avoids approval gate on activity edits). */
  if (raw.length === 0) {
    return { ok: true, assignments: [] };
  }

  const resolvedCardEntries = cardEntries ?? (await getRateCardEntries(companyId));
  if (resolvedCardEntries.length === 0 && raw.length > 0) {
    return { ok: false, error: "No rate card loaded. Upload a rate card first (App → Rate card)." };
  }

  const lookupMap = buildLookup(resolvedCardEntries);
  const out: AssignedResourceStored[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (item === null || typeof item !== "object") {
      return { ok: false, error: `Invalid assignment at index ${i}` };
    }
    const o = item as Record<string, unknown>;
    const resourceType = o.resourceType != null ? String(o.resourceType).trim() : "";
    const resourceName = o.resourceName != null ? String(o.resourceName).trim() : "";
    if (!resourceType || !resourceName) {
      return { ok: false, error: `Assignment at index ${i}: resourceType and resourceName are required` };
    }

    const entry = lookupMap.get(lookupKey(resourceType, resourceName));
    if (!entry) {
      return {
        ok: false,
        error: `Unknown resource: ${resourceType} / ${resourceName}`,
      };
    }

    let units: number | undefined;
    if (o.units !== undefined && o.units !== null) {
      const u = Number(o.units);
      if (!Number.isFinite(u) || u <= 0) {
        return { ok: false, error: `Assignment at index ${i}: units must be a positive number` };
      }
      units = u;
    }

    out.push({
      resourceType: entry.resourceType,
      resourceName: entry.resourceName,
      rate: entry.rate,
      unit: entry.unit,
      ...(units !== undefined ? { units } : {}),
    });
  }

  return { ok: true, assignments: out };
}

/** Re-validate JSON from DB before export (rate always from current card). */
/** Re-validate JSON from DB before export (rate always from current company rate card). */
export async function assignmentsFromDb(
  companyId: string,
  raw: unknown,
  cardEntries?: RateCardEntry[]
): Promise<AssignedResourceStored[]> {
  const r = await parseAndValidateAssignedResources(
    companyId,
    raw === undefined || raw === null ? [] : raw,
    cardEntries
  );
  if (!r.ok) {
    console.warn("[rate-card] Invalid stored assignments skipped");
    return [];
  }
  return r.assignments;
}
