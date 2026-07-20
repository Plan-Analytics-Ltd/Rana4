import type { AskRanaConversationTurn } from "./askRana.types.js";
import type { PlannerQuery, PlannerQueryIntent } from "./askRanaPlannerQuery.types.js";
import { extractRevisionTarget, isBroadChangeQuestion } from "./askRanaConversationPolish.service.js";
import { isExecutivePlannerQuestion } from "./askRanaPlannerReasoning.service.js";

/** Expected response depth — independent from planner intent. */
export type PlannerResponseDepth =
  | "ONE_LINE"
  | "BRIEF"
  | "STANDARD"
  | "INVESTIGATION"
  | "REPORT";

export type FollowUpIntent =
  | "none"
  | "challenge"
  | "evidence_only"
  | "alternatives"
  | "ruling_out"
  | "timeline"
  | "pinpoint"
  | "deepen";

export type PlannerResponseDepthResult = {
  depth: PlannerResponseDepth;
  followUpIntent: FollowUpIntent;
  newInformationRequested: string;
  topicsAlreadyExplained: string[];
  hasDetailedPriorAnswer: boolean;
  plannerExpectation: string;
};

const REPORT_PATTERN =
  /\b(summar(?:y|ise|ize) everything|explain (?:fully|everything)|tell me everything|full review|review (?:this|the) (?:deliverable|programme)|walk me through everything)\b/i;

const INVESTIGATION_PATTERN =
  /\b(investigate|analys(?:e|is) (?:why|how|what)|find out what happened|dig into|look into why)\b/i;

const SUBSTANTIVE_WHY_PATTERN =
  /\bwhy\b.*\b(float|critical|duration|logic|relationship|lag|reduce|reduced|change|changed)\b/i;

const ONE_LINE_PATTERN =
  /^(?:which|what)\s+(?:update|revision)\b/i;

const CHALLENGE_PATTERN =
  /^(?:how do you know|really\??|why do you think that|what makes you say that)\b/i;

const EVIDENCE_SUPPORT_PATTERN =
  /\bwhat evidence supports\b/i;

const ALTERNATIVES_PATTERN =
  /\b(?:could there be another|other explanation|alternative explanation|what else could)\b/i;

const RULING_OUT_PATTERN =
  /\bwhat evidence rules|rules? that out|rule that out\b/i;

const TIMELINE_PATTERN =
  /\b(?:show me|show the timeline|revision timeline)\b/i;

const DEEPEN_PATTERN =
  /\b(?:investigate further|go deeper|dig deeper|tell me more|explain (?:that|this) further)\b/i;

const WHY_INTENTS = new Set<PlannerQueryIntent>([
  "why",
  "explain_change",
  "explain_criticality",
  "float_change",
  "logic_change",
  "criticality",
  "investigate",
  "how",
]);

function lastRanaTurn(conversation?: AskRanaConversationTurn[]): AskRanaConversationTurn | null {
  if (!conversation?.length) return null;
  const rana = conversation.filter((t) => t.role === "rana");
  return rana[rana.length - 1] ?? null;
}

function isFollowUpConversation(conversation?: AskRanaConversationTurn[]): boolean {
  return (conversation?.some((t) => t.role === "rana") ?? false);
}

export function hasDetailedPriorAnswer(conversation?: AskRanaConversationTurn[]): boolean {
  const last = lastRanaTurn(conversation);
  if (!last) return false;
  const words = last.content.trim().split(/\s+/).length;
  return words > 60 || /###\s/.test(last.content) || last.content.length > 400;
}

/** Extract topics already covered in recent Rana answers. */
export function extractExplainedTopics(conversation?: AskRanaConversationTurn[]): string[] {
  if (!conversation?.length) return [];
  const recentRana = conversation
    .filter((t) => t.role === "rana")
    .slice(-2)
    .map((t) => t.content.toLowerCase());

  const topics: string[] = [];
  const corpus = recentRana.join(" ");

  if (/\b(?:reduced|increased|from \d+ to \d+|baseline|latest duration|duration (?:stayed|remained|unchanged))\b/.test(corpus)) {
    topics.push("duration evolution and baseline/latest figures");
  }
  if (/\b(?:became critical|left the critical path|criticality|critical path)\b/.test(corpus)) {
    topics.push("criticality history and current critical status");
  }
  if (/\b(?:scheduling flexibility|float|lost flexibility|gained flexibility)\b/.test(corpus)) {
    topics.push("float progression and scheduling flexibility");
  }
  if (/\b(?:relationship|dependency|finish-to-start|lag)\b/i.test(corpus)) {
    topics.push("relationship and lag changes");
  }
  if (/\b(?:update \d+|revision|timeline|across \d+ (?:updates|revisions))\b/i.test(corpus)) {
    topics.push("revision-by-revision timeline");
  }
  if (/\b(?:strongest|rules out|ruled out|coincid|interpretation)\b/.test(corpus)) {
    topics.push("investigation conclusion and interpretation");
  }
  if (/\b0 comparable\b|\bno (?:comparable )?completed\b|\blimited.*benchmark\b|\bisn't enough completed\b/i.test(corpus)) {
    topics.push("limited completed-project benchmarking");
  }
  if (/\badditional structural works\b/i.test(corpus)) {
    topics.push("Additional Structural Works remaining-work pressure");
  }
  if (/\b(?:four|4)\s+work packages?\b[\s\S]{0,60}\bincreas/i.test(corpus)) {
    topics.push("concentrated remaining-work increases across a few work packages");
  }
  if (/\bmy assessment\b|\boverall assessment\b|\bprogramme (?:is |looks |showing )/i.test(corpus)) {
    topics.push("overall programme health assessment");
  }

  return [...new Set(topics)];
}

export function detectFollowUpIntent(question: string): FollowUpIntent {
  const q = question.toLowerCase().trim();

  if (ONE_LINE_PATTERN.test(q)) return "pinpoint";
  if (CHALLENGE_PATTERN.test(q)) return "challenge";
  if (EVIDENCE_SUPPORT_PATTERN.test(q)) return "evidence_only";
  if (ALTERNATIVES_PATTERN.test(q)) return "alternatives";
  if (RULING_OUT_PATTERN.test(q)) return "ruling_out";
  if (TIMELINE_PATTERN.test(q)) return "timeline";
  if (DEEPEN_PATTERN.test(q)) return "deepen";

  if (/^what evidence\??$/.test(q)) return "evidence_only";
  if (/^(why|how)\??$/.test(q)) return "challenge";

  return "none";
}

function describeNewInformation(intent: FollowUpIntent, depth: PlannerResponseDepth, question: string): string {
  switch (intent) {
    case "challenge":
      return "Brief justification for the previous conclusion — not a new investigation.";
    case "evidence_only":
      return "Supporting evidence facts only — do not repeat the prior explanation.";
    case "alternatives":
      return "Alternative explanations the evidence allows or excludes — do not repeat the main conclusion.";
    case "ruling_out":
      return "What the evidence rules out — ruling logic only, no repeated timeline.";
    case "timeline":
      return "Timeline detail the planner has not yet seen — do not repeat the summary conclusion.";
    case "pinpoint":
      return "A pinpoint answer (which update/revision) — one fact.";
    case "deepen":
      return "Additional depth beyond the previous answer — new connections only.";
    default:
      if (depth === "ONE_LINE") return "A single direct answer.";
      if (depth === "BRIEF") return "One short paragraph answering exactly what was asked.";
      if (depth === "STANDARD") return "A focused answer with brief supporting detail if useful.";
      if (depth === "INVESTIGATION") return "A connected investigation across available evidence.";
      return "A full structured report covering all relevant evidence.";
  }
}

function depthFromFollowUp(
  intent: FollowUpIntent,
  hasPriorDetail: boolean
): PlannerResponseDepth {
  if (!hasPriorDetail && intent === "deepen") return "INVESTIGATION";

  switch (intent) {
    case "pinpoint":
      return "ONE_LINE";
    case "challenge":
      return "BRIEF";
    case "evidence_only":
      return "STANDARD";
    case "alternatives":
    case "ruling_out":
      return "BRIEF";
    case "timeline":
      return "STANDARD";
    case "deepen":
      return "INVESTIGATION";
    default:
      return hasPriorDetail ? "BRIEF" : "STANDARD";
  }
}

function depthFromFirstTurn(question: string, plannerQuery: PlannerQuery): PlannerResponseDepth {
  const q = question.toLowerCase().trim();
  const wordCount = q.split(/\s+/).length;

  if (REPORT_PATTERN.test(q) || plannerQuery.intent === "summary") return "REPORT";
  if (isExecutivePlannerQuestion(question)) return "REPORT";
  if (INVESTIGATION_PATTERN.test(q) || plannerQuery.intent === "investigate") return "INVESTIGATION";

  if (
    SUBSTANTIVE_WHY_PATTERN.test(q) ||
    (WHY_INTENTS.has(plannerQuery.intent) &&
      /\b(float|critical|logic|relationship|lag|duration|change)\b/.test(q))
  ) {
    return "INVESTIGATION";
  }

  if (ONE_LINE_PATTERN.test(q) || (wordCount <= 5 && /\?$/.test(q))) return "ONE_LINE";

  if (
    /\b(reasonable|normal|realistic|compare|typical)\b/.test(q) ||
    plannerQuery.intent === "is_reasonable" ||
    plannerQuery.intent === "comparison"
  ) {
    return wordCount <= 8 ? "BRIEF" : "STANDARD";
  }

  if (wordCount <= 8 && /\?$/.test(q)) return "BRIEF";

  if (/\boverview\b/.test(q)) return "REPORT";

  return "STANDARD";
}

function buildPlannerExpectation(args: {
  depth: PlannerResponseDepth;
  followUpIntent: FollowUpIntent;
  hasDetailedPriorAnswer: boolean;
}): string {
  const depthExpectations: Record<PlannerResponseDepth, string> = {
    ONE_LINE: "The planner only wants a quick pinpoint clarification.",
    BRIEF:
      "The planner wants a brief follow-up — they likely already have context from earlier in the conversation.",
    STANDARD: "The planner wants a focused answer with supporting detail as needed.",
    INVESTIGATION: "The planner wants a thorough investigation across the available evidence.",
    REPORT: "The planner wants an executive programme assessment — judgement first, then reasons, evidence, recommendation, and confidence.",
  };

  let expectation = depthExpectations[args.depth];

  if (args.hasDetailedPriorAnswer) {
    expectation += " They already received a detailed answer — focus on what is newly asked; do not restart.";
  }

  switch (args.followUpIntent) {
    case "challenge":
      expectation +=
        " They are challenging or asking how you know — briefly support your previous conclusion.";
      break;
    case "evidence_only":
      expectation += " They want supporting evidence, not a repeat of the prior explanation.";
      break;
    case "alternatives":
      expectation += " They want alternative explanations the evidence allows or excludes.";
      break;
    case "ruling_out":
      expectation += " They want to know what the evidence rules out.";
      break;
    case "timeline":
      expectation += " They want timeline detail not yet covered.";
      break;
    case "pinpoint":
      expectation += " They want a pinpoint answer (which update or revision).";
      break;
    case "deepen":
      expectation += " They want additional depth beyond the previous answer.";
      break;
    default:
      break;
  }

  return expectation;
}

/** Classify how much detail the planner actually needs — independent from intent. */
export function classifyPlannerResponseDepth(args: {
  question: string;
  plannerQuery: PlannerQuery;
  conversation?: AskRanaConversationTurn[];
}): PlannerResponseDepthResult {
  const followUpIntent = detectFollowUpIntent(args.question);
  const hasPriorDetail = hasDetailedPriorAnswer(args.conversation);
  const isFollowUp = isFollowUpConversation(args.conversation);
  const topicsAlreadyExplained = isFollowUp ? extractExplainedTopics(args.conversation) : [];

  let depth: PlannerResponseDepth;

  if (isFollowUp && followUpIntent !== "none") {
    depth = depthFromFollowUp(followUpIntent, hasPriorDetail);
  } else if (isFollowUp && hasPriorDetail) {
    const q = args.question.toLowerCase().trim();
    if (q.length < 30 || /^(why|how|and|what about)\??$/.test(q)) {
      depth = "BRIEF";
    } else if (REPORT_PATTERN.test(q)) {
      depth = "REPORT";
    } else if (INVESTIGATION_PATTERN.test(q) || DEEPEN_PATTERN.test(q)) {
      depth = "INVESTIGATION";
    } else {
      depth = "STANDARD";
    }
  } else {
    depth = depthFromFirstTurn(args.question, args.plannerQuery);
  }

  if (REPORT_PATTERN.test(args.question)) depth = "REPORT";
  if (INVESTIGATION_PATTERN.test(args.question) && !hasPriorDetail) depth = "INVESTIGATION";
  if (followUpIntent === "deepen") depth = "INVESTIGATION";

  const newInformationRequested = describeNewInformation(followUpIntent, depth, args.question);

  let plannerExpectation = buildPlannerExpectation({
    depth,
    followUpIntent,
    hasDetailedPriorAnswer: hasPriorDetail,
  });

  if (isBroadChangeQuestion(args.question, args.plannerQuery)) {
    plannerExpectation +=
      " They asked what changed without naming an attribute — synthesise recorded changes (remaining work, planning, float, criticality, logic) into a coherent story; when only one attribute moved, note the others did not.";
  }

  if (isExecutivePlannerQuestion(args.question)) {
    plannerExpectation +=
      " Executive question — open with a clear overall assessment, then key reasons, brief evidence, what you would do next, and confidence/limitations last (≤5 sections).";
  }

  const targetRevision = extractRevisionTarget(args.question);
  if (targetRevision) {
    plannerExpectation +=
      ` They asked about ${targetRevision} specifically — lead with that revision only; add neighbouring revision context only if it helps explain the answer.`;
  }

  return {
    depth,
    followUpIntent,
    newInformationRequested,
    topicsAlreadyExplained,
    hasDetailedPriorAnswer: hasPriorDetail,
    plannerExpectation,
  };
}

export function depthAllowsFullInvestigation(depth: PlannerResponseDepth): boolean {
  return depth === "INVESTIGATION" || depth === "REPORT";
}
