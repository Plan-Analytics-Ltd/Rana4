import type { BenchmarkReport } from "../benchmark/benchmark.service.js";
import type { IntelligenceFinding } from "../findings/findings.service.js";
import type { IntelligenceRecommendation } from "../recommendations/recommendationEngine.service.js";
import { plannerPositionLabel, type DurationPosition } from "../shared/outlier.service.js";

export type IntelligenceConsistencyWarning = {
  code: string;
  message: string;
  layers: string[];
};

export type IntelligenceConsistencyReport = {
  consistent: boolean;
  warnings: IntelligenceConsistencyWarning[];
  unifiedPosition: DurationPosition | null;
  unifiedPositionLabel: string | null;
};

function positionFromReport(report: BenchmarkReport): DurationPosition | null {
  return report.outlier.position ?? null;
}

function findingImpliesBelow(findings: IntelligenceFinding[]): boolean {
  return findings.some(
    (f) => f.findingType === "DURATION_TOO_LOW" || f.findingType === "DURATION_TOO_HIGH"
  );
}

function recommendationImpliesBelow(recommendations: IntelligenceRecommendation[]): boolean {
  return recommendations.some((r) => r.recommendationType === "DURATION_REVIEW");
}

/**
 * Verify summary, observations, recommendations, and outlier position agree.
 * Returns warnings when layers contradict each other.
 */
export function checkIntelligenceConsistency(args: {
  report: BenchmarkReport;
  findings: IntelligenceFinding[];
  recommendations: IntelligenceRecommendation[];
}): IntelligenceConsistencyReport {
  const warnings: IntelligenceConsistencyWarning[] = [];
  const position = positionFromReport(args.report);
  const positionLabel = position ? plannerPositionLabel(position) : null;

  const hasBelowFinding = args.findings.some((f) => f.findingType === "DURATION_TOO_LOW");
  const hasAboveFinding = args.findings.some((f) => f.findingType === "DURATION_TOO_HIGH");
  const hasDurationReview = recommendationImpliesBelow(args.recommendations);

  if (position === "TYPICAL" && (hasBelowFinding || hasAboveFinding)) {
    warnings.push({
      code: "POSITION_VS_FINDING",
      message:
        "Duration position is typical but an above/below benchmark observation was recorded. Summary uses the unified position label.",
      layers: ["outlier", "findings"],
    });
  }

  if (position === "SLIGHTLY_BELOW" || position === "WELL_BELOW") {
    if (!hasBelowFinding && !hasDurationReview && args.report.benchmark.sampleSize > 0) {
      warnings.push({
        code: "BELOW_WITHOUT_OBSERVATION",
        message: "Duration is below benchmark but no matching observation was generated.",
        layers: ["outlier", "findings"],
      });
    }
  }

  if ((position === "SLIGHTLY_ABOVE" || position === "WELL_ABOVE") && !hasAboveFinding) {
    if (args.report.benchmark.sampleSize > 0) {
      warnings.push({
        code: "ABOVE_WITHOUT_OBSERVATION",
        message: "Duration is above benchmark but no matching observation was generated.",
        layers: ["outlier", "findings"],
      });
    }
  }

  if (hasDurationReview && position === "TYPICAL") {
    warnings.push({
      code: "REVIEW_VS_TYPICAL",
      message:
        "A duration review was recommended but the unified position is typical. Review recommendation takes precedence.",
      layers: ["outlier", "recommendations"],
    });
  }

  const strongBenchmark = args.findings.some((f) => f.findingType === "STRONG_BENCHMARK");
  if (strongBenchmark && (position === "WELL_BELOW" || position === "WELL_ABOVE")) {
    warnings.push({
      code: "STRONG_BENCHMARK_VS_POSITION",
      message:
        "Strong benchmark confidence was noted alongside a significant deviation from the median. Deviation takes precedence in the summary.",
      layers: ["findings", "outlier"],
    });
  }

  return {
    consistent: warnings.length === 0,
    warnings,
    unifiedPosition: position,
    unifiedPositionLabel: positionLabel,
  };
}
