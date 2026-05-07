/**
 * Groups Assignment sheet rows onto Deliverables / Activities and validates via
 * parseAndValidateAssignedResources (single source of truth for rate card rules).
 */

import type { Activity, Deliverable, Fragnet } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "../../utils/prisma.js";
import type { AssignedResourceStored } from "../rateCard.js";
import { getRateCardEntries, parseAndValidateAssignedResources } from "../rateCard.js";
import type { ParsedAssignmentRow } from "./assignments.parser.js";
import { parseAssignmentsSheet } from "./assignments.parser.js";

/** Raw assignment payload accepted by parseAndValidateAssignedResources (no rate/unit from Excel). */
export type AssignmentResourceInput = {
  resourceType: string;
  resourceName: string;
  units?: number;
};

export type AssignmentsImportContext = {
  fragnetByName: Map<string, Fragnet>;
  /** Key: `${fragnetName}||${deliverableName}` (trimmed names). */
  deliverableByFragnetAndName: Map<string, Deliverable>;
  /** Key: `${fragnetName}||${activityCode}` (trimmed). Activity includes deliverable for name checks. */
  activityByFragnetAndCode: Map<string, Activity & { deliverable: Deliverable }>;
};

function lkFragDel(fragnetName: string, deliverableName: string): string {
  return `${fragnetName.trim()}||${deliverableName.trim()}`;
}

function lkFragAct(fragnetName: string, activityCode: string): string {
  return `${fragnetName.trim()}||${activityCode.trim()}`;
}

/**
 * Build lookup maps for assignment resolution.
 * @throws On duplicate fragnet names, duplicate deliverable names per fragnet, or duplicate activity codes per fragnet.
 */
export function buildAssignmentsImportContext(parts: {
  fragnets: Fragnet[];
  deliverables: Deliverable[];
  activities: (Activity & { deliverable: Deliverable })[];
}): AssignmentsImportContext {
  const fragnetByName = new Map<string, Fragnet>();
  for (const f of parts.fragnets) {
    const k = f.name.trim();
    if (fragnetByName.has(k)) {
      throw new Error(`Assignments import: duplicate fragnet name in context: ${JSON.stringify(k)}`);
    }
    fragnetByName.set(k, f);
  }

  const deliverableByFragnetAndName = new Map<string, Deliverable>();
  for (const d of parts.deliverables) {
    if (d.fragnetId === null) continue;
    const frag = parts.fragnets.find((x) => x.id === d.fragnetId);
    if (!frag) continue;
    const key = lkFragDel(frag.name, d.name);
    if (deliverableByFragnetAndName.has(key)) {
      throw new Error(`Assignments import: duplicate deliverable "${d.name}" under fragnet "${frag.name}"`);
    }
    deliverableByFragnetAndName.set(key, d);
  }

  const activityByFragnetAndCode = new Map<string, Activity & { deliverable: Deliverable }>();
  for (const a of parts.activities) {
    const frag = parts.fragnets.find((x) => x.id === a.fragnetId);
    if (!frag) continue;
    const key = lkFragAct(frag.name, a.activityCode);
    if (activityByFragnetAndCode.has(key)) {
      throw new Error(
        `Assignments import: duplicate activity_code ${JSON.stringify(a.activityCode)} under fragnet "${frag.name}"`
      );
    }
    activityByFragnetAndCode.set(key, a);
  }

  return { fragnetByName, deliverableByFragnetAndName, activityByFragnetAndCode };
}

export function extractAssignmentsSheetRowsFromWorkbook(wb: XLSX.WorkBook): Record<string, unknown>[] | null {
  const sheet = wb.Sheets["Assignments"];
  if (!sheet) return null;
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
}

/** Parse workbook buffer and return parsed assignment rows, or [] if sheet absent. */
export function parseAssignmentsFromImportBuffer(buffer: Buffer): ParsedAssignmentRow[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new Error("Assignments import: could not read Excel buffer");
  }
  const rows = extractAssignmentsSheetRowsFromWorkbook(wb);
  if (!rows || rows.length === 0) return [];
  return parseAssignmentsSheet(rows);
}

export type GroupedAssignmentInputs = {
  deliverableInputs: Map<string, AssignmentResourceInput[]>;
  activityInputs: Map<string, AssignmentResourceInput[]>;
};

/**
 * Maps parsed rows to entity IDs using ImportContext. Structural / FK checks only.
 */
export function groupAssignmentInputs(parsedRows: ParsedAssignmentRow[], ctx: AssignmentsImportContext): GroupedAssignmentInputs {
  const deliverableInputs = new Map<string, AssignmentResourceInput[]>();
  const activityInputs = new Map<string, AssignmentResourceInput[]>();

  const pushDel = (id: string, input: AssignmentResourceInput) => {
    const arr = deliverableInputs.get(id) ?? [];
    arr.push(input);
    deliverableInputs.set(id, arr);
  };
  const pushAct = (id: string, input: AssignmentResourceInput) => {
    const arr = activityInputs.get(id) ?? [];
    arr.push(input);
    activityInputs.set(id, arr);
  };

  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i]!;
    const excelHint =
      row.sourceExcelRow !== undefined ? `(Excel row ${row.sourceExcelRow})` : `(parsed row ${i + 1})`;

    const fragName = row.fragnetName.trim();
    const frag = ctx.fragnetByName.get(fragName);
    if (!frag) {
      throw new Error(`Assignments import ${excelHint}: fragnet not found: ${JSON.stringify(row.fragnetName)}`);
    }

    const payload: AssignmentResourceInput = {
      resourceType: row.resourceType.trim(),
      resourceName: row.resourceName.trim(),
      ...(row.units !== undefined ? { units: row.units } : {}),
    };

    if (row.level === "DELIVERABLE") {
      const dKey = lkFragDel(frag.name, row.deliverableName);
      const del = ctx.deliverableByFragnetAndName.get(dKey);
      if (!del) {
        throw new Error(
          `Assignments import ${excelHint}: deliverable not found for fragnet ${JSON.stringify(frag.name)} / ${JSON.stringify(row.deliverableName)}`
        );
      }
      pushDel(del.id, payload);
    } else {
      const code = row.activityCode?.trim();
      if (!code) {
        throw new Error(`Assignments import ${excelHint}: activity_code missing for ACTIVITY row`);
      }
      const aKey = lkFragAct(frag.name, code);
      const act = ctx.activityByFragnetAndCode.get(aKey);
      if (!act) {
        throw new Error(
          `Assignments import ${excelHint}: activity not found for fragnet ${JSON.stringify(frag.name)} / activity_code ${JSON.stringify(code)}`
        );
      }
      const dn = row.deliverableName.trim();
      if (act.deliverable.name.trim() !== dn) {
        throw new Error(
          `Assignments import ${excelHint}: deliverable_name ${JSON.stringify(row.deliverableName)} does not match activity's deliverable ${JSON.stringify(act.deliverable.name)}`
        );
      }
      pushAct(act.id, payload);
    }
  }

  return { deliverableInputs, activityInputs };
}

export type ValidatedAssignmentsMaps = {
  byDeliverableId: Map<string, AssignedResourceStored[]>;
  byActivityId: Map<string, AssignedResourceStored[]>;
};

/**
 * Validates grouped inputs via parseAndValidateAssignedResources per entity.
 * @throws If rate card missing while rows exist, or any validation error from rate card service.
 */
export async function validateGroupedAssignmentsWithRateCard(
  companyId: string,
  grouped: GroupedAssignmentInputs
): Promise<ValidatedAssignmentsMaps> {
  const byDeliverableId = new Map<string, AssignedResourceStored[]>();
  const byActivityId = new Map<string, AssignedResourceStored[]>();

  let validationOk = 0;

  for (const [deliverableId, rawList] of grouped.deliverableInputs) {
    const r = await parseAndValidateAssignedResources(companyId, rawList);
    if (!r.ok) {
      throw new Error(`Assignments import — deliverable ${deliverableId}: ${r.error}`);
    }
    byDeliverableId.set(deliverableId, r.assignments);
    validationOk += 1;
  }

  for (const [activityId, rawList] of grouped.activityInputs) {
    const r = await parseAndValidateAssignedResources(companyId, rawList);
    if (!r.ok) {
      throw new Error(`Assignments import — activity ${activityId}: ${r.error}`);
    }
    byActivityId.set(activityId, r.assignments);
    validationOk += 1;
  }

  console.log(
    "[assignments-import] Validation complete — entity buckets validated:",
    validationOk,
    "(deliverables:",
    grouped.deliverableInputs.size,
    ", activities:",
    grouped.activityInputs.size,
    ")"
  );

  return { byDeliverableId, byActivityId };
}

async function assertCompanyHasRateCardIfAssignmentsPresent(companyId: string, parsedCount: number): Promise<void> {
  if (parsedCount === 0) return;
  const card = await getRateCardEntries(companyId);
  if (card.length === 0) {
    throw new Error(
      "Assignments sheet has rows but no rate card exists for this company. Upload a rate card before importing assignments."
    );
  }
}

export type ProcessAssignmentsImportParams = {
  companyId: string;
  parsedRows: ParsedAssignmentRow[];
  context: AssignmentsImportContext;
};

export type ProcessAssignmentsImportResult = ValidatedAssignmentsMaps & {
  parsedRowCount: number;
  groupedDeliverableEntityCount: number;
  groupedActivityEntityCount: number;
};

/**
 * Full pipeline: optional rate-card presence check → group → validate with existing service.
 */
export async function processAssignmentsImport(params: ProcessAssignmentsImportParams): Promise<ProcessAssignmentsImportResult> {
  const { companyId, parsedRows, context } = params;

  console.log("[assignments-import] Parsed assignment rows:", parsedRows.length);

  await assertCompanyHasRateCardIfAssignmentsPresent(companyId, parsedRows.length);

  const grouped = groupAssignmentInputs(parsedRows, context);

  const dKeys = [...grouped.deliverableInputs.keys()];
  const aKeys = [...grouped.activityInputs.keys()];
  console.log(
    "[assignments-import] Grouped deliverable IDs:",
    dKeys.length,
    dKeys.slice(0, 20),
    dKeys.length > 20 ? "…" : ""
  );
  console.log(
    "[assignments-import] Grouped activity IDs:",
    aKeys.length,
    aKeys.slice(0, 20),
    aKeys.length > 20 ? "…" : ""
  );

  const validated = await validateGroupedAssignmentsWithRateCard(companyId, grouped);

  return {
    ...validated,
    parsedRowCount: parsedRows.length,
    groupedDeliverableEntityCount: grouped.deliverableInputs.size,
    groupedActivityEntityCount: grouped.activityInputs.size,
  };
}

/**
 * Apply validated assignments inside a transaction (or without if tx = prisma).
 */
export async function applyValidatedAssignmentMaps(
  tx: Prisma.TransactionClient,
  validated: ValidatedAssignmentsMaps,
  scope: { companyId: string; deliverableIds?: string[]; activityIds?: string[] }
): Promise<{ deliverablesUpdated: number; activitiesUpdated: number }> {
  let deliverablesUpdated = 0;
  let activitiesUpdated = 0;

  const delSet = scope.deliverableIds ? new Set(scope.deliverableIds) : null;
  const actSet = scope.activityIds ? new Set(scope.activityIds) : null;

  for (const [id, assignments] of validated.byDeliverableId) {
    if (delSet && !delSet.has(id)) continue;
    const row = await tx.deliverable.updateMany({
      where: { id, companyId: scope.companyId },
      data: { assignedResources: assignments as Prisma.InputJsonValue },
    });
    if (row.count !== 1) {
      throw new Error(`Assignments import: deliverable ${id} was not updated (not found or wrong company)`);
    }
    deliverablesUpdated += 1;
  }

  for (const [id, assignments] of validated.byActivityId) {
    if (actSet && !actSet.has(id)) continue;
    const row = await tx.activity.updateMany({
      where: { id, companyId: scope.companyId },
      data: { assignedResources: assignments as Prisma.InputJsonValue },
    });
    if (row.count !== 1) {
      throw new Error(`Assignments import: activity ${id} was not updated (not found or wrong company)`);
    }
    activitiesUpdated += 1;
  }

  console.log(
    "[assignments-import] Applied updates — deliverables:",
    deliverablesUpdated,
    "activities:",
    activitiesUpdated
  );

  return { deliverablesUpdated, activitiesUpdated };
}

/**
 * Loads fragnets (and related deliverables + activities) for a standard and builds ImportContext.
 */
export async function loadAssignmentsImportContextForStandard(
  standardId: string,
  companyId: string
): Promise<AssignmentsImportContext> {
  const fragnets = await prisma.fragnet.findMany({
    where: { standardId, companyId },
    orderBy: { createdAt: "asc" },
  });
  const fragnetIds = fragnets.map((f) => f.id);

  const [deliverables, activities] = await Promise.all([
    prisma.deliverable.findMany({
      where: { companyId, fragnetId: { in: fragnetIds } },
    }),
    prisma.activity.findMany({
      where: { companyId, fragnetId: { in: fragnetIds } },
      include: { deliverable: true },
    }),
  ]);

  return buildAssignmentsImportContext({ fragnets, deliverables, activities });
}

/**
 * Convenience: buffer → context for standard → validate; if dryRun, skip apply.
 */
export async function importAssignmentsSheetForStandard(params: {
  companyId: string;
  standardId: string;
  buffer: Buffer;
  dryRun?: boolean;
}): Promise<ProcessAssignmentsImportResult & { applied?: { deliverablesUpdated: number; activitiesUpdated: number } }> {
  const parsed = parseAssignmentsFromImportBuffer(params.buffer);
  const context = await loadAssignmentsImportContextForStandard(params.standardId, params.companyId);
  const result = await processAssignmentsImport({
    companyId: params.companyId,
    parsedRows: parsed,
    context,
  });

  if (params.dryRun || parsed.length === 0) {
    return result;
  }

  const applied = await prisma.$transaction(
    async (tx) =>
      applyValidatedAssignmentMaps(tx, result, {
        companyId: params.companyId,
        deliverableIds: [...result.byDeliverableId.keys()],
        activityIds: [...result.byActivityId.keys()],
      }),
    { maxWait: 30_000, timeout: 5 * 60_000 }
  );

  return { ...result, applied };
}
