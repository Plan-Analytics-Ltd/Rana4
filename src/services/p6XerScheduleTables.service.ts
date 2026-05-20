import type { P6Resource } from "./p6ResourceMap.service.js";
import type { AssignedResourceStored } from "./rateCard.js";
import { P6_SCHEDULE_HOURS_PER_DAY, type P6PendingSemanticTaskRow, type P6TaskPredExportRow } from "./export.service.js";
import {
  p6DeterministicTaskPredId,
  p6DeterministicTaskRsrcId,
} from "./p6DeterministicId.service.js";

/** xer-parser TASKRSRC column order. */
export const TASKRSRC_XER_FIELDS = [
  "taskrsrc_id",
  "task_id",
  "proj_id",
  "cost_qty_link_flag",
  "role_id",
  "acct_id",
  "rsrc_id",
  "pobs_id",
  "skill_level",
  "remain_qty",
  "target_qty",
  "remain_qty_per_hr",
  "target_lag_drtn_hr_cnt",
  "target_qty_per_hr",
  "act_ot_qty",
  "act_reg_qty",
  "relag_drtn_hr_cnt",
  "ot_factor",
  "cost_per_qty",
  "target_cost",
  "act_reg_cost",
  "act_ot_cost",
  "remain_cost",
  "act_start_date",
  "act_end_date",
  "restart_date",
  "reend_date",
  "target_start_date",
  "target_end_date",
  "rem_late_start_date",
  "rem_late_end_date",
  "rollup_dates_flag",
  "target_crv",
  "remain_crv",
  "actual_crv",
  "ts_pend_act_end_flag",
  "guid",
  "rate_type",
  "act_this_per_cost",
  "act_this_per_qty",
  "curv_id",
  "rsrc_type",
  "cost_per_qty_source_type",
  "create_user",
  "create_date",
  "has_rsrchours",
  "taskrsrc_sum_id",
] as const;

/** xer-parser TASKPRED column order. */
export const TASKPRED_XER_FIELDS = [
  "task_pred_id",
  "task_id",
  "pred_task_id",
  "proj_id",
  "pred_proj_id",
  "pred_type",
  "lag_hr_cnt",
  "comments",
  "float_path",
  "aref",
  "arls",
] as const;

function joinRow(tokens: string[]): string {
  return tokens.join("\t");
}

function cleanCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

export function mapSpreadsheetRelationshipToP6PredType(rel: string): string {
  const x = String(rel ?? "")
    .trim()
    .toUpperCase()
    .replace(/^PR_/, "");
  if (x === "FS" || x === "PR_FS") return "PR_FS";
  if (x === "SS" || x === "PR_SS") return "PR_SS";
  if (x === "FF" || x === "PR_FF") return "PR_FF";
  if (x === "SF" || x === "PR_SF") return "PR_SF";
  return "PR_FS";
}

function taskRsrcXerRow(values: Record<string, string | number>): string {
  const vals = TASKRSRC_XER_FIELDS.map((name) => cleanCell(values[name] ?? ""));
  return joinRow(["%R", ...vals]);
}

function taskPredXerRow(values: Record<string, string | number>): string {
  const vals = TASKPRED_XER_FIELDS.map((name) => cleanCell(values[name] ?? ""));
  return joinRow(["%R", ...vals]);
}

function resourceLookupKey(resourceType: string, resourceName: string): string {
  return `${String(resourceType ?? "").trim().toLowerCase()}|${String(resourceName ?? "").trim().toLowerCase()}`;
}

function resolveAssignmentQty(
  ar: AssignedResourceStored,
  res: P6Resource,
  durationHours: number,
  durationDays: number
): number {
  if (ar.units !== undefined && Number.isFinite(ar.units) && ar.units > 0) {
    return Math.round(ar.units * 1000) / 1000;
  }
  if (res.cost_qty_type === "QT_Day") {
    return Math.max(0.001, Math.round(durationDays * 1000) / 1000);
  }
  return durationHours;
}

export function validateP6ScheduleAppend(args: {
  taskCodeToTaskId: Map<string, number>;
  taskPredRows: P6TaskPredExportRow[];
  taskRsrcRows: { taskCode: string; rsrcShortName: string }[];
}): void {
  const seenTaskRsrc = new Set<string>();
  const seenPred = new Set<string>();

  for (const tr of args.taskRsrcRows) {
    if (!args.taskCodeToTaskId.has(tr.taskCode)) {
      throw new Error(`XER TASKRSRC: unknown task_code ${JSON.stringify(tr.taskCode)}`);
    }
    const key = `${tr.taskCode}\x1d${tr.rsrcShortName}`;
    if (seenTaskRsrc.has(key)) throw new Error(`XER TASKRSRC: duplicate assignment ${tr.taskCode} + ${tr.rsrcShortName}`);
    seenTaskRsrc.add(key);
  }

  for (const p of args.taskPredRows) {
    if (!args.taskCodeToTaskId.has(p.predecessorTaskCode)) {
      throw new Error(`XER TASKPRED: unknown predecessor ${JSON.stringify(p.predecessorTaskCode)}`);
    }
    if (!args.taskCodeToTaskId.has(p.successorTaskCode)) {
      throw new Error(`XER TASKPRED: unknown successor ${JSON.stringify(p.successorTaskCode)}`);
    }
    const predType = mapSpreadsheetRelationshipToP6PredType(p.relationshipType);
    const edgeKey = `${p.predecessorTaskCode}\x1d${p.successorTaskCode}\x1d${predType}\x1d${p.lagHr}`;
    if (seenPred.has(edgeKey)) {
      throw new Error(`XER TASKPRED: duplicate edge ${p.predecessorTaskCode} → ${p.successorTaskCode}`);
    }
    seenPred.add(edgeKey);
  }
}

export function buildP6TaskRsrcAndTaskPredSections(params: {
  projId: string;
  scope: string;
  byShortName: Map<string, P6Resource>;
  byTypeName: Map<string, P6Resource>;
  pendingSemanticTaskRows: P6PendingSemanticTaskRow[];
  taskCodeToTaskId: Map<string, number>;
  taskPredExportRows: P6TaskPredExportRow[];
}): string[] {
  const { projId, scope, byShortName, byTypeName, pendingSemanticTaskRows, taskCodeToTaskId, taskPredExportRows } =
    params;

  const taskRsrcMeta: { taskCode: string; rsrcShortName: string }[] = [];
  const taskRsrcLines: string[] = [];

  for (const row of pendingSemanticTaskRows) {
    const taskCode = String(row.baseCells[0] ?? "").trim();
    const taskName = String(row.baseCells[4] ?? "").trim();
    const wbsPath = String(row.baseCells[2] ?? "").trim();
    const durRaw = Number(row.baseCells[9]);
    if (!taskCode || !taskName || !wbsPath || !Number.isFinite(durRaw)) continue;
    const taskId = taskCodeToTaskId.get(taskCode);
    if (taskId === undefined) continue;

    const durationHours = Math.max(1, Math.round(durRaw));
    const durationDays = durationHours / P6_SCHEDULE_HOURS_PER_DAY;
    const assignments = row.assignedResources ?? [];

    let slot = 0;
    for (const ar of assignments) {
      const resource =
        byTypeName.get(resourceLookupKey(ar.resourceType, ar.resourceName)) ??
        byShortName.get(
          String(row.baseCells[7] ?? "")
            .split(",")
            .map((s) => s.trim())[slot] ?? ""
        );
      if (!resource) {
        throw new Error(
          `XER TASKRSRC: resource "${ar.resourceName}" (${ar.resourceType}) not on rate card for task ${taskCode}`
        );
      }
      const short = resource.rsrc_short_name;
      taskRsrcMeta.push({ taskCode, rsrcShortName: short });
      const qty = resolveAssignmentQty(ar, resource, durationHours, durationDays);
      const targetCost = Math.round(qty * resource.cost_per_qty * 100) / 100;
      const taskrsrc_id = p6DeterministicTaskRsrcId(scope, taskId, resource.rsrc_id, slot);
      slot += 1;

      taskRsrcLines.push(
        taskRsrcXerRow({
          taskrsrc_id,
          task_id: taskId,
          proj_id: projId,
          cost_qty_link_flag: "Y",
          role_id: "",
          acct_id: "",
          rsrc_id: resource.rsrc_id,
          pobs_id: "",
          skill_level: "",
          remain_qty: qty,
          target_qty: qty,
          remain_qty_per_hr: 1,
          target_lag_drtn_hr_cnt: "",
          target_qty_per_hr: 1,
          act_ot_qty: 0,
          act_reg_qty: 0,
          relag_drtn_hr_cnt: "",
          ot_factor: "",
          cost_per_qty: resource.cost_per_qty,
          target_cost: targetCost,
          act_reg_cost: 0,
          act_ot_cost: 0,
          remain_cost: targetCost,
          act_start_date: "",
          act_end_date: "",
          restart_date: "",
          reend_date: "",
          target_start_date: "",
          target_end_date: "",
          rem_late_start_date: "",
          rem_late_end_date: "",
          rollup_dates_flag: "Y",
          target_crv: "",
          remain_crv: "",
          actual_crv: "",
          ts_pend_act_end_flag: "N",
          guid: "",
          rate_type: "COST_PER_QTY",
          act_this_per_cost: 0,
          act_this_per_qty: 0,
          curv_id: "",
          rsrc_type: resource.rsrc_type,
          cost_per_qty_source_type: "",
          create_user: "",
          create_date: "",
          has_rsrchours: "N",
          taskrsrc_sum_id: "",
        })
      );
    }
  }

  validateP6ScheduleAppend({ taskCodeToTaskId, taskPredRows: taskPredExportRows, taskRsrcRows: taskRsrcMeta });

  const taskPredLines: string[] = [];
  for (const p of taskPredExportRows) {
    const predTaskId = taskCodeToTaskId.get(p.predecessorTaskCode);
    const succTaskId = taskCodeToTaskId.get(p.successorTaskCode);
    if (predTaskId === undefined || succTaskId === undefined) {
      throw new Error(
        `XER TASKPRED: unresolved codes pred=${JSON.stringify(p.predecessorTaskCode)} succ=${JSON.stringify(p.successorTaskCode)}`
      );
    }
    const pred_type = mapSpreadsheetRelationshipToP6PredType(p.relationshipType);
    const lag_hr_cnt = Number.isFinite(p.lagHr) ? p.lagHr : 0;
    const task_pred_id = p6DeterministicTaskPredId(scope, predTaskId, succTaskId, pred_type, lag_hr_cnt);
    taskPredLines.push(
      taskPredXerRow({
        task_pred_id,
        task_id: succTaskId,
        pred_task_id: predTaskId,
        proj_id: projId,
        pred_proj_id: projId,
        pred_type,
        lag_hr_cnt,
        comments: "",
        float_path: 0,
        aref: "",
        arls: "",
      })
    );
  }

  const out: string[] = [];
  out.push(joinRow(["%T", "TASKRSRC"]));
  out.push(joinRow(["%F", ...TASKRSRC_XER_FIELDS]));
  out.push(...taskRsrcLines);
  out.push(joinRow(["%T", "TASKPRED"]));
  out.push(joinRow(["%F", ...TASKPRED_XER_FIELDS]));
  out.push(...taskPredLines);
  return out;
}
