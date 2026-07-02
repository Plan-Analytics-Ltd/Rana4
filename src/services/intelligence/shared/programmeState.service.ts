import type { ProgrammeSnapshotRole, ProgrammeSnapshotSourceType, ProgrammeState } from "@prisma/client";

/**
 * Map snapshot role / source to canonical programme state for intelligence evidence.
 * Only APPROVED_BASELINE, AS_BUILT and FINAL_AS_BUILT are used in benchmark matching.
 */
export function resolveProgrammeState(args: {
  snapshotRole?: ProgrammeSnapshotRole | null;
  sourceType: ProgrammeSnapshotSourceType;
}): ProgrammeState | null {
  const role = args.snapshotRole ?? null;
  if (role === "AS_BUILT") return "AS_BUILT";
  if (role === "BASELINE") return "APPROVED_BASELINE";
  if (role === "LIVE_IMPORT") return "LIVE_UPDATE";

  if (args.sourceType === "AS_BUILT") return "AS_BUILT";
  if (args.sourceType === "BASELINE_GENERATED") return "APPROVED_BASELINE";
  if (args.sourceType === "LIVE_UPDATE") return "LIVE_UPDATE";
  return null;
}
