import type { PlannerQuery } from "./askRanaPlannerQuery.types.js";
import type { AskRanaEvidencePackage } from "./askRana.types.js";

const CHANGE_QUESTION_PATTERN =
  /\b(what changed|why did (?:this|it) change|what changed in the logic|what changed since baseline|has anything changed|show (?:me )?(?:the )?revisions?|revision history|how did (?:this|it) change|what(?:'s| is) different)\b/i;

const TECHNICAL_GAP_PATTERN =
  /\b(don't have enough evidence|not enough evidence|revision history on this project yet|programme logic revision history|evidence unavailable|revision data missing|no revision history)\b/i;

const TECHNICAL_OBSERVATION_PATTERN =
  /\b(only one programme revision|more updates are needed to analyse|not fully recorded)\b/i;

/** Baseline imported with no subsequent programme updates. */
export function isBaselineOnlyProgramme(pkg: AskRanaEvidencePackage): boolean {
  const evo = pkg.projectEvolution;
  return !!(evo?.available && evo.revisionCount <= 1);
}

/** Evolution was requested but no deliverable revisions are recorded yet. */
export function isAwaitingFirstProgrammeUpdate(pkg: AskRanaEvidencePackage): boolean {
  if (pkg.projectEvolution?.available) return false;
  if (!pkg.sources.includes("projectEvolution")) return false;
  return pkg.evidenceGaps.some((g) => /revision history/i.test(g));
}

export function isBaselineOnlyConversationState(pkg: AskRanaEvidencePackage): boolean {
  return isBaselineOnlyProgramme(pkg) || isAwaitingFirstProgrammeUpdate(pkg);
}

export function isChangeOrRevisionQuestion(
  question: string,
  plannerQuery?: PlannerQuery
): boolean {
  const q = question.trim();
  if (CHANGE_QUESTION_PATTERN.test(q)) return true;

  const changeIntents = new Set([
    "what_changed",
    "explain_change",
    "logic_change",
    "float_change",
    "relationship_change",
    "lag_change",
    "criticality",
    "explain_criticality",
  ]);

  return !!(plannerQuery && changeIntents.has(plannerQuery.intent));
}

export function baselineOnlyPrimaryMessage(pkg: AskRanaEvidencePackage): string {
  const duration =
    pkg.deliverable.currentDurationDays != null
      ? ` It's currently planned at ${pkg.deliverable.currentDurationDays} days on the Baseline.`
      : "";
  return `Nothing has changed yet — this project only contains the Baseline programme.${duration}`;
}

export function baselineOnlyFollowUpBullets(): string[] {
  return [
    "what changed",
    "when it changed",
    "how the programme evolved",
    "how durations, relationships, float and logic changed over time",
  ];
}

export function buildBaselineOnlyConversationAnswer(pkg: AskRanaEvidencePackage): string {
  const bullets = baselineOnlyFollowUpBullets();
  return [
    baselineOnlyPrimaryMessage(pkg),
    "",
    "Once you import your first programme update, I'll be able to explain:",
    ...bullets.map((b) => `• ${b}`),
  ].join("\n");
}

/** Replace internal gap wording with planner-facing language for baseline-only state. */
export function humanizeBaselineOnlyGap(gap: string): string {
  if (/no revision history/i.test(gap)) {
    return "There aren't any programme updates to compare yet — only the Baseline has been imported.";
  }
  if (/programme logic revision history/i.test(gap)) {
    return "There aren't any programme updates yet, so logic, float and relationship changes have nothing to compare against.";
  }
  if (/don't have enough evidence|not enough evidence/i.test(gap)) {
    return "There aren't any programme updates to compare yet — only the Baseline has been imported.";
  }
  return gap;
}

export function shouldHumanizeGap(gap: string): boolean {
  return TECHNICAL_GAP_PATTERN.test(gap);
}

export function isTechnicalBaselineObservation(text: string): boolean {
  return TECHNICAL_OBSERVATION_PATTERN.test(text);
}

export function filterTechnicalBaselineText(text: string): boolean {
  return !isTechnicalBaselineObservation(text);
}
