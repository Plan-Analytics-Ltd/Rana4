/**
 * Context-aware work package taxonomy resolution (presentation layer).
 * Planner order: gather context → discipline → category → work package → soft failure.
 */

import {
  CATEGORY_DISPLAY_ORDER,
  DISCIPLINE_DISPLAY_ORDER,
  UNKNOWN_CATEGORY_ID,
  UNKNOWN_WORK_PACKAGE_ID,
  WORK_PACKAGE_TAXONOMY,
  otherWorkCategoryLabel,
} from "./workPackageTaxonomy.config.js";
import { classifyDiscipline, type DisciplineClassification } from "./disciplineClassifier.service.js";
import {
  documentTypeAffinityBonus,
  documentTypeMatchTexts,
  extractDocumentType,
  type ExtractedDocumentType,
} from "./documentType.extraction.js";
import type { CategoryDefinition, DisciplineDefinition, WorkPackageDefinition } from "./workPackageTaxonomy.types.js";
import {
  canonicalKeyFromNormalisedName,
  isStageMetadataOnly,
  normaliseDeliverableNameForTaxonomy,
  scorePatternMatch,
  stripWorkPackageSuffix,
  titleCaseFromNormalised,
} from "./taxonomyMatching.utils.js";

export type WorkPackageTaxonomyInput = {
  deliverableName: string;
  fragnetName?: string | null;
  parentWbs?: string | null;
  wbsPath?: string | null;
  disciplineTag?: string | null;
  activityCodeDiscipline?: string | null;
  classificationTags?: Record<string, unknown> | null;
};

/** Gathered signals used for every decision (planner context). */
export type ClassificationContext = {
  originalDeliverableName: string;
  normalisedName: string;
  /** Internal only — never shown in UI */
  documentType: ExtractedDocumentType | null;
  fragnetName: string | null;
  parentWbs: string | null;
  wbsPath: string | null;
  disciplineTag: string | null;
  activityCodeDiscipline: string | null;
  classificationTags: Record<string, unknown> | null;
};

export type ClassificationDiagnostics = {
  normalisedName: string;
  documentTypeId: string | null;
  documentTypeLabel: string | null;
  disciplineId: string | null;
  disciplineLabel: string | null;
  disciplineSource: WorkPackageTaxonomyResolution["disciplineSource"];
  disciplineConfidence: number | null;
  disciplineReason: string;
  categoryId: string | null;
  categoryLabel: string | null;
  categoryReason: string;
  workPackageId: string | null;
  workPackageLabel: string | null;
  workPackageReason: string;
  softFailure: boolean;
  matched: boolean;
};

export type WorkPackageTaxonomyResolution = {
  disciplineId: string | null;
  disciplineLabel: string | null;
  categoryId: string | null;
  categoryLabel: string | null;
  workPackageId: string | null;
  workPackageLabel: string | null;
  taxonomyKey: string | null;
  originalDeliverableName: string;
  normalisedName: string;
  disciplineSource: "metadata" | "fragnet" | "wbs" | "keyword" | "name_pattern" | "work_package_inference" | "unresolved";
  /** True when a discipline is known (canonical WP or soft-failure unknown WP). */
  matched: boolean;
  /** True when discipline is known but no configured work package matched. */
  isUnknownWorkPackage: boolean;
  diagnostics: ClassificationDiagnostics;
};

function n(s: unknown): string | null {
  const v = String(s ?? "").trim();
  return v.length ? v : null;
}

export function gatherClassificationContext(input: WorkPackageTaxonomyInput): ClassificationContext {
  const originalDeliverableName = stripWorkPackageSuffix(input.deliverableName);
  const normalisedName = normaliseDeliverableNameForTaxonomy(input.deliverableName);
  const documentType = extractDocumentType(normalisedName);
  const fragnetName = n(input.fragnetName);
  const parentWbs = n(input.parentWbs);
  const wbsPath = n(input.wbsPath);

  return {
    originalDeliverableName,
    normalisedName,
    documentType,
    fragnetName,
    parentWbs,
    wbsPath,
    disciplineTag: n(input.disciplineTag),
    activityCodeDiscipline: n(input.activityCodeDiscipline),
    classificationTags: input.classificationTags ?? null,
  };
}

function mapDisciplineSource(
  source: DisciplineClassification["source"] | "work_package_inference" | undefined
): WorkPackageTaxonomyResolution["disciplineSource"] {
  switch (source) {
    case "discipline_field":
    case "activity_code":
    case "classification_tag":
      return "metadata";
    case "fragnet":
      return "fragnet";
    case "wbs":
      return "wbs";
    case "keyword":
      return "keyword";
    case "name_pattern":
      return "name_pattern";
    case "work_package_inference":
      return "work_package_inference";
    default:
      return "unresolved";
  }
}

export type WorkPackageCandidate = {
  workPackageId: string;
  workPackageLabel: string;
  categoryId: string;
  categoryLabel: string;
  score: number;
  reason: string;
  patternScore: number;
  affinityScore: number;
};

/**
 * All scored work-package candidates within a discipline.
 * Debug/export only — resolveWorkPackageInDiscipline still returns the same winner.
 */
export function listWorkPackageCandidatesInDiscipline(
  discipline: DisciplineDefinition,
  normalisedName: string,
  documentType: ExtractedDocumentType | null = null
): WorkPackageCandidate[] {
  if (isStageMetadataOnly(normalisedName)) return [];

  const matchTexts = documentTypeMatchTexts(normalisedName, documentType);
  const candidates: WorkPackageCandidate[] = [];

  for (const category of discipline.categories) {
    for (const workPackage of category.workPackages) {
      let patternScore = 0;
      let hitText = normalisedName;
      for (const text of matchTexts) {
        for (const spec of workPackage.deliverablePatterns) {
          const score = scorePatternMatch(text, spec);
          if (score > patternScore) {
            patternScore = score;
            hitText = text;
          }
        }
        for (const alias of workPackage.aliases ?? []) {
          const score = scorePatternMatch(text, alias);
          if (score > patternScore) {
            patternScore = score;
            hitText = text;
          }
        }
      }

      const affinity = documentTypeAffinityBonus(workPackage, documentType);
      const score = patternScore + affinity;
      if (score <= 0) continue;
      // Affinity-only allowed when a document type was extracted (e.g. Drawing → Design Drawings)
      if (patternScore === 0 && (!documentType || affinity < 20)) continue;

      const via =
        patternScore > 0
          ? `pattern on "${hitText}" (+${patternScore})${affinity ? ` + document-type affinity (+${affinity})` : ""}`
          : `document-type affinity for ${documentType?.label ?? "type"} (+${affinity})`;
      candidates.push({
        workPackageId: workPackage.id,
        workPackageLabel: workPackage.label,
        categoryId: category.id,
        categoryLabel: category.label,
        score,
        reason: via,
        patternScore,
        affinityScore: affinity,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.workPackageLabel.localeCompare(b.workPackageLabel));
  return candidates;
}

function resolveWorkPackageInDiscipline(
  discipline: DisciplineDefinition,
  normalisedName: string,
  documentType: ExtractedDocumentType | null = null
): { workPackage: WorkPackageDefinition; category: CategoryDefinition; score: number; reason: string } | null {
  const candidates = listWorkPackageCandidatesInDiscipline(discipline, normalisedName, documentType);
  const best = candidates[0];
  if (!best) return null;
  const category = discipline.categories.find((c) => c.id === best.categoryId);
  const workPackage = category?.workPackages.find((wp) => wp.id === best.workPackageId);
  if (!category || !workPackage) return null;
  return { workPackage, category, score: best.score, reason: best.reason };
}

/**
 * When discipline metadata/fragnet fails, try to infer a unique discipline from
 * work-package patterns across the taxonomy (no new aliases — uses existing patterns).
 */
function inferDisciplineFromWorkPackagePatterns(
  normalisedName: string,
  taxonomy: DisciplineDefinition[],
  documentType: ExtractedDocumentType | null = null
): {
  discipline: DisciplineDefinition;
  hit: NonNullable<ReturnType<typeof resolveWorkPackageInDiscipline>>;
} | null {
  if (isStageMetadataOnly(normalisedName)) return null;

  const hits: Array<{
    discipline: DisciplineDefinition;
    hit: NonNullable<ReturnType<typeof resolveWorkPackageInDiscipline>>;
  }> = [];

  for (const discipline of taxonomy) {
    const hit = resolveWorkPackageInDiscipline(discipline, normalisedName, documentType);
    if (hit) hits.push({ discipline, hit });
  }

  if (hits.length === 0) return null;

  hits.sort((a, b) => b.hit.score - a.hit.score);
  const top = hits[0]!.hit.score;
  const tied = hits.filter((h) => h.hit.score === top);
  if (tied.length !== 1) return null;
  return tied[0]!;
}

function softFailureResolution(args: {
  context: ClassificationContext;
  discipline: DisciplineDefinition;
  disciplineSource: WorkPackageTaxonomyResolution["disciplineSource"];
  disciplineConfidence: number | null;
  disciplineReason: string;
}): WorkPackageTaxonomyResolution {
  const slug = canonicalKeyFromNormalisedName(args.context.normalisedName) || "unnamed";
  // Prefer original spelling for soft-failure rows; grouping still uses normalised slug
  const displayLabel =
    args.context.originalDeliverableName.trim() ||
    titleCaseFromNormalised(args.context.normalisedName);
  const taxonomyKey = `${args.discipline.id}|${UNKNOWN_WORK_PACKAGE_ID}|${slug}`;
  const otherLabel = otherWorkCategoryLabel(args.discipline.label);

  return {
    disciplineId: args.discipline.id,
    disciplineLabel: args.discipline.label,
    categoryId: UNKNOWN_CATEGORY_ID,
    categoryLabel: otherLabel,
    workPackageId: `${UNKNOWN_WORK_PACKAGE_ID}|${slug}`,
    workPackageLabel: displayLabel,
    taxonomyKey,
    originalDeliverableName: args.context.originalDeliverableName,
    normalisedName: args.context.normalisedName,
    disciplineSource: args.disciplineSource,
    matched: true,
    isUnknownWorkPackage: true,
    diagnostics: {
      normalisedName: args.context.normalisedName,
      documentTypeId: args.context.documentType?.id ?? null,
      documentTypeLabel: args.context.documentType?.label ?? null,
      disciplineId: args.discipline.id,
      disciplineLabel: args.discipline.label,
      disciplineSource: args.disciplineSource,
      disciplineConfidence: args.disciplineConfidence,
      disciplineReason: args.disciplineReason,
      categoryId: UNKNOWN_CATEGORY_ID,
      categoryLabel: otherLabel,
      categoryReason: `Soft failure — discipline known, no configured work package matched → ${otherLabel}`,
      workPackageId: `${UNKNOWN_WORK_PACKAGE_ID}|${slug}`,
      workPackageLabel: displayLabel,
      workPackageReason: `No work-package pattern matched "${args.context.normalisedName}" within ${args.discipline.label}` +
        (args.context.documentType ? ` (document type: ${args.context.documentType.label})` : ""),
      softFailure: true,
      matched: true,
    },
  };
}

export function resolveWorkPackageTaxonomy(
  input: WorkPackageTaxonomyInput,
  taxonomy: DisciplineDefinition[] = WORK_PACKAGE_TAXONOMY
): WorkPackageTaxonomyResolution {
  const context = gatherClassificationContext(input);

  const emptyDiagnostics = (extra: Partial<ClassificationDiagnostics> = {}): ClassificationDiagnostics => ({
    normalisedName: context.normalisedName,
    documentTypeId: context.documentType?.id ?? null,
    documentTypeLabel: context.documentType?.label ?? null,
    disciplineId: null,
    disciplineLabel: null,
    disciplineSource: "unresolved",
    disciplineConfidence: null,
    disciplineReason: "No discipline resolved",
    categoryId: null,
    categoryLabel: null,
    categoryReason: "Skipped — no discipline",
    workPackageId: null,
    workPackageLabel: null,
    workPackageReason: "Skipped — no discipline",
    softFailure: false,
    matched: false,
    ...extra,
  });

  if (!context.normalisedName || isStageMetadataOnly(context.normalisedName)) {
    return {
      disciplineId: null,
      disciplineLabel: null,
      categoryId: null,
      categoryLabel: null,
      workPackageId: null,
      workPackageLabel: null,
      taxonomyKey: null,
      originalDeliverableName: context.originalDeliverableName,
      normalisedName: context.normalisedName,
      disciplineSource: "unresolved",
      matched: false,
      isUnknownWorkPackage: false,
      diagnostics: emptyDiagnostics({
        disciplineReason: "Name is stage metadata only (not a work package)",
        workPackageReason: "Rejected — stage metadata",
      }),
    };
  }

  // Pass fragnet and WBS separately — never promote parentWbs into fragnetName
  const disciplineHit = classifyDiscipline(
    {
      deliverableName: input.deliverableName,
      fragnetName: context.fragnetName,
      parentWbs: context.parentWbs,
      wbsPath: context.wbsPath,
      disciplineTag: context.disciplineTag,
      activityCodeDiscipline: context.activityCodeDiscipline,
      classificationTags: context.classificationTags,
    },
    taxonomy
  );

  let discipline: DisciplineDefinition | null = disciplineHit
    ? taxonomy.find((d) => d.id === disciplineHit.disciplineId) ?? null
    : null;
  let disciplineSource = mapDisciplineSource(disciplineHit?.source);
  let disciplineConfidence = disciplineHit?.confidence ?? null;
  let disciplineReason = disciplineHit
    ? `Discipline from ${disciplineHit.source} (confidence ${disciplineHit.confidence}) using context [fragnet=${context.fragnetName ?? "—"}, parentWbs=${context.parentWbs ?? "—"}, disciplineTag=${context.disciplineTag ?? "—"}]`
    : "No discipline from metadata/fragnet/keywords";

  let wpHit: ReturnType<typeof resolveWorkPackageInDiscipline> = null;

  if (discipline) {
    wpHit = resolveWorkPackageInDiscipline(discipline, context.normalisedName, context.documentType);
  } else {
    // Inference from existing WP patterns when metadata/fragnet/keywords fail
    const inferred = inferDisciplineFromWorkPackagePatterns(
      context.normalisedName,
      taxonomy,
      context.documentType
    );
    if (inferred) {
      discipline = inferred.discipline;
      wpHit = inferred.hit;
      disciplineSource = "work_package_inference";
      disciplineConfidence = 55;
      disciplineReason = `Discipline inferred from unique work-package pattern match (${inferred.hit.workPackage.label})`;
    }
  }

  if (!discipline) {
    return {
      disciplineId: null,
      disciplineLabel: null,
      categoryId: null,
      categoryLabel: null,
      workPackageId: null,
      workPackageLabel: null,
      taxonomyKey: null,
      originalDeliverableName: context.originalDeliverableName,
      normalisedName: context.normalisedName,
      disciplineSource: "unresolved",
      matched: false,
      isUnknownWorkPackage: false,
      diagnostics: emptyDiagnostics({
        disciplineReason,
        workPackageReason: "Cannot classify without a discipline",
      }),
    };
  }

  if (!wpHit) {
    return softFailureResolution({
      context,
      discipline,
      disciplineSource,
      disciplineConfidence,
      disciplineReason,
    });
  }

  const taxonomyKey = `${discipline.id}|${wpHit.workPackage.id}`;

  return {
    disciplineId: discipline.id,
    disciplineLabel: discipline.label,
    categoryId: wpHit.category.id,
    categoryLabel: wpHit.category.label,
    workPackageId: wpHit.workPackage.id,
    workPackageLabel: wpHit.workPackage.label,
    taxonomyKey,
    originalDeliverableName: context.originalDeliverableName,
    normalisedName: context.normalisedName,
    disciplineSource,
    matched: true,
    isUnknownWorkPackage: false,
    diagnostics: {
      normalisedName: context.normalisedName,
      documentTypeId: context.documentType?.id ?? null,
      documentTypeLabel: context.documentType?.label ?? null,
      disciplineId: discipline.id,
      disciplineLabel: discipline.label,
      disciplineSource,
      disciplineConfidence,
      disciplineReason,
      categoryId: wpHit.category.id,
      categoryLabel: wpHit.category.label,
      categoryReason: `Category inherited from work package "${wpHit.workPackage.label}" within ${discipline.label}`,
      workPackageId: wpHit.workPackage.id,
      workPackageLabel: wpHit.workPackage.label,
      workPackageReason: `Matched in ${discipline.label}: ${wpHit.reason}` +
        (context.documentType ? ` [document type=${context.documentType.label}]` : ""),
      softFailure: false,
      matched: true,
    },
  };
}

export function sortDisciplineIds(ids: string[]): string[] {
  const order = new Map(DISCIPLINE_DISPLAY_ORDER.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b));
}

export function sortCategoryIds(disciplineId: string, ids: string[]): string[] {
  const configured = CATEGORY_DISPLAY_ORDER[disciplineId] ?? [];
  const order = new Map(configured.map((id, i) => [id, i]));
  // Unknown work package always last within a discipline
  order.set(UNKNOWN_CATEGORY_ID, 10_000);
  return [...ids].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b));
}

export function getWorkPackageTaxonomyConfig(): typeof WORK_PACKAGE_TAXONOMY {
  return WORK_PACKAGE_TAXONOMY;
}

export {
  normaliseDeliverableNameForTaxonomy,
  stripWorkPackageSuffix,
  isStageMetadataOnly,
  canonicalKeyFromNormalisedName,
} from "./taxonomyMatching.utils.js";

export { classifyDiscipline } from "./disciplineClassifier.service.js";
