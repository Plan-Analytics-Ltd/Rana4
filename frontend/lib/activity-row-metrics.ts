import type { Activity, RateCardEntry } from "@/lib/api";
import { assignmentCost, HOURS_PER_DAY } from "@/lib/schedule-metrics";
import { rateCardLookup } from "@/lib/schedule-types";

export function activityListCostPreview(
  activity: Activity,
  rateCard: RateCardEntry[] | null,
  scenario: "best" | "likely" = "best"
): { totalCost: number; totalHours: number; missingRates: number } {
  const lookup = rateCardLookup(rateCard ?? []);
  const days =
    scenario === "best"
      ? activity.bestDuration > 0
        ? activity.bestDuration
        : 0
      : activity.likelyDuration > 0
        ? activity.likelyDuration
        : 0;
  let totalCost = 0;
  let totalHours = 0;
  let missingRates = 0;
  for (const ar of activity.assignedResources ?? []) {
    const key = `${ar.resourceType.trim().toLowerCase()}|${ar.resourceName.trim().toLowerCase()}`;
    if (rateCard && rateCard.length > 0 && !lookup.has(key)) missingRates++;
    const { hours, cost } = assignmentCost(ar, days, lookup);
    totalHours += hours;
    totalCost += cost;
  }
  return {
    totalCost: Math.round(totalCost * 100) / 100,
    totalHours: Math.round(totalHours * 100) / 100,
    missingRates,
  };
}

export { HOURS_PER_DAY };
