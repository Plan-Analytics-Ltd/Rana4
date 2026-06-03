/**
 * Structural validation for generated XER before download / P6 import.
 */

export type P6XerValidationIssue = {
  code: string;
  message: string;
};

type XerTable = { fields: string[]; rows: string[][] };

export function parseXerTables(xerText: string): Map<string, XerTable> {
  const lines = xerText.split(/\r?\n/).filter((l) => l.length > 0);
  const tables = new Map<string, XerTable>();
  let current: string | null = null;
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
    if (parts[0] === "%F") t.fields = parts.slice(1);
    else if (parts[0] === "%R") t.rows.push(parts.slice(1));
  }
  return tables;
}

function fieldIndex(table: XerTable, name: string): number {
  return table.fields.indexOf(name);
}

function colValues(table: XerTable, name: string): string[] {
  const idx = fieldIndex(table, name);
  if (idx < 0) return [];
  return table.rows.map((r) => String(r[idx] ?? "").trim());
}

const MAX_DUPLICATE_ID_REPORTS = 25;

function assertNoDuplicateIds(tableName: string, table: XerTable, idField: string, issues: P6XerValidationIssue[]): void {
  const idx = fieldIndex(table, idField);
  if (idx < 0) {
    issues.push({ code: "MISSING_FIELD", message: `${tableName}: missing column ${idField}` });
    return;
  }
  const seen = new Set<string>();
  let reported = 0;
  for (const r of table.rows) {
    const v = String(r[idx] ?? "").trim();
    if (!v) continue;
    if (seen.has(v)) {
      if (reported < MAX_DUPLICATE_ID_REPORTS) {
        issues.push({ code: "DUPLICATE_ID", message: `${tableName}: duplicate ${idField}=${v}` });
        reported += 1;
      }
      continue;
    }
    seen.add(v);
  }
}

function orphanRefs(
  fromTable: string,
  from: XerTable,
  fromField: string,
  toSet: Set<string>,
  issues: P6XerValidationIssue[]
): void {
  const idx = fieldIndex(from, fromField);
  if (idx < 0) {
    issues.push({ code: "MISSING_FIELD", message: `${fromTable}: missing column ${fromField}` });
    return;
  }
  for (const r of from.rows) {
    const v = String(r[idx] ?? "").trim();
    if (v && !toSet.has(v)) {
      issues.push({ code: "ORPHAN_REF", message: `${fromTable}.${fromField}=${v} references missing row` });
      return;
    }
  }
}

const REQUIRED_TABLES = [
  "PROJECT",
  "CALENDAR",
  "PROJWBS",
  "TASK",
  "TASKPRED",
  "RSRC",
  "RSRCRATE",
  "TASKRSRC",
] as const;

const ACTIVITY_CODE_TABLES = ["ACTVTYPE", "ACTVCODE", "TASKACTV"] as const;

const TASK_REQUIRED_FIELDS = [
  "task_id",
  "proj_id",
  "wbs_id",
  "clndr_id",
  "task_code",
  "task_name",
  "target_drtn_hr_cnt",
  "remain_drtn_hr_cnt",
  "phys_complete_pct",
  "task_type",
  "duration_type",
  "status_code",
] as const;

const PRED_TYPES = new Set(["PR_FS", "PR_SS", "PR_FF", "PR_SF"]);

/**
 * Validate a complete generated XER string. Throws on failure (export should not ship invalid files).
 */
export function assertValidGeneratedXer(xerText: string): void {
  const issues = collectXerValidationIssues(xerText);
  if (issues.length > 0) {
    throw new Error(`XER validation failed: ${issues.map((i) => i.message).join("; ")}`);
  }
}

export function collectXerValidationIssues(xerText: string): P6XerValidationIssue[] {
  const issues: P6XerValidationIssue[] = [];
  const tables = parseXerTables(xerText);

  for (const name of REQUIRED_TABLES) {
    if (!tables.has(name)) {
      issues.push({ code: "MISSING_TABLE", message: `XER missing required table ${name}` });
    }
  }
  if (issues.some((i) => i.code === "MISSING_TABLE")) return issues;

  const TASK = tables.get("TASK")!;
  const PROJWBS = tables.get("PROJWBS")!;
  const PROJECT = tables.get("PROJECT")!;
  const RSRC = tables.get("RSRC")!;
  const RSRCRATE = tables.get("RSRCRATE")!;
  const TASKRSRC = tables.get("TASKRSRC")!;
  const TASKPRED = tables.get("TASKPRED")!;

  const hasActvExport = ACTIVITY_CODE_TABLES.every((t) => tables.has(t));
  if (hasActvExport) {
    for (const t of ACTIVITY_CODE_TABLES) {
      const tbl = tables.get(t)!;
      if (tbl.fields.length === 0) {
        issues.push({ code: "INVALID_ACTV_SECTION", message: `${t}: missing %F header row` });
      }
    }
  }

  const ACTVTYPE = tables.get("ACTVTYPE");
  const ACTVCODE = tables.get("ACTVCODE");
  const TASKACTV = tables.get("TASKACTV");

  for (const f of TASK_REQUIRED_FIELDS) {
    if (fieldIndex(TASK, f) < 0) {
      issues.push({ code: "MISSING_FIELD", message: `TASK: missing column ${f}` });
    }
  }

  assertNoDuplicateIds("TASK", TASK, "task_id", issues);
  assertNoDuplicateIds("RSRC", RSRC, "rsrc_id", issues);
  assertNoDuplicateIds("TASKRSRC", TASKRSRC, "taskrsrc_id", issues);
  assertNoDuplicateIds("TASKPRED", TASKPRED, "task_pred_id", issues);

  const taskIds = new Set(colValues(TASK, "task_id"));
  const projIds = new Set(colValues(PROJECT, "proj_id"));
  const wbsIds = new Set(colValues(PROJWBS, "wbs_id"));
  const rsrcIds = new Set(colValues(RSRC, "rsrc_id"));

  orphanRefs("TASK", TASK, "proj_id", projIds, issues);
  orphanRefs("TASK", TASK, "wbs_id", wbsIds, issues);

  if (ACTVTYPE && ACTVCODE && TASKACTV) {
    const actvTypeIds = new Set(colValues(ACTVTYPE, "actv_code_type_id"));
    const actvCodeIds = new Set(colValues(ACTVCODE, "actv_code_id"));
    orphanRefs("TASKACTV", TASKACTV, "task_id", taskIds, issues);
    orphanRefs("TASKACTV", TASKACTV, "actv_code_type_id", actvTypeIds, issues);
    orphanRefs("TASKACTV", TASKACTV, "actv_code_id", actvCodeIds, issues);
    orphanRefs("ACTVCODE", ACTVCODE, "actv_code_type_id", actvTypeIds, issues);
    orphanRefs("ACTVCODE", ACTVCODE, "proj_id", projIds, issues);
    orphanRefs("ACTVTYPE", ACTVTYPE, "proj_id", projIds, issues);
  }
  orphanRefs("TASKRSRC", TASKRSRC, "task_id", taskIds, issues);
  orphanRefs("TASKRSRC", TASKRSRC, "rsrc_id", rsrcIds, issues);
  orphanRefs("TASKPRED", TASKPRED, "task_id", taskIds, issues);
  orphanRefs("TASKPRED", TASKPRED, "pred_task_id", taskIds, issues);
  orphanRefs("RSRCRATE", RSRCRATE, "rsrc_id", rsrcIds, issues);

  const parentWbsIdx = fieldIndex(PROJWBS, "parent_wbs_id");
  const wbsIdIdx = fieldIndex(PROJWBS, "wbs_id");
  if (parentWbsIdx >= 0 && wbsIdIdx >= 0) {
    for (const r of PROJWBS.rows) {
      const wbsId = String(r[wbsIdIdx] ?? "").trim();
      const parent = String(r[parentWbsIdx] ?? "").trim();
      if (!parent) continue;
      // Template project root rows often reference parents outside this export (e.g. OBS / enterprise).
      const wbsNum = Number(wbsId);
      if (Number.isFinite(wbsNum) && wbsNum > 1_000_000) continue;
      if (!wbsIds.has(parent)) {
        issues.push({ code: "ORPHAN_WBS", message: `PROJWBS wbs_id=${wbsId} parent_wbs_id=${parent} not found` });
        break;
      }
    }
  }

  const targetIdx = fieldIndex(TASK, "target_drtn_hr_cnt");
  const remainIdx = fieldIndex(TASK, "remain_drtn_hr_cnt");
  if (targetIdx >= 0 && remainIdx >= 0) {
    for (const r of TASK.rows) {
      const t = Number(r[targetIdx]);
      const rem = Number(r[remainIdx]);
      if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(rem) || rem <= 0) {
        const code = String(r[fieldIndex(TASK, "task_code")] ?? "");
        issues.push({ code: "INVALID_DURATION", message: `TASK ${code}: duration must be > 0 hours` });
        break;
      }
    }
  }

  const predTypeIdx = fieldIndex(TASKPRED, "pred_type");
  if (predTypeIdx >= 0) {
    for (const r of TASKPRED.rows) {
      const pt = String(r[predTypeIdx] ?? "").trim();
      if (pt && !PRED_TYPES.has(pt)) {
        issues.push({ code: "INVALID_PRED_TYPE", message: `TASKPRED invalid pred_type ${pt}` });
        break;
      }
    }
  }

  const shortIdx = fieldIndex(RSRC, "rsrc_short_name");
  if (shortIdx >= 0) {
    const shorts = new Set<string>();
    for (const r of RSRC.rows) {
      const s = String(r[shortIdx] ?? "").trim();
      if (!s) continue;
      if (shorts.has(s)) {
        issues.push({ code: "DUPLICATE_RSRC_SHORT", message: `RSRC duplicate rsrc_short_name ${s}` });
        break;
      }
      shorts.add(s);
    }
  }

  for (const costField of ["target_cost", "remain_cost"] as const) {
    const idx = fieldIndex(TASKRSRC, costField);
    if (idx < 0) continue;
    for (const r of TASKRSRC.rows) {
      const n = Number(r[idx]);
      if (!Number.isFinite(n)) {
        issues.push({ code: "INVALID_COST", message: `TASKRSRC ${costField} is not numeric` });
        break;
      }
    }
  }

  if (!xerText.includes("%E")) {
    issues.push({ code: "MISSING_EOF", message: "XER missing %E terminator" });
  }

  return issues;
}
