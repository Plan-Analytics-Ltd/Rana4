/**
 * Safe deliverable-name normalisation for taxonomy matching.
 * Produces one canonical string; never duplicates tokens.
 */

import {
  DELIVERABLE_STATUS_PREFIX_PATTERN,
  DISCIPLINE_SUFFIX_PATTERN,
  NAME_SYNONYM_REPLACEMENTS,
  REVISION_METADATA_PATTERN,
  STAGE_METADATA_ONLY_PATTERNS,
  STAGE_METADATA_PREFIX_PATTERN,
} from "./workPackageTaxonomy.config.js";
import type { PatternDefinition, PatternMatchType } from "./workPackageTaxonomy.types.js";

const DISCIPLINE_SUFFIX_RE = new RegExp(DISCIPLINE_SUFFIX_PATTERN, "i");
const STAGE_METADATA_PREFIX_RE = new RegExp(STAGE_METADATA_PREFIX_PATTERN, "i");
const DELIVERABLE_STATUS_PREFIX_RE = new RegExp(DELIVERABLE_STATUS_PREFIX_PATTERN, "i");
const REVISION_METADATA_RE = new RegExp(REVISION_METADATA_PATTERN, "gi");

const COMPILED_NAME_SYNONYM_REPLACEMENTS = NAME_SYNONYM_REPLACEMENTS.map((rule) => ({
  ...rule,
  re: new RegExp(rule.pattern, "gi"),
}));

function resolvePatternSpecInline(spec: string | PatternDefinition): {
  pattern: string;
  type: PatternMatchType;
} {
  if (typeof spec === "string") {
    return { pattern: spec, type: "contains" };
  }
  return {
    pattern: spec.pattern,
    type: spec.type ?? "contains",
  };
}

const COMPILED_STAGE_METADATA_ONLY_PATTERNS = STAGE_METADATA_ONLY_PATTERNS.map((spec) => {
  const { pattern, type } = resolvePatternSpecInline(spec);
  return { pattern, type, re: compilePatternRegex(pattern, type) };
});

const PATTERN_REGEX_CACHE = new Map<string, RegExp>();

function compilePatternRegex(pattern: string, type: PatternMatchType): RegExp {
  switch (type) {
    case "startsWith":
      return new RegExp(`^${pattern}`, "i");
    case "endsWith":
      return new RegExp(`${pattern}$`, "i");
    case "regex":
    case "contains":
    default:
      return new RegExp(pattern, "i");
  }
}

function cachedPatternRegex(pattern: string, type: PatternMatchType): RegExp {
  const key = `${type}\0${pattern}`;
  const cached = PATTERN_REGEX_CACHE.get(key);
  if (cached) return cached;
  const re = compilePatternRegex(pattern, type);
  PATTERN_REGEX_CACHE.set(key, re);
  return re;
}

/** Shared compiled discipline suffix — used by classifier and name normalisation. */
export const compiledDisciplineSuffixPattern = DISCIPLINE_SUFFIX_RE;

function n(s: unknown): string {
  return String(s ?? "").trim();
}

export function stripWorkPackageSuffix(name: string): string {
  return n(name).replace(/\s*—\s*Work package\s*$/i, "");
}

/** Collapse immediately repeated tokens: "carbon carbon" → "carbon" */
export function collapseDuplicateTokens(text: string): string {
  return text
    .replace(/\b(\w+)(?:\s+\1\b)+/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip a trailing discipline keyword whether written as "- Mechanical" or
 * " mechanical" after dashes were normalised to spaces.
 */
function stripTrailingDiscipline(text: string): string {
  let s = text.replace(DISCIPLINE_SUFFIX_RE, "");
  // Only strip true discipline parents — never WP identities (breeam, gi, drainage, sustainability)
  s = s.replace(
    /\s+(mechanical|electrical|public health|ph|structural|architecture|architectural|fire(?:\s+and\s+safety)?|fire safety|acoustics|civil|mep|hvac)\s*$/i,
    ""
  );
  return s.trim();
}

/**
 * Canonicalise a deliverable title for matching only.
 * Original names stay untouched in storage and UI variants.
 */
export function normaliseDeliverableNameForTaxonomy(rawName: string): string {
  let s = stripWorkPackageSuffix(rawName).toLowerCase();

  // Punctuation first so slash/dash forms share one path
  s = s.replace(/\s*[\/]\s*/g, " ");
  s = s.replace(/\s*[-–—]\s*/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  // Stage-only names must stay intact — prefix strip would empty "detailed design"
  if (COMPILED_STAGE_METADATA_ONLY_PATTERNS.some((p) => p.re.test(s))) {
    return s;
  }

  s = s.replace(STAGE_METADATA_PREFIX_RE, "");
  // Strip status / issue / revision noise repeatedly (stacked "New Updated …")
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(DELIVERABLE_STATUS_PREFIX_RE, "");
    s = s.replace(REVISION_METADATA_RE, "");
    s = s.replace(/\s+/g, " ").trim();
    if (s === before) break;
  }

  // Prefix strip emptied the name → reject as non-classifiable residue
  if (!s) return "";

  // Phrase-level synonym map (configured to be non-compounding)
  for (const rule of COMPILED_NAME_SYNONYM_REPLACEMENTS) {
    s = s.replace(rule.re, rule.replacement);
  }

  s = stripTrailingDiscipline(s);
  s = collapseDuplicateTokens(s);
  return s;
}

export function isStageMetadataOnly(normalisedName: string): boolean {
  return STAGE_METADATA_ONLY_PATTERNS.some((p) => patternMatches(normalisedName, p));
}

export function patternMatches(
  text: string,
  pattern: string,
  type: PatternMatchType = "contains"
): boolean {
  try {
    return cachedPatternRegex(pattern, type).test(text);
  } catch {
    const t = text.toLowerCase();
    const p = pattern.toLowerCase();
    if (type === "startsWith") return t.startsWith(p);
    if (type === "endsWith") return t.endsWith(p);
    return t.includes(p);
  }
}

export function resolvePatternSpec(spec: string | PatternDefinition): {
  pattern: string;
  type: PatternMatchType;
  priority: number;
} {
  if (typeof spec === "string") {
    return { pattern: spec, type: "contains", priority: spec.length };
  }
  return {
    pattern: spec.pattern,
    type: spec.type ?? "contains",
    priority: spec.priority ?? spec.pattern.length,
  };
}

export function scorePatternMatch(text: string, spec: string | PatternDefinition): number {
  const { pattern, type, priority } = resolvePatternSpec(spec);
  return patternMatches(text, pattern, type) ? priority : 0;
}

/** Stable slug for taxonomy keys from a normalised name */
export function canonicalKeyFromNormalisedName(normalisedName: string): string {
  return normalisedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 120);
}

export function titleCaseFromNormalised(normalisedName: string): string {
  if (!normalisedName) return "Unknown work package";
  return normalisedName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
