import { prisma } from "../../../utils/prisma.js";
import { autoPopulateFromImportedProgrammeMetadata, getProfile } from "../profiles/intelligenceProfile.service.js";
import type { ProgrammeState } from "@prisma/client";
import { buildDeliverableFingerprint, fingerprintCacheKey } from "../matching/deliverableFingerprint.service.js";
import { buildHistoricalDeliverableFingerprint } from "../matching/historicalFingerprint.service.js";
import { computeWeightedDeliverableSimilarity } from "../matching/weightedDeliverableSimilarity.service.js";
import { DEFAULT_MIN_COMPARABLE_SIMILARITY } from "../matching/similarityWeights.config.js";
import { COMPLETED_PROJECT_SNAPSHOT_STATES } from "./intelligenceConstants.js";

export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

export type SimilarProjectMatch = {
  projectId: string;
  projectName: string;
  similarityScore: number;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  matchedFields: string[];
  explanations: string[];
};

export type SimilarDeliverableMatch = {
  deliverableId: string | null;
  deliverableName: string;
  classification: string | null;
  matchedClassification: string | null;
  snapshotId?: string;
  fingerprintKey?: string;
  similaritySignals?: Record<string, number>;
  evidence?: {
    projectId: string;
    projectName: string;
    programmeState: ProgrammeState | null;
    snapshotId?: string;
    plannedStart: string | null;
    plannedFinish: string | null;
    actualStart: string | null;
    actualFinish: string | null;
    workPackageDurationDays: number | null;
    durationBasis: string | null;
  };
  similarityScore: number;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  matchedFields: string[];
  explanations: string[];
};

const PROJECT_WEIGHTS = {
  sector: 25,
  projectType: 20,
  stage: 15,
  procurementRoute: 10,
  complexity: 10,
  classificationTags: 10,
  disciplineTags: 10,
} as const;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function toStringSet(v: unknown): Set<string> {
  const s = new Set<string>();
  if (!Array.isArray(v)) return s;
  for (const x of v) {
    const t = norm(x);
    if (t) s.add(t);
  }
  return s;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function scoreExact(a: unknown, b: unknown): number {
  const aa = norm(a);
  const bb = norm(b);
  if (!aa || !bb) return 0;
  return aa === bb ? 1 : 0;
}

function confidenceFromSampleSize(sampleSize: number): { confidenceScore: number; confidenceLevel: ConfidenceLevel } {
  const n = Math.max(0, Math.floor(sampleSize));
  // Smooth curve: 0 matches -> 0, 10 -> ~0.63, 50 -> ~0.99
  const score = 1 - Math.exp(-n / 10);
  const pct = clamp01(score);
  const level: ConfidenceLevel = n < 5 ? "LOW" : n < 20 ? "MEDIUM" : "HIGH";
  return { confidenceScore: Math.round(pct * 1000) / 1000, confidenceLevel: level };
}

function roundScore01To100(x: number): number {
  return Math.round(clamp01(x) * 1000) / 10; // 1dp
}

function buildProjectSimilarity(a: any, b: any) {
  const matchedFields: string[] = [];
  const explanations: string[] = [];

  const sector = scoreExact(a.sector, b.sector);
  if (sector === 1) {
    matchedFields.push("sector");
    explanations.push("Same sector");
  }

  const projectType = scoreExact(a.projectType, b.projectType);
  if (projectType === 1) {
    matchedFields.push("projectType");
    explanations.push("Same project type");
  }

  const stage = scoreExact(a.stage, b.stage);
  if (stage === 1) {
    matchedFields.push("stage");
    explanations.push("Same stage");
  }

  const procurementRoute = scoreExact(a.procurementRoute, b.procurementRoute);
  if (procurementRoute === 1) {
    matchedFields.push("procurementRoute");
    explanations.push("Same procurement route");
  }

  const complexity = scoreExact(a.complexity, b.complexity);
  if (complexity === 1) {
    matchedFields.push("complexity");
    explanations.push("Same complexity category");
  }

  const aClass = toStringSet(a.classificationTagsList);
  const bClass = toStringSet(b.classificationTagsList);
  const classSim = jaccard(aClass, bClass);
  if (classSim > 0) {
    matchedFields.push("classificationTags");
    explanations.push("Similar classification tags");
  }

  const aDisc = toStringSet(a.disciplineTags);
  const bDisc = toStringSet(b.disciplineTags);
  const discSim = jaccard(aDisc, bDisc);
  if (discSim > 0) {
    matchedFields.push("disciplineTags");
    explanations.push("Similar discipline tags");
  }

  const score01 =
    (sector * PROJECT_WEIGHTS.sector +
      projectType * PROJECT_WEIGHTS.projectType +
      stage * PROJECT_WEIGHTS.stage +
      procurementRoute * PROJECT_WEIGHTS.procurementRoute +
      complexity * PROJECT_WEIGHTS.complexity +
      classSim * PROJECT_WEIGHTS.classificationTags +
      discSim * PROJECT_WEIGHTS.disciplineTags) /
    100;

  return { similarityScore: roundScore01To100(score01), matchedFields, explanations };
}

/** Score similarity between two loaded intelligence profiles (no DB access). */
export function scoreProjectProfilesSimilarity(
  a: Parameters<typeof buildProjectSimilarity>[0] | null | undefined,
  b: Parameters<typeof buildProjectSimilarity>[1] | null | undefined
): number {
  if (!a || !b) return 0;
  return buildProjectSimilarity(a, b).similarityScore;
}

export async function computeProjectSimilarityScore(args: {
  companyId: string;
  aProjectId: string;
  bProjectId: string;
}): Promise<number> {
  if (args.aProjectId === args.bProjectId) return 100;
  const [a, b] = await Promise.all([
    prisma.projectIntelligenceProfile.findFirst({
      where: { companyId: args.companyId, projectId: args.aProjectId },
    }),
    prisma.projectIntelligenceProfile.findFirst({
      where: { companyId: args.companyId, projectId: args.bProjectId },
    }),
  ]);
  return scoreProjectProfilesSimilarity(a, b);
}

function tokenizeName(name: string): Set<string> {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  return new Set(tokens);
}

function nameSimilarity(a: string, b: string): number {
  const A = tokenizeName(a);
  const B = tokenizeName(b);
  return jaccard(A, B);
}

function flattenJsonTags(obj: unknown): Set<string> {
  const out = new Set<string>();
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const kk = norm(k);
    const vv = norm(v);
    if (kk && vv) out.add(`${kk}:${vv}`);
    if (vv) out.add(vv);
  }
  return out;
}

async function getDeliverableSignal(projectId: string, companyId: string, deliverableId: string) {
  const deliverable = await prisma.deliverable.findFirst({
    where: { id: deliverableId, projectId, companyId },
    select: {
      id: true,
      name: true,
      classification: true,
      likelyDuration: true,
      bestDuration: true,
      fragnetId: true,
      fragnet: { select: { name: true } },
      activityCodeAssignments: { include: { type: true, code: true } },
      activities: {
        select: {
          activityCode: true,
          name: true,
          likelyDuration: true,
          bestDuration: true,
          isCritical: true,
        },
      },
    },
  });
  if (!deliverable) {
    const err: any = new Error("Deliverable not found");
    err.status = 404;
    throw err;
  }

  let deliverableType: string | null = null;
  let stage: string | null = null;
  const disciplineTags = new Set<string>();
  const classificationTags = new Set<string>();

  for (const a of deliverable.activityCodeAssignments) {
    const slug = a.type.slug.toLowerCase();
    const val = (a.code.shortName ?? a.code.name).trim();
    if (!val) continue;
    if (!stage && (slug.includes("riba") || slug.includes("stage"))) stage = val;
    if (!deliverableType && (slug.includes("deliverable") || slug.includes("type"))) deliverableType = val;
    if (slug.includes("discipline")) disciplineTags.add(val.toLowerCase());
    if (slug.includes("class")) classificationTags.add(val.toLowerCase());
  }

  if (!stage) {
    const profile = await prisma.projectIntelligenceProfile.findUnique({
      where: { projectId },
      select: { stage: true, primaryRibaStage: true },
    });
    stage = profile?.stage?.trim() || profile?.primaryRibaStage?.trim() || null;
  }

  const plannerDurationDays =
    deliverable.likelyDuration != null && deliverable.likelyDuration > 0
      ? deliverable.likelyDuration
      : deliverable.bestDuration != null && deliverable.bestDuration > 0
        ? deliverable.bestDuration
        : null;

  const fingerprint = buildDeliverableFingerprint({
    deliverableName: deliverable.name,
    classification: deliverable.classification,
    discipline: [...disciplineTags][0] ?? deliverableType,
    parentWbs: deliverable.fragnet?.name ?? null,
    fragnetId: deliverable.fragnetId,
    stage,
    durationDaysOverride: plannerDurationDays,
    activities: deliverable.activities.map((a) => ({
      activityCode: a.activityCode,
      name: a.name,
      originalDuration: a.likelyDuration ?? a.bestDuration,
      isCritical: a.isCritical,
    })),
  });

  return {
    deliverableId: deliverable.id,
    deliverableName: deliverable.name,
    classification: deliverable.classification ?? null,
    deliverableType,
    stage,
    disciplineTags,
    classificationTags,
    fingerprint,
    fingerprintKey: fingerprintCacheKey(fingerprint),
  };
}

function deliverableSimilarity(a: any, b: any) {
  // Weights: prioritize normalized classification over name
  const W = { classification: 45, stage: 15, discipline: 15, classificationTags: 15, name: 10 } as const;
  const matchedFields: string[] = [];
  const explanations: string[] = [];

  const classificationSim = scoreExact(a.classification, b.classification);
  if (classificationSim === 1) {
    matchedFields.push("classification");
    explanations.push(`Matched classification: ${String(a.classification)}`);
  }

  const stageSim = scoreExact(a.stage, b.stage);
  if (stageSim === 1) {
    matchedFields.push("stage");
    explanations.push("Same stage");
  }

  const aClass = a.classificationTags instanceof Set ? a.classificationTags : toStringSet(a.classificationTags);
  const bClass = b.classificationTags instanceof Set ? b.classificationTags : toStringSet(b.classificationTags);
  const classSim = jaccard(aClass, bClass);
  if (classSim > 0) {
    matchedFields.push("classificationTags");
    explanations.push("Similar classification tags");
  }

  const aDisc = a.disciplineTags instanceof Set ? a.disciplineTags : toStringSet(a.disciplineTags);
  const bDisc = b.disciplineTags instanceof Set ? b.disciplineTags : toStringSet(b.disciplineTags);
  const discSim = jaccard(aDisc, bDisc);
  if (discSim > 0) {
    matchedFields.push("discipline");
    explanations.push("Similar discipline tags");
  }

  const nameSim = nameSimilarity(a.deliverableName, b.deliverableName);
  if (nameSim > 0) {
    matchedFields.push("deliverableName");
    explanations.push("Similar deliverable name");
  }

  const score01 =
    (classificationSim * W.classification +
      stageSim * W.stage +
      discSim * W.discipline +
      classSim * W.classificationTags +
      nameSim * W.name) /
    100;

  return { similarityScore: roundScore01To100(score01), matchedFields, explanations };
}

export async function getSimilarProjects(args: { projectId: string; companyId: string; limit?: number }) {
  const limit = Math.max(1, Math.min(50, args.limit ?? 20));

  await autoPopulateFromImportedProgrammeMetadata(args.projectId, args.companyId);
  const base = await getProfile(args.projectId, args.companyId);

  const [project, candidates] = await Promise.all([
    prisma.project.findFirst({
      where: { id: args.projectId, companyId: args.companyId, archivedAt: null },
      select: { id: true, name: true },
    }),
    prisma.projectIntelligenceProfile.findMany({
      where: {
        companyId: args.companyId,
        projectId: { not: args.projectId },
        project: {
          archivedAt: null,
          programmeSnapshots: {
            some: { programmeState: { in: COMPLETED_PROJECT_SNAPSHOT_STATES } },
          },
        },
      },
      include: { project: { select: { id: true, name: true } } },
    }),
  ]);
  if (!project) {
    const err: any = new Error("Project not found");
    err.status = 404;
    throw err;
  }

  const scored = candidates
    .map((p) => {
      const { similarityScore, matchedFields, explanations } = buildProjectSimilarity(base, p);
      return {
        projectId: p.projectId,
        projectName: p.project?.name ?? "Unknown project",
        similarityScore,
        matchedFields,
        explanations,
      };
    })
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, limit);

  const conf = confidenceFromSampleSize(scored.filter((m) => m.similarityScore > 0).length);
  const matches: SimilarProjectMatch[] = scored.map((m) => ({
    ...m,
    confidenceScore: conf.confidenceScore,
    confidenceLevel: conf.confidenceLevel,
  }));

  return {
    projectId: project.id,
    projectName: project.name,
    matches,
    confidence: conf.confidenceScore,
    explanations: [...new Set(matches.flatMap((m) => m.explanations))],
  };
}

export async function getSimilarDeliverables(args: {
  projectId: string;
  companyId: string;
  deliverableId: string;
  limit?: number;
  selectedProjectIds?: string[];
  allowedProgrammeStates?: ProgrammeState[];
  minSimilarity?: number;
}) {
  const limit = Math.max(1, Math.min(200, args.limit ?? 50));
  const minSimilarity = args.minSimilarity ?? 0;

  const base = await getDeliverableSignal(args.projectId, args.companyId, args.deliverableId);

  const historical = await prisma.deliverableSnapshot.findMany({
    where: {
      snapshot: {
        companyId: args.companyId,
        ...(args.selectedProjectIds?.length
          ? { projectId: { in: args.selectedProjectIds.filter(Boolean).map((s) => String(s)) } }
          : { projectId: { not: args.projectId } }),
        ...(args.allowedProgrammeStates?.length
          ? { programmeState: { in: args.allowedProgrammeStates } }
          : {}),
        project: { archivedAt: null },
      },
    },
    select: {
      id: true,
      deliverableId: true,
      name: true,
      classification: true,
      classificationTags: true,
      fragnetId: true,
      parentWbs: true,
      wbsPath: true,
      stage: true,
      discipline: true,
      workPackageDurationDays: true,
      durationBasis: true,
      plannedStart: true,
      plannedFinish: true,
      actualStart: true,
      actualFinish: true,
      snapshot: {
        select: {
          id: true,
          projectId: true,
          programmeState: true,
          stage: true,
          disciplineTags: true,
          classificationTagsList: true,
          importedAt: true,
          project: { select: { name: true, intelligenceProfile: { select: { stage: true, primaryRibaStage: true } } } },
        },
      },
    },
    take: 2000,
  });

  const snapshotIds = [...new Set(historical.map((h) => h.snapshot.id))];
  const activitySnapshots = snapshotIds.length
    ? await prisma.activitySnapshot.findMany({
        where: { snapshotId: { in: snapshotIds } },
        select: {
          snapshotId: true,
          deliverableId: true,
          fragnetId: true,
          activityCode: true,
          name: true,
          originalDuration: true,
          remainingDuration: true,
          isCritical: true,
          classificationTags: true,
        },
      })
    : [];

  const activitiesBySnapshotDeliverable = new Map<string, typeof activitySnapshots>();
  for (const a of activitySnapshots) {
    const key = `${a.snapshotId}\x1d${a.deliverableId ?? ""}`;
    const bucket = activitiesBySnapshotDeliverable.get(key) ?? [];
    bucket.push(a);
    activitiesBySnapshotDeliverable.set(key, bucket);
  }

  const scored = historical
    .map((h) => {
      const actKey = `${h.snapshot.id}\x1d${h.deliverableId ?? ""}`;
      const linkedActivities = activitiesBySnapshotDeliverable.get(actKey) ?? [];

      const candidateFingerprint = buildHistoricalDeliverableFingerprint({
        deliverableSnapshot: {
          name: h.name,
          classification: h.classification,
          fragnetId: h.fragnetId,
          parentWbs: h.parentWbs,
          wbsPath: h.wbsPath,
          stage: h.stage,
          discipline: h.discipline,
          classificationTags: h.classificationTags as Record<string, unknown>,
          deliverableId: h.deliverableId,
        },
        programmeSnapshot: {
          programmeState: h.snapshot.programmeState,
          stage: h.snapshot.stage,
          disciplineTags: h.snapshot.disciplineTags,
          projectProfileStage: h.snapshot.project.intelligenceProfile?.stage ?? null,
          projectProfilePrimaryRibaStage: h.snapshot.project.intelligenceProfile?.primaryRibaStage ?? null,
        },
        linkedActivities: linkedActivities.map((a) => ({
          activityCode: a.activityCode,
          name: a.name,
          originalDuration: a.originalDuration ?? a.remainingDuration,
          isCritical: a.isCritical,
          classificationTags: a.classificationTags as Record<string, unknown>,
        })),
        activityFragnetLinks: linkedActivities.map((a) => ({
          deliverableId: a.deliverableId,
          fragnetId: a.fragnetId,
        })),
      });

      const weighted = computeWeightedDeliverableSimilarity(base.fingerprint, candidateFingerprint);
      const matchedClassification =
        base.classification && candidateFingerprint.classification && norm(base.classification) === norm(candidateFingerprint.classification)
          ? base.classification
          : null;

      return {
        deliverableId: h.deliverableId ?? null,
        deliverableName: h.name,
        classification: h.classification ?? null,
        matchedClassification,
        snapshotId: h.snapshot.id,
        fingerprintKey: fingerprintCacheKey(candidateFingerprint),
        similaritySignals: weighted.signals as unknown as Record<string, number>,
        evidence: {
          projectId: h.snapshot.projectId,
          projectName: h.snapshot.project?.name ?? "Unknown project",
          programmeState: h.snapshot.programmeState ?? null,
          snapshotId: h.snapshot.id,
          plannedStart: h.plannedStart ? h.plannedStart.toISOString().slice(0, 10) : null,
          plannedFinish: h.plannedFinish ? h.plannedFinish.toISOString().slice(0, 10) : null,
          actualStart: h.actualStart ? h.actualStart.toISOString().slice(0, 10) : null,
          actualFinish: h.actualFinish ? h.actualFinish.toISOString().slice(0, 10) : null,
          workPackageDurationDays: h.workPackageDurationDays ?? null,
          durationBasis: h.durationBasis ?? null,
        },
        similarityScore: weighted.overallScore,
        matchedFields: weighted.matchedSignals,
        explanations: weighted.explanations,
        importedAt: h.snapshot.importedAt,
      };
    })
    .filter((m) => m.similarityScore >= minSimilarity)
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, limit);

  const conf = confidenceFromSampleSize(scored.filter((m) => m.similarityScore >= DEFAULT_MIN_COMPARABLE_SIMILARITY).length);
  const matches: SimilarDeliverableMatch[] = scored.map((m) => ({
    deliverableId: m.deliverableId,
    deliverableName: m.deliverableName,
    classification: m.classification,
    matchedClassification: m.matchedClassification,
    snapshotId: m.snapshotId,
    fingerprintKey: m.fingerprintKey,
    similaritySignals: m.similaritySignals,
    evidence: m.evidence,
    similarityScore: m.similarityScore,
    matchedFields: m.matchedFields,
    explanations: m.explanations,
    confidenceScore: conf.confidenceScore,
    confidenceLevel: conf.confidenceLevel,
  }));

  return {
    deliverableId: base.deliverableId,
    deliverableName: base.deliverableName,
    fingerprintKey: base.fingerprintKey,
    matches,
    confidence: conf.confidenceScore,
    explanations: [...new Set(matches.flatMap((m) => m.explanations))],
    minComparableSimilarity: DEFAULT_MIN_COMPARABLE_SIMILARITY,
  };
}

