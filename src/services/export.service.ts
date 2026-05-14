/**
 * Excel (.xlsx) export for a single Fragnet.
 * Structure and columns match Primavera P6 Spreadsheet Import template.
 *
 * If NO deliverables: export activities normally (TASK = activities, TASKPRED = relationships).
 * TASK uses stable WBS path strings in `wbs_id`, `resource_list` (comma-separated resource short names from the rate card / XER RSRC), and optional `actv_code_<type>_id` columns with semantic code values for spreadsheet import. The bundled `.xer` also emits `TASK` + `TASKACTV` so P6 shows activity code assignments on activities after import.
 *
 * If deliverables exist: block-based duplication per deliverable:
 * - For each deliverable, create a block: deliverable row + duplicate of ALL activities.
 * - IDs sequential across sheet (no reuse between blocks).
 * - Relationships: deliverable → entry activity (FS, 0) and all internal relationships within block.
 * - Empty row between blocks in TASK only (except after last block).
 */

import * as XLSX from "xlsx";
import type { AssignedResourceStored, RateCardEntry } from "./rateCard.js";
import type { GeneratedWbs } from "./wbsGenerate.service.js";
import type { P6Resource } from "./p6ResourceMap.service.js";
import { buildP6ResourceMap } from "./p6ResourceMap.service.js";
import { buildXerAlignedWbsCodeMap } from "./wbsHumanReadable.service.js";
import type { ActivityCodeCatalogForExport } from "./activityCodeCatalog.service.js";
import {
  canonicalActivityIdForAssignmentLookup,
} from "./p6ExternalId.service.js";
import {
  activityCodeAssignmentColumnHeader,
  assertEveryTaskHasWbsPath,
  assertUniqueTaskCodesInSheet,
} from "./p6SpreadsheetExportValidation.service.js";
import { mergeInheritedAndOwnActivityAssignments } from "./activityCodeAssignmentsMerge.service.js";

export type DeliverableForExport = {
  id: string;
  name: string;
  bestDuration: number;
  likelyDuration: number;
  createdAt: Date;
  assignedResources: AssignedResourceStored[];
};

export type ActivityForExport = {
  id: string;
  /** Present for fragnet activities (required for DB); used when aligning export rows to deliverables. */
  deliverableId?: string;
  name: string;
  bestDuration: number;
  likelyDuration: number;
  createdAt: Date;
  assignedResources: AssignedResourceStored[];
};

type RelationshipForExport = {
  predecessorActivityId: string;
  successorActivityId: string;
  relationshipType: string;
  lag: number;
};

export type StandardFragnetForExport = {
  id: string;
  deliverables: DeliverableForExport[];
  activities: ActivityForExport[];
  relationships: RelationshipForExport[];
};

/** Deterministic sort: created_at asc, then id asc. */
function sortByCreatedAt<T extends { createdAt: Date; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const tA = new Date(a.createdAt).getTime();
    const tB = new Date(b.createdAt).getTime();
    if (tA !== tB) return tA - tB;
    return a.id.localeCompare(b.id);
  });
}

/** Entry activity = activity with no predecessor in this fragnet. If multiple, earliest created. */
function findEntryActivity(
  activities: ActivityForExport[],
  relationships: RelationshipForExport[]
): ActivityForExport | null {
  const successorIds = new Set(relationships.map((r) => r.successorActivityId));
  const withNoPredecessor = activities.filter((a) => !successorIds.has(a.id));
  if (withNoPredecessor.length === 0) return null;
  const sorted = sortByCreatedAt(withNoPredecessor);
  return sorted[0] ?? null;
}

/**
 * P6 spreadsheet import — TASK sheet (operational data).
 *
 * Activity code assignments use semantic columns `actv_code_<type_name>_id` with human/P6 code values
 * (short name or name), NOT Oracle internal IDs. The companion XER uses deterministic numeric ids for
 * ACTVTYPE / ACTVCODE / TASK / TASKACTV so assignments resolve without `p6_external_id` mappings.
 *
 * WBS placement uses stable hierarchical WBS path strings (same as XER PROJWBS / WBS Code), never internal
 * numeric-only node ids in this column.
 *
 * Row 1: P6 database field names; Row 2: labels for humans.
 */
const TASK_SEMANTIC_DB_HEADERS_BASE = [
  "task_code",
  "status_code",
  "wbs_id",
  "wbs_name",
  "task_name",
  "start_date",
  "end_date",
  "resource_list",
  "delete_record_flag",
  "orig_dur_hr_cnt",
  "remain_drtn_hr_cnt",
  "total_float_hr_cnt",
] as const;

const TASK_SEMANTIC_USER_HEADERS_BASE = [
  "Activity ID",
  "Activity Status",
  "WBS Code",
  "WBS Name",
  "Activity Name",
  "Start",
  "Finish",
  "Resource List",
  "Delete This Row",
  "Original Duration (hr)",
  "Remaining Duration (hr)",
  "Total Float (hr)",
] as const;

const ACTIVITY_STATUS = "Not Started";

export type P6ExportContext = {
  companyId: string;
  ranaProjectId: string;
  p6ProjIdCell: string | number;
};

export type FragnetExportOptions = {
  exportContext?: (P6ExportContext & { fragnetId: string }) | null;
  activityCatalog?: ActivityCodeCatalogForExport | null;
};

export type StandardExportOptions = {
  exportContext?: P6ExportContext | null;
  activityCatalog?: ActivityCodeCatalogForExport | null;
};

/** One semantic TASK row before activity-code columns are expanded (mirrors spreadsheet export). */
export type P6PendingSemanticTaskRow = {
  /** Catalog key for this row's own assignments (canonical activity id or deliverable id). */
  ownAssignmentKey: string | null;
  /**
   * For activity TASK rows under a deliverable WBS: inherit codes stored on that deliverable.
   * Activity-level assignments override by type.
   */
  inheritDeliverableId: string | null;
  /** Matches {@link TASK_SEMANTIC_DB_HEADERS_BASE} column order (12 cells). */
  baseCells: (string | number | null)[];
};

type TaskRowP6Meta = {
  fragnetId: string;
  deliverableBlockId: string;
  rowKind: "DELIVERABLE" | "ACTIVITY";
  exportActivityId: string;
};

function buildTaskSheetHeaders(catalog: ActivityCodeCatalogForExport): {
  dbHeaders: string[];
  userHeaders: string[];
  typeIdsOrdered: string[];
} {
  const typesSorted = [...catalog.types].sort((a, b) => {
    if (a.seqNum !== b.seqNum) return a.seqNum - b.seqNum;
    return a.name.localeCompare(b.name);
  });
  const typeIdsOrdered = typesSorted.map((t) => t.id);
  const actvDb = typesSorted.map((t) => activityCodeAssignmentColumnHeader(t.name));
  const actvUser = typesSorted.map((t) => `${t.name} (code value)`);
  return {
    dbHeaders: [...TASK_SEMANTIC_DB_HEADERS_BASE, ...actvDb],
    userHeaders: [...TASK_SEMANTIC_USER_HEADERS_BASE, ...actvUser],
    typeIdsOrdered,
  };
}

function buildSemanticTaskDataRows(args: {
  pendingTaskRows: P6PendingSemanticTaskRow[];
  catalog: ActivityCodeCatalogForExport;
  typeIdsOrdered: string[];
}): (string | number | null)[][] {
  const codeById = new Map(args.catalog.codes.map((c) => [c.id, c]));
  const typeById = new Map(args.catalog.types.map((t) => [t.id, t]));

  for (const p of args.pendingTaskRows) {
    const wbsCell = p.baseCells[2];
    if (wbsCell === null || wbsCell === undefined || String(wbsCell).trim() === "") {
      throw new Error("P6 export: TASK row missing wbs_id (WBS path must be set before writing TASK)");
    }
    const wbsNameCell = p.baseCells[3];
    if (wbsNameCell === null || wbsNameCell === undefined || String(wbsNameCell).trim() === "") {
      throw new Error("P6 export: TASK row missing wbs_name");
    }
  }

  const out: (string | number | null)[][] = [];
  for (const p of args.pendingTaskRows) {
    const actvCells: string[] = [];

    const merged = mergeInheritedAndOwnActivityAssignments(
      args.catalog,
      p.ownAssignmentKey,
      p.inheritDeliverableId
    );
    const mergedByType = new Map(merged.map((a) => [a.typeId, a]));

    for (const tid of args.typeIdsOrdered) {
      const t = typeById.get(tid);
      if (!t) {
        actvCells.push("");
        continue;
      }
      const hit = mergedByType.get(tid);
      if (!hit) {
        actvCells.push("");
        continue;
      }
      const code = codeById.get(hit.codeId);
      if (!code) {
        throw new Error(
          `P6 export: missing activity code ${hit.codeId} (type ${hit.typeId}; own=${p.ownAssignmentKey ?? "—"}; inherit=${p.inheritDeliverableId ?? "—"})`
        );
      }
      const semantic = String(code.shortName?.trim() || code.name).trim();
      if (!semantic) {
        throw new Error(`P6 export: activity code ${code.id} has empty short_name and name`);
      }
      const tc = p.baseCells[0];
      if (tc === null || tc === undefined || String(tc).trim() === "") {
        throw new Error("P6 export: TASK row missing task_code while activity code assignments exist");
      }
      actvCells.push(semantic);
    }
    out.push([...p.baseCells, ...actvCells]);
  }
  return out;
}

function deliverableWbsLookupFromGenerated(generatedWbs: GeneratedWbs): Map<string, { wbs_id: string; wbs_name: string }> {
  const m = new Map<string, { wbs_id: string; wbs_name: string }>();
  for (const s of generatedWbs.deliverable_wbs_list) {
    const wid = generatedWbs.deliverableIdToWbsId.get(s.deliverable_id);
    if (wid !== s.wbs_id) {
      throw new Error(`export: deliverableIdToWbsId mismatch for deliverable ${s.deliverable_id}`);
    }
    m.set(s.deliverable_id, { wbs_id: String(wid), wbs_name: s.wbs_name });
  }
  return m;
}

/** P6 TASKPRED sheet: Lag exported in HOURS (days * 8). */
const TASKPRED_DB_HEADERS = ["pred_task_id", "task_id", "pred_type", "pred_proj_id", "proj_id", "lag_hr_cnt", "delete_record_flag"];
const TASKPRED_USER_HEADERS = ["Predecessor", "Successor", "Relationship Type", "Predecessor Project", "Successor Project", "Lag(hr)", "Delete This Row"];

/**
 * P6 RSRC sheet (resource dictionary from uploaded rate card), matching Primavera spreadsheet template.
 * Row 1: technical keys; Row 2: labels including (*) and (h/d) as in P6 export.
 */
const RSRC_DB_HEADERS = ["rsrc_id", "rsrc_short_name", "rsrc_name", "rsrc_type", "unit_id", "role_id", "def_qty_per_hr", "cost_per_qty"] as const;
const RSRC_USER_HEADERS = [
  "Resource ID",
  "Resource ID",
  "Resource Name",
  "(*)Resource Type",
  "Unit of Measure",
  "(*)Role ID",
  "Default Units / Time(h/d)",
  "(*)Price / Unit(£/h)",
] as const;

const RSRC_RESOURCE_TYPE = "Labor";
const RSRC_UNIT_ID = "hr";
const RSRC_DEFAULT_UNITS_PER_TIME = 8;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanActivityName(name: unknown): string {
  return String(name ?? "").trim();
}

function normalizeResourceName(name: unknown): string {
  // Trim and collapse internal whitespace; keep original casing for display, but normalize for keying.
  const trimmed = String(name ?? "").trim();
  return trimmed.replace(/\s+/g, " ");
}

function normalizeActivityNameForType(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericActivityName(name: unknown): boolean {
  const n = normalizeActivityNameForType(name);
  if (!n) return false;
  const patterns = [
    "internal check",
    "check",
    "review",
    "approval",
    "approve",
    "sign off",
    "handover",
    "qa",
    "qc",
    "coordination",
    "meeting",
    "mobilization",
    "mobilisation",
  ];
  return patterns.some((p) => n === p || n.includes(p));
}

function isLikelyDuplicateRsrcHeaderRow(row: (string | number)[]): boolean {
  const asStrings = row.map((v) => String(v ?? "").trim().toLowerCase());
  const markers = new Set([
    "resource id",
    "resource name",
    "unit of measure",
    "default units / time(h/d)",
    "(*)price / unit(£/h)",
  ]);
  return asStrings.some((v) => markers.has(v));
}

function validateRsrcRows(rows: (string | number)[][]): void {
  // rows here are DATA rows only (no headers).
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    // rsrc_id (index 0) should be numeric
    if (typeof r[0] !== "number" || !Number.isFinite(r[0] as number)) {
      throw new Error(`RSRC export: invalid rsrc_id at row ${i + 2}`);
    }
    // rsrc_type (index 3) should be the fixed string "Labor"
    if (typeof r[3] !== "string" || String(r[3]).trim().toLowerCase() !== "labor") {
      throw new Error(`RSRC export: invalid rsrc_type at row ${i + 2}`);
    }
    // def_qty_per_hr (index 6) should be numeric
    if (typeof r[6] !== "number" || !Number.isFinite(r[6] as number)) {
      throw new Error(`RSRC export: invalid def_qty_per_hr at row ${i + 2}`);
    }
    // cost_per_qty (index 7) should be numeric
    if (typeof r[7] !== "number" || !Number.isFinite(r[7] as number)) {
      throw new Error(`RSRC export: invalid cost_per_qty at row ${i + 2}`);
    }
  }
}

function buildRsrcDataRows(resources: P6Resource[]): (string | number)[][] {
  const rows = resources.map((r) => [
    r.rsrc_id,
    r.rsrc_short_name,
    r.rsrc_name,
    RSRC_RESOURCE_TYPE,
    RSRC_UNIT_ID,
    "",
    RSRC_DEFAULT_UNITS_PER_TIME,
    r.cost_per_qty,
  ]);
  validateRsrcRows(rows);
  return rows;
}

/**
 * PART 1 — Generate short name from resource name.
 * Rules:
 * - Split into words
 * - 1 word: first 3 letters (uppercase)
 * - multiple words: first letter of each word (uppercase)
 * - remove non-alphabetic characters
 */
export function generate_short_name(resource_name: string): string {
  const normalized = normalizeResourceName(resource_name).toLowerCase();
  const rawWords = normalized.split(" ").filter(Boolean);
  const words = rawWords
    .map((w) => w.replace(/[^a-z]/g, "")) // remove non-alphabetic
    .filter((w) => w.length > 0);

  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();
  return words.map((w) => w[0]!).join("").toUpperCase();
}

/**
 * PART 2 — Ensure uniqueness within a run.
 * - Same normalized resource name always maps to same short name within a run.
 * - If duplicate short name occurs, append numeric suffix (2, 3, ...)
 */
function makeShortNameGenerator() {
  const nameToShort = new Map<string, string>();
  const baseToCount = new Map<string, number>();
  const duplicatesResolved: { base: string; resolved: string; name: string }[] = [];

  const generate_unique_short_name = (resource_name: string): string => {
    const displayName = normalizeResourceName(resource_name);
    const key = displayName.toLowerCase();
    if (!displayName) {
      throw new Error("RSRC export: resource name is empty");
    }
    const existing = nameToShort.get(key);
    if (existing) return existing;

    const base = generate_short_name(displayName);
    if (!base) {
      throw new Error(`RSRC export: could not generate short name for resource "${displayName}"`);
    }

    const prev = baseToCount.get(base) ?? 0;
    const next = prev + 1;
    baseToCount.set(base, next);

    const resolved = next === 1 ? base : `${base}${next}`;
    if (resolved !== base) {
      duplicatesResolved.push({ base, resolved, name: displayName });
    }
    nameToShort.set(key, resolved);
    return resolved;
  };

  const logMapping = () => {
    if (nameToShort.size === 0) return;
    console.info("[export] RSRC short names generated", {
      count: nameToShort.size,
      duplicateCount: duplicatesResolved.length,
    });
  };

  return { generate_unique_short_name, logMapping };
}

function makePlaResourceIdGenerator() {
  // Same resource name always maps to same PLA-n id within a run.
  const nameToId = new Map<string, string>();
  let next = 1;

  const getId = (resourceName: string): string => {
    const displayName = normalizeResourceName(resourceName);
    const key = displayName.toLowerCase();
    if (!displayName) throw new Error("RSRC export: resource name is empty");
    const existing = nameToId.get(key);
    if (existing) return existing;
    const id = `PLA-${next++}`;
    nameToId.set(key, id);
    return id;
  };

  const logMapping = () => {
    if (nameToId.size === 0) return;
    console.info("[export] RSRC Resource IDs generated", { count: nameToId.size });
  };

  return { getId, logMapping };
}

function makeNumericResourceIdGenerator() {
  // Same resource name always maps to the same numeric id within a run.
  const nameToId = new Map<string, number>();
  let next = 1;

  const getId = (resourceName: string): number => {
    const displayName = normalizeResourceName(resourceName);
    const key = displayName.toLowerCase();
    if (!displayName) throw new Error("RSRC export: resource name is empty");
    const existing = nameToId.get(key);
    if (existing !== undefined) return existing;
    const id = next++;
    nameToId.set(key, id);
    return id;
  };

  const logMapping = () => {
    if (nameToId.size === 0) return;
    console.info("[export] RSRC numeric IDs generated", { count: nameToId.size });
  };

  return { getId, logMapping };
}

export type ExportScenario = "best" | "likely";

/**
 * Generate xlsx buffer for fragnet export (P6 Spreadsheet Import format).
 * - Two header rows per sheet: database field names, then user-friendly names.
 * - TASK: semantic columns including stable WBS path, resource_list, optional actv_code_<type>_id (values match XER ACTVCODE short/name — not Oracle IDs). No TASKACTV sheet in xlsx (assignments are in the bundled `.xer` TASKACTV table).
 * - TASKPRED: pred_task_id, task_id, pred_type, pred_proj_id, proj_id, lag_hr_cnt, delete_record_flag.
 * - RSRC (only if rate card has rows): resource dictionary for spreadsheet import alongside XER RSRC.
 * - Block duplication per deliverable unchanged; empty rows only in TASK.
 */
export async function generateFragnetXlsx(
  generatedWbs: GeneratedWbs,
  deliverables: DeliverableForExport[],
  activities: ActivityForExport[],
  relationships: RelationshipForExport[],
  scenario: ExportScenario,
  projectId: string,
  projectNameForWbsCode: string,
  rateCardEntries: RateCardEntry[] = [],
  opts?: FragnetExportOptions | null
): Promise<{ buffer: Buffer; pendingSemanticRows: P6PendingSemanticTaskRow[] }> {
  const idFor = (n: number) => `A${n}`;
  const suggestAvailableIds = (startN: number, used: Set<string>, count = 8): string[] => {
    const out: string[] = [];
    let n = startN;
    while (out.length < count) {
      const candidate = idFor(n);
      if (!used.has(candidate)) out.push(candidate);
      n += 1;
    }
    return out;
  };

  const p6Ctx = opts?.exportContext ?? null;
  const activityCatalog: ActivityCodeCatalogForExport =
    opts?.activityCatalog ?? { types: [], codes: [], assignmentsByCanonicalActivityId: new Map() };

  const durationField = scenario === "best" ? "bestDuration" : "likelyDuration";
  const pendingSemanticRows: P6PendingSemanticTaskRow[] = [];
  const taskPredDataRows: (string | number | null)[][] = [];
  let nextId = 1000;
  const usedExportIds = new Set<string>();
  const allocateId = (kind: "deliverable" | "activity"): string => {
    const candidate = idFor(nextId);
    if (usedExportIds.has(candidate)) {
      const suggestions = suggestAvailableIds(nextId, usedExportIds, 8);
      throw new Error(
        `Export: cannot allocate ${kind} ID ${candidate} because it is already in use by a deliverable. ` +
          `Choose one of the following available IDs instead: ${suggestions.join(", ")}`
      );
    }
    usedExportIds.add(candidate);
    nextId += 1;
    return candidate;
  };
  const sortedActivities = sortByCreatedAt(activities);
  const rootWbs = generatedWbs.project_wbs;
  const deliverableWbsById = deliverableWbsLookupFromGenerated(generatedWbs);
  const wbsCodeById = buildXerAlignedWbsCodeMap(generatedWbs, projectNameForWbsCode);
  const rootWbsCode = wbsCodeById.get(generatedWbs.project_wbs.wbs_id) ?? String(projectNameForWbsCode ?? "").trim();

  const p6Resources = buildP6ResourceMap(rateCardEntries);
  const resourceKey = (type: string, name: string): string =>
    `${String(type ?? "").trim().toLowerCase()}|${String(name ?? "").trim().toLowerCase()}`;

  const droppedActivityRows: { reason: string; id: string; name: unknown; duration: unknown }[] = [];

  const buildResourceListCell = (assigned: AssignedResourceStored[]): string => {
    if (assigned.length === 0) return "";
    const parts: string[] = [];
    for (const ar of assigned) {
      const r = p6Resources.byTypeName.get(resourceKey(ar.resourceType, ar.resourceName));
      if (!r) {
        throw new Error(
          `TASK resource_list: resource "${ar.resourceName}" (${ar.resourceType}) is not on the rate card. Upload rate card or remove the assignment.`
        );
      }
      parts.push(r.rsrc_short_name);
    }
    return parts.join(", ");
  };

  const pushActivityRow = (
    exportId: string,
    rawName: unknown,
    rawDurationDays: unknown,
    assigned: AssignedResourceStored[],
    wbsId: string,
    wbsName: string,
    rowP6?: TaskRowP6Meta
  ) => {
    const activityName = cleanActivityName(rawName);
    if (!activityName) {
      droppedActivityRows.push({ reason: "empty Activity Name", id: exportId, name: rawName, duration: rawDurationDays });
      return;
    }
    if (!isFiniteNumber(rawDurationDays)) {
      droppedActivityRows.push({ reason: "missing/invalid duration", id: exportId, name: rawName, duration: rawDurationDays });
      return;
    }
    const durationHours = rawDurationDays;
    if (!Number.isFinite(durationHours)) {
      droppedActivityRows.push({ reason: "invalid converted duration", id: exportId, name: rawName, duration: rawDurationDays });
      return;
    }
    const resourceList = buildResourceListCell(assigned);
    let ownAssignmentKey: string | null = null;
    let inheritDeliverableId: string | null = null;
    if (rowP6) {
      if (rowP6.rowKind === "DELIVERABLE") {
        ownAssignmentKey = rowP6.exportActivityId;
      } else if (rowP6.rowKind === "ACTIVITY") {
        ownAssignmentKey = canonicalActivityIdForAssignmentLookup(
          rowP6.exportActivityId,
          rowP6.deliverableBlockId === "__ROOT__" ? "" : rowP6.deliverableBlockId
        );
        if (rowP6.deliverableBlockId !== "__ROOT__") {
          inheritDeliverableId = rowP6.deliverableBlockId;
        }
      }
    }
    const baseCells: (string | number | null)[] = [
      exportId,
      ACTIVITY_STATUS,
      wbsId,
      wbsName,
      activityName,
      null,
      null,
      resourceList,
      null,
      durationHours,
      durationHours,
      0,
    ];
    pendingSemanticRows.push({ ownAssignmentKey, inheritDeliverableId, baseCells });
  };

  const p6Row = (deliverableBlockId: string, rowKind: "DELIVERABLE" | "ACTIVITY", exportActivityId: string): TaskRowP6Meta | undefined =>
    p6Ctx ? { fragnetId: p6Ctx.fragnetId, deliverableBlockId, rowKind, exportActivityId } : undefined;

  if (deliverables.length === 0) {
    // No deliverables: export activities under the project root WBS only.
    const activityMap = new Map<string, string>();
    sortedActivities.forEach((a, idx) => {
      const exportId = idFor(1000 + idx);
      if (usedExportIds.has(exportId)) {
        const suggestions = suggestAvailableIds(1000 + idx, usedExportIds, 8);
        throw new Error(
          `Export: activity ID ${exportId} is already in use by a deliverable. ` +
            `Choose one of the following available IDs instead: ${suggestions.join(", ")}`
        );
      }
      usedExportIds.add(exportId);
      activityMap.set(a.id, exportId);
    });
    nextId = 1000 + sortedActivities.length;
    const rootWbsIdForTask = rootWbsCode;
    sortedActivities.forEach((a) => {
      pushActivityRow(
        activityMap.get(a.id)!,
        a.name,
        a[durationField],
        a.assignedResources,
        rootWbsIdForTask,
        rootWbs.wbs_name,
        p6Row("__ROOT__", "ACTIVITY", a.id)
      );
    });
    relationships.forEach((r) => {
      const predId = activityMap.get(r.predecessorActivityId) ?? r.predecessorActivityId;
      const succId = activityMap.get(r.successorActivityId) ?? r.successorActivityId;
      // Keep lag value as-is (no conversion) while still using lag_hr_cnt field name.
      taskPredDataRows.push([predId, succId, r.relationshipType, projectId, projectId, r.lag, null]);
    });
  } else {
    // Block-based duplication per deliverable — only activities that belong to each deliverable.
    const sortedDeliverables = sortByCreatedAt(deliverables);

    for (const d of sortedDeliverables) {
      const blockWbs = deliverableWbsById.get(d.id);
      if (!blockWbs) {
        throw new Error(`Export: deliverable ${d.id} missing from generated WBS map`);
      }
      const wbsIdNum = Number.parseInt(String(blockWbs.wbs_id), 10);
      if (!Number.isInteger(wbsIdNum) || wbsIdNum < 1) {
        throw new Error(`Export: invalid deliverable wbs_id for deliverable ${d.id}: ${JSON.stringify(blockWbs.wbs_id)}`);
      }
      const wbsCode = wbsCodeById.get(wbsIdNum);
      if (!wbsCode || String(wbsCode).trim() === "" || wbsCode === rootWbsCode) {
        throw new Error(
          `Export: invalid deliverable WBS Code for deliverable ${d.id} (wbs_id=${wbsIdNum}): ${JSON.stringify(wbsCode)}`
        );
      }

      const deliverableExportId = allocateId("deliverable");
      pushActivityRow(
        deliverableExportId,
        d.name,
        d[durationField],
        d.assignedResources,
        wbsCode,
        blockWbs.wbs_name,
        p6Row(d.id, "DELIVERABLE", d.id)
      );

      const activitiesInDeliverable = sortedActivities.filter((a) => a.deliverableId === d.id);
      const activityIds = new Set(activitiesInDeliverable.map((a) => a.id));
      const blockRelationships = relationships.filter(
        (r) => activityIds.has(r.predecessorActivityId) && activityIds.has(r.successorActivityId)
      );
      const entryActivity = findEntryActivity(activitiesInDeliverable, blockRelationships);

      const activityMapInBlock = new Map<string, string>();
      activitiesInDeliverable.forEach((a) => {
        activityMapInBlock.set(a.id, allocateId("activity"));
      });
      activitiesInDeliverable.forEach((a) => {
        pushActivityRow(
          activityMapInBlock.get(a.id)!,
          a.name,
          a[durationField],
          a.assignedResources,
          wbsCode,
          blockWbs.wbs_name,
          p6Row(d.id, "ACTIVITY", a.id)
        );
      });

      blockRelationships.forEach((r) => {
        const predId = activityMapInBlock.get(r.predecessorActivityId);
        const succId = activityMapInBlock.get(r.successorActivityId);
        if (predId && succId) {
          taskPredDataRows.push([predId, succId, r.relationshipType, projectId, projectId, r.lag, null]);
        }
      });

      if (entryActivity) {
        const firstActivityExportId = activityMapInBlock.get(entryActivity.id);
        if (firstActivityExportId) {
          taskPredDataRows.push([deliverableExportId, firstActivityExportId, "FS", projectId, projectId, 0, null]);
        }
      }
    }
  }

  const { dbHeaders: taskDbHeaders, userHeaders: taskUserHeaders, typeIdsOrdered } = buildTaskSheetHeaders(activityCatalog);
  const taskDataRows = buildSemanticTaskDataRows({
    pendingTaskRows: pendingSemanticRows,
    catalog: activityCatalog,
    typeIdsOrdered,
  });

  if (droppedActivityRows.length > 0) {
    console.warn("[export] Dropped invalid TASK rows", { count: droppedActivityRows.length });
  }

  console.info("[export] Generated TASK rows", {
    taskRows: taskDataRows.length,
  });

  const taskAoa = [taskDbHeaders, taskUserHeaders, ...taskDataRows];
  const taskPredAoa = [TASKPRED_DB_HEADERS, TASKPRED_USER_HEADERS, ...taskPredDataRows];

  const workbook = XLSX.utils.book_new();
  const taskSheet = XLSX.utils.aoa_to_sheet(taskAoa);
  const taskPredSheet = XLSX.utils.aoa_to_sheet(taskPredAoa);

  XLSX.utils.book_append_sheet(workbook, taskSheet, "TASK");
  XLSX.utils.book_append_sheet(workbook, taskPredSheet, "TASKPRED");

  if (rateCardEntries.length > 0) {
    const rsrcDataRows = buildRsrcDataRows(p6Resources.resources);
    const rsrcAoa = [
      RSRC_DB_HEADERS as unknown as string[],
      RSRC_USER_HEADERS as unknown as string[],
      ...rsrcDataRows,
    ];
    const rsrcSheet = XLSX.utils.aoa_to_sheet(rsrcAoa);
    const rsrcLastRow0 = 1 + rsrcDataRows.length;
    rsrcSheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rsrcLastRow0, c: RSRC_DB_HEADERS.length - 1 } }),
    };
    XLSX.utils.book_append_sheet(workbook, rsrcSheet, "RSRC");
  }

  assertUniqueTaskCodesInSheet(taskDataRows);
  assertEveryTaskHasWbsPath(taskDataRows);

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { buffer, pendingSemanticRows };
}

/**
 * Standard export: one workbook, activities scoped per fragnet (same TASK / TASKPRED / RSRC layout as {@link generateFragnetXlsx}).
 *
 * CRITICAL RULES:
 * - Activities repeat within a fragnet
 * - Activities MUST NOT repeat across fragnets
 * - Never use a standard-global activity list
 */
export async function generateStandardXlsx(
  generatedWbs: GeneratedWbs,
  fragnets: StandardFragnetForExport[],
  scenario: ExportScenario,
  projectId: string,
  projectNameForWbsCode: string,
  rateCardEntries: RateCardEntry[] = [],
  opts?: StandardExportOptions | null
): Promise<{ buffer: Buffer; pendingSemanticRows: P6PendingSemanticTaskRow[] }> {
  const idFor = (n: number) => `A${n}`;
  const suggestAvailableIds = (startN: number, used: Set<string>, count = 8): string[] => {
    const out: string[] = [];
    let n = startN;
    while (out.length < count) {
      const candidate = idFor(n);
      if (!used.has(candidate)) out.push(candidate);
      n += 1;
    }
    return out;
  };

  const p6Ctx = opts?.exportContext ?? null;
  const activityCatalog: ActivityCodeCatalogForExport =
    opts?.activityCatalog ?? { types: [], codes: [], assignmentsByCanonicalActivityId: new Map() };

  const durationField = scenario === "best" ? "bestDuration" : "likelyDuration";
  const pendingSemanticRows: P6PendingSemanticTaskRow[] = [];
  const taskPredDataRows: (string | number | null)[][] = [];
  let nextId = 1000;
  const usedExportIds = new Set<string>();
  const allocateId = (kind: "deliverable" | "activity"): string => {
    const candidate = idFor(nextId);
    if (usedExportIds.has(candidate)) {
      const suggestions = suggestAvailableIds(nextId, usedExportIds, 8);
      throw new Error(
        `Export: cannot allocate ${kind} ID ${candidate} because it is already in use by a deliverable. ` +
          `Choose one of the following available IDs instead: ${suggestions.join(", ")}`
      );
    }
    usedExportIds.add(candidate);
    nextId += 1;
    return candidate;
  };

  const deliverableWbsById = deliverableWbsLookupFromGenerated(generatedWbs);
  const wbsCodeById = buildXerAlignedWbsCodeMap(generatedWbs, projectNameForWbsCode);
  const rootWbsCode =
    wbsCodeById.get(generatedWbs.project_wbs.wbs_id) ?? String(projectNameForWbsCode ?? "").trim();
  const p6Resources = buildP6ResourceMap(rateCardEntries);
  const resourceKey = (type: string, name: string): string =>
    `${String(type ?? "").trim().toLowerCase()}|${String(name ?? "").trim().toLowerCase()}`;

  const droppedActivityRows: { reason: string; id: string; name: unknown; duration: unknown }[] = [];

  const buildResourceListCell = (assigned: AssignedResourceStored[]): string => {
    if (assigned.length === 0) return "";
    const parts: string[] = [];
    for (const ar of assigned) {
      const r = p6Resources.byTypeName.get(resourceKey(ar.resourceType, ar.resourceName));
      if (!r) {
        throw new Error(
          `TASK resource_list: resource "${ar.resourceName}" (${ar.resourceType}) is not on the rate card. Upload rate card or remove the assignment.`
        );
      }
      parts.push(r.rsrc_short_name);
    }
    return parts.join(", ");
  };

  const pushActivityRow = (
    exportId: string,
    rawName: unknown,
    rawDurationDays: unknown,
    assigned: AssignedResourceStored[],
    wbsId: string,
    wbsName: string,
    rowP6?: TaskRowP6Meta
  ) => {
    const activityName = cleanActivityName(rawName);
    if (!activityName) {
      droppedActivityRows.push({ reason: "empty Activity Name", id: exportId, name: rawName, duration: rawDurationDays });
      return;
    }
    if (!isFiniteNumber(rawDurationDays)) {
      droppedActivityRows.push({ reason: "missing/invalid duration", id: exportId, name: rawName, duration: rawDurationDays });
      return;
    }
    const durationHours = rawDurationDays;
    if (!Number.isFinite(durationHours)) {
      droppedActivityRows.push({ reason: "invalid converted duration", id: exportId, name: rawName, duration: rawDurationDays });
      return;
    }
    const resourceList = buildResourceListCell(assigned);
    let ownAssignmentKey: string | null = null;
    let inheritDeliverableId: string | null = null;
    if (rowP6) {
      if (rowP6.rowKind === "DELIVERABLE") {
        ownAssignmentKey = rowP6.exportActivityId;
      } else if (rowP6.rowKind === "ACTIVITY") {
        ownAssignmentKey = canonicalActivityIdForAssignmentLookup(
          rowP6.exportActivityId,
          rowP6.deliverableBlockId === "__ROOT__" ? "" : rowP6.deliverableBlockId
        );
        if (rowP6.deliverableBlockId !== "__ROOT__") {
          inheritDeliverableId = rowP6.deliverableBlockId;
        }
      }
    }
    const baseCells: (string | number | null)[] = [
      exportId,
      ACTIVITY_STATUS,
      wbsId,
      wbsName,
      activityName,
      null,
      null,
      resourceList,
      null,
      durationHours,
      durationHours,
      0,
    ];
    pendingSemanticRows.push({ ownAssignmentKey, inheritDeliverableId, baseCells });
  };

  const stdP6Row = (
    fragnetId: string,
    deliverableBlockId: string,
    rowKind: "DELIVERABLE" | "ACTIVITY",
    exportActivityId: string
  ): TaskRowP6Meta | undefined =>
    p6Ctx ? { fragnetId, deliverableBlockId, rowKind, exportActivityId } : undefined;

  // Assign activities correctly (per deliverable, per fragnet).
  // CRITICAL: activities must ONLY appear under their own deliverable (no sharing across deliverables/fragnets).
  for (const fragnet of fragnets) {
    const genericActivities = fragnet.activities.filter((a) => {
      const t = (a as any).type;
      if (t === "GENERIC") return true;
      if (t === "SPECIFIC") return false;
      return isGenericActivityName(a.name);
    });
    for (const deliverable of sortByCreatedAt(fragnet.deliverables)) {
      const blockWbs = deliverableWbsById.get(deliverable.id);
      if (!blockWbs) {
        throw new Error(`Export: deliverable ${deliverable.id} missing from generated WBS map`);
      }

      // CRITICAL: P6 spreadsheet import requires TASK.WBS Code to match a WBS Code string (hierarchical), not an internal numeric id.
      const wbsIdNum = Number.parseInt(String(blockWbs.wbs_id), 10);
      if (!Number.isInteger(wbsIdNum) || wbsIdNum < 1) {
        throw new Error(
          `Export: invalid deliverable wbs_id for deliverable ${deliverable.id}: ${JSON.stringify(blockWbs.wbs_id)}`
        );
      }
      const wbsCode = wbsCodeById.get(wbsIdNum);
      if (!wbsCode || String(wbsCode).trim() === "" || wbsCode === rootWbsCode) {
        throw new Error(
          `Export: invalid deliverable WBS Code for deliverable ${deliverable.id} (wbs_id=${wbsIdNum}): ${JSON.stringify(wbsCode)}`
        );
      }

      const deliverableExportId = allocateId("deliverable");
      pushActivityRow(
        deliverableExportId,
        deliverable.name,
        deliverable[durationField],
        deliverable.assignedResources,
        wbsCode,
        blockWbs.wbs_name,
        stdP6Row(fragnet.id, deliverable.id, "DELIVERABLE", deliverable.id)
      );

      // Step A — attach specific activities (only those already assigned to this deliverable)
      const specificActivities = fragnet.activities.filter(
        (a) => a.deliverableId === deliverable.id && !genericActivities.some((g) => g.id === a.id)
      );
      // Step B — attach generic activities (cloned per deliverable, never reused)
      const clonedGenericActivities = genericActivities.map((g) => ({
        ...g,
        id: `${deliverable.id}-${g.id}`,
        deliverableId: deliverable.id,
      }));

      const deliverableActivities = [...specificActivities, ...clonedGenericActivities];
      const sortedActivities = sortByCreatedAt(
        Array.from(new Map(deliverableActivities.map((a) => [a.id, a])).values())
      );

      const entryActivity = findEntryActivity(sortedActivities, fragnet.relationships);

      const activityMapInBlock = new Map<string, string>();
      sortedActivities.forEach((a) => {
        const exportId = allocateId("activity");
        activityMapInBlock.set(a.id, exportId);

        // Relationships are stored against ORIGINAL activity ids (those in `fragnet.relationships`).
        // But generic activities are CLONED per deliverable with id `${deliverable.id}-${originalId}`.
        // So we must also map originalId → exportId to keep TASKPRED populated.
        const prefix = `${deliverable.id}-`;
        if (String(a.id).startsWith(prefix)) {
          const originalId = String(a.id).slice(prefix.length);
          if (originalId) activityMapInBlock.set(originalId, exportId);
        }
      });
      sortedActivities.forEach((a) => {
        pushActivityRow(
          activityMapInBlock.get(a.id)!,
          a.name,
          a[durationField],
          a.assignedResources,
          wbsCode,
          blockWbs.wbs_name,
          stdP6Row(fragnet.id, deliverable.id, "ACTIVITY", a.id)
        );
      });

      fragnet.relationships.forEach((r) => {
        const predId = activityMapInBlock.get(r.predecessorActivityId);
        const succId = activityMapInBlock.get(r.successorActivityId);
        if (predId && succId) {
          taskPredDataRows.push([predId, succId, r.relationshipType, projectId, projectId, r.lag, null]);
        }
      });

      // Link deliverable row to the first activity in the block (FS, 0).
      // Use entryActivity (no predecessor within this deliverable's activity set) as "first".
      if (entryActivity) {
        const firstActivityExportId = activityMapInBlock.get(entryActivity.id);
        if (firstActivityExportId) {
          taskPredDataRows.push([deliverableExportId, firstActivityExportId, "FS", projectId, projectId, 0, null]);
        }
      }
    }
  }

  const { dbHeaders: taskDbHeaders, userHeaders: taskUserHeaders, typeIdsOrdered } = buildTaskSheetHeaders(activityCatalog);
  const taskDataRows = buildSemanticTaskDataRows({
    pendingTaskRows: pendingSemanticRows,
    catalog: activityCatalog,
    typeIdsOrdered,
  });

  if (droppedActivityRows.length > 0) {
    console.warn("[export] Dropped invalid TASK rows", { count: droppedActivityRows.length });
  }

  console.info("[export] Generated TASK rows", {
    taskRows: taskDataRows.length,
  });

  const taskAoa = [taskDbHeaders, taskUserHeaders, ...taskDataRows];
  const taskPredAoa = [TASKPRED_DB_HEADERS, TASKPRED_USER_HEADERS, ...taskPredDataRows];

  const workbook = XLSX.utils.book_new();
  const taskSheet = XLSX.utils.aoa_to_sheet(taskAoa);
  const taskPredSheet = XLSX.utils.aoa_to_sheet(taskPredAoa);

  XLSX.utils.book_append_sheet(workbook, taskSheet, "TASK");
  XLSX.utils.book_append_sheet(workbook, taskPredSheet, "TASKPRED");

  if (rateCardEntries.length > 0) {
    const rsrcDataRows = buildRsrcDataRows(p6Resources.resources);
    const rsrcAoa = [
      RSRC_DB_HEADERS as unknown as string[],
      RSRC_USER_HEADERS as unknown as string[],
      ...rsrcDataRows,
    ];
    const rsrcSheet = XLSX.utils.aoa_to_sheet(rsrcAoa);
    const rsrcLastRow0 = 1 + rsrcDataRows.length;
    rsrcSheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: rsrcLastRow0, c: RSRC_DB_HEADERS.length - 1 },
      }),
    };
    XLSX.utils.book_append_sheet(workbook, rsrcSheet, "RSRC");
  }

  assertUniqueTaskCodesInSheet(taskDataRows);
  assertEveryTaskHasWbsPath(taskDataRows);

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { buffer, pendingSemanticRows };
}
