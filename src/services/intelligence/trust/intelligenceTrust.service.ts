import { DeliverableClassification, type TrustBand } from "@prisma/client";
import { prisma } from "../../../utils/prisma.js";
import type { BenchmarkReport } from "../benchmark/benchmark.service.js";
import { formatClassificationLabel, round1 } from "../shared/durationEvidence.service.js";
import type { IntelligenceRecommendation } from "../recommendations/recommendationEngine.service.js";
import { clamp01 } from "../shared/intelligenceMath.js";

export type EvidenceStrengthSummary = {
  strengthLabel: string;
  sampleSize: number;
  projectCount: number;
  benchmarkConfidence: string | null;
  benchmarkConfidenceScore: number | null;
  layersAvailable: string[];
};

export type KnowledgeCoverageSummary = {
  coverageLabel: string;
  coverageScore: number;
  sampleSize: number;
  projectCount: number;
  learningMaturity: string | null;
  hasReliabilityEvidence: boolean;
  hasOutcomePrediction: boolean;
};

export type TraceabilityLayer = {
  layer: string;
  status: "available" | "limited" | "unavailable";
  evidenceCount: number;
  summary: string;
};

export type RecommendationTraceability = {
  traceChain: string[];
  sourceLayers: TraceabilityLayer[];
  recommendationCount: number;
  recommendations: Array<{
    type: string;
    title: string;
    evidenceCount: number;
    sourceLayers: string[];
  }>;
};

export type IntelligenceTrustExplanation = {
  trustScore: number;
  trustBand: TrustBand;
  trustLabel: string;
  evidenceStrength: EvidenceStrengthSummary;
  knowledgeCoverage: KnowledgeCoverageSummary;
  recommendationTraceability: RecommendationTraceability;
  whySeeingThis: string[];
  supportingEvidence: { label: string; value: string | number }[];
};

export type IntelligenceTrustProfileDto = IntelligenceTrustExplanation & {
  id: string;
  classification: string;
  label: string;
  lastUpdated: string;
};

const TRACE_CHAIN = [
  "Historical Evidence",
  "Learning",
  "Reliability",
  "Prediction",
  "Recommendation",
] as const;

export function trustBandFromScore(score: number): TrustBand {
  const s = clamp01(score);
  if (s >= 0.7) return "HIGH_TRUST";
  if (s >= 0.5) return "MODERATE_TRUST";
  if (s >= 0.25) return "LIMITED_TRUST";
  return "INSUFFICIENT_EVIDENCE";
}

export function trustBandLabel(band: TrustBand): string {
  switch (band) {
    case "HIGH_TRUST":
      return "High Trust";
    case "MODERATE_TRUST":
      return "Moderate Trust";
    case "LIMITED_TRUST":
      return "Limited Trust";
    default:
      return "Insufficient Evidence";
  }
}

function evidenceStrengthLabel(sampleSize: number, confidenceScore: number): string {
  if (sampleSize >= 10 && confidenceScore >= 0.7) return "Strong";
  if (sampleSize >= 5 && confidenceScore >= 0.4) return "Moderate";
  if (sampleSize >= 1) return "Limited";
  return "None";
}

function coverageLabel(score: number): string {
  if (score >= 0.7) return "Broad coverage";
  if (score >= 0.4) return "Partial coverage";
  if (score > 0) return "Narrow coverage";
  return "No coverage";
}

function recommendationSourceLayers(type: string): string[] {
  switch (type) {
    case "DURATION_REVIEW":
      return ["Historical Evidence", "Learning", "Benchmark"];
    case "OPTIMISM_RISK":
      return ["Historical Evidence", "Reliability", "Prediction"];
    case "LOW_CONFIDENCE":
      return ["Historical Evidence", "Learning", "Benchmark"];
    case "HIGH_VARIABILITY":
      return ["Historical Evidence", "Reliability"];
    case "STRONG_ALIGNMENT":
      return ["Historical Evidence", "Learning", "Reliability", "Prediction"];
    default:
      return ["Historical Evidence"];
  }
}

type LayerInputs = {
  benchmarkSample: number;
  benchmarkConfidence: number;
  benchmarkConfidenceLevel: string | null;
  projectCount: number;
  expectedEvidence: number;
  expectedConfidence: number;
  reliabilitySample: number;
  reliabilityConfidence: number;
  hasReliability: boolean;
  hasPrediction: boolean;
  predictionEvidence: number;
  predictionConfidence: number;
  observationCount: number;
  driverCount: number;
  recommendationCount: number;
  learningMaturity: string | null;
};

function computeTrustScore(input: LayerInputs): number {
  const benchmarkScore = clamp01(input.benchmarkSample / 20) * clamp01(input.benchmarkConfidence);
  const learningScore = clamp01(input.expectedEvidence / 20) * clamp01(input.expectedConfidence);
  const reliabilityScore = input.hasReliability
    ? clamp01(input.reliabilitySample / 20) * clamp01(input.reliabilityConfidence)
    : 0;
  const predictionScore = input.hasPrediction
    ? clamp01(input.predictionEvidence / 20) * clamp01(input.predictionConfidence)
    : 0;
  const coverageScore = clamp01(input.projectCount / 8);

  return round1(
    benchmarkScore * 0.3 +
      learningScore * 0.25 +
      reliabilityScore * 0.2 +
      predictionScore * 0.15 +
      coverageScore * 0.1
  );
}

function buildSourceLayers(input: LayerInputs): TraceabilityLayer[] {
  return [
    {
      layer: "Benchmark",
      status:
        input.benchmarkSample >= 5
          ? "available"
          : input.benchmarkSample > 0
            ? "limited"
            : "unavailable",
      evidenceCount: input.benchmarkSample,
      summary:
        input.benchmarkSample > 0
          ? `Compared against ${input.benchmarkSample} comparable deliverable${input.benchmarkSample === 1 ? "" : "s"}.`
          : "No comparable benchmark evidence yet.",
    },
    {
      layer: "Observations",
      status: input.observationCount > 0 ? "available" : "unavailable",
      evidenceCount: input.observationCount,
      summary:
        input.observationCount > 0
          ? `${input.observationCount} observation${input.observationCount === 1 ? "" : "s"} derived from benchmark comparison.`
          : "No observations generated.",
    },
    {
      layer: "Key Factors",
      status:
        input.driverCount > 0 ? "available" : input.benchmarkSample > 0 ? "limited" : "unavailable",
      evidenceCount: input.driverCount,
      summary:
        input.driverCount > 0
          ? `${input.driverCount} key factor${input.driverCount === 1 ? "" : "s"} identified from project metadata.`
          : "Insufficient metadata to identify key factors.",
    },
    {
      layer: "Learning",
      status:
        input.expectedEvidence >= 5
          ? "available"
          : input.expectedEvidence > 0
            ? "limited"
            : "unavailable",
      evidenceCount: input.expectedEvidence,
      summary:
        input.expectedEvidence > 0
          ? `Deliverable learning profile based on ${input.expectedEvidence} historical examples.`
          : "No deliverable learning profile for this classification.",
    },
    {
      layer: "Reliability",
      status: input.hasReliability
        ? input.reliabilitySample >= 5
          ? "available"
          : "limited"
        : "unavailable",
      evidenceCount: input.reliabilitySample,
      summary: input.hasReliability
        ? `Forecast reliability from ${input.reliabilitySample} planned-vs-actual comparisons.`
        : "No planned-vs-actual reliability evidence.",
    },
    {
      layer: "Prediction",
      status: input.hasPrediction
        ? input.predictionEvidence >= 5
          ? "available"
          : "limited"
        : "unavailable",
      evidenceCount: input.predictionEvidence,
      summary: input.hasPrediction
        ? `Outcome prediction combining learning and reliability across ${input.predictionEvidence} examples.`
        : "Outcome prediction not available.",
    },
    {
      layer: "Recommendations",
      status:
        input.recommendationCount > 0
          ? "available"
          : input.benchmarkSample > 0
            ? "limited"
            : "unavailable",
      evidenceCount: input.recommendationCount,
      summary:
        input.recommendationCount > 0
          ? `${input.recommendationCount} evidence-based recommendation${input.recommendationCount === 1 ? "" : "s"} — not AI opinions.`
          : "No recommendations generated (insufficient evidence).",
    },
  ];
}

function buildWhySeeingThis(args: {
  classification: string | null;
  input: LayerInputs;
  trustBand: TrustBand;
  layers: TraceabilityLayer[];
}): string[] {
  const lines: string[] = [
    "Rana4 intelligence is deterministic and evidence-based — not generated by AI or chat models.",
  ];

  if (args.classification) {
    lines.push(
      `You are seeing analysis for classification "${args.classification.replace(/_/g, " ")}" because matching deliverables exist in imported project history.`
    );
  }

  const available = args.layers.filter((l) => l.status === "available");
  if (available.length > 0) {
    lines.push(
      `Active intelligence layers: ${available.map((l) => l.layer).join(", ")}.`
    );
  }

  if (args.input.hasReliability) {
    lines.push(
      "Forecast reliability appears because historical snapshots include both planned and actual dates."
    );
  }

  if (args.input.hasPrediction) {
    lines.push(
      "Predicted outcomes combine expected duration with historical overrun behaviour — traceable to source data."
    );
  }

  if (args.input.recommendationCount > 0) {
    lines.push(
      "Recommendations trace through: Historical Evidence → Learning → Reliability → Prediction → Recommendation."
    );
  }

  if (args.trustBand === "LIMITED_TRUST" || args.trustBand === "INSUFFICIENT_EVIDENCE") {
    lines.push(
      "Trust is limited because historical evidence is sparse. Treat all figures as guidance only."
    );
  } else if (args.trustBand === "HIGH_TRUST") {
    lines.push(
      "High trust reflects strong sample size, project spread, and consistency across intelligence layers."
    );
  }

  return lines;
}

export function buildTrustExplanation(args: {
  classification: string | null;
  label?: string;
  report: BenchmarkReport;
  findingsCount: number;
  driverCount: number;
  recommendations: IntelligenceRecommendation[];
}): IntelligenceTrustExplanation {
  const { benchmark, deliverable } = args.report;
  const expected = benchmark.expectedDuration;
  const reliability = benchmark.forecastReliability;
  const predicted = benchmark.predictedOutcome;

  const input: LayerInputs = {
    benchmarkSample: benchmark.sampleSize,
    benchmarkConfidence: benchmark.confidenceScore ?? 0,
    benchmarkConfidenceLevel: benchmark.confidenceLevel ?? null,
    projectCount: evidenceProjectCount(args.report),
    expectedEvidence: expected?.evidenceCount ?? benchmark.sampleSize,
    expectedConfidence: expected?.confidenceScore ?? benchmark.confidenceScore ?? 0,
    reliabilitySample: reliability?.sampleSize ?? 0,
    reliabilityConfidence: reliability?.confidenceScore ?? 0,
    hasReliability: Boolean(reliability && reliability.sampleSize > 0),
    hasPrediction: Boolean(predicted && predicted.evidenceCount > 0),
    predictionEvidence: predicted?.evidenceCount ?? 0,
    predictionConfidence: predicted?.predictionConfidenceScore ?? 0,
    observationCount: args.findingsCount,
    driverCount: args.driverCount,
    recommendationCount: args.recommendations.length,
    learningMaturity: expected?.learningMaturity ?? null,
  };

  const trustScore = computeTrustScore(input);
  const trustBand = trustBandFromScore(trustScore);
  const layers = buildSourceLayers(input);
  const layersAvailable = layers.filter((l) => l.status !== "unavailable").map((l) => l.layer);

  const evidenceStrength: EvidenceStrengthSummary = {
    strengthLabel: evidenceStrengthLabel(input.benchmarkSample, input.benchmarkConfidence),
    sampleSize: Math.max(input.benchmarkSample, input.expectedEvidence),
    projectCount: input.projectCount,
    benchmarkConfidence: input.benchmarkConfidenceLevel,
    benchmarkConfidenceScore: round1(input.benchmarkConfidence),
    layersAvailable,
  };

  const coverageScore = round1(
    clamp01(input.expectedEvidence / 20) * 0.4 +
      clamp01(input.projectCount / 8) * 0.3 +
      (input.hasReliability ? 0.15 : 0) +
      (input.hasPrediction ? 0.15 : 0)
  );

  const knowledgeCoverage: KnowledgeCoverageSummary = {
    coverageLabel: coverageLabel(coverageScore),
    coverageScore,
    sampleSize: input.expectedEvidence,
    projectCount: input.projectCount,
    learningMaturity: input.learningMaturity,
    hasReliabilityEvidence: input.hasReliability,
    hasOutcomePrediction: input.hasPrediction,
  };

  const recommendationTraceability: RecommendationTraceability = {
    traceChain: [...TRACE_CHAIN],
    sourceLayers: layers,
    recommendationCount: args.recommendations.length,
    recommendations: args.recommendations.map((r) => ({
      type: r.recommendationType,
      title: r.title,
      evidenceCount: r.evidenceCount,
      sourceLayers: recommendationSourceLayers(r.recommendationType),
    })),
  };

  const whySeeingThis = buildWhySeeingThis({
    classification: args.classification ?? deliverable.classification,
    input,
    trustBand,
    layers,
  });

  const supportingEvidence: IntelligenceTrustExplanation["supportingEvidence"] = [
    { label: "Trust score", value: trustScore },
    { label: "Evidence strength", value: evidenceStrength.strengthLabel },
    { label: "Sample size", value: evidenceStrength.sampleSize },
    { label: "Projects in evidence", value: evidenceStrength.projectCount },
    { label: "Intelligence layers active", value: layersAvailable.length },
    { label: "Deliverable", value: deliverable.name },
  ];

  return {
    trustScore,
    trustBand,
    trustLabel: trustBandLabel(trustBand),
    evidenceStrength,
    knowledgeCoverage,
    recommendationTraceability,
    whySeeingThis,
    supportingEvidence,
  };
}

function evidenceProjectCount(report: BenchmarkReport): number {
  const ids = new Set<string>();
  for (const m of report.evidence?.matchedDeliverables ?? []) {
    if (m.projectId) ids.add(m.projectId);
  }
  return ids.size;
}

function mapProfileRow(row: {
  id: string;
  classification: string;
  label: string;
  trustScore: number;
  trustBand: TrustBand;
  trustLabel: string;
  evidenceStrengthJson: unknown;
  knowledgeCoverageJson: unknown;
  recommendationTraceabilityJson: unknown;
  whySeeingThisJson: unknown;
  sampleSize: number;
  projectCount: number;
  layersAvailable: number;
  lastUpdated: Date;
}): IntelligenceTrustProfileDto {
  return {
    id: row.id,
    classification: row.classification,
    label: row.label,
    trustScore: row.trustScore,
    trustBand: row.trustBand,
    trustLabel: row.trustLabel,
    evidenceStrength: (row.evidenceStrengthJson ?? {}) as EvidenceStrengthSummary,
    knowledgeCoverage: (row.knowledgeCoverageJson ?? {}) as KnowledgeCoverageSummary,
    recommendationTraceability: (row.recommendationTraceabilityJson ?? {}) as RecommendationTraceability,
    whySeeingThis: Array.isArray(row.whySeeingThisJson) ? (row.whySeeingThisJson as string[]) : [],
    supportingEvidence: [
      { label: "Trust score", value: row.trustScore },
      { label: "Sample size", value: row.sampleSize },
      { label: "Projects", value: row.projectCount },
      { label: "Layers available", value: row.layersAvailable },
    ],
    lastUpdated: row.lastUpdated.toISOString(),
  };
}

/** Rebuild classification trust profiles from stored intelligence layers. */
export async function refreshIntelligenceTrustProfiles(companyId: string): Promise<number> {
  const [knowledgeRows, reliabilityRows, outcomeRows, recommendationRows] = await Promise.all([
    prisma.deliverableKnowledgeProfile.findMany({ where: { companyId } }),
    prisma.deliverableReliabilityProfile.findMany({ where: { companyId } }),
    prisma.deliverableOutcomeProfile.findMany({ where: { companyId } }),
    prisma.recommendationProfile.findMany({ where: { companyId } }),
  ]);

  const knowledgeByClass = new Map(knowledgeRows.map((r) => [r.classification, r]));
  const reliabilityByClass = new Map(reliabilityRows.map((r) => [r.classification, r]));
  const outcomeByClass = new Map(outcomeRows.map((r) => [r.classification, r]));
  const recommendationsByClass = new Map<string, typeof recommendationRows>();
  for (const r of recommendationRows) {
    const list = recommendationsByClass.get(r.classification) ?? [];
    list.push(r);
    recommendationsByClass.set(r.classification, list);
  }

  const now = new Date();
  let updated = 0;

  for (const classification of Object.values(DeliverableClassification)) {
    const knowledge = knowledgeByClass.get(classification);
    const reliability = reliabilityByClass.get(classification);
    const outcome = outcomeByClass.get(classification);
    const recs = recommendationsByClass.get(classification) ?? [];

    const sampleSize = Math.max(
      knowledge?.sampleSize ?? 0,
      reliability?.sampleSize ?? 0,
      outcome?.sampleSize ?? 0
    );
    const projectCount = knowledge?.projectCount ?? reliability?.projectCount ?? 0;

    if (sampleSize === 0) {
      await prisma.intelligenceTrustProfile.deleteMany({ where: { companyId, classification } });
      continue;
    }

    const input: LayerInputs = {
      benchmarkSample: knowledge?.sampleSize ?? 0,
      benchmarkConfidence: knowledge?.confidenceScore ?? 0,
      benchmarkConfidenceLevel: knowledge?.confidenceLevel ?? null,
      projectCount,
      expectedEvidence: knowledge?.sampleSize ?? 0,
      expectedConfidence: knowledge?.confidenceScore ?? 0,
      reliabilitySample: reliability?.sampleSize ?? 0,
      reliabilityConfidence: reliability?.confidenceScore ?? 0,
      hasReliability: Boolean(reliability && reliability.sampleSize > 0),
      hasPrediction: Boolean(outcome && outcome.sampleSize > 0),
      predictionEvidence: outcome?.sampleSize ?? 0,
      predictionConfidence: outcome?.predictionConfidenceScore ?? 0,
      observationCount: 0,
      driverCount: 0,
      recommendationCount: recs.length,
      learningMaturity: knowledge?.learningMaturity ?? null,
    };

    const trustScore = computeTrustScore(input);
    const trustBand = trustBandFromScore(trustScore);
    const layers = buildSourceLayers(input);
    const layersAvailable = layers.filter((l) => l.status !== "unavailable");
    const coverageScore = round1(
      clamp01(input.expectedEvidence / 20) * 0.4 +
        clamp01(input.projectCount / 8) * 0.3 +
        (input.hasReliability ? 0.15 : 0) +
        (input.hasPrediction ? 0.15 : 0)
    );

    const evidenceStrength: EvidenceStrengthSummary = {
      strengthLabel: evidenceStrengthLabel(sampleSize, input.benchmarkConfidence),
      sampleSize,
      projectCount,
      benchmarkConfidence: input.benchmarkConfidenceLevel,
      benchmarkConfidenceScore: round1(input.benchmarkConfidence),
      layersAvailable: layersAvailable.map((l) => l.layer),
    };

    const knowledgeCoverage: KnowledgeCoverageSummary = {
      coverageLabel: coverageLabel(coverageScore),
      coverageScore,
      sampleSize,
      projectCount,
      learningMaturity: input.learningMaturity,
      hasReliabilityEvidence: input.hasReliability,
      hasOutcomePrediction: input.hasPrediction,
    };

    const recommendationTraceability: RecommendationTraceability = {
      traceChain: [...TRACE_CHAIN],
      sourceLayers: layers,
      recommendationCount: recs.length,
      recommendations: recs.map((r) => ({
        type: r.recommendationType,
        title: r.title,
        evidenceCount: r.evidenceCount,
        sourceLayers: recommendationSourceLayers(r.recommendationType),
      })),
    };

    const whySeeingThis = buildWhySeeingThis({
      classification,
      input,
      trustBand,
      layers,
    });

    await prisma.intelligenceTrustProfile.upsert({
      where: { companyId_classification: { companyId, classification } },
      create: {
        companyId,
        classification,
        label: formatClassificationLabel(classification),
        trustScore,
        trustBand,
        trustLabel: trustBandLabel(trustBand),
        evidenceStrengthJson: evidenceStrength,
        knowledgeCoverageJson: knowledgeCoverage,
        recommendationTraceabilityJson: recommendationTraceability,
        whySeeingThisJson: whySeeingThis,
        sampleSize,
        projectCount,
        layersAvailable: layersAvailable.length,
        lastUpdated: now,
      },
      update: {
        label: formatClassificationLabel(classification),
        trustScore,
        trustBand,
        trustLabel: trustBandLabel(trustBand),
        evidenceStrengthJson: evidenceStrength,
        knowledgeCoverageJson: knowledgeCoverage,
        recommendationTraceabilityJson: recommendationTraceability,
        whySeeingThisJson: whySeeingThis,
        sampleSize,
        projectCount,
        layersAvailable: layersAvailable.length,
        lastUpdated: now,
      },
    });
    updated += 1;
  }

  return updated;
}

export async function listIntelligenceTrustProfiles(
  companyId: string
): Promise<IntelligenceTrustProfileDto[]> {
  const rows = await prisma.intelligenceTrustProfile.findMany({
    where: { companyId },
    orderBy: [{ trustScore: "desc" }, { sampleSize: "desc" }],
  });
  return rows.map(mapProfileRow);
}

export async function getIntelligenceTrustProfileByClassification(
  companyId: string,
  classification: string
): Promise<IntelligenceTrustProfileDto | null> {
  const normalized = String(classification).trim().toUpperCase();
  if (!Object.values(DeliverableClassification).includes(normalized as DeliverableClassification)) {
    return null;
  }
  const row = await prisma.intelligenceTrustProfile.findUnique({
    where: { companyId_classification: { companyId, classification: normalized as DeliverableClassification } },
  });
  return row ? mapProfileRow(row) : null;
}
