/**
 * Ask Rana — frontend orchestration only.
 * Routes planner questions by intent, reuses existing intelligence helpers,
 * and returns layout-specific responses. No new APIs or engine changes.
 */

import type {
  DeliverableIntelligenceAnalysis,
  DeliverableProjectEvolutionReport,
  DeliverableProjectEvolutionRevision,
  ProjectEvolutionIntelligence,
  ProjectEvolutionRevisionHighlight,
} from "@/lib/api";
import { humanSnapshotRole } from "@/lib/intelligence-terminology";
import {
  evidenceBasisPhrase,
  plannerAnswerFromAnalysis,
  type PlannerAnswer,
} from "@/lib/intelligence-language";

export type AskRanaSource = "previous_projects" | "project_evolution" | "both";

export type AskRanaIntent =
  | "what_changed"
  | "revision_history"
  | "why_changed"
  | "which_revision_changed_most"
  | "was_this_stable"
  | "summarise_evolution"
  | "compare_baseline_latest"
  | "duration_reasonable"
  | "compare_previous"
  | "usually_happens"
  | "worth_reviewing"
  | "explain_deliverable"
  | "what_to_do"
  | "compare_reference"
  | "general";

export type AskRanaContext = {
  hasPreviousProjects: boolean;
  hasEvolution: boolean;
  revisionCount: number;
  completedProjectCount: number;
  workPackageCount: number;
};

export type AskRanaTimelineStep = {
  label: string;
  role: string;
  durationDays: number | null;
  durationChangeDays: number | null;
  importedAt: string;
};

export type AskRanaHighlightedRevision = {
  label: string;
  role: string;
  durationDays: number;
  durationChangeDays: number | null;
  highlightReason: string;
};

export type AskRanaResponse =
  | {
      layout: "what_changed";
      summary: string;
      netChange: string | null;
      timelineHighlights: string[];
      highlightedRevisions: AskRanaHighlightedRevision[];
      latestState: string;
    }
  | {
      layout: "revision_history";
      intro?: string;
      timeline: AskRanaTimelineStep[];
    }
  | {
      layout: "why_changed";
      howChanged: string;
      changePattern: string | null;
      keySteps: string[];
    }
  | {
      layout: "which_revision_changed";
      answer: string;
      largestIncrease: string | null;
      largestReduction: string | null;
      highlights: AskRanaHighlightedRevision[];
    }
  | {
      layout: "stability_assessment";
      answer: string;
      trend: string;
      volatility: string | null;
      stablePeriods: string[];
    }
  | {
      layout: "evolution_summary";
      summary: string;
      trend: string;
      highlights: string[];
      observations: string[];
    }
  | {
      layout: "duration_reasonable";
      answer: string;
      comparison: string;
      evidence: string[];
      recommendation: string;
    }
  | {
      layout: "explain_combined";
      summary: string;
      previousProjects: { heading: string; points: string[] };
      projectEvolution: { heading: string; points: string[] };
      recommendation: string;
    }
  | {
      layout: "what_to_do";
      answer: string;
      steps: string[];
    }
  | {
      layout: "compare_reference";
      answer: string;
      comparedAgainst: string[];
      evidence: string[];
    }
  | {
      layout: "standard";
      answer: string;
      why: string;
      evidence: string[];
      action: string;
    };

export type AskRanaSessionContext = {
  lastIntent: AskRanaIntent | null;
  lastSource: AskRanaSource | null;
  lastQuestion: string | null;
  topic: "evolution" | "comparison" | "combined" | null;
};

export type AskRanaTurn = {
  id: string;
  question: string;
  source: AskRanaSource;
  intent: AskRanaIntent;
  response: AskRanaResponse;
};

export function createAskRanaSession(): AskRanaSessionContext {
  return { lastIntent: null, lastSource: null, lastQuestion: null, topic: null };
}

function distinctProjectCount(
  analysis: DeliverableIntelligenceAnalysis | null,
  projectId: string
): number {
  const matched = analysis?.evidence?.matchedDeliverables ?? [];
  const ids = new Set<string>();
  for (const m of matched) {
    if (m.projectId && m.projectId !== projectId) ids.add(m.projectId);
  }
  return ids.size;
}

export function buildAskRanaContext(args: {
  analysis: DeliverableIntelligenceAnalysis | null;
  evolution: DeliverableProjectEvolutionReport | null;
  projectId: string;
}): AskRanaContext {
  const sampleSize =
    args.analysis?.benchmark?.sampleSize ?? args.analysis?.evidence?.sampleSize ?? 0;
  const completedProjectCount = distinctProjectCount(args.analysis, args.projectId);
  const revisionCount = args.evolution?.revisions.length ?? 0;

  return {
    hasPreviousProjects: sampleSize > 0 && completedProjectCount > 0,
    hasEvolution: revisionCount >= 1,
    revisionCount,
    completedProjectCount,
    workPackageCount: sampleSize,
  };
}

function revisionRoleLabel(rev: DeliverableProjectEvolutionRevision): string {
  const fromRole = humanSnapshotRole(rev.role);
  if (fromRole !== "Earlier programme revision") return fromRole;
  if (rev.programmeState) {
    return rev.programmeState.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return fromRole;
}

function toTimelineSteps(evolution: DeliverableProjectEvolutionReport): AskRanaTimelineStep[] {
  return evolution.revisions.map((rev, index) => ({
    label: rev.label || `Revision ${index + 1}`,
    role: revisionRoleLabel(rev),
    durationDays: rev.durationDays,
    durationChangeDays: rev.durationChangeDays,
    importedAt: rev.importedAt,
  }));
}

/** Sample timeline for long histories — first, evenly spaced middle, last. */
export function sampleTimelineSteps(steps: AskRanaTimelineStep[]): AskRanaTimelineStep[] {
  if (steps.length <= 5) return steps;
  const indices = new Set<number>([0, steps.length - 1]);
  const midCount = 3;
  for (let i = 1; i <= midCount; i++) {
    indices.add(Math.round((i * (steps.length - 1)) / (midCount + 1)));
  }
  return [...indices].sort((a, b) => a - b).map((i) => steps[i]);
}

function isFollowUpWhy(question: string): boolean {
  return /^(why|how come|what caused that|what caused it)\??$/i.test(question.trim());
}

function isFollowUpCompareReference(question: string): boolean {
  return /\b(compared to what|compare to what|what are you comparing|what is that compared|against what)\b/i.test(
    question
  );
}

/** Expand short follow-ups using session memory. */
export function resolveQuestionWithSession(
  question: string,
  session: AskRanaSessionContext
): { resolvedQuestion: string; isFollowUp: boolean } {
  const trimmed = question.trim();
  const q = trimmed.toLowerCase();

  if (isFollowUpWhy(trimmed) && session.topic === "evolution") {
    return { resolvedQuestion: "Why did the duration change?", isFollowUp: true };
  }

  if (isFollowUpCompareReference(trimmed) && session.topic === "comparison") {
    return { resolvedQuestion: "What are you comparing this duration against?", isFollowUp: true };
  }

  if (/^(and|what about)\??$/i.test(trimmed) && session.lastQuestion) {
    return { resolvedQuestion: session.lastQuestion, isFollowUp: true };
  }

  if (q === "why" && session.lastIntent === "what_changed") {
    return { resolvedQuestion: "Why did the duration change?", isFollowUp: true };
  }

  return { resolvedQuestion: trimmed, isFollowUp: false };
}

export function detectAskRanaIntent(question: string, session: AskRanaSessionContext): AskRanaIntent {
  const { resolvedQuestion, isFollowUp } = resolveQuestionWithSession(question, session);
  const q = resolvedQuestion.toLowerCase().trim();

  if (isFollowUp) {
    if (isFollowUpWhy(resolvedQuestion) || (session.lastIntent === "what_changed" && /^why\b/.test(q))) {
      return "why_changed";
    }
    if (isFollowUpCompareReference(resolvedQuestion)) return "compare_reference";
  }

  if (/\bwhich revision\b.*\b(change|most)\b|\bchanged the most\b|\bbiggest revision change\b/.test(q)) {
    return "which_revision_changed_most";
  }

  if (/\bwas (this|it) stable\b|\bhas (this|it) been stable\b|\bstable period\b/.test(q)) {
    return "was_this_stable";
  }

  if (/\bsummarise\b.*\bevolution\b|\bsummarize\b.*\bevolution\b|\bsummarise the evolution\b/.test(q)) {
    return "summarise_evolution";
  }

  if (/\b(show|see)\b.*\b(revision history|timeline)\b|\brevision history\b|\bshow timeline\b/.test(q)) {
    return "revision_history";
  }

  if (/\bwhy did\b.*\b(change|duration|reduce|grow|shrink|drop|increase)\b|\bwhat caused\b/.test(q)) {
    return "why_changed";
  }

  if (/\bcompare\b.*\b(baseline|latest)\b|\bbaseline\b.*\b(latest|current)\b/.test(q)) {
    return "compare_baseline_latest";
  }

  if (/\bwhat (has |did )?change|\bhow has\b.*\bchange|\bchanged over time\b/.test(q)) {
    return "what_changed";
  }

  if (/\b(is this|is \d+)\b.*\b(reasonable|normal)\b|\bis this duration reasonable\b/.test(q)) {
    return "duration_reasonable";
  }

  if (/\bcompare\b.*\b(previous|completed|other)\b|\bhow does this compare\b|\bcompare with\b/.test(q)) {
    return "compare_previous";
  }

  if (/\bwhat usually happens\b|\busually\b.*\bhappen\b|\btypical duration\b/.test(q)) {
    return "usually_happens";
  }

  if (/\bworth reviewing\b|\bshould i review\b/.test(q)) {
    return "worth_reviewing";
  }

  if (/\bexplain\b.*\b(deliverable|work package)\b|\btell me about\b|\bsummarise everything\b|\bsummarize everything\b/.test(q)) {
    return "explain_deliverable";
  }

  if (/\bwhat should i do\b|\bwhat do you recommend\b|\bwhat's next\b|\bwhat is next\b/.test(q)) {
    return "what_to_do";
  }

  if (/\bevolution\b|\bover time\b|\bsince baseline\b|\bon this project\b|\brevision\b/.test(q)) {
    return "what_changed";
  }

  if (/\breasonable\b|\bprevious project|\bcompleted project|\bsimilar work\b/.test(q)) {
    return "duration_reasonable";
  }

  return "general";
}

export function intentToSource(intent: AskRanaIntent): AskRanaSource {
  switch (intent) {
    case "what_changed":
    case "revision_history":
    case "why_changed":
    case "which_revision_changed_most":
    case "was_this_stable":
    case "summarise_evolution":
    case "compare_baseline_latest":
      return "project_evolution";
    case "duration_reasonable":
    case "compare_previous":
    case "usually_happens":
    case "worth_reviewing":
    case "compare_reference":
      return "previous_projects";
    case "explain_deliverable":
    case "what_to_do":
    case "general":
      return "both";
  }
}

export function resolveEffectiveSource(
  intent: AskRanaIntent,
  ctx: AskRanaContext
): AskRanaSource | null {
  const detected = intentToSource(intent);
  if (!ctx.hasPreviousProjects && !ctx.hasEvolution) return null;
  if (!ctx.hasPreviousProjects) return "project_evolution";
  if (!ctx.hasEvolution) return "previous_projects";
  return detected;
}

export function loadingMessageForSource(source: AskRanaSource): string {
  switch (source) {
    case "previous_projects":
      return "Rana is reviewing previous completed projects…";
    case "project_evolution":
      return "Rana is checking this project's revision history…";
    case "both":
      return "Rana is combining both sources…";
  }
}

export function suggestedQuestions(ctx: AskRanaContext): string[] {
  const evolutionSuggestions = [
    "What changed?",
    "Why did it change?",
    "Show revision history.",
    "Which revision changed the most?",
    "Was this stable?",
    "Summarise the evolution.",
  ];

  const previousSuggestions = [
    "Is this duration reasonable?",
    "Compare with previous projects.",
    "What usually happens?",
    "Why is this worth reviewing?",
  ];

  const mixedSuggestions = [
    "Explain this deliverable.",
    "What should I do next?",
    "Is this duration reasonable?",
    "What changed?",
    "Which revision changed the most?",
    "Compare with previous projects.",
  ];

  if (ctx.hasPreviousProjects && ctx.hasEvolution) return mixedSuggestions;
  if (ctx.hasEvolution) return evolutionSuggestions;
  if (ctx.hasPreviousProjects) return previousSuggestions;
  return ["Explain this deliverable."];
}

function missingComparisonNote(ctx: AskRanaContext): string {
  if (ctx.hasEvolution) {
    return `There aren't enough completed projects yet to compare this against, but this project has ${ctx.revisionCount} revision${ctx.revisionCount === 1 ? "" : "s"} that Rana can analyse.`;
  }
  return "There aren't enough completed projects imported yet to compare this deliverable against.";
}

function evolutionIntelligence(evolution: DeliverableProjectEvolutionReport): ProjectEvolutionIntelligence {
  return evolution.projectEvolutionIntelligence;
}

function humanTrend(trend: string | null): string {
  switch (trend) {
    case "GROWING":
      return "Duration trended upward across revisions.";
    case "SHRINKING":
      return "Duration trended downward across revisions.";
    case "STABLE":
      return "Duration remained broadly stable.";
    case "OSCILLATING":
      return "Duration moved up and down between revisions.";
    default:
      return "Not enough revisions to establish a clear trend.";
  }
}

function humanVolatility(volatility: string | null): string | null {
  if (!volatility) return null;
  if (volatility === "LOW") return "Low volatility — revisions were fairly consistent.";
  if (volatility === "MODERATE") return "Moderate volatility — some variation between revisions.";
  return "High volatility — durations shifted noticeably between revisions.";
}

function humanChangePattern(pattern: string | null): string | null {
  switch (pattern) {
    case "STABLE":
      return "Stable — no meaningful net movement.";
    case "GRADUAL":
      return "Gradual — change built up across several revisions.";
    case "SUDDEN":
      return "Sudden — most movement happened in one revision step.";
    case "OSCILLATING":
      return "Oscillating — durations moved up and down.";
    case "MIXED":
      return "Mixed — no single clear change pattern.";
    default:
      return null;
  }
}

function highlightToRevision(h: ProjectEvolutionRevisionHighlight, evolution: DeliverableProjectEvolutionReport): AskRanaHighlightedRevision {
  const rev = evolution.revisions[h.revisionIndex];
  return {
    label: h.revisionLabel,
    role: rev ? revisionRoleLabel(rev) : humanSnapshotRole(h.role),
    durationDays: h.durationDays,
    durationChangeDays: h.durationChangeDays,
    highlightReason: h.highlightReason,
  };
}

function formatNetChange(intel: ProjectEvolutionIntelligence): string | null {
  if (intel.baseline == null || intel.latest == null || intel.netChange == null) return null;
  if (intel.netChange === 0) return `No net change — stayed at ${intel.latest} days.`;
  const dir = intel.netChange > 0 ? "increased" : "reduced";
  return `Net change: ${dir} from ${intel.baseline} to ${intel.latest} days (${intel.netChange > 0 ? "+" : ""}${intel.netChange} days).`;
}

function formatChangeStep(label: string, step: { changeDays: number; fromDays: number; toDays: number }): string {
  const dir = step.changeDays > 0 ? "increased" : "reduced";
  return `${label}: ${dir} from ${step.fromDays} to ${step.toDays} days (${step.changeDays > 0 ? "+" : ""}${step.changeDays}).`;
}

function buildWhatChangedResponse(evolution: DeliverableProjectEvolutionReport): AskRanaResponse {
  const intel = evolutionIntelligence(evolution);
  const highlightedRevisions = intel.revisionHighlights.map((h) => highlightToRevision(h, evolution));

  return {
    layout: "what_changed",
    summary: intel.summary,
    netChange: formatNetChange(intel),
    timelineHighlights: intel.timelineHighlights,
    highlightedRevisions,
    latestState:
      intel.latest != null
        ? `Latest imported duration: ${intel.latest} days.`
        : "Latest duration not recorded in the imported programme.",
  };
}

function buildRevisionHistoryResponse(evolution: DeliverableProjectEvolutionReport): AskRanaResponse {
  const steps = toTimelineSteps(evolution);
  return {
    layout: "revision_history",
    timeline: steps,
  };
}

function buildWhyChangedResponse(evolution: DeliverableProjectEvolutionReport): AskRanaResponse {
  const intel = evolutionIntelligence(evolution);
  const keySteps: string[] = [];

  if (intel.firstMeaningfulChange) {
    keySteps.push(formatChangeStep("First change", intel.firstMeaningfulChange));
  }
  if (
    intel.latestMeaningfulChange &&
    intel.latestMeaningfulChange.revisionLabel !== intel.firstMeaningfulChange?.revisionLabel
  ) {
    keySteps.push(formatChangeStep("Latest change", intel.latestMeaningfulChange));
  }
  if (
    intel.largestSingleRevisionChange &&
    intel.largestSingleRevisionChange.revisionLabel !== intel.firstMeaningfulChange?.revisionLabel &&
    intel.largestSingleRevisionChange.revisionLabel !== intel.latestMeaningfulChange?.revisionLabel
  ) {
    keySteps.push(formatChangeStep("Largest step", intel.largestSingleRevisionChange));
  }

  const howChanged =
    intel.howChangedSummary ??
    (intel.changePattern === "STABLE" && intel.baseline != null
      ? `Duration remained at ${intel.baseline} days. The imported programme history does not record why those planning decisions were made.`
      : "Rana can see revision durations, but the imported programme history does not record why those planning decisions were made.");

  return {
    layout: "why_changed",
    howChanged,
    changePattern: humanChangePattern(intel.changePattern),
    keySteps,
  };
}

function buildWhichRevisionChangedResponse(evolution: DeliverableProjectEvolutionReport): AskRanaResponse {
  const intel = evolutionIntelligence(evolution);
  const highlights = intel.revisionHighlights.map((h) => highlightToRevision(h, evolution));

  let answer = "No single revision stands out — durations stayed the same across imported revisions.";
  if (intel.largestSingleRevisionChange) {
    answer = `${intel.largestSingleRevisionChange.revisionLabel} had the largest single revision step (${intel.largestSingleRevisionChange.changeDays > 0 ? "+" : ""}${intel.largestSingleRevisionChange.changeDays} days).`;
  }

  return {
    layout: "which_revision_changed",
    answer,
    largestIncrease: intel.largestIncrease
      ? formatChangeStep(intel.largestIncrease.revisionLabel, intel.largestIncrease)
      : null,
    largestReduction: intel.largestReduction
      ? formatChangeStep(intel.largestReduction.revisionLabel, intel.largestReduction)
      : null,
    highlights,
  };
}

function buildStabilityAssessmentResponse(evolution: DeliverableProjectEvolutionReport): AskRanaResponse {
  const intel = evolutionIntelligence(evolution);
  const stablePeriods = intel.stablePeriods.map(
    (p) =>
      `${p.durationDays} days held from ${p.startLabel} to ${p.endLabel} (${p.revisionCount} revision${p.revisionCount === 1 ? "" : "s"}).`
  );

  let answer: string;
  if (intel.changePattern === "STABLE") {
    answer = `Yes — duration remained at ${intel.baseline ?? intel.latest ?? "its current"} days across ${intel.revisionCount} revisions.`;
  } else if (intel.longestStablePeriod) {
    answer = `Not entirely — the longest stable run was ${intel.longestStablePeriod.revisionCount} revisions at ${intel.longestStablePeriod.durationDays} days (${intel.longestStablePeriod.startLabel} to ${intel.longestStablePeriod.endLabel}).`;
  } else {
    answer = "No — durations shifted between most imported revisions.";
  }

  return {
    layout: "stability_assessment",
    answer,
    trend: humanTrend(intel.trend),
    volatility: humanVolatility(intel.volatility),
    stablePeriods,
  };
}

function buildEvolutionSummaryResponse(evolution: DeliverableProjectEvolutionReport): AskRanaResponse {
  const intel = evolutionIntelligence(evolution);
  return {
    layout: "evolution_summary",
    summary: intel.summary,
    trend: humanTrend(intel.trend),
    highlights: intel.timelineHighlights,
    observations: intel.plannerObservations,
  };
}

function buildDurationReasonableResponse(
  analysis: DeliverableIntelligenceAnalysis,
  projectId: string
): AskRanaResponse {
  const base = plannerAnswerFromAnalysis({ analysis, projectId });
  const sampleSize = analysis.benchmark?.sampleSize ?? analysis.evidence?.sampleSize ?? 0;
  const currentDays = analysis.currentDurationDays;
  const expected = analysis.benchmark?.expectedDuration ?? null;
  const typical =
    expected?.mostLikelyDays ?? analysis.benchmark?.medianDuration ?? null;
  const typicalPhrase =
    expected?.rangeLabel ??
    (typical != null && Number.isFinite(typical) ? `around ${Math.round(typical)} days` : "a typical duration");

  let comparison = "Rana compared this with similar work on completed projects.";
  if (currentDays != null && expected?.rangeLabel) {
    comparison = `Your plan is ${Math.round(currentDays)} days. Similar work on completed projects usually sits around ${expected.rangeLabel.toLowerCase()}.`;
  } else if (currentDays != null && typical != null) {
    comparison = `Your plan is ${Math.round(currentDays)} days. Similar work on completed projects usually completes in ${typicalPhrase}.`;
  } else if (analysis.outlier?.effectivePositionLabel) {
    comparison = analysis.outlier.effectivePositionLabel
      .replace(/historical benchmark/gi, "completed projects")
      .replace(/benchmark/gi, "completed projects");
  }

  const answer =
    sampleSize === 0
      ? "There aren't enough completed projects to judge whether this duration is reasonable yet."
      : analysis.outlier?.status === "NORMAL"
        ? "Yes — this duration looks reasonable compared with similar work on completed projects."
        : analysis.outlier?.status === "SLIGHTLY_HIGH" || analysis.outlier?.status === "SLIGHTLY_LOW"
          ? "It is a bit different to what usually happens — worth a quick review with the team."
          : "This duration is materially different to what usually happens on similar projects.";

  return {
    layout: "duration_reasonable",
    answer,
    comparison,
    evidence: base.evidence,
    recommendation: base.action,
  };
}

function buildCompareReferenceResponse(
  analysis: DeliverableIntelligenceAnalysis,
  projectId: string,
  ctx: AskRanaContext
): AskRanaResponse {
  const matched = analysis.evidence?.matchedDeliverables ?? [];
  const fromOther = matched.filter((m) => m.projectId && m.projectId !== projectId);
  const projectNames = [...new Set(fromOther.map((m) => m.projectName).filter(Boolean))] as string[];

  const comparedAgainst =
    projectNames.length > 0
      ? projectNames.slice(0, 5).map((name) => name)
      : [`Similar work from ${ctx.completedProjectCount} completed project${ctx.completedProjectCount === 1 ? "" : "s"}`];

  const basis = evidenceBasisPhrase(ctx.workPackageCount, ctx.completedProjectCount);

  return {
    layout: "compare_reference",
    answer: `Rana is comparing this deliverable with similar work packages from ${ctx.completedProjectCount} completed project${ctx.completedProjectCount === 1 ? "" : "s"}.`,
    comparedAgainst,
    evidence: [basis, ...comparedAgainst.map((p) => `Includes work from ${p}`)],
  };
}

function buildExplainCombinedResponse(args: {
  analysis: DeliverableIntelligenceAnalysis | null;
  evolution: DeliverableProjectEvolutionReport | null;
  projectId: string;
  ctx: AskRanaContext;
}): AskRanaResponse {
  const { analysis, evolution, projectId, ctx } = args;

  const previousPoints: string[] = [];
  if (analysis && ctx.hasPreviousProjects) {
    const comp = plannerAnswerFromAnalysis({ analysis, projectId });
    previousPoints.push(comp.answer);
    if (comp.why) previousPoints.push(comp.why);
    previousPoints.push(...comp.evidence);
  } else {
    previousPoints.push(missingComparisonNote(ctx));
  }

  const evolutionPoints: string[] = [];
  if (evolution && ctx.hasEvolution) {
    const intel = evolutionIntelligence(evolution);
    evolutionPoints.push(intel.summary);
    if (intel.plannerObservations.length > 0) {
      evolutionPoints.push(...intel.plannerObservations.slice(0, 2));
    } else if (intel.timelineHighlights.length > 0) {
      evolutionPoints.push(...intel.timelineHighlights.slice(0, 2));
    }
    evolutionPoints.push(`${intel.revisionCount} programme revision${intel.revisionCount === 1 ? "" : "s"} imported on this project.`);
  } else {
    evolutionPoints.push("No revision history on this project yet.");
  }

  let recommendation = "Review both comparisons when deciding whether the current plan is right.";
  if (analysis && ctx.hasPreviousProjects) {
    recommendation = plannerAnswerFromAnalysis({ analysis, projectId }).action;
  } else if (evolution && ctx.hasEvolution) {
    recommendation = "Review the revision timeline and confirm the latest duration reflects the team's intent.";
  }

  const summary =
    ctx.hasPreviousProjects && ctx.hasEvolution
      ? "Here is what Rana knows from completed projects and from this project's revision history."
      : ctx.hasEvolution
        ? missingComparisonNote(ctx)
        : "Here is what Rana knows from completed projects.";

  return {
    layout: "explain_combined",
    summary,
    previousProjects: {
      heading: "Previous completed projects",
      points: previousPoints,
    },
    projectEvolution: {
      heading: "This project's revisions",
      points: evolutionPoints,
    },
    recommendation,
  };
}

function buildWhatToDoResponse(args: {
  analysis: DeliverableIntelligenceAnalysis | null;
  evolution: DeliverableProjectEvolutionReport | null;
  projectId: string;
  ctx: AskRanaContext;
}): AskRanaResponse {
  const steps: string[] = [];

  if (args.analysis && args.ctx.hasPreviousProjects) {
    const comp = plannerAnswerFromAnalysis({ analysis: args.analysis, projectId: args.projectId });
    steps.push(comp.action);
    if (args.analysis.recommendations?.length) {
      for (const rec of args.analysis.recommendations.slice(0, 2)) {
        if (rec.summary) steps.push(rec.summary);
      }
    }
  }

  if (args.evolution && args.ctx.hasEvolution) {
    const intel = evolutionIntelligence(args.evolution);
    if (intel.changePattern !== "STABLE" && intel.netChange != null && intel.netChange !== 0) {
      steps.push("Check the revision timeline — this deliverable has changed on this project.");
    }
  }

  if (steps.length === 0) {
    steps.push("Import completed projects and programme updates so Rana can give more specific guidance.");
  }

  return {
    layout: "what_to_do",
    answer: steps[0],
    steps: steps.slice(1),
  };
}

function buildStandardFromAnalysis(
  analysis: DeliverableIntelligenceAnalysis,
  projectId: string
): AskRanaResponse {
  const base = plannerAnswerFromAnalysis({ analysis, projectId });
  return {
    layout: "standard",
    answer: base.answer,
    why: base.why,
    evidence: base.evidence,
    action: base.action,
  };
}

function buildWorthReviewingResponse(
  analysis: DeliverableIntelligenceAnalysis,
  projectId: string
): AskRanaResponse {
  const base = plannerAnswerFromAnalysis({ analysis, projectId });
  const answer =
    base.answer.includes("review") || base.answer.includes("attention")
      ? base.answer
      : `Worth a review — ${base.answer.charAt(0).toLowerCase()}${base.answer.slice(1)}`;

  return {
    layout: "standard",
    answer,
    why: base.why,
    evidence: base.evidence,
    action: base.action,
  };
}

function buildUsuallyHappensResponse(
  analysis: DeliverableIntelligenceAnalysis,
  projectId: string
): AskRanaResponse {
  const expected = analysis.benchmark?.expectedDuration ?? null;
  const typical =
    expected?.mostLikelyDays ?? analysis.benchmark?.medianDuration ?? null;
  const range = expected?.rangeLabel ?? null;

  const answer = range
    ? `On similar work from completed projects, durations usually sit around ${range.toLowerCase()}.`
    : typical != null
      ? `On similar work from completed projects, durations usually complete in around ${Math.round(typical)} days.`
      : "Rana does not have enough completed projects yet to say what usually happens.";

  const base = plannerAnswerFromAnalysis({ analysis, projectId });

  return {
    layout: "standard",
    answer,
    why: base.why,
    evidence: base.evidence,
    action: base.action,
  };
}

function noDataStandardResponse(): AskRanaResponse {
  return {
    layout: "standard",
    answer: "Rana doesn't have enough information about this deliverable yet.",
    why: "Import a programme baseline or update on this project, and import completed projects elsewhere.",
    evidence: ["No completed project comparisons available", "No revision history on this project yet"],
    action: "Import a baseline or programme update for this project, and import completed projects when you can.",
  };
}

export function updateSessionFromTurn(
  session: AskRanaSessionContext,
  turn: { intent: AskRanaIntent; source: AskRanaSource; question: string }
): AskRanaSessionContext {
  const topic: AskRanaSessionContext["topic"] =
    turn.source === "both"
      ? "combined"
      : turn.source === "project_evolution"
        ? "evolution"
        : "comparison";

  return {
    lastIntent: turn.intent,
    lastSource: turn.source,
    lastQuestion: turn.question,
    topic,
  };
}

/** Answer one planner question — intent-specific layouts, no generic summary for every question. */
export function plannerAnswerForQuestion(args: {
  question: string;
  analysis: DeliverableIntelligenceAnalysis | null;
  evolution: DeliverableProjectEvolutionReport | null;
  projectId: string;
  session?: AskRanaSessionContext;
}): { source: AskRanaSource; intent: AskRanaIntent; response: AskRanaResponse } | null {
  const session = args.session ?? createAskRanaSession();
  const ctx = buildAskRanaContext(args);
  const intent = detectAskRanaIntent(args.question, session);
  const source = resolveEffectiveSource(intent, ctx);
  if (!source) return null;

  const { analysis, evolution, projectId } = args;

  // Intent-specific builders — never default everything to plannerAnswerFromDeliverable
  switch (intent) {
    case "what_changed":
    case "compare_baseline_latest":
      if (evolution) return { source, intent, response: buildWhatChangedResponse(evolution) };
      break;

    case "revision_history":
      if (evolution) return { source, intent, response: buildRevisionHistoryResponse(evolution) };
      break;

    case "why_changed":
      if (evolution) return { source, intent, response: buildWhyChangedResponse(evolution) };
      break;

    case "which_revision_changed_most":
      if (evolution) return { source, intent, response: buildWhichRevisionChangedResponse(evolution) };
      break;

    case "was_this_stable":
      if (evolution) return { source, intent, response: buildStabilityAssessmentResponse(evolution) };
      break;

    case "summarise_evolution":
      if (evolution) return { source, intent, response: buildEvolutionSummaryResponse(evolution) };
      break;

    case "duration_reasonable":
      if (analysis && ctx.hasPreviousProjects) {
        return { source, intent, response: buildDurationReasonableResponse(analysis, projectId) };
      }
      if (evolution) {
        return {
          source,
          intent,
          response: {
            layout: "standard",
            answer: missingComparisonNote(ctx),
            why: evolutionIntelligence(evolution).summary,
            evidence: [`${ctx.revisionCount} revision${ctx.revisionCount === 1 ? "" : "s"} on this project`],
            action: "Import completed projects to judge whether the duration is reasonable.",
          },
        };
      }
      break;

    case "compare_reference":
      if (analysis && ctx.hasPreviousProjects) {
        return { source, intent, response: buildCompareReferenceResponse(analysis, projectId, ctx) };
      }
      break;

    case "compare_previous":
    case "worth_reviewing":
      if (analysis && ctx.hasPreviousProjects) {
        const response =
          intent === "worth_reviewing"
            ? buildWorthReviewingResponse(analysis, projectId)
            : buildStandardFromAnalysis(analysis, projectId);
        return { source, intent, response };
      }
      break;

    case "usually_happens":
      if (analysis && ctx.hasPreviousProjects) {
        return { source, intent, response: buildUsuallyHappensResponse(analysis, projectId) };
      }
      break;

    case "explain_deliverable":
      return {
        source,
        intent,
        response: buildExplainCombinedResponse({ analysis, evolution, projectId, ctx }),
      };

    case "what_to_do":
      return {
        source,
        intent,
        response: buildWhatToDoResponse({ analysis, evolution, projectId, ctx }),
      };

    case "general":
    default:
      break;
  }

  // Source fallback when intent-specific data is missing
  if (source === "project_evolution" && evolution) {
    return { source, intent, response: buildWhatChangedResponse(evolution) };
  }

  if (source === "previous_projects" && analysis && ctx.hasPreviousProjects) {
    return { source, intent, response: buildStandardFromAnalysis(analysis, projectId) };
  }

  if (source === "both") {
    return {
      source,
      intent,
      response: buildExplainCombinedResponse({ analysis, evolution, projectId, ctx }),
    };
  }

  return { source, intent, response: noDataStandardResponse() };
}

/** @deprecated Use AskRanaResponse — kept for any legacy imports */
export type { PlannerAnswer };
