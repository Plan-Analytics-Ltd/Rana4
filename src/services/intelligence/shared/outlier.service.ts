export type OutlierStatus =
  | "NORMAL"
  | "SLIGHTLY_HIGH"
  | "HIGH"
  | "RED_FLAG"
  | "EXTREME_OUTLIER";

export const OUTLIER_THRESHOLDS = {
  slightlyHighPctVsMedian: 0.25,
  highPctVsMedian: 0.5,
  redFlagPctVsMedian: 1.0,
  extremePctVsMedian: 1.5,
  zSlightlyHigh: 1.0,
  zHigh: 1.5,
  zRedFlag: 2.0,
  zExtreme: 3.0,
} as const;

function safeDiv(n: number, d: number): number | null {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

export function computeOutlier(args: {
  currentDurationDays: number | null;
  averageDurationDays: number | null;
  medianDurationDays: number | null;
  standardDeviationDays: number | null;
}): {
  currentDurationDays: number | null;
  differenceFromAveragePercent: number | null;
  differenceFromMedianPercent: number | null;
  zScore: number | null;
  status: OutlierStatus;
} {
  const cur = args.currentDurationDays;
  const avg = args.averageDurationDays;
  const med = args.medianDurationDays;
  const sd = args.standardDeviationDays;

  if (cur == null || !Number.isFinite(cur) || cur < 0) {
    return {
      currentDurationDays: null,
      differenceFromAveragePercent: null,
      differenceFromMedianPercent: null,
      zScore: null,
      status: "NORMAL",
    };
  }

  const diffAvg = avg != null ? safeDiv(cur - avg, avg) : null;
  const diffMed = med != null ? safeDiv(cur - med, med) : null;
  const z = avg != null && sd != null && sd > 0 ? safeDiv(cur - avg, sd) : null;

  // We only flag unusually HIGH durations in this phase (benchmark & red flag).
  const pct = diffMed ?? diffAvg;
  const zScore = z;

  let status: OutlierStatus = "NORMAL";
  const p = pct ?? null;
  const zz = zScore ?? null;

  const isExtreme =
    (p != null && p >= OUTLIER_THRESHOLDS.extremePctVsMedian) || (zz != null && zz >= OUTLIER_THRESHOLDS.zExtreme);
  const isRed =
    (p != null && p >= OUTLIER_THRESHOLDS.redFlagPctVsMedian) || (zz != null && zz >= OUTLIER_THRESHOLDS.zRedFlag);
  const isHigh = (p != null && p >= OUTLIER_THRESHOLDS.highPctVsMedian) || (zz != null && zz >= OUTLIER_THRESHOLDS.zHigh);
  const isSlight =
    (p != null && p >= OUTLIER_THRESHOLDS.slightlyHighPctVsMedian) || (zz != null && zz >= OUTLIER_THRESHOLDS.zSlightlyHigh);

  if (isExtreme) status = "EXTREME_OUTLIER";
  else if (isRed) status = "RED_FLAG";
  else if (isHigh) status = "HIGH";
  else if (isSlight) status = "SLIGHTLY_HIGH";

  const toPct = (x: number | null): number | null =>
    x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 10; // 1dp percentage

  const toZ = (x: number | null): number | null => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

  return {
    currentDurationDays: cur,
    differenceFromAveragePercent: toPct(diffAvg),
    differenceFromMedianPercent: toPct(diffMed),
    zScore: toZ(zScore),
    status,
  };
}

