import { DeliverableClassification, type RecommendationType } from "@prisma/client";
import { prisma } from "../../../utils/prisma.js";
import { getDeliverableBenchmark, type BenchmarkReport } from "../benchmark/benchmark.service.js";
import { formatClassificationLabel, round1 } from "../shared/durationEvidence.service.js";
import { generateFindings, type IntelligenceFinding } from "../findings/findings.service.js";
import { MIN_PROFILE_SAMPLE } from "../shared/intelligenceConstants.js";
import { clamp01 } from "../shared/intelligenceMath.js";
import { confidenceLevelFromScore } from "../learning/learningMaturity.service.js";

export type RecommendationSeverity = "LOW" | "MEDIUM" | "HIGH";
export type RecommendationConfidence = "LOW" | "MEDIUM" | "HIGH";

export type IntelligenceRecommendation = {
  recommendationType: RecommendationType;
  title: string;
  summary: string;
  recommendation: string;
  severity: RecommendationSeverity;
  confidenceLevel: RecommendationConfidence;
  confidenceScore: number;
  evidenceCount: number;
  supportingEvidence: { label: string; value: string | number }[];
};

export type RecommendationProfileDto = {
  id: string;
  classification: string;
  label: string;
  recommendationType: RecommendationType;
  title: string;
  summary: string;
  recommendation: string;
  severity: RecommendationSeverity;
  confidenceLevel: RecommendationConfidence;
  confidenceScore: number;
  evidenceCount: number;
  supportingEvidence: { label: string; value: string | number }[];
  lastUpdated: string;
};

const MIN_EVIDENCE = MIN_PROFILE_SAMPLE;
const MATERIAL_BELOW_THRESHOLD = 0.1;

function passesEvidenceGate(evidenceCount: number, confidenceLevel: RecommendationConfidence): boolean {
  return evidenceCount >= MIN_EVIDENCE && confidenceLevel !== "LOW";
}

function computeRecommendationConfidence(args: {
  evidenceCount: number;
  benchmarkConfidence?: number | null;
  reliabilityConfidence?: number | null;
  expectedConfidence?: number | null;
}): { confidenceScore: number; confidenceLevel: RecommendationConfidence } {
  const score = round1(
    clamp01(args.evidenceCount / 20) * 0.35 +
      clamp01(args.benchmarkConfidence ?? 0) * 0.25 +
      clamp01(args.reliabilityConfidence ?? 0) * 0.2 +
      clamp01(args.expectedConfidence ?? 0) * 0.2
  );
  return { confidenceScore: score, confidenceLevel: confidenceLevelFromScore(score) };
}

function isMateriallyBelowExpected(
  current: number | null,
  expectedMin: number | null
): boolean {
  if (current == null || expectedMin == null || expectedMin <= 0) return false;
  return current < expectedMin * (1 - MATERIAL_BELOW_THRESHOLD);
}

function isWithinRange(value: number | null, min: number | null, max: number | null): boolean {
  if (value == null || min == null || max == null) return false;
  return value >= min && value <= max;
}

/**
 * Deterministic recommendations from benchmark, learning, reliability, and prediction layers.
 */
export function generateRecommendations(
  report: BenchmarkReport,
  findings: IntelligenceFinding[] = []
): IntelligenceRecommendation[] {
  const { benchmark, outlier, deliverable } = report;
  const expected = benchmark.expectedDuration;
  const reliability = benchmark.forecastReliability;
  const predicted = benchmark.predictedOutcome;
  const current = outlier.currentDurationDays;

  const evidenceCount = Math.max(
    benchmark.sampleSize,
    expected?.evidenceCount ?? 0,
    reliability?.sampleSize ?? 0,
    predicted?.evidenceCount ?? 0
  );

  const recommendations: IntelligenceRecommendation[] = [];
  const hasDurationTooLow = findings.some((f) => f.findingType === "DURATION_TOO_LOW");

  // 1. DURATION_REVIEW — observation → evidence → suggested review
  const belowPosition =
    outlier.position === "WELL_BELOW" || outlier.position === "SLIGHTLY_BELOW";
  if (
    evidenceCount >= MIN_EVIDENCE &&
    (hasDurationTooLow || belowPosition || isMateriallyBelowExpected(current, expected?.minimumExpectedDays ?? null))
  ) {
    const conf = computeRecommendationConfidence({
      evidenceCount,
      benchmarkConfidence: benchmark.confidenceScore,
      expectedConfidence: expected?.confidenceScore,
    });
    if (passesEvidenceGate(evidenceCount, conf.confidenceLevel) || hasDurationTooLow || belowPosition) {
      const med = benchmark.medianDuration;
      const supportingEvidence: IntelligenceRecommendation["supportingEvidence"] = [
        { label: "Current duration (days)", value: current ?? "—" },
        { label: "Historical median (days)", value: med ?? "—" },
        { label: "Comparable observations", value: evidenceCount },
        { label: "Distinct projects", value: benchmark.benchmarkQuality?.distinctProjects ?? "—" },
      ];
      if (expected?.minimumExpectedDays != null) {
        supportingEvidence.push({
          label: "Typical range — lower bound (days)",
          value: expected.minimumExpectedDays,
        });
      }
      recommendations.push({
        recommendationType: "DURATION_REVIEW",
        title: "Review duration assumption",
        summary: "The planned duration is shorter than most comparable historical deliverables.",
        recommendation:
          "Observation: the current duration sits below the historical median. Evidence: based on comparable deliverables from previous programmes. Suggested action: review the duration assumption with the delivery team before finalising.",
        severity: outlier.position === "WELL_BELOW" ? "HIGH" : "MEDIUM",
        ...conf,
        evidenceCount,
        supportingEvidence,
      });
    }
  }

  // 2. OPTIMISM_RISK
  const overrunPct = reliability?.overrunFrequency ?? 0;
  if (reliability && reliability.sampleSize >= MIN_EVIDENCE && overrunPct >= 55) {
    const conf = computeRecommendationConfidence({
      evidenceCount: reliability.sampleSize,
      reliabilityConfidence: reliability.confidenceScore,
      expectedConfidence: expected?.confidenceScore,
    });
    if (passesEvidenceGate(reliability.sampleSize, conf.confidenceLevel)) {
      const varianceLabel =
        reliability.averageVariancePercent != null
          ? `${reliability.averageVariancePercent > 0 ? "+" : ""}${Math.round(reliability.averageVariancePercent)}%`
          : "—";
      recommendations.push({
        recommendationType: "OPTIMISM_RISK",
        title: "Historical overrun pattern observed",
        summary: "Comparable deliverables frequently exceeded their original estimate.",
        recommendation:
          "Historical evidence suggests this deliverable may be underestimated. Similar deliverables exceeded their original estimate in a majority of historical cases.",
        severity: overrunPct >= 70 ? "HIGH" : "MEDIUM",
        ...conf,
        evidenceCount: reliability.sampleSize,
        supportingEvidence: [
          { label: "Historical overrun frequency", value: `${Math.round(overrunPct)}%` },
          { label: "Average variance", value: varianceLabel },
          { label: "Forecast reliability", value: reliability.reliabilityLabel },
          { label: "Predicted outcome", value: predicted?.rangeLabel ?? "—" },
          { label: "Evidence count", value: reliability.sampleSize },
        ],
      });
    }
  }

  // 3. LOW_CONFIDENCE
  const limitedEvidence =
    benchmark.sampleSize > 0 &&
    (benchmark.sampleSize < 5 ||
      benchmark.confidenceLevel === "LOW" ||
      expected?.confidenceLevel === "LOW");
  if (limitedEvidence) {
    const conf = computeRecommendationConfidence({
      evidenceCount,
      benchmarkConfidence: benchmark.confidenceScore,
      expectedConfidence: expected?.confidenceScore,
    });
    recommendations.push({
      recommendationType: "LOW_CONFIDENCE",
      title: "Limited historical evidence",
      summary: "Historical evidence is limited for this comparison.",
      recommendation:
        "Historical evidence is limited. Use benchmark results as guidance only.",
      severity: "LOW",
      confidenceLevel: "LOW",
      confidenceScore: conf.confidenceScore,
      evidenceCount,
      supportingEvidence: [
        { label: "Benchmark sample size", value: benchmark.sampleSize },
        { label: "Benchmark confidence", value: benchmark.confidenceLevel ?? "—" },
        { label: "Expected duration confidence", value: expected?.confidenceLevel ?? "—" },
        { label: "Evidence count", value: evidenceCount },
      ],
    });
  }

  // 4. HIGH_VARIABILITY
  const unpredictable =
    reliability?.reliabilityBand === "HIGHLY_UNPREDICTABLE" ||
    (reliability?.predictabilityScore != null && reliability.predictabilityScore < 0.35);
  if (unpredictable && reliability && reliability.sampleSize >= MIN_EVIDENCE) {
    const conf = computeRecommendationConfidence({
      evidenceCount: reliability.sampleSize,
      reliabilityConfidence: reliability.confidenceScore,
    });
    if (passesEvidenceGate(reliability.sampleSize, conf.confidenceLevel)) {
      recommendations.push({
        recommendationType: "HIGH_VARIABILITY",
        title: "High historical variability",
        summary: "Observed outcomes for comparable deliverables varied significantly.",
        recommendation: "Observed outcomes show significant variability across comparable projects.",
        severity: "MEDIUM",
        ...conf,
        evidenceCount: reliability.sampleSize,
        supportingEvidence: [
          { label: "Forecast reliability", value: reliability.reliabilityLabel },
          {
            label: "Predictability score",
            value:
              reliability.predictabilityScore != null
                ? `${Math.round(reliability.predictabilityScore * 100)}%`
                : "—",
          },
          { label: "Evidence count", value: reliability.sampleSize },
        ],
      });
    }
  }

  // 5. STRONG_ALIGNMENT — only when no higher-severity risk recommendations
  const hasRisk = recommendations.some((r) =>
    ["DURATION_REVIEW", "OPTIMISM_RISK", "HIGH_VARIABILITY"].includes(r.recommendationType)
  );
  const alignedExpected = isWithinRange(
    current,
    expected?.minimumExpectedDays ?? null,
    expected?.maximumExpectedDays ?? null
  );
  const alignedPredicted = isWithinRange(
    current,
    predicted?.predictedMinimumDuration ?? null,
    predicted?.predictedMaximumDuration ?? null
  );
  if (
    !hasRisk &&
    !limitedEvidence &&
    evidenceCount >= 5 &&
    current != null &&
    (alignedExpected || alignedPredicted) &&
    overrunPct < 45
  ) {
    const conf = computeRecommendationConfidence({
      evidenceCount,
      benchmarkConfidence: benchmark.confidenceScore,
      reliabilityConfidence: reliability?.confidenceScore,
      expectedConfidence: expected?.confidenceScore,
    });
    if (conf.confidenceLevel !== "LOW") {
      recommendations.push({
        recommendationType: "STRONG_ALIGNMENT",
        title: "Strong alignment with historical evidence",
        summary: "Current assumptions align well with historical evidence.",
        recommendation:
          "Comparable projects indicate current duration assumptions align well with historical evidence.",
        severity: "LOW",
        ...conf,
        evidenceCount,
        supportingEvidence: [
          { label: "Deliverable", value: deliverable.name },
          { label: "Current duration (days)", value: current },
          { label: "Expected range", value: expected?.rangeLabel ?? "—" },
          { label: "Predicted outcome", value: predicted?.rangeLabel ?? "—" },
          { label: "Evidence count", value: evidenceCount },
        ],
      });
    }
  }

  const severityOrder: Record<RecommendationSeverity, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  recommendations.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);

  return recommendations;
}

function mapProfileRow(row: {
  id: string;
  classification: string;
  label: string;
  recommendationType: RecommendationType;
  title: string;
  summary: string;
  recommendation: string;
  severity: string;
  confidenceLevel: string;
  confidenceScore: number;
  evidenceCount: number;
  supportingEvidenceJson: unknown;
  lastUpdated: Date;
}): RecommendationProfileDto {
  const supportingEvidence = Array.isArray(row.supportingEvidenceJson)
    ? (row.supportingEvidenceJson as { label: string; value: string | number }[])
    : [];
  return {
    id: row.id,
    classification: row.classification,
    label: row.label,
    recommendationType: row.recommendationType,
    title: row.title,
    summary: row.summary,
    recommendation: row.recommendation,
    severity: row.severity as RecommendationSeverity,
    confidenceLevel: row.confidenceLevel as RecommendationConfidence,
    confidenceScore: row.confidenceScore,
    evidenceCount: row.evidenceCount,
    supportingEvidence,
    lastUpdated: row.lastUpdated.toISOString(),
  };
}

/** Refresh classification-level recommendation trends from learning profiles. */
export async function refreshRecommendationProfiles(companyId: string): Promise<number> {
  const [knowledgeRows, reliabilityRows, outcomeRows] = await Promise.all([
    prisma.deliverableKnowledgeProfile.findMany({ where: { companyId } }),
    prisma.deliverableReliabilityProfile.findMany({ where: { companyId } }),
    prisma.deliverableOutcomeProfile.findMany({ where: { companyId } }),
  ]);

  const knowledgeByClass = new Map(knowledgeRows.map((r) => [r.classification, r]));
  const reliabilityByClass = new Map(reliabilityRows.map((r) => [r.classification, r]));
  const outcomeByClass = new Map(outcomeRows.map((r) => [r.classification, r]));

  const now = new Date();
  let updated = 0;

  for (const classification of Object.values(DeliverableClassification)) {
    const knowledge = knowledgeByClass.get(classification);
    const reliability = reliabilityByClass.get(classification);
    const outcome = outcomeByClass.get(classification);
    const label = formatClassificationLabel(classification);

    const drafts: Omit<RecommendationProfileDto, "id" | "lastUpdated" | "classification" | "label">[] = [];

    const evidenceCount = Math.max(
      knowledge?.sampleSize ?? 0,
      reliability?.sampleSize ?? 0,
      outcome?.sampleSize ?? 0
    );

    if (reliability && reliability.sampleSize >= MIN_EVIDENCE) {
      const overrunPct = round1(reliability.overrunFrequency * 100);
      if (overrunPct >= 55) {
        const conf = computeRecommendationConfidence({
          evidenceCount: reliability.sampleSize,
          reliabilityConfidence: reliability.confidenceScore,
        });
        if (passesEvidenceGate(reliability.sampleSize, conf.confidenceLevel)) {
          drafts.push({
            recommendationType: "OPTIMISM_RISK",
            title: `${label} — optimism risk pattern`,
            summary: `${label} deliverables frequently exceeded their original estimates in historical data.`,
            recommendation:
              "Comparable projects indicate similar deliverables often exceed their original duration estimates.",
            severity: overrunPct >= 70 ? "HIGH" : "MEDIUM",
            ...conf,
            evidenceCount: reliability.sampleSize,
            supportingEvidence: [
              { label: "Overrun frequency", value: `${overrunPct}%` },
              {
                label: "Average variance",
                value:
                  reliability.averageVariancePercent != null
                    ? `${reliability.averageVariancePercent > 0 ? "+" : ""}${round1(reliability.averageVariancePercent)}%`
                    : "—",
              },
              { label: "Reliability band", value: reliability.reliabilityLabel },
            ],
          });
        }
      }

      if (
        reliability.reliabilityBand === "HIGHLY_UNPREDICTABLE" ||
        (reliability.predictabilityScore != null && reliability.predictabilityScore < 0.35)
      ) {
        const conf = computeRecommendationConfidence({
          evidenceCount: reliability.sampleSize,
          reliabilityConfidence: reliability.confidenceScore,
        });
        if (passesEvidenceGate(reliability.sampleSize, conf.confidenceLevel)) {
          drafts.push({
            recommendationType: "HIGH_VARIABILITY",
            title: `${label} — high variability pattern`,
            summary: `Historical outcomes for ${label.toLowerCase()} deliverables varied significantly.`,
            recommendation: "Observed outcomes show significant variability across comparable projects.",
            severity: "MEDIUM",
            ...conf,
            evidenceCount: reliability.sampleSize,
            supportingEvidence: [
              { label: "Reliability band", value: reliability.reliabilityLabel },
              {
                label: "Predictability",
                value:
                  reliability.predictabilityScore != null
                    ? `${Math.round(reliability.predictabilityScore * 100)}%`
                    : "—",
              },
            ],
          });
        }
      }

      const planned = reliability.plannedAverageDuration;
      const actual = reliability.actualAverageDuration;
      if (
        planned != null &&
        actual != null &&
        planned > 0 &&
        actual > planned * (1 + MATERIAL_BELOW_THRESHOLD)
      ) {
        const conf = computeRecommendationConfidence({
          evidenceCount: reliability.sampleSize,
          reliabilityConfidence: reliability.confidenceScore,
        });
        if (passesEvidenceGate(reliability.sampleSize, conf.confidenceLevel)) {
          drafts.push({
            recommendationType: "DURATION_REVIEW",
            title: `${label} — duration review pattern`,
            summary: `Historical planning durations for ${label.toLowerCase()} deliverables were often below observed outcomes.`,
            recommendation:
              "Historical evidence suggests original duration assumptions for this classification may be lower than comparable outcomes.",
            severity: "MEDIUM",
            ...conf,
            evidenceCount: reliability.sampleSize,
            supportingEvidence: [
              { label: "Planned average (days)", value: round1(planned) },
              { label: "Actual average (days)", value: round1(actual) },
              { label: "Overrun frequency", value: `${overrunPct}%` },
            ],
          });
        }
      }
    }

    if (
      knowledge &&
      (knowledge.sampleSize < 5 || knowledge.confidenceLevel === "LOW")
    ) {
      drafts.push({
        recommendationType: "LOW_CONFIDENCE",
        title: `${label} — limited evidence`,
        summary: `Historical evidence for ${label.toLowerCase()} deliverables is limited.`,
        recommendation: "Historical evidence is limited. Use benchmark results as guidance only.",
        severity: "LOW",
        confidenceLevel: "LOW",
        confidenceScore: knowledge.confidenceScore,
        evidenceCount: knowledge.sampleSize,
        supportingEvidence: [
          { label: "Sample size", value: knowledge.sampleSize },
          { label: "Confidence", value: knowledge.confidenceLevel },
        ],
      });
    }

    if (
      outcome &&
      knowledge &&
      knowledge.sampleSize >= 5 &&
      knowledge.confidenceLevel !== "LOW" &&
      reliability &&
      reliability.overrunFrequency < 0.35 &&
      reliability.reliabilityBand !== "HIGHLY_UNPREDICTABLE"
    ) {
      const conf = computeRecommendationConfidence({
        evidenceCount: outcome.sampleSize,
        reliabilityConfidence: reliability.confidenceScore,
        expectedConfidence: knowledge.confidenceScore,
      });
      if (conf.confidenceLevel !== "LOW") {
        drafts.push({
          recommendationType: "STRONG_ALIGNMENT",
          title: `${label} — strong historical alignment`,
          summary: `${label} deliverables show consistent alignment between expectations and outcomes.`,
          recommendation:
            "Comparable projects indicate duration assumptions for this classification align well with historical evidence.",
          severity: "LOW",
          ...conf,
          evidenceCount: outcome.sampleSize,
          supportingEvidence: [
            { label: "Predicted range", value: outcome.predictedMinimumDuration != null && outcome.predictedMaximumDuration != null
                ? `${Math.round(outcome.predictedMinimumDuration)}–${Math.round(outcome.predictedMaximumDuration)} days`
                : "—" },
            { label: "On-target frequency", value: `${Math.round(reliability.onTargetFrequency * 100)}%` },
          ],
        });
      }
    }

    const activeTypes = new Set(drafts.map((d) => d.recommendationType));
    for (const recType of [
      "DURATION_REVIEW",
      "OPTIMISM_RISK",
      "LOW_CONFIDENCE",
      "HIGH_VARIABILITY",
      "STRONG_ALIGNMENT",
    ] as RecommendationType[]) {
      if (!activeTypes.has(recType)) {
        await prisma.recommendationProfile.deleteMany({
          where: { companyId, classification, recommendationType: recType },
        });
      }
    }

    for (const draft of drafts) {
      await prisma.recommendationProfile.upsert({
        where: {
          companyId_classification_recommendationType: {
            companyId,
            classification,
            recommendationType: draft.recommendationType,
          },
        },
        create: {
          companyId,
          classification,
          label,
          recommendationType: draft.recommendationType,
          title: draft.title,
          summary: draft.summary,
          recommendation: draft.recommendation,
          severity: draft.severity,
          confidenceLevel: draft.confidenceLevel,
          confidenceScore: draft.confidenceScore,
          evidenceCount: draft.evidenceCount,
          supportingEvidenceJson: draft.supportingEvidence,
          lastUpdated: now,
        },
        update: {
          label,
          title: draft.title,
          summary: draft.summary,
          recommendation: draft.recommendation,
          severity: draft.severity,
          confidenceLevel: draft.confidenceLevel,
          confidenceScore: draft.confidenceScore,
          evidenceCount: draft.evidenceCount,
          supportingEvidenceJson: draft.supportingEvidence,
          lastUpdated: now,
        },
      });
      updated += 1;
    }
  }

  return updated;
}

export async function listRecommendationProfiles(
  companyId: string
): Promise<RecommendationProfileDto[]> {
  const rows = await prisma.recommendationProfile.findMany({
    where: { companyId },
    orderBy: [{ evidenceCount: "desc" }, { label: "asc" }],
  });
  return rows.map(mapProfileRow);
}

export async function getRecommendationProfilesByClassification(
  companyId: string,
  classification: string
): Promise<RecommendationProfileDto[]> {
  const normalized = String(classification).trim().toUpperCase();
  if (!Object.values(DeliverableClassification).includes(normalized as DeliverableClassification)) {
    return [];
  }
  const rows = await prisma.recommendationProfile.findMany({
    where: { companyId, classification: normalized as DeliverableClassification },
    orderBy: { recommendationType: "asc" },
  });
  return rows.map(mapProfileRow);
}

export type RecommendationTrendGroup = {
  recommendationType: RecommendationType;
  typeLabel: string;
  description: string;
  profiles: RecommendationProfileDto[];
};

const TREND_TYPE_META: Record<
  RecommendationType,
  { typeLabel: string; description: string }
> = {
  OPTIMISM_RISK: {
    typeLabel: "Optimism risk",
    description: "Deliverable types that frequently exceeded original estimates.",
  },
  HIGH_VARIABILITY: {
    typeLabel: "High variability",
    description: "Deliverable types with significant outcome variability.",
  },
  DURATION_REVIEW: {
    typeLabel: "Duration review",
    description: "Deliverable types where planning durations often sat below observed outcomes.",
  },
  LOW_CONFIDENCE: {
    typeLabel: "Limited evidence",
    description: "Deliverable types with limited historical evidence.",
  },
  STRONG_ALIGNMENT: {
    typeLabel: "Strong alignment",
    description: "Deliverable types showing consistent alignment with historical evidence.",
  },
};

export function groupRecommendationTrends(
  profiles: RecommendationProfileDto[]
): RecommendationTrendGroup[] {
  const byType = new Map<RecommendationType, RecommendationProfileDto[]>();
  for (const p of profiles) {
    const list = byType.get(p.recommendationType) ?? [];
    list.push(p);
    byType.set(p.recommendationType, list);
  }

  const order: RecommendationType[] = [
    "OPTIMISM_RISK",
    "HIGH_VARIABILITY",
    "DURATION_REVIEW",
    "LOW_CONFIDENCE",
    "STRONG_ALIGNMENT",
  ];

  return order
    .filter((t) => (byType.get(t)?.length ?? 0) > 0)
    .map((t) => ({
      recommendationType: t,
      ...TREND_TYPE_META[t],
      profiles: (byType.get(t) ?? []).sort((a, b) => b.evidenceCount - a.evidenceCount),
    }));
}

export async function getDeliverableRecommendations(args: {
  projectId: string;
  companyId: string;
  deliverableId: string;
  selectedProjectIds?: string[];
}): Promise<{ recommendations: IntelligenceRecommendation[] }> {
  const report = await getDeliverableBenchmark(args);
  const findings = generateFindings(report);
  const recommendations = generateRecommendations(report, findings);
  return { recommendations };
}
