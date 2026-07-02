import type { HistoricalRevision } from "./revisionGrouping.service.js";

export type DeliverableEvolutionTrend = "STABLE" | "GROWING" | "SHRINKING" | "OSCILLATING" | "UNKNOWN";

export type DeliverableEvolution = {
  initialDuration: number | null;
  maximumDuration: number | null;
  finalDuration: number | null;
  growthPercent: number | null;
  reductionPercent: number | null;
  revisionCount: number;
  largestChangeDays: number | null;
  trend: DeliverableEvolutionTrend;
};

function detectTrend(durations: number[]): DeliverableEvolutionTrend {
  if (durations.length < 2) return "UNKNOWN";
  const first = durations[0]!;
  const last = durations[durations.length - 1]!;
  const changes = durations.slice(1).map((d, i) => d - durations[i]!);
  const signChanges = changes.filter((c, i) => i > 0 && Math.sign(c) !== Math.sign(changes[i - 1]!)).length;
  if (signChanges >= 2) return "OSCILLATING";
  if (last > first * 1.1) return "GROWING";
  if (last < first * 0.9) return "SHRINKING";
  return "STABLE";
}

/** Compute evolution metrics from ordered revisions of one deliverable. */
export function computeDeliverableEvolution(revisions: HistoricalRevision[]): DeliverableEvolution {
  const durations = revisions
    .map((r) => r.durationDays)
    .filter((d): d is number => d != null && Number.isFinite(d));

  if (durations.length === 0) {
    return {
      initialDuration: null,
      maximumDuration: null,
      finalDuration: null,
      growthPercent: null,
      reductionPercent: null,
      revisionCount: revisions.length,
      largestChangeDays: null,
      trend: "UNKNOWN",
    };
  }

  const initial = durations[0]!;
  const final = durations[durations.length - 1]!;
  const maximum = Math.max(...durations);
  let largestChange = 0;
  for (let i = 1; i < durations.length; i++) {
    largestChange = Math.max(largestChange, Math.abs(durations[i]! - durations[i - 1]!));
  }

  const growthPercent = initial > 0 ? Math.round(((maximum - initial) / initial) * 1000) / 10 : null;
  const reductionPercent =
    maximum > 0 ? Math.round(((maximum - final) / maximum) * 1000) / 10 : null;

  return {
    initialDuration: initial,
    maximumDuration: maximum,
    finalDuration: final,
    growthPercent,
    reductionPercent,
    revisionCount: revisions.length,
    largestChangeDays: largestChange > 0 ? largestChange : null,
    trend: detectTrend(durations),
  };
}
