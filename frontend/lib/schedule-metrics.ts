import type { AssignedResource, RateCardEntry } from "@/lib/api";
import { type ScheduleActivity } from "@/lib/schedule-types";

export const HOURS_PER_DAY = 8;

export type ActivityMetrics = {
  predCount: number;
  succCount: number;
  resourceCount: number;
  totalHours: number;
  totalCost: number;
};

export function durationDays(activity: ScheduleActivity, scenario: "best" | "likely"): number {
  const d = scenario === "best" ? activity.bestDuration : activity.likelyDuration;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

export function assignmentCost(
  ar: AssignedResource,
  durationDaysVal: number,
  lookup: Map<string, RateCardEntry>
): { hours: number; cost: number } {
  const key = `${ar.resourceType.trim().toLowerCase()}|${ar.resourceName.trim().toLowerCase()}`;
  const entry = lookup.get(key);
  const rate = entry?.rate ?? ar.rate ?? 0;
  const unit = (entry?.unit ?? ar.unit ?? "hr").toLowerCase();
  let qty = ar.units;
  if (qty == null || !Number.isFinite(qty) || qty <= 0) {
    if (unit.includes("day") || unit === "d") qty = durationDaysVal;
    else qty = durationDaysVal * HOURS_PER_DAY;
  }
  const hours = unit.includes("day") || unit === "d" ? qty * HOURS_PER_DAY : qty;
  return { hours, cost: qty * rate };
}

export function activityMetrics(
  activity: ScheduleActivity,
  scenario: "best" | "likely",
  lookup: Map<string, RateCardEntry>
): ActivityMetrics {
  const days = durationDays(activity, scenario);
  let totalHours = 0;
  let totalCost = 0;
  for (const ar of activity.assignedResources) {
    const { hours, cost } = assignmentCost(ar, days, lookup);
    totalHours += hours;
    totalCost += cost;
  }
  return {
    predCount: activity.relationships.predecessors.length,
    succCount: activity.relationships.successors.length,
    resourceCount: activity.assignedResources.length,
    totalHours: Math.round(totalHours * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
  };
}
