import type { BenchmarkOutlierStatus, DeliverableIntelligenceAnalysis } from "@/lib/api";
import { humanOutlierStatus } from "@/lib/intelligence-terminology";

export type DeliverableAttentionLevel = "aligned" | "review" | "high_risk" | "limited";

export type DeliverableStatusSnapshot = {
  deliverableId: string;
  deliverableName: string;
  attention: DeliverableAttentionLevel;
  label: string;
  outlierStatus: BenchmarkOutlierStatus | null;
  recommendationCount: number;
  observationCount: number;
  trustLabel: string | null;
  confidenceLevel: string | null;
  hasComparison: boolean;
};

export function attentionFromOutlier(
  status: BenchmarkOutlierStatus | null | undefined,
  sampleSize: number
): DeliverableAttentionLevel {
  if (!status || sampleSize === 0) return "limited";
  if (status === "NORMAL") return "aligned";
  if (status === "SLIGHTLY_HIGH" || status === "SLIGHTLY_LOW") return "review";
  return "high_risk";
}

export function labelForAttention(level: DeliverableAttentionLevel): string {
  switch (level) {
    case "aligned":
      return "Matches previous projects";
    case "review":
      return "Worth reviewing";
    case "high_risk":
      return "Needs attention";
    default:
      return "No completed projects for comparison yet";
  }
}

export function snapshotFromAnalysis(analysis: DeliverableIntelligenceAnalysis): DeliverableStatusSnapshot {
  const sampleSize = analysis.benchmark?.sampleSize ?? analysis.evidence?.sampleSize ?? 0;
  const status = analysis.outlier?.status ?? null;
  const attention = attentionFromOutlier(status, sampleSize);

  return {
    deliverableId: analysis.deliverable.id,
    deliverableName: analysis.deliverable.name,
    attention,
    label: labelForAttention(attention),
    outlierStatus: status,
    recommendationCount: analysis.recommendations?.length ?? 0,
    observationCount: analysis.observations?.length ?? 0,
    trustLabel: analysis.trust?.trustLabel ?? null,
    confidenceLevel: analysis.benchmark?.confidenceLevel ?? analysis.benchmark?.expectedDuration?.confidenceLevel ?? null,
    hasComparison: sampleSize > 0 || (analysis.benchmark?.expectedDuration?.evidenceCount ?? 0) > 0,
  };
}

export function scheduleTooltipForSnapshot(snapshot: DeliverableStatusSnapshot | undefined): string | null {
  if (!snapshot) return null;
  if (snapshot.attention === "aligned") return "In line with similar work from previous projects.";
  if (snapshot.attention === "review") return "Differs from similar work on previous projects — worth a look.";
  if (snapshot.attention === "high_risk") return humanOutlierStatus(snapshot.outlierStatus ?? "HIGH");
  return "No completed projects available for comparison yet.";
}
