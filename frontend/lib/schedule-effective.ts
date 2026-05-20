import type { ScheduleActivity, ScheduleDeliverable } from "@/lib/schedule-types";

/**
 * Effective activity count for validation and UX.
 * Includes materialized rows (inherited + custom) and pending template steps when not yet cloned.
 */
export function getEffectiveActivityCount(
  deliverable: Pick<ScheduleDeliverable, "activities">,
  fragnetTemplateCount: number
): number {
  const materialized = deliverable.activities?.length ?? 0;
  if (materialized > 0) return materialized;
  return fragnetTemplateCount;
}

export function deliverableHasEffectiveWorkflow(
  deliverable: Pick<ScheduleDeliverable, "activities">,
  fragnetTemplateCount: number
): boolean {
  return getEffectiveActivityCount(deliverable, fragnetTemplateCount) > 0;
}

/** Rows not yet materialized but covered by fragnet templates. */
export function deliverableNeedsMaterialization(
  deliverable: Pick<ScheduleDeliverable, "activities">,
  fragnetTemplateCount: number
): boolean {
  return (deliverable.activities?.length ?? 0) === 0 && fragnetTemplateCount > 0;
}

export type ActivityOwnershipKind = "inherited" | "custom" | "detached";

export function activityOwnershipKind(
  a: Pick<ScheduleActivity, "isInherited" | "detachedFromTemplate" | "templateActivityId">
): ActivityOwnershipKind {
  if (a.templateActivityId && (a.detachedFromTemplate || !a.isInherited)) return "detached";
  if (a.isInherited && !a.detachedFromTemplate) return "inherited";
  return "custom";
}
