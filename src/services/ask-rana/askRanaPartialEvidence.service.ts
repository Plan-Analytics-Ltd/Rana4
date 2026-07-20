import type { AskRanaEvidencePackage } from "./askRana.types.js";
import {
  baselineOnlyPrimaryMessage,
  buildBaselineOnlyConversationAnswer,
  isBaselineOnlyProgramme,
  isBaselineOnlyConversationState,
  isChangeOrRevisionQuestion,
} from "./askRanaBaselineOnlyConversation.service.js";

/** True when meaningful evidence exists beyond empty gaps. */
export function hasSubstantiveEvidence(pkg: AskRanaEvidencePackage): boolean {
  return !!(
    pkg.projectIntelligence?.available ||
    pkg.projectEvolution?.available ||
    pkg.programmeLogic?.available ||
    pkg.previousProjects?.available ||
    pkg.similarProjects?.available ||
    (pkg.recommendations?.available ?? false) ||
    (pkg.lessonsLearned?.available ?? false) ||
    (pkg.observations?.length ?? 0) > 0 ||
    (pkg.keyFactors?.length ?? 0) > 0
  );
}

export function hasEvolutionWithoutComparison(pkg: AskRanaEvidencePackage): boolean {
  return !!(pkg.projectEvolution?.available && !pkg.previousProjects?.available);
}

export function comparisonLimitationPhrase(): string {
  return "Based on the available programme data I can speak to this project's own revision history; there isn't enough completed-project history yet to benchmark it confidently against peers.";
}

/** Factual points from this project's history — for partial-evidence answers. */
export function buildEvolutionFactsForAnswer(pkg: AskRanaEvidencePackage): string[] {
  const parts: string[] = [];
  const deliverable = pkg.deliverable;
  const evolution = pkg.projectEvolution;
  if (!evolution?.available) return parts;

  if (isBaselineOnlyProgramme(pkg)) {
    return [baselineOnlyPrimaryMessage(pkg)];
  }

  if (deliverable.currentDurationDays != null) {
    parts.push(`It's currently planned at ${deliverable.currentDurationDays} days on this project.`);
  }

  if (evolution.baselineDays != null && evolution.latestDays != null) {
    const net = evolution.netChangeDays;
    let movement = "is now";
    if (net != null && net < 0) movement = "has reduced";
    else if (net != null && net > 0) movement = "has grown";
    parts.push(
      `Remaining work ${movement} from ${evolution.baselineDays} days at baseline to ${evolution.latestDays} days in the latest programme update.`
    );
  }

  if (evolution.howChangedSummary) {
    parts.push(evolution.howChangedSummary);
  } else if (evolution.summary) {
    parts.push(evolution.summary);
  }

  const stable = evolution.stablePeriods?.[0];
  if (stable) {
    parts.push(
      `Remaining work stabilised at ${stable.durationDays} days between ${stable.startLabel} and ${stable.endLabel} (${stable.revisionCount} revision${stable.revisionCount === 1 ? "" : "s"}).`
    );
  } else if (
    evolution.volatility?.toLowerCase().includes("low") ||
    evolution.changePattern?.toLowerCase().includes("stable")
  ) {
    parts.push("Remaining work has been relatively stable across revisions.");
  } else if (evolution.trend) {
    parts.push(`Across revisions, remaining work ${evolution.trend.toLowerCase()}.`);
  }

  if (pkg.programmeLogic?.summary) {
    parts.push(pkg.programmeLogic.summary);
  }

  const logicObs =
    pkg.programmeLogic?.revisions
      ?.flatMap((r) => r.plannerObservations)
      .filter(Boolean)
      .slice(0, 2) ?? [];
  for (const obs of logicObs) {
    if (!parts.includes(obs)) parts.push(obs);
  }

  const evolutionObs = evolution.plannerObservations?.slice(0, 2) ?? [];
  for (const obs of evolutionObs) {
    if (!parts.includes(obs)) parts.push(obs);
  }

  return parts;
}

/**
 * Answer-first structure for comparison questions when only this-project
 * revision history is available.
 */
export function buildPartialComparisonAnswer(pkg: AskRanaEvidencePackage): string[] {
  const facts = buildEvolutionFactsForAnswer(pkg);
  if (facts.length === 0) return [comparisonLimitationPhrase()];
  return [...facts, comparisonLimitationPhrase()];
}
