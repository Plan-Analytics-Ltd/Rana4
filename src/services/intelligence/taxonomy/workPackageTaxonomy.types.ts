/**
 * Shared types for planner-centric work package taxonomy (presentation layer only).
 */

export type PatternMatchType = "contains" | "startsWith" | "endsWith" | "regex";

export type PatternDefinition = {
  pattern: string;
  type?: PatternMatchType;
  /** Higher priority wins when multiple patterns match */
  priority?: number;
};

export type WorkPackageDefinition = {
  id: string;
  label: string;
  /** Patterns matched against normalised deliverable names */
  deliverablePatterns: Array<string | PatternDefinition>;
  aliases?: string[];
};

export type CategoryDefinition = {
  id: string;
  label: string;
  workPackages: WorkPackageDefinition[];
};

export type KeywordDefinition = {
  pattern: string;
  type?: PatternMatchType;
  /** Higher priority wins when multiple keywords match */
  priority?: number;
};

export type DisciplineDefinition = {
  id: string;
  label: string;
  /** Fragnet / parent WBS (metadata) */
  fragnetPatterns: string[];
  /** Activity-code / discipline field values (metadata) */
  activityCodePatterns: string[];
  /** Keyword detection — second priority after metadata */
  keywords: KeywordDefinition[];
  /** Fallback name patterns */
  namePatterns: string[];
  categories: CategoryDefinition[];
};

export type NameSynonymRule = { pattern: string; replacement: string };

export function flattenDisciplineWorkPackages(discipline: DisciplineDefinition): WorkPackageDefinition[] {
  return discipline.categories.flatMap((c) => c.workPackages);
}

export function findWorkPackageCategory(
  discipline: DisciplineDefinition,
  workPackageId: string
): CategoryDefinition | undefined {
  return discipline.categories.find((c) => c.workPackages.some((wp) => wp.id === workPackageId));
}
