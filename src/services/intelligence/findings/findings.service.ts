import type { DurationPosition } from "../shared/outlier.service.js";
import {
  MEDIAN_DEVIATION_THRESHOLDS,
  plannerPositionLabel,
  type OutlierStatus,
} from "../shared/outlier.service.js";
import { getDeliverableBenchmark, type BenchmarkReport } from "../benchmark/benchmark.service.js";

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
  const items: { label: string; value: string | number }[] = [
    { label: "Deliverable", value: deliverable.name },
    { label: "Current duration (days)", value: outlier.currentDurationDays ?? "—" },
    { label: "Historical median (days)", value: benchmark.medianDuration ?? "—" },
    { label: "Typical range — IQR (days)", value:
      benchmark.percentile25 != null && benchmark.percentile75 != null
        ? `${benchmark.percentile25}–${benchmark.percentile75}`
        : "—" },
    { label: "Sample size", value: benchmark.sampleSize },
    { label: "Distinct projects", value: benchmark.benchmarkQuality?.distinctProjects ?? "—" },
    { label: "Benchmark confidence", value: benchmark.confidenceLevel ?? "—" },
  ];
  if (outlier.percentilePosition != null) {
    items.push({ label: "Percentile position", value: `${outlier.percentilePosition}%` });
  }
  return items;
}

function severityFromPosition(position: DurationPosition): FindingSeverity {
  if (position === "WELL_BELOW" || position === "WELL_ABOVE") return "HIGH";
  if (position === "SLIGHTLY_BELOW" || position === "SLIGHTLY_ABOVE") return "MEDIUM";
  return "LOW";
}

function mapBenchmarkConfidence(confidenceLevel: string | undefined): FindingConfidence {
  if (confidenceLevel === "HIGH") return "HIGH";
  if (confidenceLevel === "MEDIUM") return "MEDIUM";
  return "LOW";
}

function buildDeviationReasoning(
  outlier: BenchmarkReport["outlier"],
  benchmark: BenchmarkReport["benchmark"]
): string[] {
  const reasoning: string[] = [];
  const position = outlier.position ?? "TYPICAL";
  const med = benchmark.medianDuration;

  reasoning.push(plannerPositionLabel(position) + ".");

  if (med != null && outlier.currentDurationDays != null) {
    if (position === "WELL_BELOW" || position === "SLIGHTLY_BELOW") {
      reasoning.push(
        `The planned duration (${outlier.currentDurationDays} days) is shorter than the historical median (${med} days).`
      );
      if (benchmark.minimumDuration === 0 || benchmark.allSampleDurations?.includes(0)) {
        reasoning.push(
          "Although zero-duration examples exist in the historical record, the typical duration is considerably higher."
        );
      }
    } else if (position === "WELL_ABOVE" || position === "SLIGHTLY_ABOVE") {
      reasoning.push(
        `The planned duration (${outlier.currentDurationDays} days) is longer than the historical median (${med} days).`
      );
    }
  }

  if (outlier.percentilePosition != null) {
    reasoning.push(
      `This duration sits at the ${outlier.percentilePosition}th percentile of comparable historical observations.`
    );
  }

  const effectiveStatus = outlier.status as OutlierStatus;
  const rawStatus = (outlier.rawStatus ?? outlier.status) as OutlierStatus;
  if (effectiveStatus !== rawStatus) {
    reasoning.push(
      `Deviation severity is capped to ${effectiveStatus} due to limited sample size (raw=${rawStatus}).`
    );
  }

  return reasoning;
}

export function generateFindings(report: BenchmarkReport): IntelligenceFinding[] {
  const { benchmark, outlier, deliverable } = report;
  const findings: IntelligenceFinding[] = [];
  const benchConfidence = mapBenchmarkConfidence(benchmark.confidenceLevel);
  const evBlock = durationEvidenceBlock(benchmark, outlier, deliverable);
  const position = outlier.position ?? "TYPICAL";

  if (benchmark.sampleSize > 0 && (position === "WELL_ABOVE" || position === "SLIGHTLY_ABOVE")) {
    findings.push({
      findingType: "DURATION_TOO_HIGH",
      severity: severityFromPosition(position),
      confidence: benchConfidence,
      title:
        position === "WELL_ABOVE"
          ? "Duration well above historical benchmark"
          : "Duration slightly above historical benchmark",
      summary: "The current deliverable duration is longer than comparable historical programmes.",
      reasoning: buildDeviationReasoning(outlier, benchmark),
      evidence: evBlock,
    });
  }

  if (benchmark.sampleSize > 0 && (position === "WELL_BELOW" || position === "SLIGHTLY_BELOW")) {
    findings.push({
      findingType: "DURATION_TOO_LOW",
      severity: severityFromPosition(position),
      confidence: benchConfidence,
      title:
        position === "WELL_BELOW"
          ? "Duration well below historical benchmark"
          : "Duration slightly below historical benchmark",
      summary: "The current deliverable duration is shorter than comparable historical programmes.",
      reasoning: buildDeviationReasoning(outlier, benchmark),
      evidence: evBlock,
    });
  }

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
        ...(benchmark.benchmarkQuality?.distinctProjects === 1
          ? ["Evidence comes from a single project — multiple revisions do not count as independent projects."]
          : []),
      ],
      evidence: [
        { label: "Sample size", value: benchmark.sampleSize },
        { label: "Distinct projects", value: benchmark.benchmarkQuality?.distinctProjects ?? "—" },
        { label: "Benchmark confidence", value: benchmark.confidenceLevel ?? "—" },
      ],
    });
  }

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
        "Similarity, sample size, or project diversity reduce confidence.",
        ...(bq?.distinctProjects === 1 && (bq.revisionRatio ?? 0) > 1
          ? [`Evidence is drawn from one project with ${bq.distinctSnapshots ?? bq.sampleSize} programme revisions.`]
          : []),
        ...(bq
          ? [
              `Average project similarity: ${bq.averageProjectSimilarity}%.`,
              `Classification match rate: ${Math.round((bq.classificationMatchRate ?? 0) * 100)}%.`,
            ]
          : []),
      ],
      evidence: [
        { label: "Confidence score", value: benchmark.confidenceScore ?? "—" },
        { label: "Distinct projects", value: bq?.distinctProjects ?? "—" },
        { label: "Sample size", value: benchmark.sampleSize },
      ],
    });
  }

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
        `${bq?.distinctProjects ?? 0} independent project(s) contributed evidence.`,
        "Historical evidence is considered reliable.",
      ],
      evidence: [
        { label: "Sample size", value: benchmark.sampleSize },
        { label: "Distinct projects", value: bq?.distinctProjects ?? "—" },
        { label: "Median duration (days)", value: benchmark.medianDuration ?? "—" },
      ],
    });
  }

  const histOutlierCount = benchmark.historicalOutlierCount ?? 0;
  const histOutlierValues = benchmark.historicalOutlierValues ?? [];
  if (histOutlierCount > 0) {
    findings.push({
      findingType: "HISTORICAL_OUTLIER_PRESENT",
      severity: "MEDIUM",
      confidence: benchConfidence,
      title: "Unusual durations in historical evidence",
      summary: `${histOutlierCount} unusually long duration${histOutlierCount === 1 ? "" : "s"} detected in the evidence set.`,
      reasoning: [
        histOutlierCount === 1
          ? `One unusually long duration was detected (${histOutlierValues.join(", ")} days). It was retained but given lower influence during benchmarking.`
          : `${histOutlierCount} unusually long durations were detected (${histOutlierValues.join(", ")} days). They were retained but given lower influence during benchmarking.`,
        "The benchmark reference is primarily the historical median.",
      ],
      evidence: [
        { label: "Historical median (days)", value: benchmark.medianDuration ?? "—" },
        { label: "IQR range (days)", value:
          benchmark.percentile25 != null && benchmark.percentile75 != null
            ? `${benchmark.percentile25}–${benchmark.percentile75}`
            : "—" },
        { label: "Outlier count", value: histOutlierCount },
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

// Re-export threshold for tests
export { MEDIAN_DEVIATION_THRESHOLDS };
