import type { AssignedResourceStored, RateCardEntry } from "./rateCard.js";
import type { ActivityCodeCatalogForExport } from "./activityCodeCatalog.service.js";
import type { GeneratedWbs } from "./wbsGenerate.service.js";
import { buildXerAlignedWbsCodeMap } from "./wbsHumanReadable.service.js";
import { buildP6ResourceMap } from "./p6ResourceMap.service.js";

/**
 * Sanitize activity code type name for P6 spreadsheet column `actv_code_<name>_id`.
 * Must be stable and unique per type for import mapping.
 */
export function sanitizeActivityCodeTypeForColumn(typeName: string): string {
  const s = String(typeName ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return s || "activity_code_type";
}

export function activityCodeAssignmentColumnHeader(typeName: string): string {
  return `actv_code_${sanitizeActivityCodeTypeForColumn(typeName)}_id`;
}

/** Every generated WBS path string must be unique so TASK rows resolve to a single WBS node. */
export function assertUniqueWbsPathsForSpreadsheet(wbs: GeneratedWbs, projectCode: string): void {
  const codeByNode = buildXerAlignedWbsCodeMap(wbs, projectCode);
  const pathToWbsIds = new Map<string, number[]>();
  for (const [wbsIdNum, path] of codeByNode) {
    const p = String(path ?? "").trim();
    if (!p) {
      throw new Error(`P6 export validation: empty WBS path for wbs_id ${wbsIdNum}`);
    }
    const list = pathToWbsIds.get(p) ?? [];
    list.push(wbsIdNum);
    pathToWbsIds.set(p, list);
  }
  for (const [path, ids] of pathToWbsIds) {
    const uniq = new Set(ids);
    if (uniq.size > 1) {
      throw new Error(
        `P6 export validation: duplicate WBS path "${path}" maps to multiple WBS nodes: ${[...uniq].sort((a, b) => a - b).join(", ")}`
      );
    }
  }
}

export function assertActivityCodeCatalogConsistency(catalog: ActivityCodeCatalogForExport): void {
  if (catalog.types.length === 0 && catalog.codes.length === 0 && catalog.assignmentsByCanonicalActivityId.size === 0) {
    return;
  }
  const codeById = new Map(catalog.codes.map((c) => [c.id, c]));
  const typeById = new Map(catalog.types.map((t) => [t.id, t]));
  const seenHeaders = new Map<string, string>();

  for (const t of catalog.types) {
    const h = activityCodeAssignmentColumnHeader(t.name);
    const prev = seenHeaders.get(h);
    if (prev !== undefined && prev !== t.id) {
      throw new Error(
        `P6 export validation: two activity code types map to the same spreadsheet column "${h}" (types ${prev} and ${t.id}). Rename one type.`
      );
    }
    seenHeaders.set(h, t.id);
    const colKey = sanitizeActivityCodeTypeForColumn(t.name);
    if (!colKey) {
      throw new Error(`P6 export validation: activity code type "${t.name}" (${t.id}) sanitizes to an empty column key`);
    }
  }

  for (const c of catalog.codes) {
    if (!typeById.has(c.typeId)) {
      throw new Error(`P6 export validation: activity code "${c.name}" (${c.id}) references unknown type ${c.typeId}`);
    }
  }

  for (const [targetId, assigns] of catalog.assignmentsByCanonicalActivityId) {
    for (const a of assigns) {
      if (!typeById.has(a.typeId)) {
        throw new Error(
          `P6 export validation: assignment target ${targetId} references unknown activity code type ${a.typeId}`
        );
      }
      const code = codeById.get(a.codeId);
      if (!code) {
        throw new Error(
          `P6 export validation: assignment target ${targetId} references unknown activity code value ${a.codeId}`
        );
      }
      if (code.typeId !== a.typeId) {
        throw new Error(
          `P6 export validation: assignment target ${targetId} type/code mismatch (type ${a.typeId}, code ${a.codeId} belongs to type ${code.typeId})`
        );
      }
      const semantic = String(code.shortName?.trim() || code.name).trim();
      if (!semantic) {
        throw new Error(
          `P6 export validation: activity code value ${code.id} has empty short_name and name; P6 semantic import requires a non-empty value`
        );
      }
    }
  }
}

function resourceLookupKey(type: string, name: string): string {
  return `${String(type ?? "").trim().toLowerCase()}|${String(name ?? "").trim().toLowerCase()}`;
}

/** Assigned resources must exist on the rate card so XER RSRC and TASK resource_list stay consistent. */
export function assertAssignedResourcesExistOnRateCard(
  rateCardEntries: RateCardEntry[],
  rows: { assignedResources: AssignedResourceStored[] }[]
): void {
  const hasAnyAssignment = rows.some((r) => r.assignedResources.length > 0);
  if (!hasAnyAssignment) return;
  const { byTypeName } = buildP6ResourceMap(rateCardEntries);
  for (let i = 0; i < rows.length; i++) {
    const assigned = rows[i]!.assignedResources;
    for (const ar of assigned) {
      const k = resourceLookupKey(ar.resourceType, ar.resourceName);
      if (!byTypeName.has(k)) {
        throw new Error(
          `P6 export validation: row ${i + 1} assigns resource "${ar.resourceName}" (${ar.resourceType}) but it is not on the company rate card. Upload rate card or remove the assignment.`
        );
      }
    }
  }
}

export function assertUniqueTaskCodesInSheet(taskDataRows: (string | number | null)[][]): void {
  const seen = new Map<string, number>();
  for (let i = 0; i < taskDataRows.length; i++) {
    const code = String(taskDataRows[i]![0] ?? "").trim();
    if (!code) {
      throw new Error(`P6 export validation: TASK sheet row ${i + 3} has empty task_code`);
    }
    const prev = seen.get(code);
    if (prev !== undefined) {
      throw new Error(`P6 export validation: duplicate task_code "${code}" at rows ${prev + 3} and ${i + 3}`);
    }
    seen.set(code, i);
  }
}

export function assertEveryTaskHasWbsPath(taskDataRows: (string | number | null)[][]): void {
  for (let i = 0; i < taskDataRows.length; i++) {
    const wbs = String(taskDataRows[i]![2] ?? "").trim();
    if (!wbs) {
      throw new Error(`P6 export validation: TASK sheet row ${i + 3} missing wbs_id (WBS path)`);
    }
  }
}
