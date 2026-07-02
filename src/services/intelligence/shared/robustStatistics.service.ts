import { median, percentile } from "./durationEvidence.service.js";

/**
 * Statistical conventions (Phase 9.1 validated):
 *
 * PERCENTILE (Q1, Q3, interpolated quantiles)
 * - Linear interpolation between order statistics.
 * - Index = (n - 1) * p for p in [0, 1].
 * - Equivalent to NumPy `numpy.percentile(a, q, method='linear')` with q in 0–100.
 * - Requires sorted input.
 *
 * PERCENTILE RANK (empirical CDF mid-rank)
 * - rank = (count_below + 0.5 * count_equal) / n * 100
 * - Deterministic for ties and boundaries.
 * - Value below all samples → 0; above all samples → 100.
 *
 * IQR OUTLIERS (Tukey fences)
 * - Q1 = 25th percentile, Q3 = 75th percentile, IQR = Q3 - Q1.
 * - Lower fence = Q1 - 1.5 * IQR, upper fence = Q3 + 1.5 * IQR.
 * - Values outside fences are flagged; none are removed from the sample.
 * - Requires n >= 4; otherwise returns empty outlier set.
 *
 * ROBUST BENCHMARK
 * - Primary reference is always the median.
 * - Trimmed mean (10% each tail) is supplementary only.
 * - Outliers affect the statistics note, not the median.
 */
export type HistoricalOutlierInfo = {
  values: number[];
  count: number;
  lowerBound: number;
  upperBound: number;
};

export type RobustBenchmarkStats = {
  sampleSize: number;
  medianDuration: number | null;
  percentile25: number | null;
  percentile75: number | null;
  interquartileRange: number | null;
  trimmedMean: number | null;
  averageDuration: number | null;
  standardDeviation: number | null;
  minimumDuration: number | null;
  maximumDuration: number | null;
  historicalOutliers: HistoricalOutlierInfo;
  primaryReference: "median";
  statisticsNote: string | null;
};

/** Tukey IQR fence outlier detection — values are retained, not removed. */
export function detectIqrOutliers(sorted: number[]): HistoricalOutlierInfo {
  if (sorted.length < 4) {
    return { values: [], count: 0, lowerBound: 0, upperBound: 0 };
  }
  const q1 = percentile(sorted, 0.25) ?? sorted[0]!;
  const q3 = percentile(sorted, 0.75) ?? sorted[sorted.length - 1]!;
  const iqr = q3 - q1;
  if (iqr <= 0) {
    return { values: [], count: 0, lowerBound: q1, upperBound: q3 };
  }
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  const values = sorted.filter((d) => d < lowerBound || d > upperBound);
  return { values, count: values.length, lowerBound, upperBound };
}

function trimmedMean(sorted: number[], trimFraction = 0.1): number | null {
  if (sorted.length === 0) return null;
  const trim = Math.floor(sorted.length * trimFraction);
  const slice = sorted.slice(trim, sorted.length - trim || undefined);
  if (slice.length === 0) return median(sorted);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function stddev(values: number[], mean: number): number | null {
  if (values.length < 2) return null;
  const v = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

/** Build robust benchmark statistics with outlier awareness. */
export function computeRobustBenchmarkStats(durations: number[]): RobustBenchmarkStats {
  const sorted = [...durations].sort((a, b) => a - b);
  const sampleSize = sorted.length;
  if (sampleSize === 0) {
    return {
      sampleSize: 0,
      medianDuration: null,
      percentile25: null,
      percentile75: null,
      interquartileRange: null,
      trimmedMean: null,
      averageDuration: null,
      standardDeviation: null,
      minimumDuration: null,
      maximumDuration: null,
      historicalOutliers: { values: [], count: 0, lowerBound: 0, upperBound: 0 },
      primaryReference: "median",
      statisticsNote: null,
    };
  }

  const med = median(sorted);
  const p25 = percentile(sorted, 0.25);
  const p75 = percentile(sorted, 0.75);
  const iqr = p25 != null && p75 != null ? p75 - p25 : null;
  const outliers = detectIqrOutliers(sorted);
  const avg = sorted.reduce((a, b) => a + b, 0) / sampleSize;
  const tMean = trimmedMean(sorted);
  const sd = stddev(sorted, avg);

  let statisticsNote: string | null = null;
  if (outliers.count > 0 && med != null) {
    const outlierList = outliers.values.join(", ");
    statisticsNote =
      outliers.count === 1
        ? `One unusually long duration was detected (${outlierList} days). It was retained but the benchmark is based primarily on the historical median (${med} days).`
        : `${outliers.count} unusually long durations were detected (${outlierList} days). They were retained but the benchmark is based primarily on the historical median (${med} days).`;
  } else if (med != null) {
    statisticsNote = `Benchmark reference is the historical median (${med} days) with interquartile range ${p25 ?? "—"}–${p75 ?? "—"} days.`;
  }

  return {
    sampleSize,
    medianDuration: med != null ? Math.round(med * 10) / 10 : null,
    percentile25: p25 != null ? Math.round(p25 * 10) / 10 : null,
    percentile75: p75 != null ? Math.round(p75 * 10) / 10 : null,
    interquartileRange: iqr != null ? Math.round(iqr * 10) / 10 : null,
    trimmedMean: tMean != null ? Math.round(tMean * 10) / 10 : null,
    averageDuration: Math.round(avg * 10) / 10,
    standardDeviation: sd != null ? Math.round(sd * 10) / 10 : null,
    minimumDuration: sorted[0]!,
    maximumDuration: sorted[sorted.length - 1]!,
    historicalOutliers: outliers,
    primaryReference: "median",
    statisticsNote,
  };
}

/**
 * Percentile rank of a value within a sorted sample (0–100).
 * Uses linear interpolation between ranks.
 */
export function percentileRank(sorted: number[], value: number): number | null {
  if (sorted.length === 0 || !Number.isFinite(value)) return null;
  let below = 0;
  let equal = 0;
  for (const d of sorted) {
    if (d < value) below += 1;
    else if (d === value) equal += 1;
  }
  return Math.round(((below + equal * 0.5) / sorted.length) * 1000) / 10;
}
