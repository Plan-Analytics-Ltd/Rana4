import { DeliverableClassification } from "@prisma/client";
import { prisma } from "../../../utils/prisma.js";
import {
  formatClassificationLabel,
  loadCompanyHistoricalDurationSamples,
  median,
  round1,
  stddev,
} from "../shared/durationEvidence.service.js";
import {
  confidenceLevelFromScore,
  learningMaturityFrom,
  predictabilityFromDurations,
} from "../learning/learningMaturity.service.js";

export type DeliverableKnowledgeProfileDto = {
  id: string;
  classification: string;
  label: string;
  sampleSize: number;
  projectCount: number;
  averageDuration: number | null;
  medianDuration: number | null;
  minimumDuration: number | null;
  maximumDuration: number | null;
  standardDeviation: number | null;
  predictabilityScore: number | null;
  confidenceScore: number;
  confidenceLevel: string;
  learningMaturity: string;
  maturityLabel: string;
  evidenceVolume: number;
  coverageScore: number | null;
  lastCalculatedAt: string;
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function maturityLabel(m: string): string {
  if (m === "WELL_KNOWN") return "We know this very well";
  if (m === "MODERATE") return "Moderate evidence available";
  return "Very limited evidence";
}

/** Rebuild all classification profiles for a company from historical snapshots. */
export async function refreshDeliverableKnowledgeProfiles(companyId: string): Promise<number> {
  const classifications = Object.values(DeliverableClassification);
  const allSamples = await loadCompanyHistoricalDurationSamples({ companyId });
  const samplesByClass = new Map<string, typeof allSamples>();
  for (const sample of allSamples) {
    const bucket = samplesByClass.get(sample.classification) ?? [];
    bucket.push(sample);
    samplesByClass.set(sample.classification, bucket);
  }

  const now = new Date();
  let updated = 0;

  for (const classification of classifications) {
    const classSamples = samplesByClass.get(classification) ?? [];
    const durations = classSamples.map((s) => s.durationDays).sort((a, b) => a - b);
    const sampleSize = durations.length;
    const projectCount = new Set(classSamples.map((s) => s.projectId)).size;

    if (sampleSize === 0) {
      await prisma.deliverableKnowledgeProfile.deleteMany({
        where: { companyId, classification },
      });
      continue;
    }

    const avg = durations.reduce((a, b) => a + b, 0) / sampleSize;
    const med = median(durations);
    const sd = stddev(durations, avg);
    const predictabilityScore = predictabilityFromDurations(durations);

    const confidenceScore = round1(
      clamp01(sampleSize / 20) * 0.5 +
        clamp01(projectCount / 10) * 0.3 +
        (predictabilityScore ?? 0) * 0.2
    );
    const confidenceLevel = confidenceLevelFromScore(confidenceScore);
    const learningMaturity = learningMaturityFrom(sampleSize, confidenceLevel);
    const coverageScore = round1(clamp01(projectCount / 10));

    await prisma.deliverableKnowledgeProfile.upsert({
      where: { companyId_classification: { companyId, classification } },
      create: {
        companyId,
        classification,
        label: formatClassificationLabel(classification),
        sampleSize,
        projectCount,
        averageDuration: round1(avg),
        medianDuration: med != null ? round1(med) : null,
        minimumDuration: durations[0]!,
        maximumDuration: durations[durations.length - 1]!,
        standardDeviation: sd != null ? round1(sd) : null,
        predictabilityScore,
        confidenceScore,
        confidenceLevel,
        learningMaturity,
        evidenceVolume: sampleSize,
        coverageScore,
        lastCalculatedAt: now,
      },
      update: {
        label: formatClassificationLabel(classification),
        sampleSize,
        projectCount,
        averageDuration: round1(avg),
        medianDuration: med != null ? round1(med) : null,
        minimumDuration: durations[0]!,
        maximumDuration: durations[durations.length - 1]!,
        standardDeviation: sd != null ? round1(sd) : null,
        predictabilityScore,
        confidenceScore,
        confidenceLevel,
        learningMaturity,
        evidenceVolume: sampleSize,
        coverageScore,
        lastCalculatedAt: now,
      },
    });
    updated += 1;
  }

  return updated;
}

export async function listDeliverableKnowledgeProfiles(
  companyId: string
): Promise<DeliverableKnowledgeProfileDto[]> {
  const rows = await prisma.deliverableKnowledgeProfile.findMany({
    where: { companyId },
    orderBy: [{ sampleSize: "desc" }, { label: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    classification: r.classification,
    label: r.label,
    sampleSize: r.sampleSize,
    projectCount: r.projectCount,
    averageDuration: r.averageDuration,
    medianDuration: r.medianDuration,
    minimumDuration: r.minimumDuration,
    maximumDuration: r.maximumDuration,
    standardDeviation: r.standardDeviation,
    predictabilityScore: r.predictabilityScore,
    confidenceScore: r.confidenceScore,
    confidenceLevel: r.confidenceLevel,
    learningMaturity: r.learningMaturity,
    maturityLabel: maturityLabel(r.learningMaturity),
    evidenceVolume: r.evidenceVolume,
    coverageScore: r.coverageScore,
    lastCalculatedAt: r.lastCalculatedAt.toISOString(),
  }));
}
