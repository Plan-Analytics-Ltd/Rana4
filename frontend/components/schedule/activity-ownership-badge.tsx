"use client";

import type { Activity } from "@/lib/api";
import type { ScheduleActivity } from "@/lib/schedule-types";

/** Internal ownership is hidden from planner UX — reserved for future admin surfaces. */
export function ActivityOwnershipBadge(_props: {
  activity?:
    | Pick<Activity, "isInherited" | "detachedFromTemplate" | "templateActivityId">
    | ScheduleActivity;
  className?: string;
}) {
  return null;
}
