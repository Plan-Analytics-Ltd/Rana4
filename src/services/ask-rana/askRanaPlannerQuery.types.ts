import type { AskRanaEvidenceDomain } from "./askRana.types.js";

/** Explicit evidence scope chosen by the planner (or inferred). */
export type PlannerEvidenceScope =
  | "AUTO"
  | "PROJECT_EVOLUTION"
  | "PREVIOUS_PROJECTS"
  | "BOTH"
  | "PROGRAMME"
  | "PORTFOLIO";

/** What the planner is trying to learn — separate from where evidence comes from. */
export type PlannerQueryIntent =
  | "evaluate_duration"
  | "is_reasonable"
  | "explain_change"
  | "what_changed"
  | "revision_history"
  | "logic_change"
  | "relationship_change"
  | "lag_change"
  | "float_change"
  | "criticality"
  | "explain_criticality"
  | "risk"
  | "comparison"
  | "recommendation"
  | "forecast"
  | "lessons"
  | "summary"
  | "why"
  | "how"
  | "investigate"
  | "should_change_duration"
  | "general";

export type PlannerQueryEntity = "deliverable" | "programme" | "portfolio" | "activity" | "project";

export type PlannerComparisonMode = "none" | "previous_projects" | "both" | "unspecified";

export type PlannerTimeframe = "latest" | "baseline" | "full_history" | "between_revisions" | "unspecified";

/** Canonical structured interpretation of every planner question. */
export type PlannerQuery = {
  intent: PlannerQueryIntent;
  scope: PlannerEvidenceScope;
  entity: PlannerQueryEntity;
  comparisonMode: PlannerComparisonMode;
  timeframe: PlannerTimeframe;
  qualifiers: string[];
  confidence: number;
  scopeRationale: string;
  intentRationale: string;
};

/** Evidence domains each intent can draw on when scope is AUTO or BOTH. */
export const INTENT_EVIDENCE_DOMAINS: Record<PlannerQueryIntent, AskRanaEvidenceDomain[]> = {
  evaluate_duration: ["projectEvolution", "previousProjects", "programmeLogic"],
  is_reasonable: ["previousProjects", "projectEvolution"],
  explain_change: ["projectEvolution", "programmeLogic"],
  what_changed: ["projectEvolution", "programmeLogic"],
  revision_history: ["projectEvolution"],
  logic_change: ["programmeLogic", "projectEvolution"],
  relationship_change: ["programmeLogic"],
  lag_change: ["programmeLogic"],
  float_change: ["programmeLogic"],
  criticality: ["programmeLogic", "projectEvolution"],
  explain_criticality: ["programmeLogic", "projectEvolution"],
  risk: ["observations", "recommendations", "previousProjects", "lessonsLearned"],
  comparison: ["previousProjects", "similarProjects"],
  recommendation: ["recommendations", "observations", "keyFactors"],
  forecast: ["previousProjects", "projectEvolution", "lessonsLearned"],
  lessons: ["lessonsLearned", "previousProjects", "similarProjects"],
  summary: ["projectEvolution", "previousProjects", "recommendations", "observations", "programmeLogic"],
  why: ["projectEvolution", "programmeLogic", "previousProjects"],
  how: ["projectEvolution", "programmeLogic"],
  investigate: ["projectEvolution", "programmeLogic", "observations", "keyFactors"],
  should_change_duration: ["previousProjects", "projectEvolution", "recommendations"],
  general: ["projectEvolution", "previousProjects", "recommendations"],
};

/** Domains permitted under each explicit scope. */
export const SCOPE_EVIDENCE_DOMAINS: Record<
  Exclude<PlannerEvidenceScope, "AUTO">,
  AskRanaEvidenceDomain[]
> = {
  PROJECT_EVOLUTION: ["projectEvolution", "programmeLogic"],
  PREVIOUS_PROJECTS: [
    "previousProjects",
    "similarProjects",
    "lessonsLearned",
    "observations",
    "keyFactors",
    "recommendations",
    "trust",
  ],
  BOTH: [
    "projectEvolution",
    "programmeLogic",
    "previousProjects",
    "similarProjects",
    "lessonsLearned",
    "observations",
    "keyFactors",
    "recommendations",
    "trust",
  ],
  PROGRAMME: ["projectEvolution", "previousProjects", "similarProjects", "lessonsLearned", "programmeLogic"],
  PORTFOLIO: ["lessonsLearned", "similarProjects", "previousProjects"],
};

export function humanPlannerScopeLabel(scope: PlannerEvidenceScope): string {
  switch (scope) {
    case "PROJECT_EVOLUTION":
      return "Project Evolution only";
    case "PREVIOUS_PROJECTS":
      return "Previous completed projects only";
    case "BOTH":
      return "Project Evolution and Previous Projects";
    case "PROGRAMME":
      return "This programme";
    case "PORTFOLIO":
      return "Portfolio / organisation";
    case "AUTO":
      return "Automatic (infer from question)";
    default:
      return scope;
  }
}

export function humanPlannerIntentLabel(intent: PlannerQueryIntent): string {
  return intent.replace(/_/g, " ");
}
