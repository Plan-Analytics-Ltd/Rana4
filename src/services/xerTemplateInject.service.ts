import * as path from "node:path";
import { readFile } from "node:fs/promises";
import type { GeneratedWbs } from "./wbsGenerate.service.js";
import type { RateCardEntry } from "./rateCard.js";
import { buildP6ResourceMap } from "./p6ResourceMap.service.js";

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

export async function generateXERWithWBS(
  wbs: GeneratedWbs,
  project_name: string,
  project_short_name: string,
  rateCardEntries: RateCardEntry[]
): Promise<string> {
  const templatePath = path.join(process.cwd(), "templates", "NEWPROJ-50901.xer");
  const template = await readFile(templatePath, "utf8");
  const eol = detectEol(template);
  const lines = template.split(/\r?\n/);

  // PROJECT: do not modify (keep template exactly as-is).
  let outLines = lines;

  // PROJWBS: keep template %R rows exactly; append one row per deliverable (clone first template row, only wbs_id / short / name).
  const projwbsSection = getSection(outLines, "PROJWBS");
  const wbsFields = projwbsSection.fields;
  const templateWbsRow = projwbsSection.rowLines[0] ?? null;
  if (!templateWbsRow) throw new Error("XER template PROJWBS has no %R row to clone");
  const rootValues = buildRowFromTemplate(wbsFields, templateWbsRow);
  // Root WBS short name should match the project code used across the export bundle.
  // Prefer project_short_name (often code like NEWPROJ-5090) over project_name (may be descriptive / include suffixes).
  setField(rootValues, wbsFields, "wbs_short_name", String(project_short_name).trim() || String(project_name).trim());
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
  for (let i = 0; i < wbs.deliverable_wbs_list.length; i++) {
    const slice = wbs.deliverable_wbs_list[i]!;
    const v = buildRowFromTemplate(wbsFields, templateWbsRow);
    setField(v, wbsFields, "wbs_id", String(slice.wbs_id));
    setField(v, wbsFields, "wbs_short_name", slice.wbs_short_name);
    setField(v, wbsFields, "wbs_name", slice.wbs_name);
    setField(v, wbsFields, "parent_wbs_id", String(rootWbsId));
    setField(v, wbsFields, "seq_num", String(rootSeqNum + i + 1));
    setField(v, wbsFields, "proj_node_flag", "N");
    setField(v, wbsFields, "ev_compute_type", "");
    setField(v, wbsFields, "ev_etc_compute_type", "");
    setField(v, wbsFields, "guid", "");
    appended.push(joinRow(["%R", ...v]));
  }

  outLines = appendProjwbsRows(outLines, appended);

  // RSRC + RSRCRATE (XER only): generated from a single, unified resource map derived from the rate card.
  const { resources } = buildP6ResourceMap(rateCardEntries);

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
    // Dynamic fields
    set("rsrc_id", r.rsrc_id);
    set("rsrc_seq_num", r.rsrc_seq_num);
    set("rsrc_name", r.rsrc_name);
    set("rsrc_short_name", r.rsrc_short_name);

    // Fixed values (STRICT)
    set("clndr_id", 107653);
    set("def_qty_per_hr", 1);
    set("cost_qty_type", "QT_Hour");
    set("active_flag", "Y");
    set("auto_compute_act_flag", "Y");
    set("def_cost_qty_link_flag", "Y");
    set("ot_flag", "N");
    set("curr_id", 26781);
    set("rsrc_type", "RT_Labor");
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
    set("start_date", "2025-01-01");
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

  return outLines.join(eol);
}

