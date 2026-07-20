import type {
  BenchmarkOutlierStatus,
  ProgrammeSnapshotSummary,
} from "@/lib/api";

export function humanOutlierStatus(status: BenchmarkOutlierStatus): string {
  switch (status) {
    case "NORMAL":
      return "Typical for comparable deliverables";
    case "SLIGHTLY_LOW":
      return "Slightly shorter than usual";
    case "WELL_BELOW":
      return "Well below what usually happens";
    case "SLIGHTLY_HIGH":
      return "Slightly longer than usual";
    case "HIGH":
      return "Longer than usual";
    case "RED_FLAG":
      return "Well above what usually happens";
    case "EXTREME_OUTLIER":
      return "Well above what usually happens";
    default:
      return status;
  }
}

export function humanSnapshotRole(role: string | null): string {
  if (role === "AS_BUILT") return "Completed project";
  if (role === "LIVE_IMPORT") return "Live programme";
  if (role === "BASELINE") return "Baseline";
  return role ?? "Earlier programme revision";
}

export function humanSourceType(source: string): string {
  if (source === "XER") return "Primavera P6";
  if (source === "RANANA4_JSON" || source === "RANA4_JSON") return "Rana4 export";
  return source.replace(/_/g, " ");
}

export function snapshotKnowledgeBadges(snapshot: ProgrammeSnapshotSummary): string[] {
  const badges: string[] = [];
  if (snapshot.deliverableCount > 0) badges.push("Deliverables captured");
  if (snapshot.activityCount > 0) badges.push("Activities captured");
  if (snapshot.snapshotRole === "AS_BUILT") {
    badges.push("Used for learning");
    badges.push("Used for comparison");
  }
  if (snapshot.snapshotRole === "BASELINE") badges.push("Baseline reference");
  if (snapshot.snapshotRole === "LIVE_IMPORT") badges.push("Live programme");
  const matched = (snapshot.importSummary as { matchedActivities?: number })?.matchedActivities;
  if (typeof matched === "number" && matched > 0) badges.push("Similarity data");
  if (snapshot.activityCount >= 10) badges.push("Strong evidence");
  else if (snapshot.activityCount > 0) badges.push("Limited evidence");
  return badges;
}
