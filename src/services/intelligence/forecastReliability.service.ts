import { DeliverableClassification, type ReliabilityBand } from "@prisma/client";
import { prisma } from "../../utils/prisma.js";
import {
  formatClassificationLabel,
  loadPlannedVsActualSamples,
  round1,
  stddev,
  type PlannedVsActualSample,
} from "./durationEvidence.service.js";
import { MIN_INSIGHT_SAMPLE, MIN_PROFILE_SAMPLE } from "./intelligenceConstants.js";
import { clamp01 } from "./intelligenceMath.js";
import { confidenceLevelFromScore, predictabilityFromDurations } from "./learningMaturity.service.js";

export type DeliverableReliabilityProfileDto = {
  id: string;
  classification: string;
  label: string;
  sampleSize: number;
  projectCount: number;
  plannedAverageDuration: number | null;
  actualAverageDuration: number | null;
  averageVariancePercent: number | null;
  averageVarianceDays: number | null;
  overrunFrequency: number;
  underrunFrequency: number;
  onTargetFrequency: number;
  predictabilityScore: number | null;
  reliabilityScore: number;
  reliabilityBand: ReliabilityBand;
  reliabilityLabel: string;
  confidenceLevel: string;
  confidenceScore: number;
  lastUpdated: string;
};

/** Accepted tolerance for "on target" (±10%). */
const ON_TARGET_TOLERANCE = 0.1;

function pctFrequency(fraction: number, _total: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return round1(fraction * 100);
}

export function reliabilityBandFromMetrics(args: {
  overrunFrequency: number;
  onTargetFrequency: number;
  predictabilityScore: number | null;
}): ReliabilityBand {
  const overrun = args.overrunFrequency;
  const onTarget = args.onTargetFrequency;
  const predictability = args.predictabilityScore ?? 0;

  if (predictability < 0.35) return "HIGHLY_UNPREDICTABLE";
  if (overrun >= 0.6) return "FREQUENTLY_OVERRUNS";
  if (onTarget >= 0.55 && overrun < 0.3) return "HIGHLY_RELIABLE";
  if (onTarget >= 0.35 && overrun < 0.45) return "GENERALLY_RELIABLE";
  return "MIXED_RELIABILITY";
}

export function reliabilityBandLabel(band: ReliabilityBand): string {
  switch (band) {
    case "HIGHLY_RELIABLE":
      return "Highly Reliable";
    case "GENERALLY_RELIABLE":
      return "Generally Reliable";
    case "FREQUENTLY_OVERRUNS":
      return "Frequently Overruns";
    case "HIGHLY_UNPREDICTABLE":
      return "Highly Unpredictable";
    default:
      return "Mixed Reliability";
  }
}

export function classifyOutcome(
  plannedDays: number,
  actualDays: number
): "overrun" | "underrun" | "on_target" {
  const ratio = actualDays / plannedDays;
  if (ratio > 1 + ON_TARGET_TOLERANCE) return "overrun";
  if (ratio < 1 - ON_TARGET_TOLERANCE) return "underrun";
  return "on_target";
}

export function computeReliabilityMetrics(samples: PlannedVsActualSample[]) {
  const n = samples.length;
  if (n === 0) {
    return null;
  }

  let overrun = 0;
  let underrun = 0;
  let onTarget = 0;
  const plannedDays: number[] = [];
  const actualDays: number[] = [];
  const variancePercents: number[] = [];
  const varianceDaysList: number[] = [];

  for (const s of samples) {
    plannedDays.push(s.plannedDays);
    actualDays.push(s.actualDays);
    variancePercents.push(s.variancePercent);
    varianceDaysList.push(s.varianceDays);
    const outcome = classifyOutcome(s.plannedDays, s.actualDays);
    if (outcome === "overrun") overrun += 1;
    else if (outcome === "underrun") underrun += 1;
    else onTarget += 1;
  }

  const plannedAvg = plannedDays.reduce((a, b) => a + b, 0) / n;
  const actualAvg = actualDays.reduce((a, b) => a + b, 0) / n;
  const avgVarianceDays = varianceDaysList.reduce((a, b) => a + b, 0) / n;
  const avgVariancePercent = variancePercents.reduce((a, b) => a + b, 0) / n;

  const varianceSd = stddev(variancePercents, avgVariancePercent);
  const predictabilityFromVariance =
    varianceSd != null && Math.abs(avgVariancePercent) > 0
      ? clamp01(1 - varianceSd / 50)
      : predictabilityFromDurations(actualDays);

  const overrunFrequency = overrun / n;
  const underrunFrequency = underrun / n;
  const onTargetFrequency = onTarget / n;

  const reliabilityScore = round1(
    onTargetFrequency * 0.5 + (1 - Math.min(1, overrunFrequency)) * 0.3 + (predictabilityFromVariance ?? 0) * 0.2
  );

  const projectCount = new Set(samples.map((s) => s.projectId)).size;
  const confidenceScore = round1(
    clamp01(n / 20) * 0.5 + clamp01(projectCount / 8) * 0.3 + (predictabilityFromVariance ?? 0) * 0.2
  );
  const confidenceLevel = confidenceLevelFromScore(confidenceScore);

  const reliabilityBand = reliabilityBandFromMetrics({
    overrunFrequency,
    onTargetFrequency,
    predictabilityScore: predictabilityFromVariance,
  });

  return {
    sampleSize: n,
    projectCount,
    plannedAverageDuration: round1(plannedAvg),
    actualAverageDuration: round1(actualAvg),
    averageVariancePercent: round1(avgVariancePercent),
    averageVarianceDays: round1(avgVarianceDays),
    overrunFrequency,
    underrunFrequency,
    onTargetFrequency,
    predictabilityScore: predictabilityFromVariance,
    reliabilityScore,
    reliabilityBand,
    reliabilityLabel: reliabilityBandLabel(reliabilityBand),
    confidenceLevel,
    confidenceScore,
  };
}

function mapRow(row: {
  id: string;
  classification: string;
  label: string;
  sampleSize: number;
  projectCount: number;
  plannedAverageDuration: number | null;
  actualAverageDuration: number | null;
  averageVariancePercent: number | null;
  averageVarianceDays: number | null;
  overrunFrequency: number;
  underrunFrequency: number;
  onTargetFrequency: number;
  predictabilityScore: number | null;
  reliabilityScore: number;
  reliabilityBand: ReliabilityBand;
  reliabilityLabel: string;
  confidenceLevel: string;
  confidenceScore: number;
  lastUpdated: Date;
}): DeliverableReliabilityProfileDto {
  return {
    id: row.id,
    classification: row.classification,
    label: row.label,
    sampleSize: row.sampleSize,
    projectCount: row.projectCount,
    plannedAverageDuration: row.plannedAverageDuration,
    actualAverageDuration: row.actualAverageDuration,
    averageVariancePercent: row.averageVariancePercent,
    averageVarianceDays: row.averageVarianceDays,
    overrunFrequency: pctFrequency(row.overrunFrequency, 1),
    underrunFrequency: pctFrequency(row.underrunFrequency, 1),
    onTargetFrequency: pctFrequency(row.onTargetFrequency, 1),
    predictabilityScore: row.predictabilityScore,
    reliabilityScore: row.reliabilityScore,
    reliabilityBand: row.reliabilityBand,
    reliabilityLabel: row.reliabilityLabel,
    confidenceLevel: row.confidenceLevel,
    confidenceScore: row.confidenceScore,
    lastUpdated: row.lastUpdated.toISOString(),
  };
}

/** Rebuild reliability profiles from planned vs actual historical evidence. */
export async function refreshDeliverableReliabilityProfiles(companyId: string): Promise<number> {
  const allSamples = await loadPlannedVsActualSamples({ companyId });
  const byClass = new Map<string, PlannedVsActualSample[]>();

  for (const s of allSamples) {
    const list = byClass.get(s.classification) ?? [];
    list.push(s);
    byClass.set(s.classification, list);
  }

  const now = new Date();
  let updated = 0;

  for (const classification of Object.values(DeliverableClassification)) {
    const samples = byClass.get(classification) ?? [];
    if (samples.length < MIN_PROFILE_SAMPLE) {
      await prisma.deliverableReliabilityProfile.deleteMany({
        where: { companyId, classification },
      });
      continue;
    }

    const metrics = computeReliabilityMetrics(samples)!;
    await prisma.deliverableReliabilityProfile.upsert({
      where: { companyId_classification: { companyId, classification } },
      create: {
        companyId,
        classification,
        label: formatClassificationLabel(classification),
        ...metrics,
        lastUpdated: now,
      },
      update: {
        label: formatClassificationLabel(classification),
        ...metrics,
        lastUpdated: now,
      },
    });
    updated += 1;
  }

  return updated;
}

export async function listReliabilityProfiles(companyId: string): Promise<DeliverableReliabilityProfileDto[]> {
  const rows = await prisma.deliverableReliabilityProfile.findMany({
    where: { companyId },
    orderBy: [{ sampleSize: "desc" }, { label: "asc" }],
  });
  return rows.map(mapRow);
}

export async function getReliabilityProfileByClassification(
  companyId: string,
  classification: string
): Promise<DeliverableReliabilityProfileDto | null> {
  const normalized = String(classification).trim().toUpperCase();
  if (!Object.values(DeliverableClassification).includes(normalized as DeliverableClassification)) {
    return null;
  }
  const row = await prisma.deliverableReliabilityProfile.findUnique({
    where: { companyId_classification: { companyId, classification: normalized as DeliverableClassification } },
  });
  return row ? mapRow(row) : null;
}

/** Forecast reliability block for deliverable comparison API. */
export async function getForecastReliabilityForClassification(
  companyId: string,
  classification: string | null | undefined
): Promise<DeliverableReliabilityProfileDto | null> {
  if (!classification) return null;
  return getReliabilityProfileByClassification(companyId, classification);
}

export type ForecastReliabilityInsightDraft = {
  title: string;
  summary: string;
  observation: string;
  classification: string;
  sampleSize: number;
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  confidenceScore: number;
  evidenceJson: Record<string, unknown>;
};

/** Build organisational FORECAST_RELIABILITY insight drafts from stored profiles. */
export function buildForecastReliabilityInsights(
  profiles: DeliverableReliabilityProfileDto[]
): ForecastReliabilityInsightDraft[] {
  const drafts: ForecastReliabilityInsightDraft[] = [];

  for (const p of profiles) {
    if (p.sampleSize < MIN_INSIGHT_SAMPLE) continue;
    if (p.confidenceLevel === "LOW") continue;

    if (p.reliabilityBand === "FREQUENTLY_OVERRUNS" && p.overrunFrequency >= 55) {
      drafts.push({
        title: `${p.label} Deliverables Frequently Exceed Original Estimates`,
        summary: `Historical outcomes show that ${p.label.toLowerCase()} deliverables often took longer than originally planned.`,
        observation: `${Math.round(p.overrunFrequency)}% exceeded original estimates across ${p.sampleSize} comparable examples (average variance ${p.averageVariancePercent != null && p.averageVariancePercent > 0 ? "+" : ""}${p.averageVariancePercent ?? 0}%).`,
        classification: p.classification,
        sampleSize: p.sampleSize,
        confidenceLevel: p.confidenceLevel as "LOW" | "MEDIUM" | "HIGH",
        confidenceScore: p.confidenceScore,
        evidenceJson: {
          reliabilityBand: p.reliabilityBand,
          overrunFrequency: p.overrunFrequency,
          averageVariancePercent: p.averageVariancePercent,
        },
      });
    }

    if (p.reliabilityBand === "HIGHLY_UNPREDICTABLE") {
      drafts.push({
        title: `${p.label} Packages Have High Duration Variability`,
        summary: `Outcomes for ${p.label.toLowerCase()} deliverables varied widely compared with their original estimates.`,
        observation: `Predictability score is low (${p.predictabilityScore != null ? Math.round(p.predictabilityScore * 100) : 0}%) across ${p.sampleSize} planned-vs-actual comparisons.`,
        classification: p.classification,
        sampleSize: p.sampleSize,
        confidenceLevel: p.confidenceLevel as "LOW" | "MEDIUM" | "HIGH",
        confidenceScore: p.confidenceScore,
        evidenceJson: {
          reliabilityBand: p.reliabilityBand,
          predictabilityScore: p.predictabilityScore,
        },
      });
    }

    if (
      p.reliabilityBand === "HIGHLY_RELIABLE" &&
      p.onTargetFrequency >= 45 &&
      drafts.length < 8
    ) {
      drafts.push({
        title: `${p.label} Estimates Are Generally Reliable`,
        summary: `Original duration estimates for ${p.label.toLowerCase()} deliverables usually matched what actually happened.`,
        observation: `${Math.round(p.onTargetFrequency)}% finished within tolerance of the original estimate across ${p.sampleSize} examples.`,
        classification: p.classification,
        sampleSize: p.sampleSize,
        confidenceLevel: p.confidenceLevel as "LOW" | "MEDIUM" | "HIGH",
        confidenceScore: p.confidenceScore,
        evidenceJson: {
          reliabilityBand: p.reliabilityBand,
          onTargetFrequency: p.onTargetFrequency,
        },
      });
    }
  }

  return drafts.slice(0, 8);
}
