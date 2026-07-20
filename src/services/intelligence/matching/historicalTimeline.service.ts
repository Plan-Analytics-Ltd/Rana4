import type { ProgrammeState } from "@prisma/client";
import type { HistoricalRevision } from "./revisionGrouping.service.js";
import { computeDeliverableEvolution } from "./deliverableEvolution.service.js";

export type DeliverableTimelineIntelligence = {
  typicalBaselineDuration: number | null;
  typicalPeakDuration: number | null;
  typicalCompletedDuration: number | null;
  averageGrowthPercent: number | null;
  averageReductionPercent: number | null;
  averageRevisionCount: number;
  mostCommonRevisionStage: string | null;
  largestHistoricalIncrease: number | null;
  evolutionSummary: string | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function stageLabel(state: ProgrammeState | null): string {
  if (state === "APPROVED_BASELINE" || state === "BASELINE") return "baseline";
  if (state === "AS_BUILT" || state === "FINAL_AS_BUILT") return "completion";
  if (state === "LIVE_UPDATE") return "live update";
  return "revision";
}

/** Aggregate timeline intelligence across revisions for one deliverable identity. */
export function computeDeliverableTimeline(
  revisions: HistoricalRevision[]
): DeliverableTimelineIntelligence {
  const evolution = computeDeliverableEvolution(revisions);
  const baselineDurations = revisions
    .filter((r) => r.programmeState === "APPROVED_BASELINE" || r.programmeState === "BASELINE")
    .map((r) => r.durationDays)
    .filter((d): d is number => d != null);
  const completedDurations = revisions
    .filter((r) => r.programmeState === "AS_BUILT" || r.programmeState === "FINAL_AS_BUILT")
    .map((r) => r.durationDays)
    .filter((d): d is number => d != null);
  const allDurations = revisions.map((r) => r.durationDays).filter((d): d is number => d != null);

  const stageCounts = new Map<string, number>();
  for (const r of revisions) {
    const label = stageLabel(r.programmeState);
    stageCounts.set(label, (stageCounts.get(label) ?? 0) + 1);
  }
  const mostCommonRevisionStage =
    [...stageCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const typicalBaseline = median(baselineDurations) ?? evolution.initialDuration;
  const typicalCompleted = median(completedDurations) ?? evolution.finalDuration;
  const typicalPeak = evolution.maximumDuration ?? (allDurations.length ? Math.max(...allDurations) : null);

  let evolutionSummary: string | null = null;
  if (typicalBaseline != null && typicalPeak != null && typicalCompleted != null && revisions.length >= 2) {
    if (evolution.trend === "GROWING" || (typicalPeak > typicalBaseline * 1.15 && typicalCompleted < typicalPeak)) {
      evolutionSummary = `Remaining work started around ${Math.round(typicalBaseline)} days, peaked near ${Math.round(typicalPeak)} days during the programme, and typically settled at ${Math.round(typicalCompleted)} days.`;
    } else if (evolution.trend === "STABLE") {
      evolutionSummary = `Remaining work stayed relatively stable across revisions (around ${Math.round(typicalBaseline ?? typicalCompleted)} days).`;
    } else if (evolution.trend === "SHRINKING") {
      evolutionSummary = `Remaining work reduced across revisions, from around ${Math.round(typicalBaseline ?? evolution.initialDuration ?? 0)} days toward ${Math.round(typicalCompleted)} days.`;
    } else if (evolution.trend === "OSCILLATING") {
      evolutionSummary = `Remaining work varied across revisions before settling around ${Math.round(typicalCompleted)} days.`;
    }
  }

  return {
    typicalBaselineDuration: typicalBaseline != null ? Math.round(typicalBaseline) : null,
    typicalPeakDuration: typicalPeak != null ? Math.round(typicalPeak) : null,
    typicalCompletedDuration: typicalCompleted != null ? Math.round(typicalCompleted) : null,
    averageGrowthPercent: evolution.growthPercent,
    averageReductionPercent: evolution.reductionPercent,
    averageRevisionCount: revisions.length,
    mostCommonRevisionStage: mostCommonRevisionStage,
    largestHistoricalIncrease: evolution.largestChangeDays,
    evolutionSummary,
  };
}
