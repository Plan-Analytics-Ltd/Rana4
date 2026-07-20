/**
 * Plain-English language + derivation helpers for the "What We've Learned" dashboard.
 *
 * These helpers translate internal intelligence data into planner-facing language.
 * They never invent numbers — every value comes from the intelligence engine.
 *
 * Vocabulary rules (deliberately enforced here):
 * - No "benchmark", "median", "percentile", "IQR", "snapshot", "fingerprint",
 *   "confidence", "evidence layer", "scoring", "clustering", "duration normalisation".
 * - Prefer: "similar work from previous projects", "typical planned duration",
 *   "how reliable is this", "how much project history", "what usually happens".
 */

import type {
  DeliverableKnowledgeProfile,
  DeliverableOutcomeProfile,
  DeliverableReliabilityProfile,
  DeliverableIntelligenceAnalysis,
  DeliverableProjectEvolutionReport,
  IntelligenceTrustProfile,
  IntelligenceTrustExplanation,
  LearnedInsight,
} from "@/lib/api";

export type UnderstandingLevel = "well" | "reasonable" | "limited" | "single";

export type UnderstandingSummary = {
  level: UnderstandingLevel;
  label: string;
  tone: "good" | "moderate" | "low";
};

/** How well Rana understands a type of work — plain language, no "maturity" jargon. */
export function understandingFor(profile: {
  learningMaturity?: string;
  projectCount?: number;
  sampleSize?: number;
}): UnderstandingSummary {
  const projects = profile.projectCount ?? 0;
  const samples = profile.sampleSize ?? 0;
  if (projects <= 1) {
    return { level: "single", label: "Based on only one project", tone: "low" };
  }
  if (profile.learningMaturity === "WELL_KNOWN" && samples >= 8) {
    return { level: "well", label: "Well understood", tone: "good" };
  }
  if (profile.learningMaturity === "MODERATE" || samples >= 4) {
    return { level: "reasonable", label: "Reasonably understood", tone: "moderate" };
  }
  return { level: "limited", label: "Limited history available", tone: "low" };
}

/** "How reliable is this?" — replaces the word "confidence". */
export function reliabilityWord(level: string | null | undefined): string {
  if (level === "HIGH") return "Reliable";
  if (level === "MEDIUM") return "Fairly reliable";
  if (level === "LOW") return "Early indication";
  return "Being learned";
}

export function reliabilityTone(level: string | null | undefined): "good" | "moderate" | "low" {
  if (level === "HIGH") return "good";
  if (level === "MEDIUM") return "moderate";
  return "low";
}

/** Typical duration in plain words. */
export function typicalDurationPhrase(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return "Not enough completed projects yet";
  const rounded = Math.round(days);
  if (rounded <= 0) return "Usually a milestone (no duration)";
  return `About ${rounded} ${rounded === 1 ? "day" : "days"}`;
}

/**
 * How much a type of work varies between previous projects.
 * Uses the spread of durations seen — never shown as a raw wide range.
 */
export function variationPhrase(profile: {
  minimumDuration?: number | null;
  maximumDuration?: number | null;
  medianDuration?: number | null;
  averageDuration?: number | null;
  predictabilityScore?: number | null;
}): { label: string; tone: "good" | "moderate" | "low" } {
  const predictability = profile.predictabilityScore;
  if (predictability != null && Number.isFinite(predictability)) {
    if (predictability >= 0.75) return { label: "Very consistent", tone: "good" };
    if (predictability >= 0.5) return { label: "Fairly consistent", tone: "moderate" };
    return { label: "Varies a lot between projects", tone: "low" };
  }
  const min = profile.minimumDuration;
  const max = profile.maximumDuration;
  const mid = profile.medianDuration ?? profile.averageDuration;
  if (min != null && max != null && mid != null && mid > 0) {
    const spread = (max - min) / mid;
    if (spread <= 0.5) return { label: "Very consistent", tone: "good" };
    if (spread <= 1.5) return { label: "Some variation", tone: "moderate" };
    return { label: "Varies a lot between projects", tone: "low" };
  }
  return { label: "Still learning the pattern", tone: "moderate" };
}

/** How often this type of work runs to plan — plain language, from reliability data. */
export function reliabilityStory(profile: DeliverableReliabilityProfile): string {
  const overrun = Math.round(profile.overrunFrequency);
  const onTarget = Math.round(profile.onTargetFrequency);
  const under = Math.round(profile.underrunFrequency);
  if (overrun >= 50) return `Usually takes longer than planned (${overrun}% of the time)`;
  if (onTarget >= 45) return `Usually stays close to plan (${onTarget}% on target)`;
  if (under >= 45) return `Often finishes earlier than planned (${under}% of the time)`;
  return "Mixed track record against the plan";
}

export type PredictabilityRank = {
  label: string;
  typical: string;
  story: string;
  reliability: string;
  classification: string;
};

/** Sort reliability profiles into most / least predictable work types. */
export function rankPredictability(
  reliability: DeliverableReliabilityProfile[],
  outcomes: DeliverableOutcomeProfile[]
): { mostPredictable: PredictabilityRank[]; leastPredictable: PredictabilityRank[] } {
  const outcomeByClass = new Map(outcomes.map((o) => [o.classification, o]));
  const withScore = reliability
    .filter((r) => r.sampleSize >= 2)
    .map((r) => {
      const outcome = outcomeByClass.get(r.classification);
      const typicalDays =
        outcome?.historicalMedianDuration ??
        outcome?.predictedMostLikelyDuration ??
        r.actualAverageDuration ??
        r.plannedAverageDuration ??
        null;
      return {
        classification: r.classification,
        label: r.label,
        score: r.predictabilityScore ?? r.reliabilityScore ?? 0,
        typical: typicalDurationPhrase(typicalDays),
        story: reliabilityStory(r),
        reliability: reliabilityWord(r.confidenceLevel),
      };
    })
    .sort((a, b) => b.score - a.score);

  return {
    mostPredictable: withScore.slice(0, 4),
    leastPredictable: [...withScore].reverse().slice(0, 4),
  };
}

/** Turn a learned insight into a single planner-facing headline. */
export function insightHeadline(insight: LearnedInsight): string {
  const subject = insight.classification
    ? humanClassification(insight.classification)
    : insight.category ?? "This type of work";
  switch (insight.insightType) {
    case "DURATION_OVERRUN":
      return `${subject} usually takes longer than planned`;
    case "DURATION_PREDICTABILITY":
      return `${subject} usually finishes close to plan`;
    case "FLOAT_CONSUMPTION":
      return `${subject} often uses up its schedule buffer`;
    case "DRIVER_STRENGTH":
      return insight.title.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    case "RECURRING_LESSON":
      return `${subject} — a pattern seen on several projects`;
    case "FORECAST_RELIABILITY":
      return `${subject} — estimates often match what actually happened`;
    case "OUTCOME_PREDICTION":
      return `${subject} — what usually happens on similar projects`;
    default:
      return insight.title;
  }
}

/** Convert a raw classification token into readable words. Never surfaces OTHER. */
export function humanClassification(classification: string | null | undefined): string {
  if (!classification || classification.toUpperCase() === "OTHER") return "Unclassified work";
  return classification
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Group deliverable types by how well Rana understands them. */
export function groupByUnderstanding(profiles: DeliverableKnowledgeProfile[]): {
  well: DeliverableKnowledgeProfile[];
  reasonable: DeliverableKnowledgeProfile[];
  limited: DeliverableKnowledgeProfile[];
} {
  const well: DeliverableKnowledgeProfile[] = [];
  const reasonable: DeliverableKnowledgeProfile[] = [];
  const limited: DeliverableKnowledgeProfile[] = [];
  for (const p of profiles) {
    const u = understandingFor(p);
    if (u.level === "well") well.push(p);
    else if (u.level === "reasonable") reasonable.push(p);
    else limited.push(p);
  }
  return { well, reasonable, limited };
}

/** Plain-English labels for the kinds of things that most often need reviewing. */
export function reviewThemeLabel(recommendationType: string, fallback: string): string {
  const key = recommendationType.toUpperCase();
  if (key.includes("DURATION")) return "Duration assumptions";
  if (key.includes("SEQUENC") || key.includes("LOGIC")) return "Sequencing and logic";
  if (key === "LOW_CONFIDENCE" || key.includes("LIMITED_EVIDENCE")) {
    return "Limited historical evidence";
  }
  if (key.includes("EVIDENCE") || key.includes("CONFIDENCE") || key.includes("LOW")) {
    return "Limited historical evidence";
  }
  if (key.includes("VARIATION") || key.includes("VARIANCE") || key.includes("RANGE")) return "Large variation between projects";
  if (key.includes("FLOAT") || key.includes("BUFFER")) return "Schedule buffer";
  return fallback;
}

export type TrustUnderstanding = {
  classification: string;
  label: string;
  understanding: string;
  tone: "good" | "moderate" | "low";
};

/** Trust profiles expressed as "how well understood / trustworthy". */
export function trustUnderstanding(profile: IntelligenceTrustProfile): TrustUnderstanding {
  const projects = profile.evidenceStrength.projectCount;
  const band = profile.trustBand;
  let label = "Limited history available";
  let tone: "good" | "moderate" | "low" = "low";
  if (projects <= 1) {
    label = "Based on only one project";
    tone = "low";
  } else if (band === "HIGH_TRUST") {
    label = "Well understood";
    tone = "good";
  } else if (band === "MODERATE_TRUST") {
    label = "Reasonably understood";
    tone = "moderate";
  }
  return {
    classification: profile.classification,
    label: profile.label,
    understanding: label,
    tone,
  };
}

export const TONE_CLASSES: Record<"good" | "moderate" | "low", string> = {
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  moderate: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export type PlannerAnswer = {
  answer: string;
  why: string;
  evidence: string[];
  action: string;
};

/** Adaptive heading when "projects" count is shown to planners. */
export function adaptiveProjectsHeading(projectCount: number): string {
  if (projectCount <= 0) return "What Rana can learn from completed projects";
  if (projectCount === 1) return "What Rana learned from this completed project";
  return "What Rana has learned across projects";
}

/** Evidence basis — always show both project count and work package count when known. */
export function evidenceBasisPhrase(workPackages: number, projects: number): string {
  if (workPackages <= 0 && projects <= 0) return "No completed project history yet";
  const wp =
    workPackages > 0
      ? `${workPackages} work package${workPackages === 1 ? "" : "s"}`
      : null;
  const pj =
    projects > 0
      ? `${projects} completed project${projects === 1 ? "" : "s"}`
      : null;
  if (wp && pj) return `Based on ${pj} · ${wp}`;
  if (pj) return `Based on ${pj}`;
  if (wp) return `Based on ${wp}`;
  return "Limited history available";
}

/** Short label for lesson / pattern evidence footers. */
export function lessonEvidencePhrase(workPackages: number, projects?: number): string {
  if (projects != null && projects > 0 && workPackages > 0) {
    return evidenceBasisPhrase(workPackages, projects);
  }
  if (workPackages > 0) {
    return `Based on ${workPackages} work package${workPackages === 1 ? "" : "s"} from previous projects`;
  }
  return "Based on limited previous project history";
}

/** Project evolution availability for health surfaces. */
export function projectEvolutionStateLabel(revisionCount: number): { label: string; detail: string } {
  if (revisionCount <= 0) {
    return {
      label: "Not started",
      detail: "Import a baseline or programme update to track changes on this project.",
    };
  }
  if (revisionCount === 1) {
    return {
      label: "Started",
      detail: "1 revision imported — import programme updates to build a timeline.",
    };
  }
  return {
    label: "Available",
    detail: `${revisionCount} revisions imported`,
  };
}

/** Previous-project comparison availability for health surfaces. */
export function previousProjectsComparisonStateLabel(args: {
  hasComparison: boolean;
  completedProjectCount: number;
  reviewCount?: number;
}): { label: string; detail: string } {
  if (!args.hasComparison || args.completedProjectCount === 0) {
    return {
      label: "Not available yet",
      detail: "Import completed projects to compare against previous work.",
    };
  }
  if (args.reviewCount != null && args.reviewCount > 0) {
    return {
      label: `${args.reviewCount} worth reviewing`,
      detail: `Compared with work from ${args.completedProjectCount} completed project${args.completedProjectCount === 1 ? "" : "s"}.`,
    };
  }
  return {
    label: "Mostly in line",
    detail: `Compared with work from ${args.completedProjectCount} completed project${args.completedProjectCount === 1 ? "" : "s"}.`,
  };
}

function distinctCount(values: Array<string | null | undefined>): number {
  const s = new Set<string>();
  for (const v of values) if (typeof v === "string" && v.trim()) s.add(v);
  return s.size;
}

/** Turn a deliverable analysis into a planner-style answer (Answer → Why → Evidence → Action). */
export function plannerAnswerFromAnalysis(args: {
  analysis: DeliverableIntelligenceAnalysis;
  projectId: string;
}): PlannerAnswer {
  const { analysis, projectId } = args;

  const sampleSize = analysis.benchmark?.sampleSize ?? analysis.evidence?.sampleSize ?? 0;
  const currentDays = analysis.currentDurationDays;
  const outlierStatus = analysis.outlier?.status ?? null;
  const positionLabel =
    analysis.outlier?.effectivePositionLabel ??
    analysis.outlier?.positionLabel ??
    null;

  const expected = analysis.benchmark?.expectedDuration ?? null;
  const typical =
    expected?.mostLikelyDays ??
    analysis.benchmark?.medianDuration ??
    null;
  const typicalPhrase =
    expected?.rangeLabel ??
    (typical != null && Number.isFinite(typical) ? `around ${Math.round(typical)} days` : "a typical planned duration");

  const matched = analysis.evidence?.matchedDeliverables ?? [];
  const fromOtherProjects = matched.filter((m) => m.projectId !== projectId);
  const otherProjectCount = distinctCount(fromOtherProjects.map((m) => m.projectId));

  const answer =
    !outlierStatus || sampleSize === 0
      ? "There aren’t enough completed projects to compare this with yet."
      : outlierStatus === "NORMAL"
        ? "This planned duration looks normal compared with similar work from completed projects."
        : outlierStatus === "SLIGHTLY_HIGH" || outlierStatus === "SLIGHTLY_LOW"
          ? "Worth a review — the planned duration is a bit different to what usually happens on similar projects."
          : "This deserves attention — the planned duration is materially different to what usually happens on similar projects.";

  const whyParts: string[] = [];
  if (currentDays != null) {
    whyParts.push(`Your current planned duration is ${Math.round(currentDays)} days.`);
  }
  if (expected?.rangeLabel) {
    whyParts.push(`Similar work on completed projects usually sits around ${expected.rangeLabel.toLowerCase()} planned.`);
  } else if (typical != null) {
    whyParts.push(`Similar work on completed projects usually has a typical planned duration of ${typicalPhrase}.`);
  }
  if (positionLabel) {
    const clean = positionLabel
      .replace(/historical benchmark/gi, "completed projects")
      .replace(/benchmark/gi, "completed projects");
    whyParts.push(clean.endsWith(".") ? clean : `${clean}.`);
  }
  const why = whyParts.join(" ") || "Rana compared this deliverable with similar work from completed projects.";

  const evidence: string[] = [];
  if (sampleSize > 0) {
    evidence.push(evidenceBasisPhrase(sampleSize, otherProjectCount));
  } else {
    evidence.push("No completed projects have been imported for comparison yet.");
  }
  if (analysis.observations?.length) {
    evidence.push(
      `${analysis.observations.length} observation${analysis.observations.length === 1 ? "" : "s"} noted from the comparison.`
    );
  }

  const recCount = analysis.recommendations?.length ?? 0;
  const limited = analysis.benchmark?.confidenceLevel === "LOW" || sampleSize <= 2;
  const action =
    limited
      ? "Treat this as early guidance — import more completed projects if you can, and review the supporting work packages."
      : recCount > 0
        ? "Review the recommendations below and sanity-check the planned duration and sequencing with the team."
        : outlierStatus === "NORMAL"
          ? "No change needed based on completed projects — keep as-is unless the team has new information."
          : "Review the assumptions with the team and decide whether the planned duration or approach should change.";

  return { answer, why, evidence, action };
}

/** Combined deliverable answer — uses previous projects and project evolution as appropriate. */
export function plannerAnswerFromDeliverable(args: {
  analysis: DeliverableIntelligenceAnalysis | null;
  evolution: DeliverableProjectEvolutionReport | null;
  projectId: string;
}): PlannerAnswer | null {
  const { analysis, evolution, projectId } = args;
  if (!analysis && !evolution) return null;

  const comparison = analysis ? plannerAnswerFromAnalysis({ analysis, projectId }) : null;
  const revCount = evolution?.revisions.length ?? 0;
  const hasEvolution = revCount > 1;
  const initial = evolution?.evolution.initialDuration;
  const latest = evolution?.evolution.finalDuration;
  const largestChange = evolution?.evolution.largestChangeDays;

  if (!comparison && hasEvolution && evolution) {
    const changed = initial != null && latest != null && initial !== latest;
    return {
      answer: changed
        ? `Remaining work on this deliverable has changed from ${initial} to ${latest} days across ${revCount} programme revisions.`
        : `Remaining work on this deliverable has stayed at ${latest ?? initial ?? "its current"} days across ${revCount} programme revisions.`,
      why:
        evolution.timeline.evolutionSummary ??
        "Rana tracked how remaining work changed each time you imported a programme update on this project.",
      evidence: [
        `${revCount} revisions imported on this project`,
        largestChange != null && largestChange > 0
          ? `Largest single revision change in remaining work: ${largestChange} day${largestChange === 1 ? "" : "s"}`
          : "No large single-step changes in remaining work between revisions",
      ],
      action: changed
        ? "Review the revision timeline and confirm the latest remaining work reflects the programme state."
        : "No change flagged from project history — continue with the current plan unless something has shifted on site.",
    };
  }

  if (!comparison) return null;

  if (!hasEvolution || !evolution) {
    return comparison;
  }

  const evolutionEvidence: string[] = [`${revCount} revisions on this project`];
  if (initial != null && latest != null && initial !== latest) {
    evolutionEvidence.push(`Remaining work changed from ${initial} to ${latest} days on this project`);
  } else if (latest != null) {
    evolutionEvidence.push(`Currently ${latest} days remaining work on this project`);
  }

  const combinedAnswer =
    initial != null && latest != null && initial !== latest
      ? `${comparison.answer} On this project, remaining work has also changed from ${initial} to ${latest} days across ${revCount} revisions.`
      : comparison.answer;

  return {
    answer: combinedAnswer,
    why: [comparison.why, evolution.timeline.evolutionSummary].filter(Boolean).join(" "),
    evidence: [...comparison.evidence, ...evolutionEvidence],
    action:
      comparison.action.startsWith("No change needed") && initial != null && latest != null && initial !== latest
        ? "Worth checking the revision timeline — remaining work on this project has changed even though completed-project planned durations look normal."
        : comparison.action,
  };
}

/** Plain-language strength for project similarity — never expose raw scores. */
export function projectSimilarityPhrase(score: number): string {
  if (score >= 75) return "Very similar";
  if (score >= 55) return "Quite similar";
  if (score >= 35) return "Somewhat similar";
  if (score > 0) return "Loosely similar";
  return "Limited overlap";
}

/** Turn matched field keys into planner-readable phrases. */
export function matchedFieldPhrase(field: string): string {
  const key = field.toLowerCase();
  if (key === "sector") return "same sector";
  if (key === "projecttype") return "same project type";
  if (key === "stage") return "same stage";
  if (key === "procurementroute") return "same procurement route";
  if (key === "complexity") return "similar complexity";
  if (key.includes("classification")) return "similar work types";
  if (key.includes("discipline")) return "similar disciplines";
  return field.replace(/([A-Z])/g, " $1").trim().toLowerCase();
}

/** Summarise why two projects are similar — uses engine explanations when present. */
export function projectSimilaritySummary(match: {
  explanations: string[];
  matchedFields: string[];
}): string {
  if (match.explanations.length > 0) {
    return match.explanations.slice(0, 3).join(". ") + (match.explanations.length > 3 ? "." : "");
  }
  if (match.matchedFields.length > 0) {
    return `Shared ${match.matchedFields.map(matchedFieldPhrase).join(", ")}.`;
  }
  return "Some programme characteristics overlap.";
}

/** Planner-facing label for organisational pattern types. */
export function organisationalPatternLabel(type: string, fallback: string): string {
  const key = type.toUpperCase();
  if (key.includes("SCOPE_GROWTH")) return "Usually grows during the programme";
  if (key.includes("DURATION_REDUCTION")) return "Often reduced before completion";
  if (key.includes("PROLONGED")) return "Often takes longer than planned";
  if (key.includes("VOLATILITY")) return "Changes frequently between revisions";
  if (key.includes("UNDERESTIMATION")) return "Often underestimated";
  return fallback;
}

/** Category labels for organisation knowledge entries. */
export function orgKnowledgeCategoryLabel(category: string): string {
  const key = category.toLowerCase();
  if (key.includes("stable")) return "Usually stays close to plan";
  if (key.includes("volatile") || key.includes("growth")) return "Often grows";
  if (key.includes("reduced")) return "Often reduced";
  return "Pattern";
}

/** Format a lesson from a learned insight — evidence-backed only. */
export function lessonFromInsight(insight: LearnedInsight): { title: string; detail: string; sampleSize: number } {
  return {
    title: insightHeadline(insight),
    detail: insight.observation || insight.summary,
    sampleSize: insight.sampleSize,
  };
}
