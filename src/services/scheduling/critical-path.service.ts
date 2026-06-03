import type { ComputedScheduleActivity } from "./types.js";

export function identifyCriticalActivities(
  activities: ComputedScheduleActivity[]
): string[] {
  return activities.filter((a) => a.isCritical).map((a) => a.id);
}

export function applyCriticalFlags(activities: ComputedScheduleActivity[]): ComputedScheduleActivity[] {
  return activities.map((a) => ({
    ...a,
    isCritical: a.totalFloat === 0,
  }));
}
