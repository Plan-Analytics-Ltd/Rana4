import type { LearningMaturity } from "@prisma/client";

export type ConfidenceTier = "LOW" | "MEDIUM" | "HIGH";

export function confidenceLevelFromScore(score: number): ConfidenceTier {
  const s = Math.max(0, Math.min(1, score));
  if (s <= 0.39) return "LOW";
  if (s <= 0.69) return "MEDIUM";
  return "HIGH";
}

export function learningMaturityFrom(
  sampleSize: number,
  confidenceLevel: ConfidenceTier
): LearningMaturity {
  if (sampleSize >= 20 && confidenceLevel === "HIGH") return "WELL_KNOWN";
  if (sampleSize >= 10 && confidenceLevel !== "LOW") return "MODERATE";
  return "LIMITED";
}

export function learningMaturityLabel(maturity: LearningMaturity): string {
  if (maturity === "WELL_KNOWN") return "We know this very well";
  if (maturity === "MODERATE") return "Moderate evidence available";
  return "Very limited evidence";
}

export function predictabilityFromDurations(durations: number[]): number | null {
  if (durations.length < 2) return null;
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  if (mean <= 0) return null;
  const variance = durations.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (durations.length - 1);
  const cv = Math.sqrt(variance) / mean;
  return Math.round(Math.max(0, Math.min(1, 1 - cv / 0.5)) * 100) / 100;
}
