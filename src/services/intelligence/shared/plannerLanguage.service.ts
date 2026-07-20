/** Planner-facing language helpers — presentation only, no new intelligence. */

export function formatActivityLabel(name: string | null | undefined, code: string): string {
  const trimmedName = String(name ?? "").trim();
  const trimmedCode = String(code ?? "").trim();
  if (trimmedName && trimmedCode) return `${trimmedName} (${trimmedCode})`;
  if (trimmedName) return trimmedName;
  if (trimmedCode) return `Activity (${trimmedCode})`;
  return "Activity";
}

export function formatRelationshipType(type: string): string {
  switch (type) {
    case "FS":
      return "Finish-to-Start (FS)";
    case "SS":
      return "Start-to-Start (SS)";
    case "FF":
      return "Finish-to-Finish (FF)";
    case "SF":
      return "Start-to-Finish (SF)";
    default:
      return type;
  }
}

export function formatFloatDays(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return "—";
  const rounded = Math.round(days);
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
}

export type PlannerRevisionLabelArgs = {
  snapshotRole: string | null;
  programmeState: string | null;
  liveUpdateIndex: number | null;
  isLatestLiveUpdate: boolean;
  totalLiveUpdates: number;
};

/** Short revision name for programme stories: Baseline, Update 1, Update 2, As-built. */
export function buildPlannerRevisionStoryLabel(args: PlannerRevisionLabelArgs): string {
  const role = args.snapshotRole;
  const state = args.programmeState;

  if (role === "BASELINE" || state === "APPROVED_BASELINE") return "Baseline";
  if (role === "AS_BUILT" || state === "AS_BUILT" || state === "FINAL_AS_BUILT") return "As-built";

  const isLive = role === "LIVE_IMPORT" || state === "LIVE_UPDATE";
  if (isLive) {
    if (args.liveUpdateIndex != null) return `Update ${args.liveUpdateIndex}`;
    return "Update";
  }

  if (args.liveUpdateIndex != null) return `Update ${args.liveUpdateIndex}`;
  return "Update";
}

/** Planner phrase "Latest Update" → canonical numbered label for the last live import. */
export function resolveLatestRevisionStoryLabel(
  revisions: Array<{ snapshotRole: string | null; programmeState: string | null }>
): string | null {
  const liveIndices = computeLiveUpdateIndices(revisions);
  for (const meta of liveIndices.values()) {
    if (meta.isLatest) return `Update ${meta.index}`;
  }
  return null;
}

export function computeLiveUpdateIndices(
  revisions: Array<{ snapshotRole: string | null; programmeState: string | null }>
): Map<number, { index: number; isLatest: boolean; total: number }> {
  const result = new Map<number, { index: number; isLatest: boolean; total: number }>();
  const livePositions = revisions
    .map((r, i) => ({
      i,
      isLive: r.snapshotRole === "LIVE_IMPORT" || r.programmeState === "LIVE_UPDATE",
    }))
    .filter((x) => x.isLive);
  const total = livePositions.length;
  livePositions.forEach((pos, idx) => {
    result.set(pos.i, { index: idx + 1, isLatest: idx === total - 1, total });
  });
  return result;
}

function dependencyConsequence(relType: string, predecessorName: string | null, predecessorCode: string): string {
  const pred = formatActivityLabel(predecessorName, predecessorCode);
  const rel = formatRelationshipType(relType);
  if (relType === "FS") return `This activity now depends on ${pred} before it can start.`;
  if (relType === "FF") return `This activity now finishes in step with ${pred}.`;
  if (relType === "SS") return `This activity now starts in step with ${pred}.`;
  if (relType === "SF") return `This activity now controls when ${pred} can finish.`;
  return `A new ${rel} relationship was introduced with ${pred}.`;
}

export function buildLogicEventDescription(args: {
  type: string;
  activityName: string | null;
  activityCode: string;
  predecessorName?: string | null;
  predecessorCode?: string;
  relationshipType?: string;
  lagDays?: number;
  previousLagDays?: number;
  floatBefore?: number | null;
  floatAfter?: number | null;
}): string {
  const activity = formatActivityLabel(args.activityName, args.activityCode);

  switch (args.type) {
    case "FLOAT_LOST": {
      const before = formatFloatDays(args.floatBefore);
      const after = formatFloatDays(args.floatAfter);
      if (args.floatAfter === 0) {
        return `The activity gradually lost all scheduling flexibility and became critical. Total float reduced from ${before} to ${after}.`;
      }
      return `The activity lost scheduling flexibility. Total float reduced from ${before} to ${after}.`;
    }
    case "FLOAT_GAINED": {
      const before = formatFloatDays(args.floatBefore);
      const after = formatFloatDays(args.floatAfter);
      return `The activity gained additional scheduling flexibility. Total float increased from ${before} to ${after}.`;
    }
    case "NEGATIVE_FLOAT_INTRODUCED": {
      const before = formatFloatDays(args.floatBefore);
      const after = formatFloatDays(args.floatAfter);
      return `The activity is now behind the required programme dates. Total float reduced from ${before} to ${after}.`;
    }
    case "BECAME_CRITICAL": {
      const evidence =
        args.floatBefore != null && args.floatAfter != null
          ? ` Total float reduced from ${formatFloatDays(args.floatBefore)} to ${formatFloatDays(args.floatAfter)}.`
          : "";
      if (args.floatAfter === 0) {
        return `This activity became critical because it lost all scheduling flexibility.${evidence}`;
      }
      return `This activity became critical.${evidence}`;
    }
    case "LEFT_CRITICAL": {
      const evidence =
        args.floatAfter != null
          ? ` Total float is now ${formatFloatDays(args.floatAfter)}.`
          : "";
      return `This activity left the critical path and gained scheduling flexibility.${evidence}`;
    }
    case "APPROACHING_CRITICAL": {
      return `This activity is running low on scheduling flexibility. Total float is now ${formatFloatDays(args.floatAfter)}.`;
    }
    case "RELATIONSHIP_ADDED": {
      const rel = formatRelationshipType(args.relationshipType ?? "FS");
      const lagPart =
        args.lagDays != null && args.lagDays > 0 ? ` with a ${args.lagDays}-day lag` : "";
      if (args.predecessorCode && args.relationshipType) {
        return (
          dependencyConsequence(args.relationshipType, args.predecessorName ?? null, args.predecessorCode) +
          lagPart +
          "."
        );
      }
      return `A new ${rel} relationship was introduced${lagPart}.`;
    }
    case "RELATIONSHIP_REMOVED": {
      const rel = formatRelationshipType(args.relationshipType ?? "FS");
      if (args.predecessorCode) {
        const pred = formatActivityLabel(args.predecessorName ?? null, args.predecessorCode);
        return `A ${rel} dependency on ${pred} was removed.`;
      }
      return `A ${rel} relationship was removed.`;
    }
    case "RELATIONSHIP_TYPE_CHANGED": {
      const pred = args.predecessorCode
        ? formatActivityLabel(args.predecessorName ?? null, args.predecessorCode)
        : "another activity";
      return `The link between ${activity} and ${pred} changed relationship type.`;
    }
    case "LAG_INTRODUCED":
    case "LAG_INCREASED":
    case "LAG_DECREASED": {
      const rel = formatRelationshipType(args.relationshipType ?? "FS");
      const pred = args.predecessorCode
        ? formatActivityLabel(args.predecessorName ?? null, args.predecessorCode)
        : "its predecessor";
      if (args.type === "LAG_INTRODUCED") {
        return `A ${args.lagDays}-day lag was introduced on the ${rel} link to ${pred}.`;
      }
      return `Lag on the ${rel} link to ${pred} changed from ${formatFloatDays(args.previousLagDays)} to ${formatFloatDays(args.lagDays)}.`;
    }
    case "LAG_REMOVED": {
      const pred = args.predecessorCode
        ? formatActivityLabel(args.predecessorName ?? null, args.predecessorCode)
        : "its predecessor";
      return `The ${formatFloatDays(args.previousLagDays)} lag on the link to ${pred} was removed with the relationship.`;
    }
    default:
      return "";
  }
}

/** Short bullet for programme story timelines. */
export function logicEventStoryBullet(type: string, relationshipType?: string): string | null {
  switch (type) {
    case "RELATIONSHIP_ADDED":
      return relationshipType
        ? `${formatRelationshipType(relationshipType)} relationship introduced`
        : "Relationship introduced";
    case "RELATIONSHIP_REMOVED":
      return "Dependencies removed";
    case "RELATIONSHIP_TYPE_CHANGED":
      return "Relationship type changed";
    case "FLOAT_LOST":
      return "Float reduced";
    case "FLOAT_GAINED":
      return "Float increased";
    case "BECAME_CRITICAL":
      return "Activity became critical";
    case "LEFT_CRITICAL":
      return "Activity left the critical path";
    case "NEGATIVE_FLOAT_INTRODUCED":
      return "Activity fell behind programme dates";
    case "APPROACHING_CRITICAL":
      return "Float running low";
    case "LAG_INTRODUCED":
    case "LAG_INCREASED":
    case "LAG_DECREASED":
    case "LAG_REMOVED":
      return "Lag changed";
    case "RELATIONSHIP_COUNT_CHANGED":
      return null;
    default:
      return null;
  }
}
