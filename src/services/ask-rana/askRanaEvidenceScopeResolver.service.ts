import type { AskRanaEvidenceDomain } from "./askRana.types.js";
import { selectAskRanaEvidenceDomainsAuto } from "./askRanaEvidenceSelector.js";
import type { PlannerQuery } from "./askRanaPlannerQuery.types.js";
import {
  INTENT_EVIDENCE_DOMAINS,
  SCOPE_EVIDENCE_DOMAINS,
} from "./askRanaPlannerQuery.types.js";

function unique(domains: AskRanaEvidenceDomain[]): AskRanaEvidenceDomain[] {
  return [...new Set(domains)];
}

function intersect(
  allowed: AskRanaEvidenceDomain[],
  preferred: AskRanaEvidenceDomain[]
): AskRanaEvidenceDomain[] {
  const set = new Set(allowed);
  const hit = preferred.filter((d) => set.has(d));
  return hit.length > 0 ? hit : allowed;
}

/**
 * Resolves which evidence domains to fetch for a structured planner query.
 * Scope constrains the boundary; intent refines within that boundary.
 */
export function resolveEvidenceDomains(
  query: PlannerQuery,
  question: string
): AskRanaEvidenceDomain[] {
  const intentDomains = INTENT_EVIDENCE_DOMAINS[query.intent] ?? INTENT_EVIDENCE_DOMAINS.general;

  let resolved: AskRanaEvidenceDomain[];

  if (query.scope === "AUTO") {
    const auto = selectAskRanaEvidenceDomainsAuto(question);
    resolved = unique([...auto, ...intentDomains.filter((d) => auto.includes(d) || auto.length <= 3)]);
  } else {
    const scopeDomains = SCOPE_EVIDENCE_DOMAINS[query.scope];
    resolved = intersect(scopeDomains, intentDomains);
  }

  const logicIntents = new Set([
    "logic_change",
    "relationship_change",
    "lag_change",
    "float_change",
    "explain_criticality",
  ]);
  if (logicIntents.has(query.intent) && query.scope !== "PREVIOUS_PROJECTS") {
    resolved = unique(["programmeLogic", "projectEvolution"]);
  }

  if (query.scope === "PREVIOUS_PROJECTS") {
    resolved = resolved.filter((d) => d !== "projectEvolution" && d !== "programmeLogic");
    if (resolved.length === 0) {
      resolved = ["previousProjects", "similarProjects"];
    }
  }

  if (query.scope === "PROJECT_EVOLUTION") {
    resolved = resolved.filter((d) => d === "projectEvolution" || d === "programmeLogic");
    if (resolved.length === 0) {
      resolved = ["projectEvolution", "programmeLogic"];
    }
  }

  if (query.scope === "PORTFOLIO") {
    resolved = resolved.filter(
      (d) => d === "lessonsLearned" || d === "similarProjects" || d === "previousProjects"
    );
    if (resolved.length === 0) {
      resolved = ["lessonsLearned", "similarProjects", "previousProjects"];
    }
  }

  return unique(resolved);
}

export function scopeInstructionForPrompt(query: PlannerQuery): string | null {
  switch (query.scope) {
    case "PROJECT_EVOLUTION":
      return [
        "Answer ONLY using Project Evolution evidence (this project's revisions, duration history, programme logic).",
        "Do NOT apologise for missing Previous Project evidence unless the planner explicitly asks for comparison.",
        "If the planner narrowed scope to project evolution, respect that boundary.",
      ].join(" ");
    case "PREVIOUS_PROJECTS":
      return [
        "Answer ONLY using Previous completed Projects evidence (benchmarks, similar work, lessons).",
        "Do NOT discuss this project's revision history unless it directly supports the comparison question.",
      ].join(" ");
    case "BOTH":
      return "Use both Project Evolution and Previous Projects evidence. Keep each source clearly labelled.";
    case "PORTFOLIO":
      return "Answer using portfolio and organisation-level evidence. This is not deliverable-specific unless the question says so.";
    case "PROGRAMME":
      return "Answer at programme level using the evidence provided for this programme.";
    default:
      return null;
  }
}
