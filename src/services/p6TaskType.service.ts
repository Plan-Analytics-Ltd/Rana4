/** Default Primavera task type when Rana has no stored metadata (backwards compatible export). */
export const P6_DEFAULT_TASK_TYPE = "TT_Task";

const P6_MILESTONE_TYPES = new Set(["TT_Mile", "TT_StartMile", "TT_FinMile"]);
const P6_RESOURCE_TASK_TYPE = "TT_Rsrc";

/** True for Primavera milestone task types (TT_Mile, TT_StartMile, TT_FinMile). */
export function isP6MilestoneType(taskType: string | null | undefined): boolean {
  const t = String(taskType ?? "").trim();
  return t !== "" && P6_MILESTONE_TYPES.has(t);
}

/** True for Primavera resource-dependent tasks (TT_Rsrc). */
export function isP6ResourceTask(taskType: string | null | undefined): boolean {
  return String(taskType ?? "").trim() === P6_RESOURCE_TASK_TYPE;
}

/** Resolve TASK.task_type for XER export — stored value or TT_Task when unknown. */
export function resolveP6TaskTypeForExport(taskType: string | null | undefined): string {
  const t = String(taskType ?? "").trim();
  return t || P6_DEFAULT_TASK_TYPE;
}
