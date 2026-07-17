/**
 * Planner-centric synonym rules — each rule must be idempotent when re-applied.
 * Prefer longest / whole-phrase forms; never expand a phrase into a longer one that
 * re-matches an earlier rule.
 */

import type { NameSynonymRule } from "./workPackageTaxonomy.types.js";

export type {
  CategoryDefinition,
  DisciplineDefinition,
  KeywordDefinition,
  PatternDefinition,
  WorkPackageDefinition,
} from "./workPackageTaxonomy.types.js";

export {
  CATEGORY_DISPLAY_ORDER,
  DISCIPLINE_DISPLAY_ORDER,
  WORK_PACKAGE_TAXONOMY,
} from "./workPackageTaxonomy.data.js";

/**
 * Applied after punctuation normalisation (slashes/dashes → spaces).
 * Rules are ordered longest / most specific first.
 */
export const NAME_SYNONYM_REPLACEMENTS: NameSynonymRule[] = [
  // Model / drawing — map every spelling onto one phrase (already without slash)
  { pattern: "\\bmodel\\s+drawing\\s+development\\b", replacement: "model drawing development" },
  { pattern: "\\bmodel\\s+drawing\\b", replacement: "model drawing development" },
  { pattern: "\\bmodel\\s+development\\b", replacement: "model drawing development" },
  { pattern: "\\bdrawing\\s+development\\b", replacement: "model drawing development" },

  { pattern: "\\bg\\.?a\\.?\\s*drawings?\\b", replacement: "general arrangements" },
  { pattern: "\\bg\\.?a\\.?\\b", replacement: "general arrangements" },
  { pattern: "\\bgeneral\\s+arrangements?\\b", replacement: "general arrangements" },

  { pattern: "\\bg\\.?i\\.?\\b", replacement: "ground investigation" },

  { pattern: "\\bpublic\\s+health\\b", replacement: "public health" },
  { pattern: "\\bphe\\b", replacement: "public health" },

  { pattern: "\\bmep\\b", replacement: "mechanical" },
  { pattern: "\\bcivils?\\b", replacement: "civil" },
  { pattern: "\\bstructures?\\b", replacement: "structural" },

  { pattern: "\\btechnical\\s+notes?\\b", replacement: "technical notes" },
  { pattern: "\\bdesign\\s+drawings?\\b", replacement: "design drawings" },
  { pattern: "\\bdesign\\s+reports?\\b", replacement: "design reports" },
  { pattern: "\\bdesign\\s+schedules?\\b", replacement: "design schedules" },

  // Idempotent: optional existing "carbon"
  { pattern: "\\bnet\\s+zero(?:\\s+carbon)?\\b", replacement: "net zero carbon" },
  { pattern: "\\benvironment(?:al)?\\s+sustainability\\b", replacement: "environmental sustainability" },
];

export const DELIVERABLE_STATUS_PREFIX_PATTERN =
  "^(?:(?:new|updated|final|developed|revised|amended|draft|superseded|issued(?:\\s+for\\s+(?:review|construction|information|tender))?)\\s+)+";

/** Issue A/B, Rev A, Revision 1, Issued for Construction — never influence WP matching */
export const NON_PLANNING_INLINE_PATTERN =
  "\\b(?:issued\\s+for\\s+(?:review|construction|information|tender)|rev(?:ision)?\\s*[a-z0-9]+|issue\\s*[a-z0-9]+|stage\\s*\\d+|riba\\s*\\d+)\\b";

export const REVISION_METADATA_PATTERN = NON_PLANNING_INLINE_PATTERN;

export const STAGE_METADATA_PREFIX_PATTERN =
  "^(?:detailed design|design development|stage \\d+|riba \\d+|construction|tender(?: period)?|pre-?construction|procurement)\\s*[-–—:]?\\s*";

export const STAGE_METADATA_ONLY_PATTERNS: string[] = [
  "^detailed design$",
  "^design development$",
  "^stage \\d+$",
  "^riba \\d+$",
  "^construction$",
  "^tender$",
  "^tender period$",
  "^pre-?construction$",
  "^procurement$",
];

/** Matches dashed suffixes on the raw original name (before punctuation flattening). */
export const DISCIPLINE_SUFFIX_PATTERN =
  "\\s*[-–—]\\s*(mechanical|electrical|public health|ph|structural|architecture|architectural|fire(?:\\s+and\\s+safety)?|fire safety|acoustics|civil|mep|hvac)\\s*$";

export const UNKNOWN_WORK_PACKAGE_ID = "unknown_work_package";
export const UNKNOWN_CATEGORY_ID = "unknown_work_package";

/** Planner-facing soft-failure category: discipline known, no configured WP yet. */
export function otherWorkCategoryLabel(disciplineLabel: string): string {
  const label = String(disciplineLabel ?? "").trim() || "Unclassified";
  return `Other ${label} Work`;
}
