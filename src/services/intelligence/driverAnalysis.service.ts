import { prisma } from "../../utils/prisma.js";
import { getDeliverableBenchmark, type BenchmarkReport } from "./benchmark.service.js";
import { ALLOWED_SNAPSHOT_STATES } from "./intelligenceConstants.js";

export type DriverConfidence = "LOW" | "MEDIUM" | "HIGH";
export type DriverImpactLevel = "LOW" | "MEDIUM" | "HIGH";

export type DriverFinding = {
  driverType: string;
  confidence: DriverConfidence;
  confidenceScore: number;
  impactLevel: DriverImpactLevel;
  title: string;
  summary: string;
  reasoning: string[];
  evidence: { label: string; value: string | number }[];
};

type EnrichedSample = {
  projectId: string;
  durationDays: number;
  classification: string | null;
  complexity: string | null;
  projectType: string | null;
  procurementRoute: string | null;
  clientType: string | null;
  stage: string | null;
};

type ProjectMeta = {
  complexity: string | null;
  projectType: string | null;
  procurementRoute: string | null;
  clientType: string | null;
  stage: string | null;
};

const MIN_GROUP_SAMPLE = 5;
const MIN_PCT_DIFF = 15;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
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

function confidenceLevelFromScore(score: number): DriverConfidence {
  const s = clamp01(score);
  if (s <= 0.39) return "LOW";
  if (s <= 0.69) return "MEDIUM";
  return "HIGH";
}

function benchmarkConfidenceScore(level: string | undefined, score: number | undefined): number {
  if (typeof score === "number" && Number.isFinite(score)) return clamp01(score);
  if (level === "HIGH") return 0.85;
  if (level === "MEDIUM") return 0.6;
  if (level === "LOW") return 0.35;
  return 0.5;
}

function impactFromPctDiff(pctDiff: number): DriverImpactLevel {
  const abs = Math.abs(pctDiff);
  if (abs >= 35) return "HIGH";
  if (abs >= 25) return "MEDIUM";
  return "LOW";
}

function pctDiffFromPortfolio(groupAvg: number, portfolioAvg: number): number {
  if (!Number.isFinite(portfolioAvg) || portfolioAvg <= 0) return 0;
  return round2(((groupAvg - portfolioAvg) / portfolioAvg) * 100);
}

function computeDriverConfidence(args: {
  groupSampleSize: number;
  pctDiff: number;
  benchmarkConfidenceScore: number;
  attributeCompleteness: number;
}): { confidenceScore: number; confidence: DriverConfidence } {
  const sampleSizeScore = clamp01(args.groupSampleSize / 10);
  const varianceScore = clamp01(Math.abs(args.pctDiff) / 50);
  const benchmarkScore = clamp01(args.benchmarkConfidenceScore);
  const completenessScore = clamp01(args.attributeCompleteness);

  const confidenceScore = round2(
    sampleSizeScore * 0.4 + varianceScore * 0.3 + benchmarkScore * 0.2 + completenessScore * 0.1
  );
  return { confidenceScore, confidence: confidenceLevelFromScore(confidenceScore) };
}

function formatClassificationLabel(value: string): string {
  return value.replace(/_/g, " ");
}

type DriverDimension = {
  driverType: string;
  field: keyof Pick<
    EnrichedSample,
    "complexity" | "projectType" | "procurementRoute" | "clientType" | "stage" | "classification"
  >;
  titlePrefix: string;
  valueLabel: (value: string) => string;
  normalize?: (value: string | null) => string | null;
};

const DIMENSIONS: DriverDimension[] = [
  {
    driverType: "COMPLEXITY_DRIVER",
    field: "complexity",
    titlePrefix: "Complexity",
    valueLabel: (v) => `${v} complexity`,
    normalize: normComplexity,
  },
  {
    driverType: "PROJECT_TYPE_DRIVER",
    field: "projectType",
    titlePrefix: "Project type",
    valueLabel: (v) => v,
  },
  {
    driverType: "PROCUREMENT_DRIVER",
    field: "procurementRoute",
    titlePrefix: "Procurement route",
    valueLabel: (v) => v,
  },
  {
    driverType: "CLIENT_TYPE_DRIVER",
    field: "clientType",
    titlePrefix: "Client type",
    valueLabel: (v) => v,
  },
  {
    driverType: "STAGE_DRIVER",
    field: "stage",
    titlePrefix: "Stage",
    valueLabel: (v) => v,
  },
  {
    driverType: "CLASSIFICATION_DRIVER",
    field: "classification",
    titlePrefix: "Deliverable classification",
    valueLabel: formatClassificationLabel,
  },
];

async function loadProjectMetaByProjectId(
  companyId: string,
  projectIds: string[]
): Promise<Map<string, ProjectMeta>> {
  const map = new Map<string, ProjectMeta>();
  if (projectIds.length === 0) return map;

  const profiles = await prisma.projectIntelligenceProfile.findMany({
    where: { companyId, projectId: { in: projectIds } },
    select: {
      projectId: true,
      complexity: true,
      projectType: true,
      procurementRoute: true,
      clientType: true,
      stage: true,
    },
  });

  for (const p of profiles) {
    map.set(p.projectId, {
      complexity: normComplexity(p.complexity),
      projectType: normLabel(p.projectType),
      procurementRoute: normLabel(p.procurementRoute),
      clientType: normLabel(p.clientType),
      stage: normLabel(p.stage),
    });
  }

  const missing = projectIds.filter((id) => !map.has(id));
  if (missing.length > 0) {
    const snapshots = await prisma.programmeSnapshot.findMany({
      where: {
        companyId,
        projectId: { in: missing },
        programmeState: { in: ["APPROVED_BASELINE", "AS_BUILT", "FINAL_AS_BUILT"] },
      },
      orderBy: { importedAt: "desc" },
      select: {
        projectId: true,
        complexity: true,
        projectType: true,
        procurementRoute: true,
        clientType: true,
        stage: true,
      },
    });
    for (const s of snapshots) {
      if (map.has(s.projectId)) continue;
      map.set(s.projectId, {
        complexity: normComplexity(s.complexity),
        projectType: normLabel(s.projectType),
        procurementRoute: normLabel(s.procurementRoute),
        clientType: normLabel(s.clientType),
        stage: normLabel(s.stage),
      });
    }
  }

  return map;
}

async function enrichSamples(report: BenchmarkReport, companyId: string): Promise<EnrichedSample[]> {
  const matched = report.evidence?.matchedDeliverables ?? [];
  const projectIds = [...new Set(matched.map((m) => m.projectId).filter(Boolean))];
  const metaByProject = await loadProjectMetaByProjectId(companyId, projectIds);

  return matched
    .filter((m) => typeof m.durationDays === "number" && Number.isFinite(m.durationDays))
    .map((m) => {
      const meta = metaByProject.get(m.projectId) ?? {
        complexity: null,
        projectType: null,
        procurementRoute: null,
        clientType: null,
        stage: null,
      };
      const classification = m.classification ? String(m.classification) : null;
      return {
        projectId: m.projectId,
        durationDays: m.durationDays as number,
        classification,
        complexity: meta.complexity,
        projectType: meta.projectType,
        procurementRoute: meta.procurementRoute,
        clientType: meta.clientType,
        stage: meta.stage,
      };
    });
}

function currentValuesForProject(
  profile: ProjectMeta | null,
  deliverableClassification: string | null
): Record<DriverDimension["field"], string | null> {
  return {
    complexity: profile?.complexity ?? null,
    projectType: profile?.projectType ?? null,
    procurementRoute: profile?.procurementRoute ?? null,
    clientType: profile?.clientType ?? null,
    stage: profile?.stage ?? null,
    classification: deliverableClassification,
  };
}

function evaluateDimensionDriver(args: {
  dimension: DriverDimension;
  samples: EnrichedSample[];
  currentValue: string | null;
  portfolioAvg: number;
  benchmarkConfidenceScore: number;
}): DriverFinding | null {
  const { dimension, samples, currentValue, portfolioAvg, benchmarkConfidenceScore } = args;

  const normalizedCurrent = dimension.normalize ? dimension.normalize(currentValue) : normLabel(currentValue);
  if (!normalizedCurrent) return null;

  const groups = new Map<string, number[]>();
  let populated = 0;
  for (const s of samples) {
    const raw = s[dimension.field];
    const key = dimension.normalize ? dimension.normalize(raw) : normLabel(raw);
    if (!key) continue;
    populated += 1;
    const list = groups.get(key) ?? [];
    list.push(s.durationDays);
    groups.set(key, list);
  }

  const groupDurations = groups.get(normalizedCurrent);
  if (!groupDurations || groupDurations.length < MIN_GROUP_SAMPLE) return null;

  const groupAvg = avg(groupDurations);
  if (groupAvg == null || portfolioAvg <= 0) return null;

  const pctDiff = pctDiffFromPortfolio(groupAvg, portfolioAvg);
  if (Math.abs(pctDiff) < MIN_PCT_DIFF) return null;

  const attributeCompleteness = samples.length > 0 ? populated / samples.length : 0;
  const { confidenceScore, confidence } = computeDriverConfidence({
    groupSampleSize: groupDurations.length,
    pctDiff,
    benchmarkConfidenceScore,
    attributeCompleteness,
  });

  if (confidence === "LOW") return null;

  const impactLevel = impactFromPctDiff(pctDiff);
  const direction = pctDiff >= 0 ? "longer" : "shorter";
  const valueLabel = dimension.valueLabel(normalizedCurrent);

  const reasoning = [
    `${valueLabel} projects averaged ${Math.abs(pctDiff)}% ${direction} durations than the portfolio average in comparable evidence.`,
    `Average duration for this category: ${round2(groupAvg)} days.`,
    `Portfolio average across all comparable samples: ${round2(portfolioAvg)} days.`,
    `Current ${dimension.field === "classification" ? "deliverable" : "project"} is associated with ${valueLabel}.`,
  ];

  return {
    driverType: dimension.driverType,
    confidence,
    confidenceScore,
    impactLevel,
    title: `${dimension.titlePrefix} association (${normalizedCurrent})`,
    summary: `Historically, ${valueLabel} programmes in the evidence set averaged ${Math.abs(pctDiff)}% ${direction} durations than the portfolio average.`,
    reasoning,
    evidence: [
      { label: "Category", value: valueLabel },
      { label: "Avg Duration (Category)", value: round2(groupAvg) },
      { label: "Avg Duration (Portfolio)", value: round2(portfolioAvg) },
      { label: "Difference vs Portfolio", value: `${pctDiff}%` },
      { label: "Sample Size (Category)", value: groupDurations.length },
      { label: "Sample Size (Portfolio)", value: samples.length },
      { label: "Confidence Score", value: confidenceScore },
    ],
  };
}

export function generateDrivers(
  report: BenchmarkReport,
  samples: EnrichedSample[],
  currentProfile: ProjectMeta | null
): DriverFinding[] {
  if (samples.length < MIN_GROUP_SAMPLE) return [];

  const portfolioAvg = avg(samples.map((s) => s.durationDays));
  if (portfolioAvg == null || portfolioAvg <= 0) return [];

  const benchScore = benchmarkConfidenceScore(
    report.benchmark.confidenceLevel,
    report.benchmark.confidenceScore
  );

  const currentValues = currentValuesForProject(
    currentProfile,
    report.deliverable.classification ? String(report.deliverable.classification) : null
  );

  const drivers: DriverFinding[] = [];

  for (const dimension of DIMENSIONS) {
    const finding = evaluateDimensionDriver({
      dimension,
      samples,
      currentValue: currentValues[dimension.field],
      portfolioAvg,
      benchmarkConfidenceScore: benchScore,
    });
    if (finding) drivers.push(finding);
  }

  const impactOrder: Record<DriverImpactLevel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const confOrder: Record<DriverConfidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

  drivers.sort((a, b) => {
    const imp = impactOrder[b.impactLevel] - impactOrder[a.impactLevel];
    if (imp !== 0) return imp;
    return confOrder[b.confidence] - confOrder[a.confidence];
  });

  return drivers;
}

async function loadCurrentProjectMeta(projectId: string, companyId: string): Promise<ProjectMeta | null> {
  const currentProfileRow = await prisma.projectIntelligenceProfile.findUnique({
    where: { projectId },
    select: {
      complexity: true,
      projectType: true,
      procurementRoute: true,
      clientType: true,
      stage: true,
    },
  });

  if (currentProfileRow) {
    return {
      complexity: normComplexity(currentProfileRow.complexity),
      projectType: normLabel(currentProfileRow.projectType),
      procurementRoute: normLabel(currentProfileRow.procurementRoute),
      clientType: normLabel(currentProfileRow.clientType),
      stage: normLabel(currentProfileRow.stage),
    };
  }

  const snap = await prisma.programmeSnapshot.findFirst({
    where: {
      companyId,
      projectId,
      programmeState: { in: ALLOWED_SNAPSHOT_STATES },
    },
    orderBy: { importedAt: "desc" },
    select: {
      complexity: true,
      projectType: true,
      procurementRoute: true,
      clientType: true,
      stage: true,
    },
  });

  if (!snap) return null;

  return {
    complexity: normComplexity(snap.complexity),
    projectType: normLabel(snap.projectType),
    procurementRoute: normLabel(snap.procurementRoute),
    clientType: normLabel(snap.clientType),
    stage: normLabel(snap.stage),
  };
}

/** Build key-factor drivers from an existing benchmark report (no duplicate benchmark). */
export async function buildKeyFactorsFromReport(
  report: BenchmarkReport,
  args: { companyId: string; projectId: string }
): Promise<DriverFinding[]> {
  const samples = await enrichSamples(report, args.companyId);
  const currentProfile = await loadCurrentProjectMeta(args.projectId, args.companyId);
  return generateDrivers(report, samples, currentProfile);
}

export async function getDeliverableDrivers(args: {
  projectId: string;
  companyId: string;
  deliverableId: string;
  selectedProjectIds?: string[];
  /** When provided, skips a duplicate benchmark computation (e.g. trust orchestration). */
  benchmarkReport?: BenchmarkReport;
}): Promise<{ drivers: DriverFinding[] }> {
  const report = args.benchmarkReport ?? (await getDeliverableBenchmark(args));
  const drivers = await buildKeyFactorsFromReport(report, {
    companyId: args.companyId,
    projectId: args.projectId,
  });
  return { drivers };
}
