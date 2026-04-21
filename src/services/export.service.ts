/**
 * Excel (.xlsx) export for a single Fragnet.
 * Structure and columns match Primavera P6 Spreadsheet Import template.
 *
 * If NO deliverables: export activities normally (TASK = activities, TASKPRED = relationships).
 * TASK `wbs_id` / `wbs_name` come from {@link buildWbsFromDeliverables} (project root + deliverable nodes), not a flat constant.
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
import { buildP6ResourceMap } from "./p6ResourceMap.service.js";

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

/** P6 TASK sheet: row = [task_code, task_name, status_code, wbs_id, proj_id, orig_dur_hr_cnt, delete_record_flag]. Duration: days → hours (8h/day). */
/**
 * P6 TASK sheet headers (match Primavera export template).
 * Row 1: P6 field names
 * Row 2: Human-friendly column labels
 */
const TASK_DB_HEADERS = [
  "task_code",
  "status_code",
  "wbs_id",
  "wbs_name",
  "task_name",
  "start_date",
  "end_date",
  "orig_dur_hr_cnt",
  "remain_drtn_hr_cnt",
  "total_float_hr_cnt",
  "delete_record_flag",
] as const;
const TASK_USER_HEADERS = [
  "Activity ID",
  "Activity Status",
  "WBS Code",
  "WBS Name",
  "Activity Name",
  "Start",
  "Finish",
  "Original Duration (hr)",
  "Remaining Duration (hr)",
  "Total Float (hr)",
  "Delete This Row",
] as const;
const ACTIVITY_STATUS = "Not Started";

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

/**
 * P6 TASKRSRC sheet (task–resource assignments), matching Primavera spreadsheet template.
 * Row 1: technical keys; Row 2: labels (with (*) and (h) as in P6 export).
 */
// Note: first column contains `rsrc_short_name` values (e.g. PLARES-1) used for linking to XER.
// This header label is kept as `rsrc_id` per export template expectations.
const TASKRSRC_DB_HEADERS = ["rsrc_id", "task_id", "TASK__status_code", "rsrc_type", "target_qty"] as const;
const TASKRSRC_USER_HEADERS = [
  "Resource ID",
  "Activity ID",
  "(*)Activity Status",
  "(*)Resource Type",
  "Budgeted Units(h)",
] as const;

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
    console.log("[export] RSRC short names (Resource Name → rsrc_short_name):");
    // Stable output order: by resource name
    const rows = [...nameToShort.entries()]
      .map(([k, v]) => ({ name: k, short: v }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const r of rows) console.log(`  ${r.name} → ${r.short}`);
    for (const d of duplicatesResolved) {
      console.warn(`[export] RSRC short name duplicate resolved: base ${d.base} used; "${d.name}" assigned ${d.resolved}`);
    }
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
    console.log("[export] RSRC Resource ID mapping (Resource Name → Resource ID):");
    const rows = [...nameToId.entries()]
      .map(([name, id]) => ({ name, id }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const r of rows) console.log(`  ${r.name} → ${r.id}`);
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
    console.log("[export] RSRC rsrc_id mapping (Resource Name → rsrc_id):");
    const rows = [...nameToId.entries()]
      .map(([name, id]) => ({ name, id }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const r of rows) console.log(`  ${r.name} → ${r.id}`);
  };

  return { getId, logMapping };
}

/** Default resource units: activity duration (days) → hours at 8h/day. */
function defaultUnitsFromDurationDays(durationDays: number): number {
  return durationDays * 8;
}

export type ExportScenario = "best" | "likely";

/**
 * Generate xlsx buffer for fragnet export (P6 Spreadsheet Import format).
 * - Two header rows per sheet: database field names, then user-friendly names.
 * - TASK: task_code, task_name, status_code, wbs_id, proj_id, orig_dur_hr_cnt, delete_record_flag.
 * - TASKPRED: pred_task_id, task_id, pred_type, pred_proj_id, proj_id, lag_hr_cnt, delete_record_flag.
 * - RSRC (only if rate card has rows): rsrc_short_name, rsrc_name, rsrc_type, unit_id, role_id, def_qty_per_hr, rate.
 * - TASKRSRC: rsrc_id, task_id, TASK__status_code, rsrc_type, target_qty (P6 template; autofilter on data range).
 * - Block duplication per deliverable unchanged; empty rows only in TASK.
 */
export function generateFragnetXlsx(
  generatedWbs: GeneratedWbs,
  deliverables: DeliverableForExport[],
  activities: ActivityForExport[],
  relationships: RelationshipForExport[],
  scenario: ExportScenario,
  projectId: string,
  projectNameForWbsCode: string,
  unassignedDeliverables?: DeliverableForExport[],
  rateCardEntries: RateCardEntry[] = []
): Buffer {
  // WBS Code numbering must align with XER WBS structure:
  // root is "1", deliverables start at ".2", ".3", ...
  const wbsCodeNumberForPosition = (pos1: number): number => {
    if (!Number.isInteger(pos1) || pos1 < 1) return pos1;
    return pos1 + 1;
  };

  const durationField = scenario === "best" ? "bestDuration" : "likelyDuration";
  const taskDataRows: (string | number | null)[][] = [];
  const taskPredDataRows: (string | number | null)[][] = [];
  const taskrsrcDataRows: (string | number)[][] = [];
  let nextId = 1000;
  const sortedActivities = sortByCreatedAt(activities);
  const entryActivity = findEntryActivity(activities, relationships);
  const rootWbs = generatedWbs.project_wbs;
  const deliverableWbsById = deliverableWbsLookupFromGenerated(generatedWbs);

  const p6Resources = buildP6ResourceMap(rateCardEntries);
  const resourceKey = (type: string, name: string): string =>
    `${String(type ?? "").trim().toLowerCase()}|${String(name ?? "").trim().toLowerCase()}`;

  const droppedActivityRows: { reason: string; id: string; name: unknown; duration: unknown }[] = [];
  const pushActivityRow = (
    exportId: string,
    rawName: unknown,
    rawDurationDays: unknown,
    assigned: AssignedResourceStored[],
    wbsId: string,
    wbsName: string
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
    // Intentionally write raw user input into the P6 hour fields (format compatibility),
    // with no conversion/multiplication.
    const durationHours = rawDurationDays;
    if (!Number.isFinite(durationHours)) {
      droppedActivityRows.push({ reason: "invalid converted duration", id: exportId, name: rawName, duration: rawDurationDays });
      return;
    }
    // Keep columns aligned with TASK_DB_HEADERS / TASK_USER_HEADERS
    taskDataRows.push([
      exportId, // task_code
      ACTIVITY_STATUS, // status_code
      wbsId, // wbs_id
      wbsName, // wbs_name
      activityName, // task_name
      null, // start_date
      null, // end_date
      durationHours, // orig_dur_hr_cnt (raw user input)
      durationHours, // remain_drtn_hr_cnt (raw user input)
      0, // total_float_hr_cnt
      null, // delete_record_flag
    ]);

    const defaultUnits = defaultUnitsFromDurationDays(rawDurationDays);
    for (const ar of assigned) {
      const r = p6Resources.byTypeName.get(resourceKey(ar.resourceType, ar.resourceName));
      if (!r) {
        throw new Error(`TASKRSRC export: resource not found in rate card map: ${ar.resourceType} / ${ar.resourceName}`);
      }
      const units = ar.units ?? defaultUnits;
      taskrsrcDataRows.push([
        r.rsrc_short_name, // Resource ID / rsrc_short_name (must match XER.RSRC.rsrc_short_name)
        exportId, // Activity ID / task_id
        ACTIVITY_STATUS, // TASK__status_code
        RSRC_RESOURCE_TYPE, // rsrc_type (fixed)
        units, // target_qty — budgeted hours
      ]);
    }
  };

  if (deliverables.length === 0) {
    // No deliverables: export activities under the project root WBS only.
    const activityMap = new Map<string, string>();
    sortedActivities.forEach((a, idx) => {
      activityMap.set(a.id, `A${1000 + idx}`);
    });
    nextId = 1000 + sortedActivities.length;
    sortedActivities.forEach((a) => {
      pushActivityRow(
        activityMap.get(a.id)!,
        a.name,
        a[durationField],
        a.assignedResources,
        String(rootWbs.wbs_id),
        rootWbs.wbs_name
      );
    });
    relationships.forEach((r) => {
      const predId = activityMap.get(r.predecessorActivityId) ?? r.predecessorActivityId;
      const succId = activityMap.get(r.successorActivityId) ?? r.successorActivityId;
      // Keep lag value as-is (no conversion) while still using lag_hr_cnt field name.
      taskPredDataRows.push([predId, succId, r.relationshipType, projectId, projectId, r.lag, null]);
    });
  } else {
    // Block-based duplication per deliverable
    const sortedDeliverables = sortByCreatedAt(deliverables);

    for (let i = 0; i < sortedDeliverables.length; i++) {
      const d = sortedDeliverables[i];
      const blockWbs = deliverableWbsById.get(d.id);
      if (!blockWbs) {
        throw new Error(`Export: deliverable ${d.id} missing from generated WBS map`);
      }
      const wbsCode = `${projectNameForWbsCode}.${wbsCodeNumberForPosition(i + 1)}`;

      const deliverableExportId = `A${nextId++}`;
      pushActivityRow(
        deliverableExportId,
        d.name,
        d[durationField],
        d.assignedResources,
        wbsCode,
        blockWbs.wbs_name
      );

      const activityMapInBlock = new Map<string, string>();
      sortedActivities.forEach((a) => {
        activityMapInBlock.set(a.id, `A${nextId++}`);
      });
      sortedActivities.forEach((a) => {
        pushActivityRow(
          activityMapInBlock.get(a.id)!,
          a.name,
          a[durationField],
          a.assignedResources,
          wbsCode,
          blockWbs.wbs_name
        );
      });

      if (entryActivity) {
        const entryExportId = activityMapInBlock.get(entryActivity.id);
        if (entryExportId) {
          taskPredDataRows.push([deliverableExportId, entryExportId, "FS", projectId, projectId, 0, null]);
        }
      }

      relationships.forEach((r) => {
        const predId = activityMapInBlock.get(r.predecessorActivityId);
        const succId = activityMapInBlock.get(r.successorActivityId);
        if (predId && succId) {
          taskPredDataRows.push([predId, succId, r.relationshipType, projectId, projectId, r.lag, null]);
        }
      });

      // No blank separator rows: P6 import can mis-read after empty lines
    }
  }

  // Append blocks for unassigned deliverables (no fragnet)
  if (unassignedDeliverables && unassignedDeliverables.length > 0) {
    const sortedUnassigned = sortByCreatedAt(unassignedDeliverables);
    let maxWbsId = generatedWbs.project_wbs.wbs_id;
    for (const s of generatedWbs.deliverable_wbs_list) {
      maxWbsId = Math.max(maxWbsId, s.wbs_id);
    }
    let unassignedSeq = 0;
    // No blank separator rows
    for (let i = 0; i < sortedUnassigned.length; i++) {
      const d = sortedUnassigned[i];
      unassignedSeq += 1;
      const wbsIdNum = maxWbsId + unassignedSeq;
      const unassignedWbs = { wbs_id: String(wbsIdNum), wbs_name: d.name };
      const pos1 = (deliverables?.length ?? 0) + unassignedSeq;
      const wbsCode = `${projectNameForWbsCode}.${wbsCodeNumberForPosition(pos1)}`;
      const deliverableExportId = `A${nextId++}`;
      pushActivityRow(
        deliverableExportId,
        d.name,
        d[durationField],
        d.assignedResources,
        wbsCode,
        unassignedWbs.wbs_name
      );
      const activityMapInBlock = new Map<string, string>();
      sortedActivities.forEach((a) => {
        activityMapInBlock.set(a.id, `A${nextId++}`);
      });
      sortedActivities.forEach((a) => {
        pushActivityRow(
          activityMapInBlock.get(a.id)!,
          a.name,
          a[durationField],
          a.assignedResources,
          wbsCode,
          unassignedWbs.wbs_name
        );
      });
      if (entryActivity) {
        const entryExportId = activityMapInBlock.get(entryActivity.id);
        if (entryExportId) {
          taskPredDataRows.push([deliverableExportId, entryExportId, "FS", projectId, projectId, 0, null]);
        }
      }
      relationships.forEach((r) => {
        const predId = activityMapInBlock.get(r.predecessorActivityId);
        const succId = activityMapInBlock.get(r.successorActivityId);
        if (predId && succId) {
          taskPredDataRows.push([predId, succId, r.relationshipType, projectId, projectId, r.lag, null]);
        }
      });
      // No blank separator rows
    }
  }

  // Debug logging (requested): headers, sample conversions, dropped rows
  console.log("[export] TASK headers row1:", TASK_DB_HEADERS);
  console.log("[export] TASK headers row2:", TASK_USER_HEADERS);
  const sample = taskDataRows.filter((r) => r[0] !== "").slice(0, 5);
  console.log("[export] TASK sample rows (first 5):", sample);
  if (droppedActivityRows.length > 0) {
    console.warn("[export] Dropped invalid TASK rows:", droppedActivityRows.slice(0, 20));
    if (droppedActivityRows.length > 20) {
      console.warn(`[export] Dropped invalid TASK rows: ${droppedActivityRows.length} total (showing first 20)`);
    }
  }

  console.log("[export] TASKRSRC sheet rows:", taskrsrcDataRows.length);
  console.log("[export] TASKRSRC sample (first 5):", taskrsrcDataRows.slice(0, 5));

  const taskAoa = [TASK_DB_HEADERS as unknown as string[], TASK_USER_HEADERS as unknown as string[], ...taskDataRows];
  const taskPredAoa = [TASKPRED_DB_HEADERS, TASKPRED_USER_HEADERS, ...taskPredDataRows];
  const taskrsrcAoa = [
    TASKRSRC_DB_HEADERS as unknown as string[],
    TASKRSRC_USER_HEADERS as unknown as string[],
    ...taskrsrcDataRows,
  ];

  const workbook = XLSX.utils.book_new();
  const taskSheet = XLSX.utils.aoa_to_sheet(taskAoa);
  const taskPredSheet = XLSX.utils.aoa_to_sheet(taskPredAoa);
  const taskrsrcSheet = XLSX.utils.aoa_to_sheet(taskrsrcAoa);

  const taskrsrcLastRow0 = 1 + taskrsrcDataRows.length;
  taskrsrcSheet["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: taskrsrcLastRow0, c: TASKRSRC_DB_HEADERS.length - 1 } }),
  };

  XLSX.utils.book_append_sheet(workbook, taskSheet, "TASK");
  XLSX.utils.book_append_sheet(workbook, taskPredSheet, "TASKPRED");

  XLSX.utils.book_append_sheet(workbook, taskrsrcSheet, "TASKRSRC");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
