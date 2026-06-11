import type { DeliverableClassification, LearnedInsightConfidenceLevel, LearnedInsightType } from "@prisma/client";
import { prisma } from "../../utils/prisma.js";
import {
  buildForecastReliabilityInsights,
  listReliabilityProfiles,
} from "./forecastReliability.service.js";
import {
  buildOutcomePredictionInsights,
  listOutcomeProfiles,
} from "./outcomePrediction.service.js";

export type LearnedInsightDto = {
  id: string;
  insightType: LearnedInsightType;
  title: string;
  summary: string;
  observation: string;
  category: string | null;
  classification: string | null;
  projectType: string | null;
  stage: string | null;
  complexity: string | null;
  clientType: string | null;
  procurementRoute: string | null;
  sampleSize: number;
  confidenceLevel: LearnedInsightConfidenceLevel;
  confidenceScore: number;
  evidenceJson: Record<string, unknown>;
  lastCalculatedAt: string;
};

export type LearnedInsightFilters = {
  insightType?: LearnedInsightType;
  classification?: string;
  projectType?: string;
  stage?: string;
  complexity?: string;
  clientType?: string;
  procurementRoute?: string;
  limit?: number;
};

type InsightDraft = Omit<LearnedInsightDto, "id" | "lastCalculatedAt">;

const MIN_SAMPLE = 10;
const OVERRUN_THRESHOLD = 0.1;
const MAX_INSIGHTS_PER_GENERATOR = 8;

function msPerDay() {
  return 24 * 60 * 60 * 1000;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function confidenceLevelFromScore(score: number): LearnedInsightConfidenceLevel {
  const s = clamp01(score);
  if (s <= 0.39) return "LOW";
  if (s <= 0.69) return "MEDIUM";
  return "HIGH";
}

function computeInsightConfidence(args: {
  sampleSize: number;
  consistency: number;
  evidenceQuality: number;
  dataCompleteness: number;
}): { confidenceScore: number; confidenceLevel: LearnedInsightConfidenceLevel } {
  const confidenceScore = round2(
    clamp01(args.sampleSize / 10) * 0.4 +
      clamp01(args.consistency) * 0.3 +
      clamp01(args.evidenceQuality) * 0.2 +
      clamp01(args.dataCompleteness) * 0.1
  );
  return { confidenceScore, confidenceLevel: confidenceLevelFromScore(confidenceScore) };
}

function passesQualityGate(sampleSize: number, confidenceLevel: LearnedInsightConfidenceLevel): boolean {
  return sampleSize >= MIN_SAMPLE && confidenceLevel !== "LOW";
}

function normLabel(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim();
  return v ? v : null;
}

function normComplexity(value: string | null | undefined): string | null {
  const v = normLabel(value);
  if (!v) return null;
  const u = v.toUpperCase();
  if (u === "LOW" || u === "MEDIUM" || u === "HIGH") return u;
  if (u.includes("HIGH")) return "HIGH";
  if (u.includes("MED")) return "MEDIUM";
  if (u.includes("LOW")) return "LOW";
  return v;
}

function formatClassification(value: string): string {
  return value.replace(/_/g, " ");
}

function diffDays(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  const d = (b.getTime() - a.getTime()) / msPerDay();
  if (!Number.isFinite(d)) return null;
  return Math.max(0, Math.round(d));
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[], mean: number): number | null {
  if (values.length < 2) return null;
  const v = values.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / (values.length - 1);
  return Math.sqrt(v);
}

type ProjectMeta = {
  projectType: string | null;
  stage: string | null;
  complexity: string | null;
  clientType: string | null;
  procurementRoute: string | null;
  sector: string | null;
};

type DeliverableObservation = {
  projectId: string;
  snapshotId: string;
  classification: string;
  name: string;
  plannedDays: number | null;
  actualDays: number | null;
  overrun: boolean | null;
  totalFloat: number | null;
  floatConsumed: boolean;
  meta: ProjectMeta;
};

type PortfolioContext = {
  observations: DeliverableObservation[];
  projectMeta: Map<string, ProjectMeta>;
  projectCount: number;
};

async function loadPortfolioContext(companyId: string): Promise<PortfolioContext> {
  const snapshots = await prisma.programmeSnapshot.findMany({
    where: { companyId },
    include: {
      deliverableSnapshots: true,
      project: { include: { intelligenceProfile: true } },
    },
    orderBy: { importedAt: "desc" },
    take: 500,
  });

  const projectMeta = new Map<string, ProjectMeta>();
  const observations: DeliverableObservation[] = [];

  for (const snap of snapshots) {
    const profile = snap.project.intelligenceProfile;
    const meta: ProjectMeta = {
      projectType: normLabel(snap.projectType ?? profile?.projectType),
      stage: normLabel(snap.stage ?? profile?.stage ?? profile?.primaryRibaStage),
      complexity: normComplexity(snap.complexity ?? profile?.complexity),
      clientType: normLabel(snap.clientType ?? profile?.clientType),
      procurementRoute: normLabel(snap.procurementRoute ?? profile?.procurementRoute),
      sector: normLabel(snap.sector ?? profile?.sector),
    };
    projectMeta.set(snap.projectId, meta);

    for (const d of snap.deliverableSnapshots) {
      const classification = String(d.classification ?? "OTHER");
      const plannedDays = diffDays(d.plannedStart, d.plannedFinish);
      const actualDays = diffDays(d.actualStart, d.actualFinish);
      let overrun: boolean | null = null;
      if (plannedDays != null && plannedDays > 0 && actualDays != null) {
        overrun = (actualDays - plannedDays) / plannedDays > OVERRUN_THRESHOLD;
      }
      const floatConsumed = d.totalFloat != null && d.totalFloat <= 0;
      observations.push({
        projectId: snap.projectId,
        snapshotId: snap.id,
        classification,
        name: d.name,
        plannedDays,
        actualDays,
        overrun,
        totalFloat: d.totalFloat,
        floatConsumed,
        meta,
      });
    }
  }

  return {
    observations,
    projectMeta,
    projectCount: new Set(snapshots.map((s) => s.projectId)).size,
  };
}

function metaCompleteness(meta: ProjectMeta): number {
  const fields = [meta.projectType, meta.stage, meta.complexity, meta.clientType, meta.procurementRoute];
  const filled = fields.filter(Boolean).length;
  return filled / fields.length;
}

function portfolioMetaCompleteness(ctx: PortfolioContext): number {
  if (ctx.projectMeta.size === 0) return 0;
  let sum = 0;
  for (const m of ctx.projectMeta.values()) sum += metaCompleteness(m);
  return sum / ctx.projectMeta.size;
}

function topInsights(drafts: InsightDraft[]): InsightDraft[] {
  return drafts
    .filter((d) => passesQualityGate(d.sampleSize, d.confidenceLevel))
    .sort((a, b) => b.confidenceScore - a.confidenceScore || b.sampleSize - a.sampleSize)
    .slice(0, MAX_INSIGHTS_PER_GENERATOR);
}

/** Duration overrun patterns by deliverable classification. */
export function generateDurationOverrunInsights(ctx: PortfolioContext): InsightDraft[] {
  const byClass = new Map<
    string,
    { total: number; overrun: number; projects: Set<string>; withActual: number }
  >();

  for (const o of ctx.observations) {
    if (o.overrun === null) continue;
    const entry = byClass.get(o.classification) ?? {
      total: 0,
      overrun: 0,
      projects: new Set<string>(),
      withActual: 0,
    };
    entry.withActual++;
    entry.total++;
    if (o.overrun) entry.overrun++;
    entry.projects.add(o.projectId);
    byClass.set(o.classification, entry);
  }

  const drafts: InsightDraft[] = [];
  for (const [classification, stats] of byClass) {
    if (stats.withActual < MIN_SAMPLE) continue;
    const pct = Math.round((stats.overrun / stats.withActual) * 100);
    if (pct < 55) continue;

    const consistency = clamp01((pct - 50) / 50);
    const completeness = portfolioMetaCompleteness(ctx);
    const { confidenceScore, confidenceLevel } = computeInsightConfidence({
      sampleSize: stats.withActual,
      consistency,
      evidenceQuality: clamp01(stats.projects.size / 5),
      dataCompleteness: completeness,
    });
    if (!passesQualityGate(stats.withActual, confidenceLevel)) continue;

    const label = formatClassification(classification);
    drafts.push({
      insightType: "DURATION_OVERRUN",
      title: `${label} Deliverables Frequently Overrun`,
      summary: `Historical analysis across ${stats.projects.size} project(s) shows duration growth on ${label.toLowerCase()} deliverables.`,
      observation: `${pct}% of analysed ${label.toLowerCase()} deliverables exceeded planned duration.`,
      category: "duration",
      classification,
      projectType: null,
      stage: null,
      complexity: null,
      clientType: null,
      procurementRoute: null,
      sampleSize: stats.withActual,
      confidenceLevel,
      confidenceScore,
      evidenceJson: {
        classification,
        overrunCount: stats.overrun,
        analysedCount: stats.withActual,
        overrunPct: pct,
        projectCount: stats.projects.size,
        projectIds: [...stats.projects].slice(0, 20),
      },
    });
  }

  return topInsights(drafts);
}

/** Low duration variation indicates predictable deliverable types. */
export function generatePredictabilityInsights(ctx: PortfolioContext): InsightDraft[] {
  const byClass = new Map<string, { durations: number[]; projects: Set<string> }>();

  for (const o of ctx.observations) {
    const days = o.actualDays ?? o.plannedDays;
    if (days == null || days <= 0) continue;
    const entry = byClass.get(o.classification) ?? { durations: [], projects: new Set() };
    entry.durations.push(days);
    entry.projects.add(o.projectId);
    byClass.set(o.classification, entry);
  }

  const drafts: InsightDraft[] = [];
  for (const [classification, stats] of byClass) {
    if (stats.durations.length < MIN_SAMPLE) continue;
    const mean = avg(stats.durations)!;
    const sd = stddev(stats.durations, mean);
    if (sd == null || mean <= 0) continue;
    const cv = sd / mean;
    if (cv > 0.25) continue;

    const consistency = clamp01(1 - cv / 0.25);
    const { confidenceScore, confidenceLevel } = computeInsightConfidence({
      sampleSize: stats.durations.length,
      consistency,
      evidenceQuality: clamp01(stats.projects.size / 5),
      dataCompleteness: portfolioMetaCompleteness(ctx),
    });
    if (!passesQualityGate(stats.durations.length, confidenceLevel)) continue;

    const label = formatClassification(classification);
    drafts.push({
      insightType: "DURATION_PREDICTABILITY",
      title: `${label} Deliverables Highly Predictable`,
      summary: `Duration variation for ${label.toLowerCase()} deliverables remained within a narrow band across historical projects.`,
      observation: `Duration variation remained within a narrow range (coefficient of variation ${round2(cv * 100)}%) across ${stats.durations.length} historical observations.`,
      category: "predictability",
      classification,
      projectType: null,
      stage: null,
      complexity: null,
      clientType: null,
      procurementRoute: null,
      sampleSize: stats.durations.length,
      confidenceLevel,
      confidenceScore,
      evidenceJson: {
        classification,
        meanDurationDays: round2(mean),
        stdDevDays: round2(sd),
        coefficientOfVariation: round2(cv),
        projectCount: stats.projects.size,
      },
    });
  }

  return topInsights(drafts);
}

/** Float erosion patterns by project stage. */
export function generateFloatConsumptionInsights(ctx: PortfolioContext): InsightDraft[] {
  const portfolioFloat = ctx.observations.filter((o) => o.totalFloat != null);
  if (portfolioFloat.length < MIN_SAMPLE) return [];

  const portfolioConsumed =
    portfolioFloat.filter((o) => o.floatConsumed).length / portfolioFloat.length;

  const byStage = new Map<string, { consumed: number; total: number; projects: Set<string> }>();
  for (const o of portfolioFloat) {
    const stage = o.meta.stage ?? "Unknown stage";
    const entry = byStage.get(stage) ?? { consumed: 0, total: 0, projects: new Set() };
    entry.total++;
    if (o.floatConsumed) entry.consumed++;
    entry.projects.add(o.projectId);
    byStage.set(stage, entry);
  }

  const drafts: InsightDraft[] = [];
  for (const [stage, stats] of byStage) {
    if (stats.total < MIN_SAMPLE) continue;
    const rate = stats.consumed / stats.total;
    const excessVsPortfolio = rate - portfolioConsumed;
    if (excessVsPortfolio < 0.12) continue;

    const pct = Math.round(rate * 100);
    const portfolioPct = Math.round(portfolioConsumed * 100);
    const consistency = clamp01(excessVsPortfolio / 0.4);
    const { confidenceScore, confidenceLevel } = computeInsightConfidence({
      sampleSize: stats.total,
      consistency,
      evidenceQuality: clamp01(stats.projects.size / 4),
      dataCompleteness: portfolioMetaCompleteness(ctx),
    });
    if (!passesQualityGate(stats.total, confidenceLevel)) continue;

    drafts.push({
      insightType: "FLOAT_CONSUMPTION",
      title: `${stage} Deliverables Consume Significant Float`,
      summary: `Deliverables captured during ${stage} showed elevated float erosion compared with the portfolio average.`,
      observation: `${pct}% of deliverables at ${stage} had zero or negative float, compared with a portfolio average of ${portfolioPct}%.`,
      category: "float",
      classification: null,
      projectType: null,
      stage,
      complexity: null,
      clientType: null,
      procurementRoute: null,
      sampleSize: stats.total,
      confidenceLevel,
      confidenceScore,
      evidenceJson: {
        stage,
        floatConsumedPct: pct,
        portfolioFloatConsumedPct: portfolioPct,
        excessPercentagePoints: round2(excessVsPortfolio * 100),
        projectCount: stats.projects.size,
      },
    });
  }

  return topInsights(drafts);
}

type DriverDimension = {
  field: keyof Pick<ProjectMeta, "complexity" | "projectType" | "clientType" | "procurementRoute" | "stage">;
  titlePrefix: string;
  normalize?: (v: string | null | undefined) => string | null;
};

const DRIVER_DIMENSIONS: DriverDimension[] = [
  { field: "complexity", titlePrefix: "Complexity", normalize: normComplexity },
  { field: "projectType", titlePrefix: "Project type" },
  { field: "clientType", titlePrefix: "Client type" },
  { field: "procurementRoute", titlePrefix: "Procurement route" },
  { field: "stage", titlePrefix: "Stage" },
];

/** Metadata dimensions associated with longer deliverable durations. */
export function generateDriverStrengthInsights(ctx: PortfolioContext): InsightDraft[] {
  const withDuration = ctx.observations
    .map((o) => {
      const days = o.actualDays ?? o.plannedDays;
      return days != null && days > 0 ? { ...o, durationDays: days } : null;
    })
    .filter((x): x is DeliverableObservation & { durationDays: number } => x !== null);

  if (withDuration.length < MIN_SAMPLE) return [];

  const portfolioAvg = avg(withDuration.map((o) => o.durationDays))!;

  const drafts: InsightDraft[] = [];

  for (const dim of DRIVER_DIMENSIONS) {
    const groups = new Map<string, { durations: number[]; projects: Set<string> }>();
    for (const o of withDuration) {
      const raw = o.meta[dim.field];
      const value = dim.normalize ? dim.normalize(raw) : normLabel(raw);
      if (!value) continue;
      const entry = groups.get(value) ?? { durations: [], projects: new Set() };
      entry.durations.push(o.durationDays);
      entry.projects.add(o.projectId);
      groups.set(value, entry);
    }

    for (const [value, stats] of groups) {
      if (stats.durations.length < MIN_SAMPLE) continue;
      const groupAvg = avg(stats.durations)!;
      const pctDiff = round2(((groupAvg - portfolioAvg) / portfolioAvg) * 100);
      if (Math.abs(pctDiff) < 20) continue;

      const consistency = clamp01(Math.abs(pctDiff) / 50);
      const { confidenceScore, confidenceLevel } = computeInsightConfidence({
        sampleSize: stats.durations.length,
        consistency,
        evidenceQuality: clamp01(stats.projects.size / 5),
        dataCompleteness: portfolioMetaCompleteness(ctx),
      });
      if (!passesQualityGate(stats.durations.length, confidenceLevel)) continue;

      const direction = pctDiff > 0 ? "longer" : "shorter";
      drafts.push({
        insightType: "DRIVER_STRENGTH",
        title:
          dim.field === "complexity"
            ? `${value} Complexity Associated With ${direction === "longer" ? "Longer" : "Shorter"} Durations`
            : `${dim.titlePrefix}: ${value} Shows ${direction === "longer" ? "Longer" : "Shorter"} Durations`,
        summary: `Deliverables on projects with ${dim.titlePrefix.toLowerCase()} "${value}" averaged ${Math.abs(pctDiff)}% ${direction} than the portfolio baseline.`,
        observation: `Average duration ${direction === "longer" ? "exceeded" : "was below"} portfolio average by ${Math.abs(pctDiff)}% (${round2(groupAvg)} vs ${round2(portfolioAvg)} days).`,
        category: "driver",
        classification: null,
        projectType: dim.field === "projectType" ? value : null,
        stage: dim.field === "stage" ? value : null,
        complexity: dim.field === "complexity" ? value : null,
        clientType: dim.field === "clientType" ? value : null,
        procurementRoute: dim.field === "procurementRoute" ? value : null,
        sampleSize: stats.durations.length,
        confidenceLevel,
        confidenceScore,
        evidenceJson: {
          dimension: dim.field,
          dimensionValue: value,
          groupAvgDurationDays: round2(groupAvg),
          portfolioAvgDurationDays: round2(portfolioAvg),
          pctDiffFromPortfolio: pctDiff,
          projectCount: stats.projects.size,
        },
      });
    }
  }

  return topInsights(drafts);
}

/** Cross-project patterns combining metadata and deliverable classification. */
export function generateRecurringLessons(ctx: PortfolioContext): InsightDraft[] {
  const keyFor = (o: DeliverableObservation) => {
    const parts = [
      o.meta.projectType ? `pt:${o.meta.projectType}` : null,
      o.meta.clientType ? `ct:${o.meta.clientType}` : null,
      o.meta.sector ? `sec:${o.meta.sector}` : null,
      `cls:${o.classification}`,
    ].filter(Boolean);
    return parts.join("|");
  };

  const groups = new Map<
    string,
    {
      label: string;
      classification: string;
      projectType: string | null;
      clientType: string | null;
      overrun: number;
      withActual: number;
      projects: Set<string>;
    }
  >();

  for (const o of ctx.observations) {
    if (o.overrun === null) continue;
    const key = keyFor(o);
    const projectType = o.meta.projectType;
    const clientType = o.meta.clientType;
    const sector = o.meta.sector;
    const classLabel = formatClassification(o.classification);
    const contextLabel = [sector, clientType, projectType].filter(Boolean).join(" ") || "Portfolio";
    const label = `${contextLabel} ${classLabel}`.trim();

    const entry = groups.get(key) ?? {
      label,
      classification: o.classification,
      projectType,
      clientType,
      overrun: 0,
      withActual: 0,
      projects: new Set(),
    };
    entry.withActual++;
    if (o.overrun) entry.overrun++;
    entry.projects.add(o.projectId);
    groups.set(key, entry);
  }

  const drafts: InsightDraft[] = [];
  for (const [, stats] of groups) {
    if (stats.withActual < MIN_SAMPLE || stats.projects.size < 3) continue;
    const pct = Math.round((stats.overrun / stats.withActual) * 100);
    if (pct < 50) continue;

    const consistency = clamp01((pct - 45) / 55);
    const { confidenceScore, confidenceLevel } = computeInsightConfidence({
      sampleSize: stats.withActual,
      consistency,
      evidenceQuality: clamp01(stats.projects.size / 6),
      dataCompleteness: portfolioMetaCompleteness(ctx),
    });
    if (!passesQualityGate(stats.withActual, confidenceLevel)) continue;

    drafts.push({
      insightType: "RECURRING_LESSON",
      title: `${stats.label} Commonly Experience Duration Growth`,
      summary: `This pattern was observed repeatedly across ${stats.projects.size} historical projects.`,
      observation: `${pct}% of analysed deliverables in this group exceeded planned duration across the portfolio history.`,
      category: "lesson",
      classification: stats.classification as DeliverableClassification,
      projectType: stats.projectType,
      stage: null,
      complexity: null,
      clientType: stats.clientType,
      procurementRoute: null,
      sampleSize: stats.withActual,
      confidenceLevel,
      confidenceScore,
      evidenceJson: {
        contextLabel: stats.label,
        overrunPct: pct,
        overrunCount: stats.overrun,
        analysedCount: stats.withActual,
        projectCount: stats.projects.size,
      },
    });
  }

  return topInsights(drafts);
}

/** Run all insight generators against current portfolio history. */
export async function generateAllInsights(companyId: string): Promise<LearnedInsightDto[]> {
  const ctx = await loadPortfolioContext(companyId);
  const reliabilityProfiles = await listReliabilityProfiles(companyId);
  const outcomeProfiles = await listOutcomeProfiles(companyId);
  const drafts: InsightDraft[] = [
    ...generateDurationOverrunInsights(ctx),
    ...generatePredictabilityInsights(ctx),
    ...generateFloatConsumptionInsights(ctx),
    ...generateDriverStrengthInsights(ctx),
    ...generateRecurringLessons(ctx),
    ...buildForecastReliabilityInsights(reliabilityProfiles).map((d) => ({
      insightType: "FORECAST_RELIABILITY" as const,
      title: d.title,
      summary: d.summary,
      observation: d.observation,
      category: "forecast_reliability",
      classification: d.classification,
      projectType: null,
      stage: null,
      complexity: null,
      clientType: null,
      procurementRoute: null,
      sampleSize: d.sampleSize,
      confidenceLevel: d.confidenceLevel,
      confidenceScore: d.confidenceScore,
      evidenceJson: d.evidenceJson,
    })),
    ...buildOutcomePredictionInsights(outcomeProfiles).map((d) => ({
      insightType: "OUTCOME_PREDICTION" as const,
      title: d.title,
      summary: d.summary,
      observation: d.observation,
      category: "outcome_prediction",
      classification: d.classification,
      projectType: null,
      stage: null,
      complexity: null,
      clientType: null,
      procurementRoute: null,
      sampleSize: d.sampleSize,
      confidenceLevel: d.confidenceLevel,
      confidenceScore: d.confidenceScore,
      evidenceJson: d.evidenceJson,
    })),
  ];

  const now = new Date();
  await prisma.learnedInsight.deleteMany({ where: { companyId } });

  if (drafts.length === 0) return [];

  const created = await Promise.all(
    drafts.map((d) =>
      prisma.learnedInsight.create({
        data: {
          companyId,
          insightType: d.insightType,
          title: d.title,
          summary: d.summary,
          observation: d.observation,
          category: d.category,
          classification: d.classification,
          projectType: d.projectType,
          stage: d.stage,
          complexity: d.complexity,
          clientType: d.clientType,
          procurementRoute: d.procurementRoute,
          sampleSize: d.sampleSize,
          confidenceLevel: d.confidenceLevel,
          confidenceScore: d.confidenceScore,
          evidenceJson: d.evidenceJson as object,
          lastCalculatedAt: now,
        },
      })
    )
  );

  return created.map(mapRow);
}

function mapRow(row: {
  id: string;
  insightType: LearnedInsightType;
  title: string;
  summary: string;
  observation: string;
  category: string | null;
  classification: string | null;
  projectType: string | null;
  stage: string | null;
  complexity: string | null;
  clientType: string | null;
  procurementRoute: string | null;
  sampleSize: number;
  confidenceLevel: LearnedInsightConfidenceLevel;
  confidenceScore: number;
  evidenceJson: unknown;
  lastCalculatedAt: Date;
}): LearnedInsightDto {
  return {
    id: row.id,
    insightType: row.insightType,
    title: row.title,
    summary: row.summary,
    observation: row.observation,
    category: row.category,
    classification: row.classification,
    projectType: row.projectType,
    stage: row.stage,
    complexity: row.complexity,
    clientType: row.clientType,
    procurementRoute: row.procurementRoute,
    sampleSize: row.sampleSize,
    confidenceLevel: row.confidenceLevel,
    confidenceScore: row.confidenceScore,
    evidenceJson: (row.evidenceJson ?? {}) as Record<string, unknown>,
    lastCalculatedAt: row.lastCalculatedAt.toISOString(),
  };
}

export async function listLearnedInsights(
  companyId: string,
  filters: LearnedInsightFilters = {}
): Promise<LearnedInsightDto[]> {
  const where: Record<string, unknown> = { companyId };
  if (filters.insightType) where.insightType = filters.insightType;
  if (filters.classification) where.classification = filters.classification;
  if (filters.projectType) where.projectType = filters.projectType;
  if (filters.stage) where.stage = filters.stage;
  if (filters.complexity) where.complexity = filters.complexity;
  if (filters.clientType) where.clientType = filters.clientType;
  if (filters.procurementRoute) where.procurementRoute = filters.procurementRoute;

  const rows = await prisma.learnedInsight.findMany({
    where,
    orderBy: [{ confidenceScore: "desc" }, { sampleSize: "desc" }],
    take: filters.limit ?? 100,
  });
  return rows.map(mapRow);
}

export async function getLearnedInsightById(
  companyId: string,
  id: string
): Promise<LearnedInsightDto | null> {
  const row = await prisma.learnedInsight.findFirst({ where: { id, companyId } });
  return row ? mapRow(row) : null;
}
