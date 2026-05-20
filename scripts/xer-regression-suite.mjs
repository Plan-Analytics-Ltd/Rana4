/**
 * XER export regression suite — structural integrity + deterministic output.
 *
 * Run:
 *   npm run build
 *   npm run test:xer-regression
 */
import "dotenv/config";
import { buildWbsForFragnetExport } from "../dist/services/wbsGenerate.service.js";
import { buildXerAlignedWbsCodeMap } from "../dist/services/wbsHumanReadable.service.js";
import { generateFragnetXlsx } from "../dist/services/export.service.js";
import { generateXERWithWBS } from "../dist/services/xerTemplateInject.service.js";
import * as XLSX from "xlsx";

function parseXerTables(xerText) {
  const lines = xerText.split(/\r?\n/).filter((l) => l.length > 0);
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

function validateReferences({ fromTable, fromField, toIds }) {
  const idx = fromTable.fields.indexOf(fromField);
  if (idx < 0) return { ok: false, missing: [] };
  const missing = [];
  for (const r of fromTable.rows) {
    const v = String(r[idx] ?? "");
    if (!v) continue;
    if (!toIds.has(v)) missing.push(v);
  }
  return { ok: missing.length === 0, missing };
}

function validateXer(xerText) {
  const tables = parseXerTables(xerText);
  const coreTables = ["TASK", "PROJECT", "PROJWBS", "CALENDAR", "RSRC", "RSRCRATE", "TASKRSRC", "TASKPRED"];
  const issues = [];
  for (const t of coreTables) {
    if (!tables.has(t)) issues.push({ code: "missing_table", table: t });
  }
  if (issues.length > 0) return { ok: false, issues };

  const TASK = tables.get("TASK");
  const TASKPRED = tables.get("TASKPRED");
  const TASKRSRC = tables.get("TASKRSRC");
  const RSRC = tables.get("RSRC");
  const TASKACTV = tables.has("TASKACTV") ? tables.get("TASKACTV") : null;
  const ACTVTYPE = tables.has("ACTVTYPE") ? tables.get("ACTVTYPE") : null;
  const ACTVCODE = tables.has("ACTVCODE") ? tables.get("ACTVCODE") : null;

  const taskIds = indexByField(TASK, "task_id").set;
  const rsrcIds = indexByField(RSRC, "rsrc_id").set;

  for (const [name, table, field] of [
    ["TASK", TASK, "task_id"],
    ["TASKPRED", TASKPRED, "task_pred_id"],
    ["TASKRSRC", TASKRSRC, "taskrsrc_id"],
  ]) {
    const r = assertNoDuplicateIds(name, table, field);
    if (!r.ok) issues.push({ code: "duplicate_ids", table: name, duplicates: r.duplicates.slice(0, 10) });
  }
  if (TASKACTV) {
    const r = assertNoDuplicateIds("TASKACTV", TASKACTV, "taskactv_id");
    if (!r.ok) issues.push({ code: "duplicate_ids", table: "TASKACTV", duplicates: r.duplicates.slice(0, 10) });
  }

  const predTask = validateReferences({ fromTable: TASKPRED, fromField: "pred_task_id", toIds: taskIds });
  const succTask = validateReferences({ fromTable: TASKPRED, fromField: "task_id", toIds: taskIds });
  if (!predTask.ok) issues.push({ code: "orphan_pred", count: predTask.missing.length });
  if (!succTask.ok) issues.push({ code: "orphan_succ", count: succTask.missing.length });

  if (TASKACTV && ACTVTYPE && ACTVCODE) {
    const actvTypeIds = indexByField(ACTVTYPE, "actv_code_type_id").set;
    const actvCodeIds = indexByField(ACTVCODE, "actv_code_id").set;
    const taskactvTask = validateReferences({ fromTable: TASKACTV, fromField: "task_id", toIds: taskIds });
    const taskactvType = validateReferences({ fromTable: TASKACTV, fromField: "actv_code_type_id", toIds: actvTypeIds });
    const taskactvCode = validateReferences({ fromTable: TASKACTV, fromField: "actv_code_id", toIds: actvCodeIds });
    if (!taskactvTask.ok) issues.push({ code: "orphan_taskactv_task", count: taskactvTask.missing.length });
    if (!taskactvType.ok) issues.push({ code: "orphan_taskactv_type", count: taskactvType.missing.length });
    if (!taskactvCode.ok) issues.push({ code: "orphan_taskactv_code", count: taskactvCode.missing.length });
  }

  const taskrsrcTask = validateReferences({ fromTable: TASKRSRC, fromField: "task_id", toIds: taskIds });
  const taskrsrcRsrc = validateReferences({ fromTable: TASKRSRC, fromField: "rsrc_id", toIds: rsrcIds });
  if (!taskrsrcTask.ok) issues.push({ code: "orphan_taskrsrc_task", count: taskrsrcTask.missing.length });
  if (!taskrsrcRsrc.ok) issues.push({ code: "orphan_taskrsrc_rsrc", count: taskrsrcRsrc.missing.length });

  return { ok: issues.length === 0, issues };
}

async function generateFixture({ seedTag, withP6 = false, withLag = true }) {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const fragnetId = `fragnet-${seedTag}`;
  const deliverableId = `del-${seedTag}`;
  const a1Id = `act-${seedTag}-1`;
  const a2Id = `act-${seedTag}-2`;
  const a3Id = `act-${seedTag}-3`;

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
      assignedResources: [{ resourceType: "Labor", resourceName: "Engineer", units: 8 }],
    },
    {
      id: a2Id,
      deliverableId,
      name: "Act2",
      bestDuration: 2,
      likelyDuration: 2,
      createdAt,
      assignedResources: [],
    },
    {
      id: a3Id,
      deliverableId,
      name: "Act3",
      bestDuration: 1,
      likelyDuration: 1,
      createdAt,
      assignedResources: withP6 ? [{ resourceType: "Material", resourceName: "Concrete", units: 1 }] : [],
    },
  ];
  const relationships = [
    { predecessorActivityId: a1Id, successorActivityId: a2Id, relationshipType: "FS", lag: withLag ? 2 : 0 },
    { predecessorActivityId: a2Id, successorActivityId: a3Id, relationshipType: "SS", lag: 0 },
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
        { id: a2Id, deliverableId, activityCode: "A2", name: "Act2", bestDuration: 2, likelyDuration: 2, createdAt, fragnetId, projectId: "proj-audit" },
        { id: a3Id, deliverableId, activityCode: "A3", name: "Act3", bestDuration: 1, likelyDuration: 1, createdAt, fragnetId, projectId: "proj-audit" },
      ],
    },
  ];

  const generatedWbs = buildWbsForFragnetExport("Audit Project", { id: fragnetId, name: "F" }, deliverablesWithActivities);
  const rateCardEntries = [
    { resourceType: "Labor", resourceName: "Engineer", unit: "hr", rate: 100, rsrcShortName: "PLARES-1" },
    { resourceType: "Material", resourceName: "Concrete", unit: "day", rate: 400, rsrcShortName: "PLARES-2" },
  ];

  const { buffer, pendingSemanticRows, taskPredExportRows } = await generateFragnetXlsx(
    generatedWbs,
    deliverablesForExport,
    activitiesForExport,
    relationships,
    "best",
    "PROJ-AUDIT",
    "PROJ-AUDIT",
    rateCardEntries,
    undefined
  );
  XLSX.read(buffer, { type: "buffer" });

  const xerString = await generateXERWithWBS(generatedWbs, "Audit Project", "PROJ-AUDIT", rateCardEntries, {
    xerDeterministicScope: `xer-regression:${seedTag}`,
    pendingSemanticTaskRows: pendingSemanticRows,
    taskPredExportRows,
  });

  return { xer: xerString, seedTag };
}

async function main() {
  const cases = [
    { name: "baseline-fs-chain", seed: "reg-baseline", withP6: false, withLag: true },
    { name: "multi-rel-types", seed: "reg-multi", withP6: true, withLag: true },
    { name: "zero-lag", seed: "reg-zero-lag", withP6: false, withLag: false },
  ];

  const results = [];
  let failed = 0;

  for (const c of cases) {
    const a = await generateFixture({ seedTag: c.seed, withP6: c.withP6, withLag: c.withLag });
    const b = await generateFixture({ seedTag: c.seed, withP6: c.withP6, withLag: c.withLag });
    const va = validateXer(a.xer);
    const vb = validateXer(b.xer);
    const stable = a.xer === b.xer;
    const pass = va.ok && vb.ok && stable;
    if (!pass) failed++;
    results.push({
      case: c.name,
      pass,
      stableExactText: stable,
      size: a.xer.length,
      validateIssues: va.issues,
      validateIssuesB: vb.ok ? [] : vb.issues,
    });
  }

  const stabilityRun = await generateFixture({ seedTag: "reg-stability", withP6: true, withLag: true });
  const v = validateXer(stabilityRun.xer);
  if (!v.ok) failed++;

  console.log(
    JSON.stringify(
      {
        summary: { total: cases.length + 1, failed, passed: cases.length + 1 - failed },
        permutations: results,
        stability: { ok: v.ok, issues: v.issues, bytes: stabilityRun.xer.length },
      },
      null,
      2
    )
  );

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
