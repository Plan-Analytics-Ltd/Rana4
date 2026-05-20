/**
 * P6 XER validation audit (static/structural).
 *
 * Notes:
 * - This does NOT import into Primavera P6 (manual step required).
 * - It generates a fresh XER from current generator code and validates:
 *   - required tables exist
 *   - id uniqueness
 *   - foreign-key style references resolve
 *   - relationship types valid
 *   - durations > 0
 *   - basic cost numeric checks
 *
 * Run:
 *   npm run build
 *   node scripts/p6-xer-audit.mjs
 */
import "dotenv/config";
import { buildWbsForFragnetExport } from "../dist/services/wbsGenerate.service.js";
import { buildXerAlignedWbsCodeMap } from "../dist/services/wbsHumanReadable.service.js";
import { generateFragnetXlsx } from "../dist/services/export.service.js";
import { generateXERWithWBS } from "../dist/services/xerTemplateInject.service.js";
import * as XLSX from "xlsx";

function parseXerTables(xerText) {
  const lines = xerText.split(/\r?\n/).filter((l) => l.length > 0);
  /** @type {Map<string, { fields: string[], rows: string[][] }>} */
  const tables = new Map();
  let current = null;
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts[0] === "%T") {
      current = parts[1] ?? "";
      if (current) tables.set(current, { fields: [], rows: [] });
      continue;
    }
    if (!current) continue;
    const t = tables.get(current);
    if (!t) continue;
    if (parts[0] === "%F") {
      t.fields = parts.slice(1);
      continue;
    }
    if (parts[0] === "%R") {
      t.rows.push(parts.slice(1));
      continue;
    }
  }
  return tables;
}

function indexByField(table, fieldName) {
  const idx = table.fields.indexOf(fieldName);
  if (idx < 0) throw new Error(`missing field ${fieldName}`);
  const set = new Set();
  for (const r of table.rows) set.add(String(r[idx] ?? ""));
  return { idx, set };
}

function assertNoDuplicateIds(tableName, table, idField) {
  const idx = table.fields.indexOf(idField);
  if (idx < 0) throw new Error(`${tableName}: missing id field ${idField}`);
  const seen = new Set();
  const dups = new Set();
  for (const r of table.rows) {
    const v = String(r[idx] ?? "");
    if (!v) continue;
    if (seen.has(v)) dups.add(v);
    seen.add(v);
  }
  return { ok: dups.size === 0, duplicates: [...dups] };
}

function asNumber(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validateReferences({ fromTableName, fromTable, fromField, toTableName, toIds }) {
  const idx = fromTable.fields.indexOf(fromField);
  if (idx < 0) return { ok: false, missingField: true, missing: [] };
  const missing = [];
  for (const r of fromTable.rows) {
    const v = String(r[idx] ?? "");
    if (!v) continue;
    if (!toIds.has(v)) missing.push(v);
  }
  return { ok: missing.length === 0, missingField: false, missing };
}

async function generateFixtureXer({ seedTag }) {
  // In-memory fixture: avoids DB dependency (so audit can run even when DB is offline).
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const companyId = "company-audit";
  const fragnetId = `fragnet-${seedTag}`;
  const deliverableId = `del-${seedTag}`;
  const a1Id = `act-${seedTag}-1`;
  const a2Id = `act-${seedTag}-2`;

  const deliverablesForExport = [
    {
      id: deliverableId,
      name: "Pkg",
      bestDuration: 2,
      likelyDuration: 3,
      createdAt,
      assignedResources: [{ resourceType: "Labor", resourceName: "Engineer", units: 4 }],
    },
  ];
  const activitiesForExport = [
    {
      id: a1Id,
      deliverableId,
      name: "Act1",
      bestDuration: 1,
      likelyDuration: 2,
      createdAt,
      assignedResources: [
        { resourceType: "Labor", resourceName: "Engineer", units: 8 },
        { resourceType: "Material", resourceName: "Concrete", units: 1 },
      ],
    },
    {
      id: a2Id,
      deliverableId,
      name: "Act2",
      bestDuration: 1,
      likelyDuration: 1,
      createdAt,
      assignedResources: [],
    },
  ];
  const relationships = [
    { predecessorActivityId: a1Id, successorActivityId: a2Id, relationshipType: "FS", lag: 1 },
  ];

  const deliverablesWithActivities = [
    {
      id: deliverableId,
      name: "Pkg",
      createdAt,
      fragnetId,
      projectId: "proj-audit",
      externalProjectId: seedTag,
      bestDuration: 2,
      likelyDuration: 3,
      activities: [
        { id: a1Id, deliverableId, activityCode: "A1", name: "Act1", bestDuration: 1, likelyDuration: 2, createdAt, fragnetId, projectId: "proj-audit" },
        { id: a2Id, deliverableId, activityCode: "A2", name: "Act2", bestDuration: 1, likelyDuration: 1, createdAt, fragnetId, projectId: "proj-audit" },
      ],
    },
  ];

  const generatedWbs = buildWbsForFragnetExport("Audit Project", { id: fragnetId, name: "F" }, deliverablesWithActivities);
  const wbsCodeById = buildXerAlignedWbsCodeMap(generatedWbs, "PROJ-AUDIT");

  const { buffer, pendingSemanticRows, taskPredExportRows } = await generateFragnetXlsx(
    generatedWbs,
    deliverablesForExport,
    activitiesForExport,
    relationships,
    "best",
    "PROJ-AUDIT",
    "PROJ-AUDIT",
    [
      { resourceType: "Labor", resourceName: "Engineer", unit: "hr", rate: 100, rsrcShortName: "PLARES-1" },
      { resourceType: "Material", resourceName: "Concrete", unit: "day", rate: 400, rsrcShortName: "PLARES-2" },
    ],
    undefined
  );
  // Sanity: xlsx parse should succeed.
  XLSX.read(buffer, { type: "buffer" });

  // Rate-card entries as the generator expects them (includes rsrcShortName).
  const rateCardEntries = [
    { resourceType: "Labor", resourceName: "Engineer", unit: "hr", rate: 100, rsrcShortName: "PLARES-1" },
    { resourceType: "Material", resourceName: "Concrete", unit: "day", rate: 400, rsrcShortName: "PLARES-2" },
  ];

  const xerString = await generateXERWithWBS(generatedWbs, "Audit Project", "PROJ-AUDIT", rateCardEntries, {
    xerDeterministicScope: "xer-audit:fixed-scope",
    pendingSemanticTaskRows: pendingSemanticRows,
    taskPredExportRows,
  });

  return { xer: xerString };
}

function validateXer(xerText) {
  const tables = parseXerTables(xerText);

  const requiredTables = ["TASK", "ACTVTYPE", "ACTVCODE", "TASKACTV", "PROJECT", "PROJWBS", "CALENDAR", "RSRC", "RSRCRATE", "TASKRSRC", "TASKPRED"];
  const tablePresence = Object.fromEntries(requiredTables.map((t) => [t, tables.has(t)]));

  const issues = [];
  for (const t of requiredTables) {
    if (!tables.has(t)) issues.push({ code: "missing_table", table: t });
  }
  if (issues.length > 0) return { ok: false, tablePresence, issues, tables };

  const TASK = tables.get("TASK");
  const ACTVTYPE = tables.get("ACTVTYPE");
  const ACTVCODE = tables.get("ACTVCODE");
  const TASKACTV = tables.get("TASKACTV");
  const RSRC = tables.get("RSRC");
  const RSRCRATE = tables.get("RSRCRATE");
  const TASKRSRC = tables.get("TASKRSRC");
  const TASKPRED = tables.get("TASKPRED");
  const PROJECT = tables.get("PROJECT");

  const taskIds = indexByField(TASK, "task_id").set;
  const actvTypeIds = indexByField(ACTVTYPE, "actv_code_type_id").set;
  const actvCodeIds = indexByField(ACTVCODE, "actv_code_id").set;
  const rsrcIds = indexByField(RSRC, "rsrc_id").set;
  const projIds = indexByField(PROJECT, "proj_id").set;

  const dupChecks = [
    ["TASK", assertNoDuplicateIds("TASK", TASK, "task_id")],
    ["ACTVTYPE", assertNoDuplicateIds("ACTVTYPE", ACTVTYPE, "actv_code_type_id")],
    ["ACTVCODE", assertNoDuplicateIds("ACTVCODE", ACTVCODE, "actv_code_id")],
    ["TASKACTV", assertNoDuplicateIds("TASKACTV", TASKACTV, "taskactv_id")],
    ["RSRC", assertNoDuplicateIds("RSRC", RSRC, "rsrc_id")],
    ["RSRCRATE", assertNoDuplicateIds("RSRCRATE", RSRCRATE, "rsrc_rate_id")],
    ["TASKRSRC", assertNoDuplicateIds("TASKRSRC", TASKRSRC, "taskrsrc_id")],
    ["TASKPRED", assertNoDuplicateIds("TASKPRED", TASKPRED, "task_pred_id")],
  ];
  for (const [name, r] of dupChecks) {
    if (!r.ok) issues.push({ code: "duplicate_ids", table: name, duplicates: r.duplicates.slice(0, 20) });
  }

  // TASKACTV references
  const taskactv_task = validateReferences({ fromTableName: "TASKACTV", fromTable: TASKACTV, fromField: "task_id", toTableName: "TASK", toIds: taskIds });
  const taskactv_type = validateReferences({ fromTableName: "TASKACTV", fromTable: TASKACTV, fromField: "actv_code_type_id", toTableName: "ACTVTYPE", toIds: actvTypeIds });
  const taskactv_code = validateReferences({ fromTableName: "TASKACTV", fromTable: TASKACTV, fromField: "actv_code_id", toTableName: "ACTVCODE", toIds: actvCodeIds });
  if (!taskactv_task.ok) issues.push({ code: "orphan_ref", from: "TASKACTV.task_id", to: "TASK.task_id", missingCount: taskactv_task.missing.length });
  if (!taskactv_type.ok) issues.push({ code: "orphan_ref", from: "TASKACTV.actv_code_type_id", to: "ACTVTYPE.actv_code_type_id", missingCount: taskactv_type.missing.length });
  if (!taskactv_code.ok) issues.push({ code: "orphan_ref", from: "TASKACTV.actv_code_id", to: "ACTVCODE.actv_code_id", missingCount: taskactv_code.missing.length });

  // TASKRSRC references
  const taskrsrc_task = validateReferences({ fromTableName: "TASKRSRC", fromTable: TASKRSRC, fromField: "task_id", toTableName: "TASK", toIds: taskIds });
  const taskrsrc_proj = validateReferences({ fromTableName: "TASKRSRC", fromTable: TASKRSRC, fromField: "proj_id", toTableName: "PROJECT", toIds: projIds });
  const taskrsrc_rsrc = validateReferences({ fromTableName: "TASKRSRC", fromTable: TASKRSRC, fromField: "rsrc_id", toTableName: "RSRC", toIds: rsrcIds });
  if (!taskrsrc_task.ok) issues.push({ code: "orphan_ref", from: "TASKRSRC.task_id", to: "TASK.task_id", missingCount: taskrsrc_task.missing.length });
  if (!taskrsrc_proj.ok) issues.push({ code: "orphan_ref", from: "TASKRSRC.proj_id", to: "PROJECT.proj_id", missingCount: taskrsrc_proj.missing.length });
  if (!taskrsrc_rsrc.ok) issues.push({ code: "orphan_ref", from: "TASKRSRC.rsrc_id", to: "RSRC.rsrc_id", missingCount: taskrsrc_rsrc.missing.length });

  // TASKPRED references + types
  const taskpred_task = validateReferences({ fromTableName: "TASKPRED", fromTable: TASKPRED, fromField: "task_id", toTableName: "TASK", toIds: taskIds });
  const taskpred_pred = validateReferences({ fromTableName: "TASKPRED", fromTable: TASKPRED, fromField: "pred_task_id", toTableName: "TASK", toIds: taskIds });
  if (!taskpred_task.ok) issues.push({ code: "orphan_ref", from: "TASKPRED.task_id", to: "TASK.task_id", missingCount: taskpred_task.missing.length });
  if (!taskpred_pred.ok) issues.push({ code: "orphan_ref", from: "TASKPRED.pred_task_id", to: "TASK.task_id", missingCount: taskpred_pred.missing.length });

  const predTypeIdx = TASKPRED.fields.indexOf("pred_type");
  if (predTypeIdx >= 0) {
    const allowed = new Set(["PR_FS", "PR_SS", "PR_FF", "PR_SF"]);
    const bad = [];
    for (const r of TASKPRED.rows) {
      const v = String(r[predTypeIdx] ?? "");
      if (v && !allowed.has(v)) bad.push(v);
    }
    if (bad.length > 0) issues.push({ code: "invalid_pred_type", bad: [...new Set(bad)].slice(0, 20) });
  }

  // Durations > 0
  for (const f of ["target_drtn_hr_cnt", "remain_drtn_hr_cnt"]) {
    const idx = TASK.fields.indexOf(f);
    if (idx < 0) {
      issues.push({ code: "missing_field", table: "TASK", field: f });
      continue;
    }
    const zeros = TASK.rows.filter((r) => {
      const n = asNumber(r[idx]);
      return n === null || n <= 0;
    });
    if (zeros.length > 0) issues.push({ code: "non_positive_duration", field: f, count: zeros.length });
  }

  // Costs numeric
  for (const f of ["target_cost", "remain_cost", "target_qty", "remain_qty"]) {
    const idx = TASKRSRC.fields.indexOf(f);
    if (idx < 0) continue;
    const bad = TASKRSRC.rows.filter((r) => {
      const n = asNumber(r[idx]);
      return n === null;
    });
    if (bad.length > 0) issues.push({ code: "non_numeric_taskrsrc", field: f, count: bad.length });
  }

  // RSRC short name unique (within RSRC table)
  const shortIdx = RSRC.fields.indexOf("rsrc_short_name");
  if (shortIdx >= 0) {
    const seen = new Set();
    const dup = new Set();
    for (const r of RSRC.rows) {
      const v = String(r[shortIdx] ?? "");
      if (!v) continue;
      if (seen.has(v)) dup.add(v);
      seen.add(v);
    }
    if (dup.size > 0) issues.push({ code: "duplicate_rsrc_short_name", count: dup.size });
  }

  return { ok: issues.length === 0, tablePresence, issues, tables };
}

async function main() {
  const seed = `audit-${Date.now()}`;
  const a = await generateFixtureXer({ seedTag: seed });
  const b = await generateFixtureXer({ seedTag: seed }); // same seedTag but fresh DB rows; ids should be deterministic in XER based on codes + scope

  const va = validateXer(a.xer);
  const vb = validateXer(b.xer);
  const stability = a.xer === b.xer;

  const out = {
    generated: { sizeA: a.xer.length, sizeB: b.xer.length, stableExactText: stability },
    validateA: { ok: va.ok, tablePresence: va.tablePresence, issues: va.issues },
    validateB: { ok: vb.ok, tablePresence: vb.tablePresence, issues: vb.issues },
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

