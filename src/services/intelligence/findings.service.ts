import type { OutlierStatus } from "./outlier.service.js";
import { OUTLIER_THRESHOLDS } from "./outlier.service.js";
import { getDeliverableBenchmark, type BenchmarkReport } from "./benchmark.service.js";

export type FindingSeverity = "LOW" | "MEDIUM" | "HIGH";
export type FindingConfidence = "LOW" | "MEDIUM" | "HIGH";

export type IntelligenceFinding = {
  findingType: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  title: string;
  summary: string;
  reasoning: string[];
  evidence: { label: string; value: string | number }[];
};

function durationEvidenceBlock(
  benchmark: BenchmarkReport["benchmark"],
  outlier: BenchmarkReport["outlier"],
  deliverable: BenchmarkReport["deliverable"]
): { label: string; value: string | number }[] {
  return [
    { label: "Deliverable", value: deliverable.name },
    { label: "Current Duration (days)", value: outlier.currentDurationDays ?? "—" },
    { label: "Historical Average (days)", value: benchmark.averageDuration ?? "—" },
    { label: "Historical Median (days)", value: benchmark.medianDuration ?? "—" },
    { label: "Historical Maximum (days)", value: benchmark.maximumDuration ?? "—" },
    { label: "Historical Minimum (days)", value: benchmark.minimumDuration ?? "—" },
    { label: "Sample Size", value: benchmark.sampleSize },
    { label: "Benchmark Confidence", value: benchmark.confidenceLevel ?? "—" },
  ];
}

function severityFromHighOutlierStatus(status: OutlierStatus): FindingSeverity {
  if (status === "SLIGHTLY_HIGH") return "LOW";
  if (status === "HIGH") return "MEDIUM";
  if (status === "RED_FLAG" || status === "EXTREME_OUTLIER") return "HIGH";
  return "LOW";
}

function severityFromLowDeviation(pctBelow: number): FindingSeverity {
  const abs = Math.abs(pctBelow);
  if (abs >= OUTLIER_THRESHOLDS.extremePctVsMedian * 100) return "HIGH";
  if (abs >= OUTLIER_THRESHOLDS.redFlagPctVsMedian * 100) return "HIGH";
  if (abs >= OUTLIER_THRESHOLDS.highPctVsMedian * 100) return "MEDIUM";
  if (abs >= OUTLIER_THRESHOLDS.slightlyHighPctVsMedian * 100) return "LOW";
  return "LOW";
}

function isDurationTooLow(outlier: BenchmarkReport["outlier"]): { triggered: boolean; pctBelow: number | null } {
  const cur = outlier.currentDurationDays;
  if (cur == null || !Number.isFinite(cur)) return { triggered: false, pctBelow: null };

  const diffMed = outlier.differenceFromMedianPercent;
  const diffAvg = outlier.differenceFromAveragePercent;

  // Negative percent means current is below benchmark reference.
  const ref = diffMed ?? diffAvg;
  if (ref == null || !Number.isFinite(ref)) return { triggered: false, pctBelow: null };

  const thresholdPct = OUTLIER_THRESHOLDS.slightlyHighPctVsMedian * 100;
  if (ref <= -thresholdPct) return { triggered: true, pctBelow: ref };
  return { triggered: false, pctBelow: ref };
}

function detectHistoricalDurationOutliers(durations: number[]): number[] {
  if (durations.length < 4) return [];
  const sorted = [...durations].sort((a, b) => a - b);
  const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)]!;
  const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)]!;
  const iqr = q3 - q1;
  if (iqr <= 0) return [];
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  return sorted.filter((d) => d < lower || d > upper);
}

function mapBenchmarkConfidence(confidenceLevel: string | undefined): FindingConfidence {
  if (confidenceLevel === "HIGH") return "HIGH";
  if (confidenceLevel === "MEDIUM") return "MEDIUM";
  return "LOW";
}

export function generateFindings(report: BenchmarkReport): IntelligenceFinding[] {
  const { benchmark, outlier, evidence, deliverable } = report;
  const findings: IntelligenceFinding[] = [];
  const benchConfidence = mapBenchmarkConfidence(benchmark.confidenceLevel);
  const evBlock = durationEvidenceBlock(benchmark, outlier, deliverable);

  const rawStatus = (outlier.rawStatus ?? outlier.status) as OutlierStatus;
  const effectiveStatus = outlier.status as OutlierStatus;

  // DURATION_TOO_HIGH — use raw outlier status (pre sample-size cap) for detection & severity
  if (
    rawStatus !== "NORMAL" &&
    outlier.currentDurationDays != null &&
    benchmark.sampleSize > 0
  ) {
    const reasoning: string[] = [];
    if (outlier.differenceFromAveragePercent != null && outlier.differenceFromAveragePercent > 0) {
      reasoning.push(
        `Current duration exceeds historical average by ${outlier.differenceFromAveragePercent}%.`
      );
    } else {
      reasoning.push("Current duration exceeds historical average.");
    }
    if (outlier.differenceFromMedianPercent != null && outlier.differenceFromMedianPercent > 0) {
      reasoning.push(
        `Current duration exceeds historical median by ${outlier.differenceFromMedianPercent}%.`
      );
    } else {
      reasoning.push("Current duration exceeds historical median.");
    }
    if (
      benchmark.maximumDuration != null &&
      outlier.currentDurationDays != null &&
      outlier.currentDurationDays > benchmark.maximumDuration
    ) {
      reasoning.push("Current duration exceeds the highest comparable duration in the evidence set.");
    }
    if (effectiveStatus !== rawStatus) {
      reasoning.push(
        `Effective outlier status is capped to ${effectiveStatus} due to limited sample size (raw=${rawStatus}).`
      );
    }

    findings.push({
      findingType: "DURATION_TOO_HIGH",
      severity: severityFromHighOutlierStatus(rawStatus),
      confidence: benchConfidence,
      title: "Duration significantly exceeds benchmark",
      summary: "The current deliverable duration is higher than comparable historical programmes.",
      reasoning,
      evidence: evBlock,
    });
  }

  // DURATION_TOO_LOW
  const lowCheck = isDurationTooLow(outlier);
  if (lowCheck.triggered && benchmark.sampleSize > 0) {
    const reasoning = [
      "Current duration is substantially lower than comparable programmes.",
      "Historical evidence suggests this estimate may be optimistic.",
    ];
    if (lowCheck.pctBelow != null) {
      reasoning.unshift(
        `Current duration is ${Math.abs(lowCheck.pctBelow)}% below the historical median or average reference.`
      );
    }
    findings.push({
      findingType: "DURATION_TOO_LOW",
      severity: severityFromLowDeviation(lowCheck.pctBelow ?? 0),
      confidence: benchConfidence,
      title: "Duration significantly below benchmark",
      summary: "The current deliverable duration is lower than comparable historical programmes.",
      reasoning,
      evidence: evBlock,
    });
  }

  // LIMITED_HISTORICAL_EVIDENCE
  if (benchmark.sampleSize > 0 && benchmark.sampleSize < 5) {
    findings.push({
      findingType: "LIMITED_HISTORICAL_EVIDENCE",
      severity: "LOW",
      confidence: "LOW",
      title: "Limited historical evidence",
      summary: `Benchmark is based on ${benchmark.sampleSize} comparable deliverable${benchmark.sampleSize === 1 ? "" : "s"}.`,
      reasoning: [
        "Benchmark is based on a limited number of comparable deliverables.",
        "Statistical confidence is reduced.",
      ],
      evidence: [
        { label: "Sample Size", value: benchmark.sampleSize },
        { label: "Benchmark Confidence", value: benchmark.confidenceLevel ?? "—" },
        { label: "Sample Size Tier", value: benchmark.sampleSizeConfidenceTier ?? "—" },
      ],
    });
  }

  // LOW_CONFIDENCE_BENCHMARK
  if (benchmark.confidenceLevel === "LOW" && benchmark.sampleSize > 0) {
    const bq = benchmark.benchmarkQuality;
    findings.push({
      findingType: "LOW_CONFIDENCE_BENCHMARK",
      severity: "MEDIUM",
      confidence: "LOW",
      title: "Low confidence benchmark",
      summary: "Historical evidence quality is limited for this comparison.",
      reasoning: [
        "Historical evidence quality is limited.",
        "Similarity, sample size, or data completeness reduce confidence.",
        ...(bq
          ? [
              `Average project similarity: ${bq.averageProjectSimilarity}%.`,
              `Classification match rate: ${Math.round((bq.classificationMatchRate ?? 0) * 100)}%.`,
              `Data completeness: ${Math.round((bq.dataCompleteness ?? 0) * 100)}%.`,
            ]
          : []),
      ],
      evidence: [
        { label: "Confidence Score", value: benchmark.confidenceScore ?? "—" },
        { label: "Confidence Level", value: benchmark.confidenceLevel },
        { label: "Sample Size", value: benchmark.sampleSize },
        ...(bq
          ? [
              { label: "Average Project Similarity", value: `${bq.averageProjectSimilarity}%` },
              { label: "Data Completeness", value: bq.dataCompleteness },
            ]
          : []),
      ],
    });
  }

  // STRONG_BENCHMARK
  if (benchmark.confidenceLevel === "HIGH" && benchmark.sampleSize >= 10) {
    const bq = benchmark.benchmarkQuality;
    findings.push({
      findingType: "STRONG_BENCHMARK",
      severity: "LOW",
      confidence: "HIGH",
      title: "Strong benchmark confidence",
      summary: "Historical evidence for this comparison is considered reliable.",
      reasoning: [
        "Large sample size available.",
        "Comparable projects show strong alignment.",
        "Historical evidence is considered reliable.",
      ],
      evidence: [
        { label: "Sample Size", value: benchmark.sampleSize },
        { label: "Confidence Level", value: benchmark.confidenceLevel },
        { label: "Confidence Score", value: benchmark.confidenceScore ?? "—" },
        ...(bq
          ? [
              { label: "Average Project Similarity", value: `${bq.averageProjectSimilarity}%` },
              { label: "Classification Match Rate", value: bq.classificationMatchRate },
            ]
          : []),
      ],
    });
  }

  // HISTORICAL_OUTLIER_PRESENT
  const durations = benchmark.allSampleDurations ?? [];
  const histOutliers = detectHistoricalDurationOutliers(durations);
  if (histOutliers.length > 0) {
    findings.push({
      findingType: "HISTORICAL_OUTLIER_PRESENT",
      severity: "MEDIUM",
      confidence: benchConfidence,
      title: "Historical outliers in evidence set",
      summary: `${histOutliers.length} historical duration value${histOutliers.length === 1 ? "" : "s"} appear statistically unusual.`,
      reasoning: [
        "One or more historical projects contain unusual duration values.",
        "Benchmark averages may be influenced by exceptional cases.",
        `Outlier durations (days): ${histOutliers.join(", ")}.`,
      ],
      evidence: [
        { label: "Sample Size", value: benchmark.sampleSize },
        { label: "Historical Outlier Count", value: histOutliers.length },
        { label: "Historical Average (days)", value: benchmark.averageDuration ?? "—" },
        { label: "Historical Median (days)", value: benchmark.medianDuration ?? "—" },
      ],
    });
  }

  return findings;
}

export async function getDeliverableFindings(args: {
  projectId: string;
  companyId: string;
  deliverableId: string;
  selectedProjectIds?: string[];
}): Promise<{ findings: IntelligenceFinding[] }> {
  const report = await getDeliverableBenchmark(args);
  const findings = generateFindings(report);
  return { findings };
}
