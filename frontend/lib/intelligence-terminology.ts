import type {
  BenchmarkOutlierStatus,
  IntelligenceDashboard,
  ProgrammeSnapshotSummary,
} from "@/lib/api";

/** Human-friendly labels — prefer these in intelligence UI. */
export const INTELLIGENCE_LABELS = {
  benchmark: "Historical comparison",
  driver: "Key factor",
  finding: "Observation",
  trustScore: "Evidence quality",
  prediction: "Likely outcome",
  forecastReliability: "Forecast reliability",
  recommendation: "Recommendation",
  organisationKnowledge: "What we've learned",
  evidence: "Supporting evidence",
  confidence: "Confidence",
  maturity: "Knowledge maturity",
} as const;

export function humanOutlierStatus(status: BenchmarkOutlierStatus): string {
  switch (status) {
    case "NORMAL":
      return "Typical for comparable deliverables";
    case "SLIGHTLY_LOW":
      return "Slightly shorter than usual";
    case "WELL_BELOW":
      return "Well below what usually happens";
    case "SLIGHTLY_HIGH":
      return "Slightly longer than usual";
    case "HIGH":
      return "Longer than usual";
    case "RED_FLAG":
      return "Well above what usually happens";
    case "EXTREME_OUTLIER":
      return "Well above what usually happens";
    default:
      return status;
  }
}

export function humanDurationPosition(position: string | null | undefined): string {
  switch (position) {
    case "WELL_BELOW":
      return "Well below what usually happens";
    case "SLIGHTLY_BELOW":
      return "Slightly below what usually happens";
    case "TYPICAL":
      return "Typical for comparable deliverables";
    case "SLIGHTLY_ABOVE":
      return "Slightly above what usually happens";
    case "WELL_ABOVE":
      return "Well above what usually happens";
    default:
      return position ? humanOutlierStatus(position as BenchmarkOutlierStatus) : "Typical for comparable deliverables";
  }
}

export function humanConfidenceLevel(level: string | null | undefined): string {
  if (!level) return "Unknown";
  if (level === "HIGH") return "High";
  if (level === "MEDIUM") return "Moderate";
  if (level === "LOW") return "Limited";
  return level.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function humanMaturity(maturity: string | null | undefined): string {
  if (!maturity) return "Building";
  if (maturity === "WELL_KNOWN") return "Well established";
  if (maturity === "MODERATE") return "Growing";
  if (maturity === "LIMITED" || maturity === "EMERGING") return "Early";
  return maturity.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function humanSnapshotRole(role: string | null): string {
  if (role === "AS_BUILT") return "Completed project";
  if (role === "LIVE_IMPORT") return "Live programme";
  if (role === "BASELINE") return "Baseline";
  return role ?? "Earlier programme revision";
}

export function humanSourceType(source: string): string {
  if (source === "XER") return "Primavera P6";
  if (source === "RANANA4_JSON" || source === "RANA4_JSON") return "Rana4 export";
  return source.replace(/_/g, " ");
}

export type OrgIntelligenceKpis = {
  projectsAnalysed: number;
  historicalDeliverables: number;
  historicalActivities: number;
  knowledgeMaturity: string;
  averageConfidencePercent: number | null;
  latestKnowledgeUpdate: string | null;
  insightsCount: number;
  profilesCount: number;
  highTrustCount: number;
  predictionsAvailable: number;
  recommendationsGenerated: number;
};

export function computeOrgKpis(data: IntelligenceDashboard): OrgIntelligenceKpis {
  const profiles = data.deliverableProfiles ?? [];
  const insights = data.insights ?? [];
  const trust = data.trustProfiles ?? [];
  const outcomes = data.outcomeProfiles ?? [];
  const trends = data.recommendationTrends ?? [];

  const projectsAnalysed = profiles.length
    ? Math.max(...profiles.map((p) => p.projectCount), 0)
    : insights.length
      ? Math.max(...insights.map((i) => Math.ceil(i.sampleSize / 10)), 0)
      : 0;

  const historicalDeliverables = profiles.reduce((s, p) => s + p.sampleSize, 0);
  const historicalActivities = profiles.reduce((s, p) => s + (p.evidenceVolume ?? 0), 0);

  const maturityScores = profiles.map((p) => {
    if (p.learningMaturity === "WELL_KNOWN") return 3;
    if (p.learningMaturity === "MODERATE") return 2;
    return 1;
  });
  const avgMaturity =
    maturityScores.length > 0
      ? maturityScores.reduce((a, b) => a + b, 0) / maturityScores.length
      : 0;
  const knowledgeMaturity =
    avgMaturity >= 2.5 ? "Well established" : avgMaturity >= 1.5 ? "Growing" : "Early";

  const confidenceScores = [
    ...profiles.map((p) => p.confidenceScore),
    ...insights.map((i) => i.confidenceScore),
    ...trust.map((t) => t.evidenceStrength.benchmarkConfidenceScore ?? 0).filter((n) => n > 0),
  ].filter((n) => typeof n === "number" && Number.isFinite(n));

  const averageConfidencePercent =
    confidenceScores.length > 0
      ? Math.round((confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length) * 100)
      : null;

  const dates = [
    ...profiles.map((p) => p.lastCalculatedAt),
    ...insights.map((i) => i.lastCalculatedAt),
    ...trust.map((t) => t.lastUpdated),
    ...outcomes.map((o) => o.lastUpdated),
  ].filter(Boolean);
  const latestKnowledgeUpdate =
    dates.length > 0
      ? dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
      : null;

  const highTrustCount = trust.filter(
    (t) => t.trustBand === "HIGH_TRUST" || t.trustBand === "MODERATE_TRUST"
  ).length;

  const recommendationsGenerated = trends.reduce((s, g) => s + g.profiles.length, 0);

  return {
    projectsAnalysed,
    historicalDeliverables,
    historicalActivities,
    knowledgeMaturity,
    averageConfidencePercent,
    latestKnowledgeUpdate,
    insightsCount: insights.length,
    profilesCount: profiles.length,
    highTrustCount,
    predictionsAvailable: outcomes.length,
    recommendationsGenerated,
  };
}

export function snapshotKnowledgeBadges(snapshot: ProgrammeSnapshotSummary): string[] {
  const badges: string[] = [];
  if (snapshot.deliverableCount > 0) badges.push("Deliverables captured");
  if (snapshot.activityCount > 0) badges.push("Activities captured");
  if (snapshot.snapshotRole === "AS_BUILT") {
    badges.push("Used for learning");
    badges.push("Used for comparison");
  }
  if (snapshot.snapshotRole === "BASELINE") badges.push("Baseline reference");
  if (snapshot.snapshotRole === "LIVE_IMPORT") badges.push("Live programme");
  const matched = (snapshot.importSummary as { matchedActivities?: number })?.matchedActivities;
  if (typeof matched === "number" && matched > 0) badges.push("Similarity data");
  if (snapshot.activityCount >= 10) badges.push("Strong evidence");
  else if (snapshot.activityCount > 0) badges.push("Limited evidence");
  return badges;
}

export function buildDeliverableSummary(args: {
  outlierLabel: string;
  confidenceLabel: string;
  sampleSize: number;
  observationCount: number;
  recommendationCount: number;
  trustLabel: string | null;
  positionCapped?: boolean;
  evidenceLimited?: boolean;
}): string {
  const parts: string[] = [];
  const cautious =
    args.positionCapped || args.evidenceLimited
      ? ", though historical evidence is limited so this should be treated as indicative rather than definitive"
      : "";
  parts.push(`This deliverable is ${args.outlierLabel.toLowerCase()}${cautious}.`);
  if (args.sampleSize > 0) {
    parts.push(
      `Rana compared this with ${args.sampleSize} similar work package${args.sampleSize === 1 ? "" : "s"} from completed projects (${args.confidenceLabel.toLowerCase()} reliability).`
    );
  } else {
    parts.push("There is not yet enough historical evidence for a detailed comparison.");
  }
  if (args.observationCount > 0) {
    parts.push(`${args.observationCount} observation${args.observationCount === 1 ? "" : "s"} may be worth reviewing.`);
  }
  if (args.recommendationCount > 0) {
    parts.push(`${args.recommendationCount} evidence-based recommendation${args.recommendationCount === 1 ? "" : "s"} are available.`);
  }
  if (args.trustLabel) {
    parts.push(`Overall evidence quality: ${args.trustLabel.toLowerCase()}.`);
  }
  return parts.join(" ");
}
