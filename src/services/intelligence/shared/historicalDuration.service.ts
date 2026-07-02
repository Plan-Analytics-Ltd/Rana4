/**
 * Phase 10 — Historical duration normalisation.
 *
 * The live deliverable duration (`deliverable.likelyDuration`) is a planner
 * work-package estimate. During XER bootstrap it is derived as
 *   deliverable.likelyDuration = max over activities of durationDays(activity)
 * where durationDays = remainingDuration ?? originalDuration ?? actualDuration.
 *
 * Historically the benchmark instead used the deliverable calendar span
 * (earliest activity start → latest activity finish), which is a different
 * measurement and inflated durations by an order of magnitude.
 *
 * CANONICAL DEFINITION (Phase 10):
 *   Historical deliverable duration = the planner-equivalent WORK-PACKAGE duration
 *   = max over the deliverable's activities of the activity work duration,
 *     where activity work duration = originalDuration ?? remainingDuration ?? actualDuration.
 *
 * This mirrors the live `deliverableDurationFromActivities` (max activity duration)
 * so the benchmark compares planner estimate ↔ historical planner estimate.
 * `originalDuration` is preferred first so estimates are not mixed with actual
 * elapsed durations across baseline/as-built revisions.
 *
 * Calendar span is used ONLY as a last resort when no activity duration exists.
 */

export type DurationBasis = "WORK_PACKAGE" | "MILESTONE" | "CALENDAR_SPAN_FALLBACK";

export type WorkPackageActivityDuration = {
  originalDuration?: number | null;
  remainingDuration?: number | null;
  actualDuration?: number | null;
};

export type WorkPackageDurationResult = {
  durationDays: number | null;
  basis: DurationBasis | null;
};

/** Planner work-package duration for a single activity (planned first, then actual). */
export function activityWorkDuration(activity: WorkPackageActivityDuration): number | null {
  const raw = activity.originalDuration ?? activity.remainingDuration ?? activity.actualDuration;
  if (raw == null || !Number.isFinite(raw) || raw < 0) return null;
  return Math.round(raw);
}

/**
 * Resolve the canonical work-package duration for a deliverable from its activities.
 *
 * Precedence:
 * 1. max activity work duration ≥ 1 → WORK_PACKAGE
 * 2. all activities resolve to 0 → MILESTONE (genuine 0-day work)
 * 3. no activity duration data + calendar span available → CALENDAR_SPAN_FALLBACK
 * 4. otherwise → null (no benchmark contribution)
 *
 * Deterministic: no randomness, no silent discards — the basis is always reported.
 */
export function resolveWorkPackageDuration(
  activities: WorkPackageActivityDuration[],
  calendarSpanDays?: number | null
): WorkPackageDurationResult {
  const durations = activities
    .map(activityWorkDuration)
    .filter((d): d is number => d != null);

  if (durations.length > 0) {
    const max = Math.max(...durations);
    if (max >= 1) return { durationDays: max, basis: "WORK_PACKAGE" };
    // Every linked activity is a 0-day activity → genuine milestone deliverable.
    return { durationDays: 0, basis: "MILESTONE" };
  }

  if (calendarSpanDays != null && Number.isFinite(calendarSpanDays) && calendarSpanDays >= 0) {
    return { durationDays: Math.round(calendarSpanDays), basis: "CALENDAR_SPAN_FALLBACK" };
  }

  return { durationDays: null, basis: null };
}
