import type { RelationshipType } from "@prisma/client";
import type { ImportedActivityRow, ImportedRelationshipRow, ParsedProgrammeImport } from "./types.js";
import { P6_HOURS_PER_DAY } from "./types.js";

type XerTable = { fields: string[]; rows: Record<string, string>[] };

function parseXerTables(content: string): Map<string, XerTable> {
  const tables = new Map<string, XerTable>();
  let currentName: string | null = null;
  let currentFields: string[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === "%E") continue;

    if (line.startsWith("%T\t")) {
      currentName = line.slice(3).trim();
      currentFields = [];
      if (currentName) tables.set(currentName, { fields: [], rows: [] });
      continue;
    }

    if (line.startsWith("%F\t") && currentName) {
      currentFields = line.slice(3).split("\t").map((f) => f.trim());
      const t = tables.get(currentName)!;
      t.fields = currentFields;
      continue;
    }

    if (line.startsWith("%R\t") && currentName && currentFields.length > 0) {
      const cells = line.slice(3).split("\t");
      const row: Record<string, string> = {};
      for (let i = 0; i < currentFields.length; i++) {
        row[currentFields[i]!] = (cells[i] ?? "").trim();
      }
      tables.get(currentName)!.rows.push(row);
    }
  }

  return tables;
}

function parseP6Date(value: string | undefined): Date | undefined {
  const v = String(value ?? "").trim();
  if (!v) return undefined;
  const d = new Date(v.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function hoursToDays(hours: string | undefined): number | undefined {
  const h = parseFloat(String(hours ?? ""));
  if (!Number.isFinite(h) || h < 0) return undefined;
  return Math.round((h / P6_HOURS_PER_DAY) * 100) / 100;
}

function mapP6PredType(predType: string): RelationshipType {
  const x = String(predType ?? "").trim().toUpperCase();
  if (x.includes("SS")) return "SS";
  if (x.includes("FF")) return "FF";
  if (x.includes("SF")) return "SF";
  return "FS";
}

function rowByTaskId(tasks: XerTable): Map<string, Record<string, string>> {
  const m = new Map<string, Record<string, string>>();
  for (const r of tasks.rows) {
    const id = r.task_id;
    if (id) m.set(id, r);
  }
  return m;
}

/**
 * Parse P6 XER export into normalized programme import rows.
 * Matches activity identity by task_code (Rana4 activity codes).
 */
export function parseXerProgramme(content: string | Buffer): ParsedProgrammeImport {
  const text = Buffer.isBuffer(content) ? content.toString("utf8") : content;
  const tables = parseXerTables(text);
  const taskTable = tables.get("TASK");
  if (!taskTable?.rows.length) {
    throw new Error("XER file has no TASK table or no activity rows");
  }

  const projectTable = tables.get("PROJECT");
  const scheduleDate = projectTable?.rows[0]
    ? parseP6Date(projectTable.rows[0].last_schedule_date ?? projectTable.rows[0].plan_start_date)
    : undefined;

  const activities: ImportedActivityRow[] = [];
  for (const r of taskTable.rows) {
    const code = String(r.task_code ?? "").trim();
    if (!code) continue;

    const targetDays = hoursToDays(r.target_drtn_hr_cnt);
    const remainDays = hoursToDays(r.remain_drtn_hr_cnt);
    const totalFloat = hoursToDays(r.total_float_hr_cnt);
    const freeFloat = hoursToDays(r.free_float_hr_cnt);
    const pct = parseFloat(String(r.phys_complete_pct ?? ""));
    const status = String(r.status_code ?? "").trim() || undefined;

    let actualDays: number | undefined;
    const actStart = parseP6Date(r.act_start_date);
    const actEnd = parseP6Date(r.act_end_date);
    if (actStart && actEnd) {
      actualDays = Math.max(0, Math.round((actEnd.getTime() - actStart.getTime()) / 86400000));
    }

    activities.push({
      activityCode: code,
      name: String(r.task_name ?? "").trim() || undefined,
      originalDurationDays: targetDays,
      remainingDurationDays: remainDays,
      actualDurationDays: actualDays,
      percentComplete: Number.isFinite(pct) ? pct : undefined,
      startDate: parseP6Date(r.act_start_date ?? r.early_start_date ?? r.target_start_date),
      finishDate: parseP6Date(r.act_end_date ?? r.early_end_date ?? r.target_end_date),
      earlyStart: parseP6Date(r.early_start_date),
      earlyFinish: parseP6Date(r.early_end_date),
      lateStart: parseP6Date(r.late_start_date),
      lateFinish: parseP6Date(r.late_end_date),
      totalFloatDays: totalFloat,
      freeFloatDays: freeFloat,
      isCritical: totalFloat !== undefined && totalFloat <= 0,
      status,
    });
  }

  const taskById = rowByTaskId(taskTable);
  const relationships: ImportedRelationshipRow[] = [];
  const predTable = tables.get("TASKPRED");
  if (predTable) {
    for (const p of predTable.rows) {
      const predRow = taskById.get(p.pred_task_id ?? "");
      const succRow = taskById.get(p.task_id ?? "");
      const predCode = predRow?.task_code?.trim();
      const succCode = succRow?.task_code?.trim();
      if (!predCode || !succCode) continue;
      const lagHr = parseFloat(String(p.lag_hr_cnt ?? "0"));
      const lagDays = Number.isFinite(lagHr) ? Math.round(lagHr / P6_HOURS_PER_DAY) : 0;
      relationships.push({
        predecessorActivityCode: predCode,
        successorActivityCode: succCode,
        relationshipType: mapP6PredType(p.pred_type ?? "PR_FS"),
        lag: lagDays,
      });
    }
  }

  return {
    sourceType: "XER_IMPORT",
    scheduleDate,
    activities,
    deliverables: [],
    relationships,
    metrics: {
      taskCount: activities.length,
      relationshipCount: relationships.length,
    },
  };
}
