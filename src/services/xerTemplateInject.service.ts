import * as path from "node:path";
import { readdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import type { GeneratedWbs } from "./wbsGenerate.service.js";
import type { ActivityCodeCatalogForExport } from "./activityCodeCatalog.service.js";
import type { RateCardEntry } from "./rateCard.js";
import { buildP6ResourceMap } from "./p6ResourceMap.service.js";
import { buildXerAlignedWbsCodeMap } from "./wbsHumanReadable.service.js";
import { mergeInheritedAndOwnActivityAssignments } from "./activityCodeAssignmentsMerge.service.js";
import {
  p6DeterministicActvCodeId,
  p6DeterministicActvTypeId,
  p6XerTaskStableKey,
} from "./p6DeterministicId.service.js";

const P6_TASK_ID_BAND_START = 1_450_000_000;
const P6_TASK_ID_BAND_LIMIT = 80_000_000;
import type { P6PendingSemanticTaskRow, P6TaskPredExportRow } from "./export.service.js";
import { buildP6TaskRsrcAndTaskPredSections } from "./p6XerScheduleTables.service.js";
import { assertValidGeneratedXer } from "./p6XerExportValidation.service.js";

type XerSection = {
  tIndex: number;
  fIndex: number;
  rStartIndex: number;
  rEndIndex: number;
  fields: string[];
  rowLines: string[];
};

function detectEol(s: string): "\r\n" | "\n" {
  return s.includes("\r\n") ? "\r\n" : "\n";
}

function splitRow(line: string): string[] {
  return line.split("\t");
}

function joinRow(tokens: string[]): string {
  return tokens.join("\t");
}

function cleanCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

function appendBeforeEof(lines: string[], appended: string[]): string[] {
  const eIdx = lines.lastIndexOf("%E");
  if (eIdx >= 0) return [...lines.slice(0, eIdx), ...appended, ...lines.slice(eIdx)];
  return [...lines, ...appended];
}

function getSection(lines: string[], tableName: string): XerSection {
  const tLine = `%T\t${tableName}`;
  const tIndex = lines.findIndex((l) => l === tLine);
  if (tIndex < 0) throw new Error(`XER template missing section ${tableName}`);

  const fIndex = tIndex + 1;
  const fLine = lines[fIndex];
  if (!fLine || !fLine.startsWith("%F\t")) {
    throw new Error(`XER template invalid %F for ${tableName}`);
  }
  const fields = splitRow(fLine)
    .slice(1)
    .map((f) => f.trim());

  let rStartIndex = fIndex + 1;
  let rEndIndex = rStartIndex;
  while (rEndIndex < lines.length) {
    const l = lines[rEndIndex]!;
    if (l.startsWith("%T\t")) break;
    rEndIndex += 1;
  }

  const rowLines = lines.slice(rStartIndex, rEndIndex).filter((l) => l.startsWith("%R\t"));

  return { tIndex, fIndex, rStartIndex, rEndIndex, fields, rowLines };
}

function replaceSectionRows(lines: string[], tableName: string, newRowLines: string[]): string[] {
  const section = getSection(lines, tableName);

  const before = lines.slice(0, section.fIndex + 1);

  const afterSlice = lines.slice(section.fIndex + 1, section.rEndIndex);
  const afterWithoutOldR = afterSlice.filter((l) => !l.startsWith("%R\t"));

  const after = lines.slice(section.rEndIndex);
  return [...before, ...newRowLines, ...afterWithoutOldR, ...after];
}

/** Keep all template %R rows under PROJWBS; append new %R lines before any trailing non-%R lines (e.g. %E). */
function appendProjwbsRows(lines: string[], appendedRowLines: string[]): string[] {
  const section = getSection(lines, "PROJWBS");
  const before = lines.slice(0, section.fIndex + 1);
  const middle = lines.slice(section.fIndex + 1, section.rEndIndex);
  const nonR = middle.filter((l) => !l.startsWith("%R\t"));
  const after = lines.slice(section.rEndIndex);
  return [...before, ...section.rowLines, ...appendedRowLines, ...nonR, ...after];
}

function setField(values: string[], fields: string[], fieldName: string, value: string | null): void {
  const idx = fields.indexOf(fieldName);
  if (idx === -1) return;
  values[idx] = value ?? "";
}

function buildRowFromTemplate(fields: string[], templateRowLine: string | null): string[] {
  const base = templateRowLine ? splitRow(templateRowLine).slice(1) : [];
  const out = new Array<string>(fields.length).fill("");
  for (let i = 0; i < Math.min(base.length, out.length); i++) out[i] = base[i] ?? "";
  return out;
}

export type GenerateXerWithWbsOptions = {
  /** Activity code types/values to emit as ACTVTYPE/ACTVCODE (deterministic ids). */
  activityCatalog?: ActivityCodeCatalogForExport | null;
  /** Same TASK rows as the spreadsheet export; drives XER `TASK` + `TASKACTV`. */
  pendingSemanticTaskRows?: P6PendingSemanticTaskRow[] | null;
  /** Namespace for deterministic TASK ids (e.g. companyId:projectId:projectCode). */
  xerDeterministicScope?: string | null;
  /** Predecessor/successor activity IDs (task_code) and lag hours for `TASKPRED`. */
  taskPredExportRows?: P6TaskPredExportRow[] | null;
  /** When false, caller runs {@link collectXerValidationIssues} (e.g. export preflight reporting all issues). */
  assertValidOnComplete?: boolean;
};

function projIdFromProjectSection(lines: string[]): string {
  const sec = getSection(lines, "PROJECT");
  const row = sec.rowLines[0];
  if (!row) throw new Error("XER template PROJECT has no %R row");
  const vals = splitRow(row).slice(1);
  const idx = sec.fields.indexOf("proj_id");
  if (idx < 0) throw new Error("XER template PROJECT fields missing proj_id");
  const v = vals[idx];
  if (v === undefined || String(v).trim() === "") throw new Error("XER template PROJECT proj_id is empty");
  return String(v).trim();
}

function clndrIdFromProjectSection(lines: string[]): number {
  const sec = getSection(lines, "PROJECT");
  const row = sec.rowLines[0];
  if (!row) return 107653;
  const vals = splitRow(row).slice(1);
  const idx = sec.fields.indexOf("clndr_id");
  if (idx < 0) return 107653;
  const n = Number(vals[idx]);
  return Number.isFinite(n) && n > 0 ? n : 107653;
}

const ACTVTYPE_XER_FIELDS = [
  "actv_code_type_id",
  "proj_id",
  "seq_num",
  "actv_short_len",
  "actv_code_type",
  "export_flag",
  "super_flag",
  "actv_code_type_scope",
] as const;

const ACTVCODE_XER_FIELDS = [
  "actv_code_id",
  "parent_actv_code_id",
  "actv_code_type_id",
  "actv_code_name",
  "short_name",
  "seq_num",
  "export_flag",
  "proj_id",
] as const;

/** Matches xer-parser TASK schema column order. */
const TASK_XER_FIELDS = [
  "task_id",
  "proj_id",
  "wbs_id",
  "clndr_id",
  "phys_complete_pct",
  "rev_fdbk_flag",
  "est_wt",
  "lock_plan_flag",
  "auto_compute_act_flag",
  "complete_pct_type",
  "task_type",
  "duration_type",
  "status_code",
  "task_code",
  "task_name",
  "rsrc_id",
  "total_float_hr_cnt",
  "free_float_hr_cnt",
  "remain_drtn_hr_cnt",
  "act_work_qty",
  "remain_work_qty",
  "target_work_qty",
  "target_drtn_hr_cnt",
  "target_equip_qty",
  "act_equip_qty",
  "remain_equip_qty",
  "cstr_date",
  "act_start_date",
  "act_end_date",
  "late_start_date",
  "late_end_date",
  "expect_end_date",
  "early_start_date",
  "early_end_date",
  "restart_date",
  "reend_date",
  "target_start_date",
  "target_end_date",
  "rem_late_start_date",
  "rem_late_end_date",
  "cstr_type",
  "priority_type",
  "suspend_date",
  "resume_date",
  "float_path",
  "float_path_order",
  "guid",
  "tmpl_guid",
  "cstr_date2",
  "cstr_type2",
  "driving_path_flag",
  "act_this_per_work_qty",
  "act_this_per_equip_qty",
  "external_early_start_date",
  "external_late_end_date",
  "create_date",
  "update_date",
  "create_user",
  "update_user",
  "location_id",
  "crt_path_num",
] as const;

const TASKACTV_XER_FIELDS = ["task_id", "proj_id", "actv_code_type_id", "actv_code_id"] as const;

function activityTypeSlugUpper(t: ActivityCodeCatalogForExport["types"][number]): string {
  const s = String(t.slug ?? "").trim();
  if (!s) {
    throw new Error(`XER ACTVTYPE: activity code type ${t.id} is missing slug`);
  }
  return s.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

function stableActivityCodeHashKey(
  typeSlugUpper: string,
  code: ActivityCodeCatalogForExport["codes"][number],
  disambiguator: number
): string {
  const base = String(code.shortName?.trim() || code.name).trim();
  const norm = base
    .replace(/\s+/g, "_")
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 80);
  const tail = disambiguator > 0 ? `#${disambiguator}` : "";
  if (!norm) return `${typeSlugUpper}:ID_${code.id}${tail}`;
  return `${typeSlugUpper}:${norm}${tail}`;
}

function wbsNumericIdFromSpreadsheetPath(
  wbsPath: string,
  generatedWbs: GeneratedWbs,
  projectCodeForWbs: string
): number {
  const m = buildXerAlignedWbsCodeMap(generatedWbs, projectCodeForWbs);
  const p = String(wbsPath).trim();
  for (const [wid, code] of m) {
    if (String(code).trim() === p) return wid;
  }
  throw new Error(`XER TASK: WBS path not found in generated WBS map: ${JSON.stringify(p)}`);
}

function taskXerRowFromSemantic(input: {
  taskId: number;
  projId: string;
  wbsId: number;
  clndrId: number;
  taskCode: string;
  taskName: string;
  durationHours: number;
}): string {
  const v: Record<string, string | number> = {};
  v.task_id = input.taskId;
  v.proj_id = input.projId;
  v.wbs_id = input.wbsId;
  v.clndr_id = input.clndrId;
  v.phys_complete_pct = 0;
  v.rev_fdbk_flag = "N";
  v.est_wt = 1;
  v.lock_plan_flag = "N";
  v.auto_compute_act_flag = "Y";
  v.complete_pct_type = "CP_Drtn";
  v.task_type = "TT_Task";
  v.duration_type = "DT_FixedDUR2";
  v.status_code = "TK_NotStart";
  v.task_code = input.taskCode;
  v.task_name = input.taskName;
  v.total_float_hr_cnt = 0;
  v.free_float_hr_cnt = 0;
  v.remain_drtn_hr_cnt = input.durationHours;
  v.target_drtn_hr_cnt = input.durationHours;
  v.act_work_qty = 0;
  v.remain_work_qty = 0;
  v.target_work_qty = 0;
  v.target_equip_qty = 0;
  v.act_equip_qty = 0;
  v.remain_equip_qty = 0;
  v.driving_path_flag = "N";
  v.act_this_per_work_qty = 0;
  v.act_this_per_equip_qty = 0;

  const vals = TASK_XER_FIELDS.map((name) => cleanCell(v[name] ?? ""));
  return joinRow(["%R", ...vals]);
}

function taskactvXerRow(input: {
  task_id: number;
  proj_id: string;
  actv_code_type_id: number;
  actv_code_id: number;
}): string {
  const vals = new Array(TASKACTV_XER_FIELDS.length).fill("");
  const set = (name: string, value: string | number) => {
    const i = (TASKACTV_XER_FIELDS as readonly string[]).indexOf(name);
    if (i >= 0) vals[i] = cleanCell(value);
  };
  set("task_id", input.task_id);
  set("proj_id", input.proj_id);
  set("actv_code_type_id", input.actv_code_type_id);
  set("actv_code_id", input.actv_code_id);
  return joinRow(["%R", ...vals]);
}

function appendP6ActivityTaskTables(params: {
  lines: string[];
  wbs: GeneratedWbs;
  projectShortNameForWbsPaths: string;
  catalog: ActivityCodeCatalogForExport | null | undefined;
  pendingSemanticTaskRows: P6PendingSemanticTaskRow[] | null | undefined;
  xerDeterministicScope: string;
  clndrId: number;
}): { lines: string[]; taskCodeToTaskId: Map<string, number> } {
  const blocks: string[] = [];
  const projId = projIdFromProjectSection(params.lines);
  const clndrId = params.clndrId;
  const cat = params.catalog;
  const pending = params.pendingSemanticTaskRows ?? [];
  const scope = params.xerDeterministicScope;

  const taskCodeToTaskId = new Map<string, number>();

  let ranaCodeToNumeric = new Map<string, number>();

  if (cat && cat.types.length > 0) {
    const typeSlugUpperById = new Map<string, string>();
    const typeNumById = new Map<string, number>();
    for (const t of cat.types) {
      const slugU = activityTypeSlugUpper(t);
      typeSlugUpperById.set(t.id, slugU);
      typeNumById.set(t.id, p6DeterministicActvTypeId(slugU));
    }

    blocks.push(joinRow(["%T", "ACTVTYPE"]));
    blocks.push(joinRow(["%F", ...ACTVTYPE_XER_FIELDS]));
    const typesOrdered = [...cat.types].sort((a, b) => {
      if (a.seqNum !== b.seqNum) return a.seqNum - b.seqNum;
      return a.name.localeCompare(b.name);
    });
    for (let i = 0; i < typesOrdered.length; i++) {
      const t = typesOrdered[i]!;
      const slugU = typeSlugUpperById.get(t.id)!;
      blocks.push(
        actvtypeXerRow({
          actv_code_type_id: typeNumById.get(t.id)!,
          proj_id: projId,
          seq_num: Number.isFinite(t.seqNum) ? t.seqNum : i,
          actv_short_len: 40,
          actv_code_type: String(t.name).trim() || slugU,
        })
      );
    }

    if (cat.codes.length > 0) {
      ranaCodeToNumeric = new Map();
      blocks.push(joinRow(["%T", "ACTVCODE"]));
      blocks.push(joinRow(["%F", ...ACTVCODE_XER_FIELDS]));
      const orderedCodes = sortActivityCodesParentsBeforeChildren(cat.codes);
      const usedHashKeys = new Set<string>();
      for (const c of orderedCodes) {
        const typeSlugU = typeSlugUpperById.get(c.typeId);
        if (!typeSlugU) {
          throw new Error(`XER ACTVCODE: code ${c.id} references unknown type ${c.typeId}`);
        }
        const typeNum = typeNumById.get(c.typeId)!;
        let dis = 0;
        let hashKey = stableActivityCodeHashKey(typeSlugU, c, dis);
        while (usedHashKeys.has(hashKey)) {
          dis += 1;
          hashKey = stableActivityCodeHashKey(typeSlugU, c, dis);
        }
        usedHashKeys.add(hashKey);
        const codeNum = p6DeterministicActvCodeId(hashKey);
        ranaCodeToNumeric.set(c.id, codeNum);
        const parentNum = c.parentId ? ranaCodeToNumeric.get(c.parentId) ?? null : null;
        const shortName = String(c.shortName?.trim() || c.name).trim();
        blocks.push(
          actvcodeXerRow({
            actv_code_id: codeNum,
            parent_actv_code_id: parentNum ?? typeNum,
            actv_code_type_id: typeNum,
            actv_code_name: c.name,
            short_name: shortName,
            seq_num: c.seqNum,
            proj_id: projId,
          })
        );
      }
    }
  }

  const typeNumByIdForTask = new Map<string, number>();
  if (cat && cat.types.length > 0) {
    for (const t of cat.types) {
      typeNumByIdForTask.set(t.id, p6DeterministicActvTypeId(activityTypeSlugUpper(t)));
    }
  }
  const typeById = cat ? new Map(cat.types.map((t) => [t.id, t])) : new Map<string, ActivityCodeCatalogForExport["types"][number]>();
  const codeById = cat ? new Map(cat.codes.map((c) => [c.id, c])) : new Map<string, ActivityCodeCatalogForExport["codes"][number]>();
  const hasActv = Boolean(cat && cat.types.length > 0 && cat.codes.length > 0);

  const taskActvRowStrings: string[] = [];
  const taskDataRowStrings: string[] = [];
  const emittedTaskCodes = new Set<string>();
  const stableKeyToTaskNum = new Map<string, number>();
  let nextP6TaskNum = P6_TASK_ID_BAND_START;
  const taskNumForStableKey = (stableKey: string): number => {
    const existing = stableKeyToTaskNum.get(stableKey);
    if (existing !== undefined) return existing;
    const n = nextP6TaskNum;
    nextP6TaskNum += 1;
    if (nextP6TaskNum >= P6_TASK_ID_BAND_START + P6_TASK_ID_BAND_LIMIT) {
      throw new Error("XER TASK: export exceeds supported task_id range");
    }
    stableKeyToTaskNum.set(stableKey, n);
    return n;
  };
  if (pending.length > 0) {
    for (const row of pending) {
      const taskCode = String(row.baseCells[0] ?? "").trim();
      const wbsPath = String(row.baseCells[2] ?? "").trim();
      const taskName = String(row.baseCells[4] ?? "").trim();
      const dur = Number(row.baseCells[9]);
      if (!taskCode || !wbsPath || !taskName || !Number.isFinite(dur)) continue;
      if (emittedTaskCodes.has(taskCode)) continue;
      emittedTaskCodes.add(taskCode);
      const wbsIdNum = wbsNumericIdFromSpreadsheetPath(wbsPath, params.wbs, params.projectShortNameForWbsPaths);
      const stableKey = p6XerTaskStableKey({ taskCode, ownAssignmentKey: row.ownAssignmentKey });
      const taskNum = taskNumForStableKey(stableKey);
      taskCodeToTaskId.set(taskCode, taskNum);
      taskDataRowStrings.push(
        taskXerRowFromSemantic({
          taskId: taskNum,
          projId,
          wbsId: wbsIdNum,
          clndrId,
          taskCode,
          taskName,
          durationHours: Math.max(1, Math.round(dur)),
        })
      );

      if (!hasActv) continue;
      const merged = mergeInheritedAndOwnActivityAssignments(cat!, row.ownAssignmentKey, row.inheritDeliverableId);
      for (const as of merged) {
        const typ = typeById.get(as.typeId);
        if (!typ || !codeById.has(as.codeId)) {
          throw new Error(`XER TASKACTV: missing catalog entry for type=${as.typeId} code=${as.codeId}`);
        }
        const actvCodeNum = ranaCodeToNumeric.get(as.codeId);
        if (actvCodeNum === undefined) {
          throw new Error(`XER TASKACTV: missing deterministic ACTVCODE id for code ${as.codeId}`);
        }
        const typeNum = typeNumByIdForTask.get(typ.id);
        if (typeNum === undefined) {
          throw new Error(`XER TASKACTV: missing deterministic ACTVTYPE id for type ${typ.id}`);
        }
        taskActvRowStrings.push(
          taskactvXerRow({
            task_id: taskNum,
            proj_id: projId,
            actv_code_type_id: typeNum,
            actv_code_id: actvCodeNum,
          })
        );
      }
    }
    if (taskDataRowStrings.length > 0) {
      blocks.push(joinRow(["%T", "TASK"]));
      blocks.push(joinRow(["%F", ...TASK_XER_FIELDS]));
      blocks.push(...taskDataRowStrings);
    }
    if (taskActvRowStrings.length > 0) {
      blocks.push(joinRow(["%T", "TASKACTV"]));
      blocks.push(joinRow(["%F", ...TASKACTV_XER_FIELDS]));
      blocks.push(...taskActvRowStrings);
    } else if (hasActv) {
      blocks.push(joinRow(["%T", "TASKACTV"]));
      blocks.push(joinRow(["%F", ...TASKACTV_XER_FIELDS]));
    }
  } else {
    blocks.push(joinRow(["%T", "TASK"]));
    blocks.push(joinRow(["%F", ...TASK_XER_FIELDS]));
  }

  if (blocks.length === 0) return { lines: params.lines, taskCodeToTaskId };
  return { lines: appendBeforeEof(params.lines, blocks), taskCodeToTaskId };
}

function sortActivityCodesParentsBeforeChildren(codes: ActivityCodeCatalogForExport["codes"]): ActivityCodeCatalogForExport["codes"] {
  const byId = new Map(codes.map((c) => [c.id, c]));
  const remaining = new Set(codes.map((c) => c.id));
  const out: ActivityCodeCatalogForExport["codes"] = [];
  while (remaining.size > 0) {
    let progressed = false;
    for (const id of [...remaining]) {
      const c = byId.get(id)!;
      if (!c.parentId || !remaining.has(c.parentId)) {
        out.push(c);
        remaining.delete(id);
        progressed = true;
      }
    }
    if (!progressed) {
      throw new Error("XER ACTVCODE export: activity code hierarchy contains a cycle or missing parent");
    }
  }
  return out;
}

function actvtypeXerRow(input: {
  actv_code_type_id: number;
  proj_id: string;
  seq_num: number;
  actv_short_len: number;
  actv_code_type: string;
}): string {
  const vals = new Array(ACTVTYPE_XER_FIELDS.length).fill("");
  const set = (name: string, value: string | number) => {
    const i = (ACTVTYPE_XER_FIELDS as readonly string[]).indexOf(name);
    if (i >= 0) vals[i] = cleanCell(value);
  };
  set("actv_code_type_id", input.actv_code_type_id);
  set("proj_id", input.proj_id);
  set("seq_num", input.seq_num);
  set("actv_short_len", input.actv_short_len);
  set("actv_code_type", input.actv_code_type);
  set("export_flag", "Y");
  set("super_flag", "N");
  set("actv_code_type_scope", "AS_Project");
  return joinRow(["%R", ...vals]);
}

function actvcodeXerRow(input: {
  actv_code_id: number;
  parent_actv_code_id: number;
  actv_code_type_id: number;
  actv_code_name: string;
  short_name: string;
  seq_num: number;
  proj_id: string;
}): string {
  const vals = new Array(ACTVCODE_XER_FIELDS.length).fill("");
  const set = (name: string, value: string | number) => {
    const i = (ACTVCODE_XER_FIELDS as readonly string[]).indexOf(name);
    if (i >= 0) vals[i] = cleanCell(value);
  };
  set("actv_code_id", input.actv_code_id);
  set("parent_actv_code_id", input.parent_actv_code_id);
  set("actv_code_type_id", input.actv_code_type_id);
  set("actv_code_name", input.actv_code_name);
  set("short_name", input.short_name);
  set("seq_num", input.seq_num);
  set("export_flag", "Y");
  set("proj_id", input.proj_id);
  return joinRow(["%R", ...vals]);
}

async function resolveXerTemplatePath(): Promise<string> {
  const dir = path.join(process.cwd(), "templates");
  const entries = await readdir(dir);
  const xer = entries.filter((n) => n.toLowerCase().endsWith(".xer")).sort((a, b) => a.localeCompare(b));
  if (xer.length === 0) {
    throw new Error("No .xer template found in /templates");
  }
  if (xer.length > 1) {
    throw new Error(`Multiple .xer templates found in /templates: ${xer.join(", ")}. Keep only one.`);
  }
  return path.join(dir, xer[0]!);
}

export async function generateXERWithWBS(
  wbs: GeneratedWbs,
  project_name: string,
  project_short_name: string,
  rateCardEntries: RateCardEntry[],
  opts?: GenerateXerWithWbsOptions | null
): Promise<string> {
  const templatePath = await resolveXerTemplatePath();
  const template = await readFile(templatePath, "utf8");
  const eol = detectEol(template);
  const lines = template.split(/\r?\n/);

  let outLines = lines;

  // PROJECT: ensure proj_short_name + name match what we export elsewhere (WBS codes depend on this consistency).
  const projectSection = getSection(outLines, "PROJECT");
  const projectFields = projectSection.fields;
  const templateProjectRow = projectSection.rowLines[0] ?? null;
  if (!templateProjectRow) throw new Error("XER template PROJECT has no %R row to clone");
  const projectValues = buildRowFromTemplate(projectFields, templateProjectRow);
  setField(projectValues, projectFields, "proj_short_name", String(project_short_name).trim() || String(project_name).trim());
  setField(projectValues, projectFields, "name_sep_char", ".");
  setField(projectValues, projectFields, "name", String(project_name).trim());
  const newProjectLine = joinRow(["%R", ...projectValues]);
  outLines = replaceSectionRows(outLines, "PROJECT", [newProjectLine, ...projectSection.rowLines.slice(1)]);

  // PROJWBS: keep template %R rows exactly; append one row per deliverable (clone first template row, only wbs_id / short / name).
  const projwbsSection = getSection(outLines, "PROJWBS");
  const wbsFields = projwbsSection.fields;
  const templateWbsRow = projwbsSection.rowLines[0] ?? null;
  if (!templateWbsRow) throw new Error("XER template PROJWBS has no %R row to clone");
  const rootValues = buildRowFromTemplate(wbsFields, templateWbsRow);
  // Root WBS short name should match the project code used across the export bundle.
  // Prefer project_short_name (often code like NEWPROJ-5090) over project_name (may be descriptive / include suffixes).
  setField(rootValues, wbsFields, "wbs_short_name", String(project_short_name).trim() || String(project_name).trim());
  // Root WBS name should be the human-readable project name (P6 shows this as the WBS name).
  setField(rootValues, wbsFields, "wbs_name", String(project_name).trim());
  const newRootLine = joinRow(["%R", ...rootValues]);
  outLines = replaceSectionRows(outLines, "PROJWBS", [newRootLine, ...projwbsSection.rowLines.slice(1)]);
  const rootWbsId = rootValues[wbsFields.indexOf("wbs_id")] ?? "";
  if (String(rootWbsId).trim() === "") {
    throw new Error("XER template PROJWBS root row missing wbs_id");
  }
  const rootSeqRaw = rootValues[wbsFields.indexOf("seq_num")] ?? "";
  const rootSeqNum = Number.parseInt(String(rootSeqRaw), 10);
  if (!Number.isFinite(rootSeqNum)) {
    throw new Error(`XER template PROJWBS root row missing/invalid seq_num: ${JSON.stringify(rootSeqRaw)}`);
  }

  const appended: string[] = [];
  const sliceByWbsId = new Map<number, { wbs_short_name: string; wbs_name: string }>();
  for (const s of wbs.deliverable_wbs_list) {
    sliceByWbsId.set(s.wbs_id, { wbs_short_name: s.wbs_short_name, wbs_name: s.wbs_name });
  }

  const orderedNodes = [...wbs.wbs_nodes].sort((a, b) => a.wbs_id - b.wbs_id);
  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i]!;
    const slice = sliceByWbsId.get(node.wbs_id);
    const v = buildRowFromTemplate(wbsFields, templateWbsRow);
    setField(v, wbsFields, "wbs_id", String(node.wbs_id));
    setField(v, wbsFields, "wbs_short_name", slice?.wbs_short_name ?? node.wbs_short_name);
    setField(v, wbsFields, "wbs_name", slice?.wbs_name ?? node.wbs_name);
    const parent =
      node.parent_wbs_id === 1 ? String(rootWbsId) : String(node.parent_wbs_id);
    setField(v, wbsFields, "parent_wbs_id", parent);
    setField(v, wbsFields, "seq_num", String(rootSeqNum + i + 1));
    setField(v, wbsFields, "proj_node_flag", "N");
    setField(v, wbsFields, "ev_compute_type", "");
    setField(v, wbsFields, "ev_etc_compute_type", "");
    setField(v, wbsFields, "guid", "");
    appended.push(joinRow(["%R", ...v]));
  }

  outLines = appendProjwbsRows(outLines, appended);

  const cat = opts?.activityCatalog;
  const pending = opts?.pendingSemanticTaskRows ?? [];
  const scope =
    String(opts?.xerDeterministicScope ?? "").trim() ||
    `${String(project_name).trim()}:${String(project_short_name).trim()}`;
  const rateStartDate = "2026-01-01";
  const clndrId = clndrIdFromProjectSection(outLines);
  const { resources, byShortName, byTypeName } = buildP6ResourceMap(rateCardEntries, {
    deterministicScope: scope,
    rateStartDate,
  });

  // RSRC + RSRCRATE (XER): rate card with deterministic ids (aligned with spreadsheet when exportContext is used).
  const rsrcFields = [
    "rsrc_id",
    "parent_rsrc_id",
    "clndr_id",
    "role_id",
    "shift_id",
    "user_id",
    "pobs_id",
    "guid",
    "rsrc_seq_num",
    "email_addr",
    "employee_code",
    "office_phone",
    "other_phone",
    "rsrc_name",
    "rsrc_short_name",
    "rsrc_title_name",
    "def_qty_per_hr",
    "cost_qty_type",
    "ot_factor",
    "active_flag",
    "auto_compute_act_flag",
    "def_cost_qty_link_flag",
    "ot_flag",
    "curr_id",
    "unit_id",
    "rsrc_type",
    "location_id",
    "ts_approve_user_id",
    "timesheet_flag",
    "rsrc_notes",
    "load_tasks_flag",
    "level_flag",
    "last_checksum",
  ];

  const rsrcRows = resources.map((r) => {
    const vals = new Array<string>(rsrcFields.length).fill("");
    const set = (name: string, value: string | number | null) => {
      const idx = rsrcFields.indexOf(name);
      if (idx >= 0) vals[idx] = cleanCell(value);
    };
    set("rsrc_id", r.rsrc_id);
    set("rsrc_seq_num", r.rsrc_seq_num);
    set("rsrc_name", r.rsrc_name);
    set("rsrc_short_name", r.rsrc_short_name);
    set("clndr_id", clndrId);
    set("def_qty_per_hr", r.cost_qty_type === "QT_Day" ? 8 : 1);
    set("cost_qty_type", r.cost_qty_type);
    set("active_flag", "Y");
    set("auto_compute_act_flag", "Y");
    set("def_cost_qty_link_flag", "Y");
    set("ot_flag", "N");
    set("curr_id", 26781);
    set("unit_id", r.cost_qty_type === "QT_Day" ? "d" : "h");
    set("rsrc_type", r.rsrc_type);
    set("timesheet_flag", "N");
    return joinRow(["%R", ...vals]);
  });

  const rsrcRateFields = [
    "rsrc_rate_id",
    "rsrc_id",
    "max_qty_per_hr",
    "cost_per_qty",
    "start_date",
    "shift_period_id",
    "cost_per_qty2",
    "cost_per_qty3",
    "cost_per_qty4",
    "cost_per_qty5",
  ];

  const rsrcRateRows = resources.map((r) => {
    const vals = new Array<string>(rsrcRateFields.length).fill("");
    const set = (name: string, value: string | number | null) => {
      const idx = rsrcRateFields.indexOf(name);
      if (idx >= 0) vals[idx] = cleanCell(value);
    };
    set("rsrc_rate_id", r.rsrc_rate_id);
    set("rsrc_id", r.rsrc_id);
    set("max_qty_per_hr", 1);
    set("cost_per_qty", r.cost_per_qty);
    set("start_date", rateStartDate);
    return joinRow(["%R", ...vals]);
  });

  const resourceSections: string[] = [];
  resourceSections.push(joinRow(["%T", "RSRC"]));
  resourceSections.push(joinRow(["%F", ...rsrcFields]));
  resourceSections.push(...rsrcRows);
  resourceSections.push(joinRow(["%T", "RSRCRATE"]));
  resourceSections.push(joinRow(["%F", ...rsrcRateFields]));
  resourceSections.push(...rsrcRateRows);

  outLines = appendBeforeEof(outLines, resourceSections);

  const projIdForSchedule = projIdFromProjectSection(outLines);
  const appendResult = appendP6ActivityTaskTables({
    lines: outLines,
    wbs,
    projectShortNameForWbsPaths: String(project_short_name).trim() || String(project_name).trim(),
    catalog: cat ?? null,
    pendingSemanticTaskRows: pending,
    xerDeterministicScope: scope,
    clndrId,
  });
  outLines = appendResult.lines;

  outLines = appendBeforeEof(
    outLines,
    buildP6TaskRsrcAndTaskPredSections({
      projId: projIdForSchedule,
      scope,
      byShortName,
      byTypeName,
      pendingSemanticTaskRows: pending,
      taskCodeToTaskId: appendResult.taskCodeToTaskId,
      taskPredExportRows: opts?.taskPredExportRows ?? [],
    })
  );

  const xerOut = outLines.join(eol);
  if (opts?.assertValidOnComplete !== false) {
    assertValidGeneratedXer(xerOut);
  }
  return xerOut;
}

