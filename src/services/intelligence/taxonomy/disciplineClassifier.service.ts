import type { DisciplineDefinition, KeywordDefinition } from "./workPackageTaxonomy.types.js";
import { WORK_PACKAGE_TAXONOMY } from "./workPackageTaxonomy.config.js";
import {
  compiledDisciplineSuffixPattern,
  normaliseDeliverableNameForTaxonomy,
  patternMatches,
  stripWorkPackageSuffix,
} from "./taxonomyMatching.utils.js";

export type DisciplineClassifierInput = {
  deliverableName: string;
  fragnetName?: string | null;
  parentWbs?: string | null;
  wbsPath?: string | null;
  disciplineTag?: string | null;
  activityCodeDiscipline?: string | null;
  classificationTags?: Record<string, unknown> | null;
};

export type DisciplineClassificationSource =
  | "discipline_field"
  | "activity_code"
  | "classification_tag"
  | "fragnet"
  | "wbs"
  | "keyword"
  | "name_pattern"
  | "unresolved";

export type DisciplineClassification = {
  disciplineId: string;
  disciplineLabel: string;
  source: DisciplineClassificationSource;
  confidence: number;
};

/** Strict planner priority — lower rank wins over higher confidence from a weaker source. */
const SOURCE_RANK: Record<DisciplineClassificationSource, number> = {
  discipline_field: 1,
  activity_code: 2,
  classification_tag: 3,
  fragnet: 4,
  wbs: 5,
  keyword: 6,
  name_pattern: 7,
  unresolved: 99,
};

const SOURCE_BASE_CONFIDENCE: Record<DisciplineClassificationSource, number> = {
  discipline_field: 100,
  activity_code: 95,
  classification_tag: 90,
  fragnet: 85,
  wbs: 75,
  keyword: 55,
  name_pattern: 40,
  unresolved: 0,
};

function n(s: unknown): string {
  return String(s ?? "").trim();
}

function disciplineFromClassificationTags(tags: Record<string, unknown> | null | undefined): string | null {
  if (!tags || typeof tags !== "object") return null;
  for (const [key, value] of Object.entries(tags)) {
    if (!key.toLowerCase().includes("discipline")) continue;
    const v = n(value);
    if (v) return v.toLowerCase();
  }
  return null;
}

function matchDisciplinePatterns(discipline: DisciplineDefinition, text: string, patterns: string[]): boolean {
  return patterns.some((p) => patternMatches(text, p, "contains"));
}

function keywordMatchesText(text: string, kw: KeywordDefinition): boolean {
  const type = kw.type ?? (kw.pattern.length <= 5 ? "regex" : "contains");
  const pattern =
    type === "regex" || kw.pattern.includes("\\b")
      ? kw.pattern
      : kw.pattern.length <= 5
        ? `\\b${kw.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`
        : kw.pattern;
  return patternMatches(text, pattern, type === "regex" || kw.pattern.length <= 5 ? "regex" : type);
}

function scoreKeywords(discipline: DisciplineDefinition, texts: string[]): number {
  let best = 0;
  for (const text of texts) {
    if (!text) continue;
    for (const kw of discipline.keywords) {
      if (!keywordMatchesText(text, kw)) continue;
      best = Math.max(best, kw.priority ?? 5);
    }
  }
  return best;
}

/** Deliverable-name texts only — never scan fragnet/WBS as keywords (source attribution stays honest). */
function collectDeliverableTexts(input: DisciplineClassifierInput, normalisedName: string): string[] {
  const raw = stripWorkPackageSuffix(input.deliverableName).toLowerCase();
  const texts = [normalisedName, raw].filter(Boolean);
  const suffixMatch = raw.match(compiledDisciplineSuffixPattern);
  if (suffixMatch?.[1]) texts.push(suffixMatch[1].toLowerCase());
  return [...new Set(texts)];
}

function addCandidate(
  candidates: DisciplineClassification[],
  discipline: DisciplineDefinition,
  source: DisciplineClassificationSource,
  bonus = 0
) {
  candidates.push({
    disciplineId: discipline.id,
    disciplineLabel: discipline.label,
    source,
    confidence: SOURCE_BASE_CONFIDENCE[source] + bonus,
  });
}

function tryMatchFromField(
  candidates: DisciplineClassification[],
  taxonomy: DisciplineDefinition[],
  field: string,
  source: DisciplineClassificationSource,
  includeFragnetPatterns: boolean
) {
  if (!field) return;
  for (const discipline of taxonomy) {
    const kw = scoreKeywords(discipline, [field]);
    const activityHit = matchDisciplinePatterns(discipline, field, discipline.activityCodePatterns);
    const fragnetHit =
      includeFragnetPatterns && matchDisciplinePatterns(discipline, field, discipline.fragnetPatterns);
    if (activityHit || fragnetHit || kw > 0) {
      addCandidate(candidates, discipline, source, kw);
    }
  }
}

/**
 * All discipline candidates considered, sorted by the same planner priority as
 * classifyDiscipline. Debug/export only — production callers should keep using
 * classifyDiscipline(), which returns the identical winner.
 */
export function classifyDisciplineCandidates(
  input: DisciplineClassifierInput,
  taxonomy: DisciplineDefinition[] = WORK_PACKAGE_TAXONOMY
): DisciplineClassification[] {
  const candidates: DisciplineClassification[] = [];
  const normalisedName = normaliseDeliverableNameForTaxonomy(input.deliverableName);
  const deliverableTexts = collectDeliverableTexts(input, normalisedName);

  tryMatchFromField(candidates, taxonomy, n(input.disciplineTag), "discipline_field", true);
  tryMatchFromField(candidates, taxonomy, n(input.activityCodeDiscipline), "activity_code", false);

  const tagDiscipline = disciplineFromClassificationTags(input.classificationTags);
  if (tagDiscipline) {
    tryMatchFromField(candidates, taxonomy, tagDiscipline, "classification_tag", true);
  }

  const fragnet = n(input.fragnetName);
  if (fragnet) {
    for (const discipline of taxonomy) {
      const kw = scoreKeywords(discipline, [fragnet]);
      if (matchDisciplinePatterns(discipline, fragnet, discipline.fragnetPatterns) || kw > 0) {
        addCandidate(candidates, discipline, "fragnet", kw);
      }
    }
  }

  // Parent WBS preferred over deeper WBS path segments when both are present
  const parentWbs = n(input.parentWbs);
  const wbsPathHead = n(input.wbsPath?.split(" / ")[0]);
  const wbsLabels = [...new Set([parentWbs, wbsPathHead].filter(Boolean))];
  // Skip WBS if identical to fragnet — fragnet is the real source
  for (const wbs of wbsLabels) {
    if (fragnet && wbs.toLowerCase() === fragnet.toLowerCase()) continue;
    for (const discipline of taxonomy) {
      const kw = scoreKeywords(discipline, [wbs]);
      if (matchDisciplinePatterns(discipline, wbs, discipline.fragnetPatterns) || kw > 0) {
        addCandidate(candidates, discipline, "wbs", kw);
      }
    }
  }

  for (const discipline of taxonomy) {
    const kwScore = scoreKeywords(discipline, deliverableTexts);
    if (kwScore > 0) {
      addCandidate(candidates, discipline, "keyword", kwScore);
    }
  }

  for (const discipline of taxonomy) {
    if (deliverableTexts.some((text) => matchDisciplinePatterns(discipline, text, discipline.namePatterns))) {
      addCandidate(candidates, discipline, "name_pattern");
    }
  }

  candidates.sort(
    (a, b) =>
      SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
      b.confidence - a.confidence ||
      a.disciplineLabel.localeCompare(b.disciplineLabel)
  );
  return candidates;
}

export function classifyDiscipline(
  input: DisciplineClassifierInput,
  taxonomy: DisciplineDefinition[] = WORK_PACKAGE_TAXONOMY
): DisciplineClassification | null {
  const candidates = classifyDisciplineCandidates(input, taxonomy);
  return candidates[0] ?? null;
}
