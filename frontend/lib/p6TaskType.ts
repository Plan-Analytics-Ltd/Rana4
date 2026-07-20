const P6_MILESTONE_TYPES = new Set(["TT_Mile", "TT_StartMile", "TT_FinMile"]);

/** True for Primavera milestone task types when p6TaskType metadata is present. */
export function isP6MilestoneType(taskType: string | null | undefined): boolean {
  const t = String(taskType ?? "").trim();
  return t !== "" && P6_MILESTONE_TYPES.has(t);
}
