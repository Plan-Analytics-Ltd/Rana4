import type { AskRanaEvidenceDomain } from "./askRana.types.js";

const ALL_DOMAINS: AskRanaEvidenceDomain[] = [
  "previousProjects",
  "projectEvolution",
  "programmeLogic",
  "recommendations",
  "observations",
  "keyFactors",
  "trust",
  "lessonsLearned",
  "similarProjects",
];

/**
 * Legacy AUTO evidence selection — used only when PlannerQuery.scope is AUTO.
 * Prefer resolveEvidenceDomains(plannerQuery) for scoped questions.
 */
export function selectAskRanaEvidenceDomainsAuto(question: string): AskRanaEvidenceDomain[] {
  const q = question.toLowerCase().trim();

  if (
    /\b(explain everything|tell me everything|summarise everything|summarize everything|everything about|tell me about this)\b/.test(
      q
    )
  ) {
    return [...ALL_DOMAINS];
  }

  const selected = new Set<AskRanaEvidenceDomain>();

  if (
    /\b(revision|history|timeline|changed|change|evolution|evolve|stable|baseline|update|why did|why was|why were|increased|increase|reduced|reduce|from\s+\d+\s+to)\b/.test(
      q
    )
  ) {
    selected.add("projectEvolution");
    selected.add("programmeLogic");
  }

  if (
    /\b(critical|float|logic|relationship|lag|predecessor|successor|dependency|dependencies|driving)\b/.test(
      q
    )
  ) {
    selected.add("programmeLogic");
    selected.add("projectEvolution");
  }

  if (
    /\b(reasonable|normal|realistic|compare|previous|completed|worry|unusual|typical|usually|duration|days|keep|realistic|is this)\b/.test(
      q
    )
  ) {
    selected.add("previousProjects");
    selected.add("projectEvolution");
    selected.add("programmeLogic");
  }

  if (/\b(should|do next|review first|recommend|what would you|what should)\b/.test(q)) {
    selected.add("recommendations");
    selected.add("observations");
    selected.add("keyFactors");
    selected.add("previousProjects");
    selected.add("projectEvolution");
    selected.add("lessonsLearned");
  }

  if (/\b(worth reviewing|why is this|why is it different|different|flagged|attention)\b/.test(q)) {
    selected.add("previousProjects");
    selected.add("projectEvolution");
    selected.add("recommendations");
    selected.add("observations");
    selected.add("similarProjects");
  }

  if (/\b(lesson|usually happens|historically|learned|what usually)\b/.test(q)) {
    selected.add("lessonsLearned");
    selected.add("previousProjects");
  }

  if (/\b(similar project|other project|like this project|compare.*work)\b/.test(q)) {
    selected.add("similarProjects");
    selected.add("previousProjects");
  }

  if (/\b(trust|evidence quality|how reliable|how much evidence)\b/.test(q)) {
    selected.add("trust");
    selected.add("previousProjects");
  }

  if (/\b(summarise|summarize|overview|summary)\b/.test(q)) {
    selected.add("previousProjects");
    selected.add("projectEvolution");
    selected.add("recommendations");
    selected.add("observations");
  }

  if (selected.size === 0) {
    selected.add("previousProjects");
    selected.add("projectEvolution");
    selected.add("recommendations");
  }

  return [...selected];
}

/** @deprecated Use interpretPlannerQuery + resolveEvidenceDomains */
export function selectAskRanaEvidenceDomains(question: string): AskRanaEvidenceDomain[] {
  return selectAskRanaEvidenceDomainsAuto(question);
}

export function loadingHintForDomains(domains: AskRanaEvidenceDomain[]): string {
  const hasPrevious = domains.includes("previousProjects");
  const hasEvolution = domains.includes("projectEvolution");
  if (hasPrevious && hasEvolution) return "Rana is combining evidence from completed projects and revision history…";
  if (hasEvolution) return "Rana is checking this project's revision history…";
  if (hasPrevious) return "Rana is reviewing previous completed projects…";
  return "Rana is gathering evidence…";
}
