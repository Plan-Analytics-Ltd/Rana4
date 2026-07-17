import { prisma } from "../../../utils/prisma.js";
import {
  ALLOWED_SNAPSHOT_STATES,
  COMPLETED_PROJECT_SNAPSHOT_STATES,
  MIN_PROFILE_SAMPLE,
} from "../shared/intelligenceConstants.js";
import { diffDaysFromDates, round1 } from "../shared/intelligenceMath.js";
import { median, stddev } from "../shared/durationEvidence.service.js";
import { listLearnedInsights } from "../learning/learningEngine.service.js";
import { listReliabilityProfiles } from "../prediction/forecastReliability.service.js";
import { listRecommendationProfiles } from "../recommendations/recommendationEngine.service.js";
import { listIntelligenceTrustProfiles } from "../trust/intelligenceTrust.service.js";
import { confidenceLevelFromScore } from "../learning/learningMaturity.service.js";
import {
  resolveWorkPackageTaxonomy,
  sortCategoryIds,
  sortDisciplineIds,
  stripWorkPackageSuffix,
  canonicalKeyFromNormalisedName,
  normaliseDeliverableNameForTaxonomy,
} from "../taxonomy/workPackageTaxonomy.service.js";

export type DeliverableVariantTrace = {
  originalName: string;
  observationCount: number;
};

/** Canonical work package — aggregated organisational memory unit */
export type WorkPackageMemoryItem = {
  key: string;
  disciplineId: string;
  disciplineLabel: string;
  categoryId: string;
  categoryLabel: string;
  workPackageId: string;
  workPackageLabel: string;
  typicalDurationDays: number | null;
  durationVariationDays: number | null;
  sampleSize: number;
  projectCount: number;
  projectNames: string[];
  confidenceExplanation: string[];
  limitedEvidenceReason: string | null;
  confidenceTier: "high" | "moderate" | "limited";
  compactSummary: string;
  deliverableVariants: DeliverableVariantTrace[];
  sourceDeliverableNames: string[];
  classification: string | null;
  isUnclassified: boolean;
};

/** @deprecated Use WorkPackageMemoryItem */
export type EngineeringActivityMemoryItem = WorkPackageMemoryItem & {
  engineeringActivityId: string;
  engineeringActivityLabel: string;
};

export type CategoryMemorySection = {
  categoryId: string;
  categoryLabel: string;
  workPackageCount: number;
  workPackages: WorkPackageMemoryItem[];
};

export type DisciplineMemorySection = {
  disciplineId: string;
  disciplineLabel: string;
  workPackageCount: number;
  categories: CategoryMemorySection[];
  workPackages: WorkPackageMemoryItem[];
  /** @deprecated Use workPackages */
  activities: WorkPackageMemoryItem[];
};

/** Legacy flat item for brief dialog compatibility */
export type WorkPackageMemoryLegacyItem = WorkPackageMemoryItem & {
  name: string;
  sectionTitle: string;
};

export type OrganisationalMemoryPresentation = {
  summary: {
    completedProjectCount: number;
    programmesIndexed: number;
    workPackagesIndexed: number;
    canonicalWorkPackagesIndexed: number;
    deliverableObservationsIndexed: number;
    lastUpdated: string | null;
  };
  disciplines: DisciplineMemorySection[];
  /** Legacy flat sections — mirrors disciplines for backwards compatibility */
  sections: Array<{ title: string; workPackages: WorkPackageMemoryLegacyItem[] }>;
  unclassified: {
    workPackageCount: number;
    examples: string[];
    recommendation: string;
    workPackages: WorkPackageMemoryItem[];
  } | null;
  wellSupported: WorkPackageMemoryItem[];
  limitedEvidence: WorkPackageMemoryItem[];
  singleProjectOnly: WorkPackageMemoryItem[];
};

export type WorkPackageBrief = {
  key: string;
  name: string;
  sectionTitle: string;
  disciplineLabel: string;
  workPackageLabel: string;
  categoryLabel?: string;
  /** @deprecated Use workPackageLabel */
  engineeringActivityLabel: string;
  typicalDurationDays: number | null;
  durationVariationDays: number | null;
  projectCount: number;
  sampleSize: number;
  projectNames: string[];
  confidenceExplanation: string[];
  why: string | null;
  typicalRisks: string[];
  planningRecommendations: string[];
  contributingProjects: string[];
  deliverableVariants: DeliverableVariantTrace[];
  sourceDeliverableNames: string[];
};

type SnapshotRow = {
  name: string;
  classification: string | null;
  fragnetId: string | null;
  parentWbs: string | null;
  wbsPath: string | null;
  discipline: string | null;
  classificationTags: Record<string, unknown> | null;
  workPackageDurationDays: number | null;
  plannedStart: Date | null;
  plannedFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  projectId: string;
  projectName: string;
};

function durationFromRow(row: SnapshotRow): number | null {
  if (row.workPackageDurationDays != null && Number.isFinite(row.workPackageDurationDays)) {
    return row.workPackageDurationDays;
  }
  const actual = diffDaysFromDates(row.actualStart, row.actualFinish);
  if (actual != null) return actual;
  return diffDaysFromDates(row.plannedStart, row.plannedFinish);
}

function isUnclassified(classification: string | null): boolean {
  return !classification || classification === "OTHER";
}

function buildConfidenceExplanation(args: {
  projectCount: number;
  sampleSize: number;
  std: number | null;
  medianDays: number | null;
}): string[] {
  const lines: string[] = [];
  lines.push(
    `Observed across ${args.projectCount} completed project${args.projectCount === 1 ? "" : "s"}`
  );
  lines.push(`${args.sampleSize} work package${args.sampleSize === 1 ? "" : "s"} in memory`);
  if (args.projectCount >= 2 && args.std != null && args.medianDays != null && args.medianDays > 0) {
    const cv = args.std / args.medianDays;
    if (cv <= 0.25) {
      lines.push(`Typical duration stable across those projects`);
    }
  }
  return lines;
}

function limitedEvidenceReason(projectCount: number, sampleSize: number): string | null {
  if (projectCount <= 1) {
    return `Only seen on ${projectCount} completed project`;
  }
  if (sampleSize < MIN_PROFILE_SAMPLE) {
    return `Only ${sampleSize} historical observation${sampleSize === 1 ? "" : "s"} — below the minimum for strong comparison`;
  }
  return null;
}

function confidenceTierFor(
  projectCount: number,
  sampleSize: number,
  limitedReason: string | null
): "high" | "moderate" | "limited" {
  if (limitedReason) return "limited";
  if (projectCount >= 2 && sampleSize >= MIN_PROFILE_SAMPLE) return "high";
  if (projectCount >= 2 || sampleSize >= MIN_PROFILE_SAMPLE) return "moderate";
  return "limited";
}

function compactSummaryFor(item: {
  typicalDurationDays: number | null;
  projectCount: number;
  sampleSize: number;
}): string {
  const days =
    item.typicalDurationDays != null ? `${Math.round(item.typicalDurationDays)} days typical` : "Duration TBC";
  return `${days} · Observed across ${item.projectCount} project${item.projectCount === 1 ? "" : "s"} · ${item.sampleSize} work package${item.sampleSize === 1 ? "" : "s"}`;
}

function toLegacyItem(item: WorkPackageMemoryItem): WorkPackageMemoryLegacyItem {
  return {
    ...item,
    name: item.workPackageLabel,
    sectionTitle: item.disciplineLabel,
  };
}

function withLegacyActivityFields(item: WorkPackageMemoryItem): EngineeringActivityMemoryItem {
  return {
    ...item,
    engineeringActivityId: item.workPackageId,
    engineeringActivityLabel: item.workPackageLabel,
  };
}

type TaxonomyBucket = {
  resolution: ReturnType<typeof resolveWorkPackageTaxonomy>;
  rows: SnapshotRow[];
};

function aggregateByTaxonomy(rows: SnapshotRow[]): {
  matched: Map<string, TaxonomyBucket>;
  unmatched: SnapshotRow[];
} {
  const matched = new Map<string, TaxonomyBucket>();
  const unmatched: SnapshotRow[] = [];

  for (const row of rows) {
    const resolution = resolveWorkPackageTaxonomy({
      deliverableName: row.name,
      // Real fragnet only when fragnetId was captured — never invent fragnet from WBS alone
      fragnetName: row.fragnetId ? row.parentWbs : null,
      parentWbs: row.parentWbs,
      wbsPath: row.wbsPath,
      disciplineTag: row.discipline,
      classificationTags: row.classificationTags,
    });

    // Soft success: discipline known (canonical WP or Other … Work) → hierarchy.
    // Only fully unresolved discipline goes to global Unclassified.
    if (!resolution.matched || !resolution.taxonomyKey || !resolution.disciplineId) {
      unmatched.push(row);
      continue;
    }

    const bucket = matched.get(resolution.taxonomyKey) ?? { resolution, rows: [] };
    bucket.rows.push(row);
    matched.set(resolution.taxonomyKey, bucket);
  }

  return { matched, unmatched };
}

function buildWorkPackageItem(key: string, bucket: TaxonomyBucket): WorkPackageMemoryItem {
  const { resolution, rows } = bucket;
  const durations: number[] = [];
  const projectNames = new Set<string>();
  const projectIds = new Set<string>();
  const variantCounts = new Map<string, number>();
  const sourceNames = new Set<string>();

  for (const r of rows) {
    const d = durationFromRow(r);
    if (d != null && Number.isFinite(d)) durations.push(d);
    projectIds.add(r.projectId);
    projectNames.add(r.projectName);
    const original = stripWorkPackageSuffix(r.name);
    sourceNames.add(original);
    variantCounts.set(original, (variantCounts.get(original) ?? 0) + 1);
  }

  durations.sort((a, b) => a - b);
  const med = median(durations);
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const sd = durations.length >= 2 ? stddev(durations, avg) : null;
  const projectCount = projectIds.size;
  const sampleSize = durations.length;

  const classification =
    rows.find((r) => r.classification && r.classification !== "OTHER")?.classification ??
    rows[0]?.classification ??
    null;

  const limitedReason = limitedEvidenceReason(projectCount, sampleSize);
  const confidenceTier = confidenceTierFor(projectCount, sampleSize, limitedReason);

  const deliverableVariants = [...variantCounts.entries()]
    .map(([originalName, observationCount]) => ({ originalName, observationCount }))
    .sort((a, b) => b.observationCount - a.observationCount || a.originalName.localeCompare(b.originalName));

  const base = {
    key,
    disciplineId: resolution.disciplineId ?? "unclassified",
    disciplineLabel: resolution.disciplineLabel ?? "Unclassified work",
    categoryId: resolution.categoryId ?? "unclassified",
    categoryLabel: resolution.categoryLabel ?? "Unclassified",
    workPackageId: resolution.workPackageId ?? key,
    workPackageLabel: resolution.workPackageLabel ?? key,
    typicalDurationDays: med != null ? round1(med) : null,
    durationVariationDays: sd != null ? round1(sd) : null,
    sampleSize,
    projectCount,
    projectNames: [...projectNames].sort(),
    confidenceExplanation: buildConfidenceExplanation({
      projectCount,
      sampleSize,
      std: sd,
      medianDays: med,
    }),
    limitedEvidenceReason: limitedReason,
    confidenceTier,
    deliverableVariants,
    sourceDeliverableNames: [...sourceNames].sort(),
    classification,
    isUnclassified: isUnclassified(classification),
  };

  return {
    ...base,
    compactSummary: compactSummaryFor({
      typicalDurationDays: base.typicalDurationDays,
      projectCount: base.projectCount,
      sampleSize: base.sampleSize,
    }),
  };
}

function buildUnclassifiedWorkPackageItem(rows: SnapshotRow[]): WorkPackageMemoryItem {
  const name = stripWorkPackageSuffix(rows[0]?.name ?? "Unclassified work");
  const normalised = normaliseDeliverableNameForTaxonomy(name);
  const slug = canonicalKeyFromNormalisedName(normalised) || name.toLowerCase().replace(/\s+/g, "_");
  const key = `unclassified|${slug}`;
  const item = buildWorkPackageItem(key, {
    resolution: {
      disciplineId: null,
      disciplineLabel: null,
      categoryId: null,
      categoryLabel: null,
      workPackageId: null,
      workPackageLabel: name,
      taxonomyKey: key,
      originalDeliverableName: name,
      normalisedName: normalised,
      disciplineSource: "unresolved",
      matched: false,
      isUnknownWorkPackage: false,
      diagnostics: {
        normalisedName: normalised,
        documentTypeId: null,
        documentTypeLabel: null,
        disciplineId: null,
        disciplineLabel: null,
        disciplineSource: "unresolved",
        disciplineConfidence: null,
        disciplineReason: "No discipline could be determined from context or name",
        categoryId: null,
        categoryLabel: null,
        categoryReason: "Skipped",
        workPackageId: null,
        workPackageLabel: null,
        workPackageReason: "Skipped — no discipline",
        softFailure: false,
        matched: false,
      },
    },
    rows,
  });
  return {
    ...item,
    disciplineId: "unclassified",
    disciplineLabel: "Unclassified work",
    categoryId: "unclassified",
    categoryLabel: "Unclassified",
    workPackageId: key,
    workPackageLabel: name,
    isUnclassified: true,
    classification: null,
    compactSummary: compactSummaryFor({
      typicalDurationDays: item.typicalDurationDays,
      projectCount: item.projectCount,
      sampleSize: item.sampleSize,
    }),
  };
}

export async function buildOrganisationalMemoryPresentation(
  companyId: string
): Promise<OrganisationalMemoryPresentation> {
  const snapshots = await prisma.programmeSnapshot.findMany({
    where: {
      companyId,
      programmeState: { in: ALLOWED_SNAPSHOT_STATES },
      project: { archivedAt: null },
    },
    include: {
      deliverableSnapshots: true,
      project: { select: { id: true, name: true } },
    },
    orderBy: { importedAt: "desc" },
    take: 500,
  });

  const completedProjectIds = new Set<string>();
  for (const s of snapshots) {
    if (s.programmeState && COMPLETED_PROJECT_SNAPSHOT_STATES.includes(s.programmeState)) {
      completedProjectIds.add(s.projectId);
    }
  }

  const flat: SnapshotRow[] = [];
  let lastUpdated: Date | null = null;
  for (const snap of snapshots) {
    if (!lastUpdated || snap.importedAt > lastUpdated) lastUpdated = snap.importedAt;
    for (const d of snap.deliverableSnapshots) {
      flat.push({
        name: d.name,
        classification: d.classification,
        fragnetId: d.fragnetId,
        parentWbs: d.parentWbs,
        wbsPath: d.wbsPath,
        discipline: d.discipline,
        classificationTags:
          d.classificationTags && typeof d.classificationTags === "object"
            ? (d.classificationTags as Record<string, unknown>)
            : null,
        workPackageDurationDays: d.workPackageDurationDays,
        plannedStart: d.plannedStart,
        plannedFinish: d.plannedFinish,
        actualStart: d.actualStart,
        actualFinish: d.actualFinish,
        projectId: snap.projectId,
        projectName: snap.project.name,
      });
    }
  }

  const { matched, unmatched } = aggregateByTaxonomy(flat);
  const allWorkPackages = [...matched.entries()].map(([key, bucket]) => buildWorkPackageItem(key, bucket));

  const unclassifiedByName = new Map<string, SnapshotRow[]>();
  for (const row of unmatched) {
    const normalised = normaliseDeliverableNameForTaxonomy(row.name);
    const k = canonicalKeyFromNormalisedName(normalised) || stripWorkPackageSuffix(row.name).toLowerCase();
    const bucket = unclassifiedByName.get(k) ?? [];
    bucket.push(row);
    unclassifiedByName.set(k, bucket);
  }
  const unclassifiedWorkPackages = [...unclassifiedByName.values()].map((rows) =>
    buildUnclassifiedWorkPackageItem(rows)
  );

  const classifiedWorkPackages = allWorkPackages.filter((a) => !a.isUnclassified);

  const disciplineMap = new Map<string, WorkPackageMemoryItem[]>();
  for (const workPackage of classifiedWorkPackages) {
    const list = disciplineMap.get(workPackage.disciplineId) ?? [];
    list.push(workPackage);
    disciplineMap.set(workPackage.disciplineId, list);
  }

  const disciplines: DisciplineMemorySection[] = sortDisciplineIds([...disciplineMap.keys()]).map(
    (disciplineId) => {
      const workPackages = (disciplineMap.get(disciplineId) ?? []).sort((a, b) =>
        a.workPackageLabel.localeCompare(b.workPackageLabel)
      );

      const categoryMap = new Map<string, WorkPackageMemoryItem[]>();
      for (const wp of workPackages) {
        const list = categoryMap.get(wp.categoryId) ?? [];
        list.push(wp);
        categoryMap.set(wp.categoryId, list);
      }

      const categories: CategoryMemorySection[] = sortCategoryIds(disciplineId, [...categoryMap.keys()]).map(
        (categoryId) => {
          const cWorkPackages = (categoryMap.get(categoryId) ?? []).sort((a, b) =>
            a.workPackageLabel.localeCompare(b.workPackageLabel)
          );
          return {
            categoryId,
            categoryLabel: cWorkPackages[0]?.categoryLabel ?? categoryId,
            workPackageCount: cWorkPackages.length,
            workPackages: cWorkPackages,
          };
        }
      );

      return {
        disciplineId,
        disciplineLabel: workPackages[0]?.disciplineLabel ?? disciplineId,
        workPackageCount: workPackages.length,
        categories,
        workPackages,
        activities: workPackages.map(withLegacyActivityFields),
      };
    }
  );

  const sections = disciplines.map((d) => ({
    title: d.disciplineLabel,
    workPackages: d.workPackages.map(toLegacyItem),
  }));

  const wellSupported = classifiedWorkPackages
    .filter((w) => w.projectCount >= 2 && w.sampleSize >= MIN_PROFILE_SAMPLE)
    .sort((a, b) => b.sampleSize - a.sampleSize || b.projectCount - a.projectCount);

  const limitedEvidence = [...allWorkPackages, ...unclassifiedWorkPackages]
    .filter((w) => w.limitedEvidenceReason != null)
    .sort((a, b) => a.projectCount - b.projectCount || a.sampleSize - b.sampleSize);

  const singleProjectOnly = [...allWorkPackages, ...unclassifiedWorkPackages]
    .filter((w) => w.projectCount === 1)
    .sort((a, b) => a.workPackageLabel.localeCompare(b.workPackageLabel));

  const unclassifiedExamples = unclassifiedWorkPackages
    .flatMap((a) => a.sourceDeliverableNames)
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .slice(0, 8);

  return {
    summary: {
      completedProjectCount: completedProjectIds.size,
      programmesIndexed: new Set(snapshots.map((s) => s.projectId)).size,
      workPackagesIndexed: allWorkPackages.length + unclassifiedWorkPackages.length,
      canonicalWorkPackagesIndexed: allWorkPackages.length,
      deliverableObservationsIndexed: flat.length,
      lastUpdated: lastUpdated?.toISOString() ?? null,
    },
    disciplines,
    sections,
    unclassified:
      unclassifiedWorkPackages.length > 0
        ? {
            workPackageCount: unclassifiedWorkPackages.reduce((s, a) => s + a.sampleSize, 0),
            examples: unclassifiedExamples,
            recommendation:
              "Improve fragnet naming or assign a discipline tag so Rana can place this work under a discipline. Items with a known discipline but no configured work package appear under that discipline as Other … Work.",
            workPackages: unclassifiedWorkPackages,
          }
        : null,
    wellSupported,
    limitedEvidence,
    singleProjectOnly,
  };
}

function findWorkPackageByKey(
  memory: OrganisationalMemoryPresentation,
  key: string
): WorkPackageMemoryItem | undefined {
  return (
    memory.wellSupported.find((w) => w.key === key) ??
    memory.limitedEvidence.find((w) => w.key === key) ??
    memory.unclassified?.workPackages.find((w) => w.key === key) ??
    memory.disciplines.flatMap((d) => d.categories.flatMap((c) => c.workPackages)).find((a) => a.key === key) ??
    memory.disciplines.flatMap((d) => d.workPackages).find((a) => a.key === key)
  );
}

export async function getWorkPackageBrief(
  companyId: string,
  key: string
): Promise<WorkPackageBrief | null> {
  const memory = await buildOrganisationalMemoryPresentation(companyId);
  const item = findWorkPackageByKey(memory, key);
  if (!item) return null;

  const classification = item.classification;
  const [reliabilityProfiles, recommendationProfiles, trustProfiles, insights] = await Promise.all([
    listReliabilityProfiles(companyId),
    listRecommendationProfiles(companyId),
    listIntelligenceTrustProfiles(companyId),
    listLearnedInsights(companyId, { classification: classification ?? undefined, limit: 20 }),
  ]);

  const reliability = classification
    ? reliabilityProfiles.find((p) => p.classification === classification)
    : undefined;
  const recommendations = classification
    ? recommendationProfiles.filter((p) => p.classification === classification)
    : [];
  const trust = classification
    ? trustProfiles.find((p) => p.classification === classification)
    : undefined;
  const classInsights = insights.filter(
    (i) => !classification || i.classification === classification
  );

  const whyParts: string[] = [];
  if (reliability) {
    const overrun = Math.round(reliability.overrunFrequency);
    const onTarget = Math.round(reliability.onTargetFrequency);
    if (overrun >= 50) {
      whyParts.push(`Usually takes longer than planned (${overrun}% of the time on similar work).`);
    } else if (onTarget >= 45) {
      whyParts.push(`Usually stays close to plan (${onTarget}% on target on similar work).`);
    } else if (reliability.averageVariancePercent != null) {
      whyParts.push(
        `On average, planned durations differ from actual by about ${Math.abs(Math.round(reliability.averageVariancePercent))}% on similar work.`
      );
    }
  }
  const insightObservation = classInsights.find((i) => i.observation)?.observation;
  if (insightObservation && !whyParts.some((p) => p.includes(insightObservation.slice(0, 40)))) {
    whyParts.push(insightObservation);
  }

  const typicalRisks = recommendations
    .filter((r) => ["OPTIMISM_RISK", "HIGH_VARIABILITY", "DURATION_REVIEW"].includes(r.recommendationType))
    .map((r) => r.summary || r.title)
    .filter(Boolean)
    .slice(0, 4);

  const planningRecommendations = recommendations
    .map((r) => r.recommendation)
    .filter(Boolean)
    .slice(0, 3);

  const confidenceExplanation = [...item.confidenceExplanation];
  if (trust?.evidenceStrength.benchmarkConfidence) {
    confidenceExplanation.push(
      `Classification-level evidence quality: ${trust.evidenceStrength.benchmarkConfidence}`
    );
  } else if (reliability?.confidenceLevel) {
    const score =
      reliability.confidenceScore ??
      (reliability.confidenceLevel === "HIGH" ? 0.8 : reliability.confidenceLevel === "MEDIUM" ? 0.55 : 0.3);
    const tier = confidenceLevelFromScore(score);
    if (tier === "HIGH") {
      confidenceExplanation.push("Strong historical sample for this type of work");
    }
  }

  return {
    key: item.key,
    name: item.workPackageLabel,
    sectionTitle: item.disciplineLabel,
    disciplineLabel: item.disciplineLabel,
    categoryLabel: item.categoryLabel,
    workPackageLabel: item.workPackageLabel,
    engineeringActivityLabel: item.workPackageLabel,
    typicalDurationDays: item.typicalDurationDays,
    durationVariationDays: item.durationVariationDays,
    projectCount: item.projectCount,
    sampleSize: item.sampleSize,
    projectNames: item.projectNames,
    confidenceExplanation,
    why: whyParts.length ? whyParts.join(" ") : null,
    typicalRisks,
    planningRecommendations,
    contributingProjects: item.projectNames,
    deliverableVariants: item.deliverableVariants,
    sourceDeliverableNames: item.sourceDeliverableNames,
  };
}

export function workPackageKey(taxonomyKey: string): string {
  return taxonomyKey;
}
