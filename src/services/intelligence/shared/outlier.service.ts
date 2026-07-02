import { percentileRank } from "./robustStatistics.service.js";

/** Five-tier duration position relative to historical benchmark distribution. */
export type DurationPosition =
  | "WELL_BELOW"
  | "SLIGHTLY_BELOW"
  | "TYPICAL"
  | "SLIGHTLY_ABOVE"
  | "WELL_ABOVE";

/**
 * Legacy outlier status — derived from DurationPosition for API compatibility.
 * High-side names preserved; low-side uses new values where needed.
 */
export type OutlierStatus =
  | "NORMAL"
  | "SLIGHTLY_LOW"
  | "WELL_BELOW"
  | "SLIGHTLY_HIGH"
  | "HIGH"
  | "RED_FLAG"
  | "EXTREME_OUTLIER";

export const POSITION_PERCENTILE_THRESHOLDS = {
  wellBelow: 10,
  slightlyBelow: 25,
  slightlyAbove: 75,
  wellAbove: 90,
} as const;

/**
 * Duration position bands (inclusive boundaries):
 * - WELL_BELOW:     percentile rank <= 10
 * - SLIGHTLY_BELOW: percentile rank <= 25 (and > 10)
 * - TYPICAL:        percentile rank > 25 and < 75
 * - SLIGHTLY_ABOVE: percentile rank >= 75 (and < 90)
 * - WELL_ABOVE:     percentile rank >= 90
 *
 * When percentile rank is unavailable (empty history), median deviation % is used as fallback.
 */
export const MEDIAN_DEVIATION_THRESHOLDS = {
  slight: 0.25,
  high: 0.5,
  redFlag: 1.0,
  extreme: 1.5,
} as const;

function safeDiv(n: number, d: number): number | null {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

function toPct(x: number | null): number | null {
  return x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 10;
}

/** Classify current duration position using percentile rank within historical samples. */
export function classifyDurationPosition(
  percentile: number | null,
  medianDeviationPercent: number | null
): DurationPosition {
  if (percentile == null) {
    const dev = medianDeviationPercent;
    if (dev != null && dev <= -MEDIAN_DEVIATION_THRESHOLDS.high) return "WELL_BELOW";
    if (dev != null && dev <= -MEDIAN_DEVIATION_THRESHOLDS.slight * 100) return "SLIGHTLY_BELOW";
    if (dev != null && dev >= MEDIAN_DEVIATION_THRESHOLDS.extreme * 100) return "WELL_ABOVE";
    if (dev != null && dev >= MEDIAN_DEVIATION_THRESHOLDS.slight * 100) return "SLIGHTLY_ABOVE";
    return "TYPICAL";
  }

  if (percentile <= POSITION_PERCENTILE_THRESHOLDS.wellBelow) return "WELL_BELOW";
  if (percentile <= POSITION_PERCENTILE_THRESHOLDS.slightlyBelow) return "SLIGHTLY_BELOW";
  if (percentile >= POSITION_PERCENTILE_THRESHOLDS.wellAbove) return "WELL_ABOVE";
  if (percentile >= POSITION_PERCENTILE_THRESHOLDS.slightlyAbove) return "SLIGHTLY_ABOVE";
  return "TYPICAL";
}

/** Map duration position to legacy outlier status for downstream consumers. */
export function positionToLegacyStatus(
  position: DurationPosition,
  medianDeviationPercent: number | null
): OutlierStatus {
  switch (position) {
    case "WELL_BELOW":
      return "WELL_BELOW";
    case "SLIGHTLY_BELOW":
      return "SLIGHTLY_LOW";
    case "TYPICAL":
      return "NORMAL";
    case "SLIGHTLY_ABOVE":
      return "SLIGHTLY_HIGH";
    case "WELL_ABOVE": {
      const dev = medianDeviationPercent ?? 0;
      if (dev >= MEDIAN_DEVIATION_THRESHOLDS.extreme * 100) return "EXTREME_OUTLIER";
      if (dev >= MEDIAN_DEVIATION_THRESHOLDS.redFlag * 100) return "RED_FLAG";
      if (dev >= MEDIAN_DEVIATION_THRESHOLDS.high * 100) return "HIGH";
      return "SLIGHTLY_HIGH";
    }
    default:
      return "NORMAL";
  }
}

export function plannerPositionLabel(position: DurationPosition): string {
  switch (position) {
    case "WELL_BELOW":
      return "Well below historical benchmark";
    case "SLIGHTLY_BELOW":
      return "Slightly below historical benchmark";
    case "TYPICAL":
      return "Typical for comparable deliverables";
    case "SLIGHTLY_ABOVE":
      return "Slightly above historical benchmark";
    case "WELL_ABOVE":
      return "Well above historical benchmark";
    default:
      return "Typical for comparable deliverables";
  }
}

export function computeOutlier(args: {
  currentDurationDays: number | null;
  medianDurationDays: number | null;
  averageDurationDays?: number | null;
  standardDeviationDays?: number | null;
  historicalDurations?: number[];
}): {
  currentDurationDays: number | null;
  differenceFromAveragePercent: number | null;
  differenceFromMedianPercent: number | null;
  zScore: number | null;
  percentilePosition: number | null;
  position: DurationPosition;
  positionLabel: string;
  status: OutlierStatus;
} {
  const cur = args.currentDurationDays;
  const med = args.medianDurationDays;
  const avg = args.averageDurationDays ?? null;
  const sd = args.standardDeviationDays ?? null;
  const sorted = args.historicalDurations ? [...args.historicalDurations].sort((a, b) => a - b) : [];

  if (cur == null || !Number.isFinite(cur) || cur < 0) {
    return {
      currentDurationDays: null,
      differenceFromAveragePercent: null,
      differenceFromMedianPercent: null,
      zScore: null,
      percentilePosition: null,
      position: "TYPICAL",
      positionLabel: plannerPositionLabel("TYPICAL"),
      status: "NORMAL",
    };
  }

  const diffMed = med != null ? safeDiv(cur - med, med) : null;
  const diffAvg = avg != null ? safeDiv(cur - avg, avg) : null;
  const z = avg != null && sd != null && sd > 0 ? safeDiv(cur - avg, sd) : null;
  const pctRank = sorted.length > 0 ? percentileRank(sorted, cur) : null;
  const diffMedPct = diffMed != null ? diffMed * 100 : null;

  const position = classifyDurationPosition(pctRank, diffMedPct);
  const status = positionToLegacyStatus(position, diffMedPct);

  return {
    currentDurationDays: cur,
    differenceFromAveragePercent: toPct(diffAvg),
    differenceFromMedianPercent: toPct(diffMed),
    zScore: z != null && Number.isFinite(z) ? Math.round(z * 100) / 100 : null,
    percentilePosition: pctRank,
    position,
    positionLabel: plannerPositionLabel(position),
    status,
  };
}

/** Cap duration position when historical sample size is too small for strong conclusions. */
export function capPositionForSampleSize(sampleSize: number, raw: DurationPosition): DurationPosition {
  if (sampleSize <= 2) {
    if (raw === "WELL_BELOW") return "SLIGHTLY_BELOW";
    if (raw === "WELL_ABOVE") return "SLIGHTLY_ABOVE";
    return raw === "SLIGHTLY_ABOVE" || raw === "SLIGHTLY_BELOW" ? raw : "TYPICAL";
  }
  if (sampleSize <= 4) {
    if (raw === "WELL_BELOW") return "SLIGHTLY_BELOW";
    if (raw === "WELL_ABOVE") return "SLIGHTLY_ABOVE";
  }
  return raw;
}

/** Cap legacy outlier status when historical sample size is too small for strong conclusions. */
export function capOutlierStatusForSampleSize(sampleSize: number, raw: OutlierStatus): OutlierStatus {
  if (sampleSize <= 2) {
    if (raw === "EXTREME_OUTLIER" || raw === "RED_FLAG" || raw === "HIGH") return "NORMAL";
    if (raw === "WELL_BELOW") return "SLIGHTLY_LOW";
    return raw === "SLIGHTLY_HIGH" || raw === "SLIGHTLY_LOW" ? raw : "NORMAL";
  }
  if (sampleSize <= 4) {
    if (raw === "RED_FLAG" || raw === "EXTREME_OUTLIER") return "SLIGHTLY_HIGH";
    if (raw === "WELL_BELOW") return "SLIGHTLY_LOW";
    return raw;
  }
  return raw;
}

/** @deprecated Use MEDIAN_DEVIATION_THRESHOLDS — kept for findings compatibility */
export const OUTLIER_THRESHOLDS = {
  slightlyHighPctVsMedian: MEDIAN_DEVIATION_THRESHOLDS.slight,
  highPctVsMedian: MEDIAN_DEVIATION_THRESHOLDS.high,
  redFlagPctVsMedian: MEDIAN_DEVIATION_THRESHOLDS.redFlag,
  extremePctVsMedian: MEDIAN_DEVIATION_THRESHOLDS.extreme,
  zSlightlyHigh: 1.0,
  zHigh: 1.5,
  zRedFlag: 2.0,
  zExtreme: 3.0,
} as const;
