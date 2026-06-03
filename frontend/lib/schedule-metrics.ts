import type { AssignedResource, RateCardEntry } from "@/lib/api";
import {
  type ProjectFullData,
  type ScheduleActivity,
  rateCardLookup,
} from "@/lib/schedule-types";

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

export type CostRollup = {
  totalCost: number;
  totalHours: number;
  activityCount: number;
  byResourceType: Record<string, number>;
};

export function rollupCosts(data: ProjectFullData, rateCard: RateCardEntry[], scenario: "best" | "likely"): {
  project: CostRollup;
  byFragnet: Map<string, CostRollup & { name: string }>;
  byDeliverable: Map<string, CostRollup & { name: string }>;
} {
  const lookup = rateCardLookup(rateCard);
  const empty = (): CostRollup => ({
    totalCost: 0,
    totalHours: 0,
    activityCount: 0,
    byResourceType: {},
  });
  const project = empty();
  const byFragnet = new Map<string, CostRollup & { name: string }>();
  const byDeliverable = new Map<string, CostRollup & { name: string }>();

  const add = (bucket: CostRollup, activity: ScheduleActivity) => {
    const m = activityMetrics(activity, scenario, lookup);
    bucket.totalCost += m.totalCost;
    bucket.totalHours += m.totalHours;
    bucket.activityCount += 1;
    for (const ar of activity.assignedResources) {
      const { cost } = assignmentCost(ar, durationDays(activity, scenario), lookup);
      const t = ar.resourceType || "Other";
      bucket.byResourceType[t] = (bucket.byResourceType[t] ?? 0) + cost;
    }
  };

  for (const f of data.fragnets) {
    const fb = { ...empty(), name: f.name };
    for (const a of f.sharedActivities ?? []) {
      add(project, a);
      add(fb, a);
    }
    for (const d of f.deliverables) {
      const db = { ...empty(), name: d.name };
      for (const a of d.activities) {
        add(project, a);
        add(fb, a);
        add(db, a);
      }
      byDeliverable.set(d.id, db);
    }
    byFragnet.set(f.id, fb);
  }

  project.totalCost = Math.round(project.totalCost * 100) / 100;
  project.totalHours = Math.round(project.totalHours * 100) / 100;
  return { project, byFragnet, byDeliverable };
}
