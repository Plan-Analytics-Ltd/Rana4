import type { AskRanaConversationTurn, AskRanaEvidencePackage } from "./askRana.types.js";
import { hasEvolutionWithoutComparison } from "./askRanaPartialEvidence.service.js";
import {
  humanizeBaselineOnlyGap,
  isBaselineOnlyConversationState,
  isChangeOrRevisionQuestion,
  shouldHumanizeGap,
} from "./askRanaBaselineOnlyConversation.service.js";
import {
  extractExplainedTopics,
  type PlannerResponseDepth,
} from "./askRanaResponseDepth.service.js";
import type { PlannerEvidenceScope } from "./askRanaPlannerQuery.types.js";
import type { PlannerQuery } from "./askRanaPlannerQuery.types.js";
import { humanPlannerScopeLabel } from "./askRanaPlannerQuery.types.js";
export type AskRanaResponseStyle = "brief" | "standard" | "detailed";

export type AskRanaQuestionTopic =
  | "evolution"
  | "comparison"
  | "recommendation"
  | "out_of_scope_plant"
  | "out_of_scope_people"
  | "general";

export type AskRanaVerificationResult = {
  corrections: string[];
  relevantMissingEvidence: string[];
  responseStyle: AskRanaResponseStyle;
  isFollowUp: boolean;
  doNotRepeat: string[];
  topic: AskRanaQuestionTopic;
  instructionBlock: string;
};

type DurationSpan = {
  fromDays: number;
  toDays: number;
  claimedDirection: "increase" | "decrease" | "unchanged" | null;
};

function parseDurationSpan(question: string): DurationSpan | null {
  const q = question.toLowerCase();

  const fromTo =
    q.match(/\bfrom\s+(\d+)\s+(?:to|→|-)\s+(\d+)\b/) ??
    q.match(/\b(\d+)\s+(?:to|→|-)\s+(\d+)\s+days?\b/);
  if (fromTo) {
    const fromDays = Number(fromTo[1]);
    const toDays = Number(fromTo[2]);
    let claimedDirection: DurationSpan["claimedDirection"] = null;
    if (/\b(increas|grew|rose|longer|extended)\b/.test(q)) claimedDirection = "increase";
    else if (/\b(reduc|decreas|shrank|shorter|dropped|cut)\b/.test(q)) claimedDirection = "decrease";
    else if (/\b(unchanged|stayed|same|stable)\b/.test(q)) claimedDirection = "unchanged";
    else if (toDays > fromDays) claimedDirection = "increase";
    else if (toDays < fromDays) claimedDirection = "decrease";
    else claimedDirection = "unchanged";
    return { fromDays, toDays, claimedDirection };
  }

  const toOnly = q.match(/\b(?:increase|raise|extend|grow)\b.*\bto\s+(\d+)\s+days?\b/);
  if (toOnly) {
    return { fromDays: NaN, toDays: Number(toOnly[1]), claimedDirection: "increase" };
  }

  return null;
}

function detectQuestionTopic(question: string): AskRanaQuestionTopic {
  const q = question.toLowerCase();
  if (/\b(crane|plant|equipment|machinery|colour|color|excavator|tower)\b/.test(q)) {
    return "out_of_scope_plant";
  }
  if (
    /\b(subcontractor|designer|architect|who designed|who caused|who is responsible|consultant|engineer)\b/.test(
      q
    )
  ) {
    return "out_of_scope_people";
  }
  if (/\b(reasonable|normal|realistic|compare|worry|should i increase|should i reduce|typical)\b/.test(q)) {
    return "comparison";
  }
  if (/\b(why|change|changed|revision|evolution|reduce|reduced|increase|increased|stable|timeline|baseline)\b/.test(q)) {
    return "evolution";
  }
  if (/\b(recommend|what should|do next|review)\b/.test(q)) {
    return "recommendation";
  }
  return "general";
}

function detectResponseStyle(question: string, topic: AskRanaQuestionTopic): AskRanaResponseStyle {
  const q = question.toLowerCase().trim();
  const wordCount = q.split(/\s+/).length;

  if (
    topic === "out_of_scope_plant" ||
    topic === "out_of_scope_people" ||
    /^(is there|are there|who|what colour|what color)\b/.test(q) ||
    (wordCount <= 8 && /\?$/.test(q))
  ) {
    return "brief";
  }

  if (/\b(explain everything|tell me everything|summarise|summarize everything|overview)\b/.test(q)) {
    return "detailed";
  }

  return "standard";
}

function isFollowUpQuestion(question: string, conversation?: AskRanaConversationTurn[]): boolean {
  if (!conversation?.length) return false;
  const q = question.toLowerCase().trim();
  if (/^(why|how|and|what about|compared to what|against what)\??$/.test(q)) return true;
  if (/\b(investigate further|go deeper|what evidence supports|tell me more|can you investigate)\b/.test(q)) {
    return true;
  }
  if (q.length < 40 && /\b(that|it|this)\b/.test(q)) return true;
  return false;
}

const WORD_NUMBER: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** "four" / "4" -> 4, for count phrases that mix numerals and number words. */
function parseCount(raw: string): number {
  const digit = Number(raw);
  if (Number.isFinite(digit)) return digit;
  return WORD_NUMBER[raw.toLowerCase()] ?? NaN;
}

function extractDoNotRepeat(conversation: AskRanaConversationTurn[] | undefined): string[] {
  if (!conversation?.length) return [];
  const recentRana = conversation
    .filter((t) => t.role === "rana")
    .slice(-2)
    .map((t) => t.content);

  const avoid: string[] = [];
  for (const msg of recentRana) {
    const baseline = msg.match(/baseline[^.]*?(\d+)\s*days?/i);
    const latest = msg.match(/latest[^.]*?(\d+)\s*days?/i);
    const revision = msg.match(/(\d+)\s+(?:programme )?revision/i);
    if (baseline) avoid.push(`baseline duration (${baseline[1]} days)`);
    if (latest) avoid.push(`latest duration (${latest[1]} days)`);
    if (revision) avoid.push(`revision count (${revision[1]} revisions)`);

    // Any "reduced/increased/changed from N to M [days]" narrative — the
    // change-summary phrasing itself, distinct from the baseline/latest
    // figures matched above (which require the literal words "baseline"/
    // "latest"). Generic across whatever numbers this deliverable actually has.
    const changeSummary = msg.match(
      /\b(?:reduced|increased|changed|moved)\s+from\s+(?:the\s+)?(?:baseline\s+)?(\d+)\s*days?\s*(?:to|→|-)\s*(?:the\s+)?(?:latest\s+)?(\d+)\s*days?\b/i
    );
    if (changeSummary) {
      avoid.push(`the ${changeSummary[1]} → ${changeSummary[2]} day change summary`);
    }

    if (/\b0 comparable\b|\bno (?:comparable )?completed\b|\bisn'?t enough completed\b/i.test(msg)) {
      avoid.push("zero / thin completed-project benchmarking counts");
    }

    // Any "<named work package> +N" remaining-work figure, whatever the
    // deliverable name and number happen to be for this conversation.
    const remainingWorkFigure = msg.match(/\b([A-Z][A-Za-z0-9/&' -]{2,60}?)\s*\(?\+\s*(\d+)\b(?=[^.]*?remaining)/i);
    if (remainingWorkFigure) {
      avoid.push(`${remainingWorkFigure[1].trim()} +${remainingWorkFigure[2]} remaining-work figure`);
    }

    // Any "<N> work packages ... increas..." narrative, whatever count is real.
    const workPackageCount = msg.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+work packages?\b/i);
    if (workPackageCount && /\bincreas/i.test(msg)) {
      const count = parseCount(workPackageCount[1]!);
      avoid.push(`${Number.isFinite(count) ? count : workPackageCount[1]} work packages with increasing remaining work`);
    }
  }
  return [...new Set(avoid)];
}

function verifyDurationClaims(
  question: string,
  pkg: AskRanaEvidencePackage
): string[] {
  const corrections: string[] = [];
  const span = parseDurationSpan(question);
  const evo = pkg.projectEvolution;
  if (!span || !evo?.available) return corrections;

  const baseline = evo.baselineDays;
  const latest = evo.latestDays;
  const net = evo.netChangeDays;

  if (baseline != null && latest != null && !Number.isNaN(span.fromDays) && !Number.isNaN(span.toDays)) {
    const actualFrom = baseline;
    const actualTo = latest;

    if (span.fromDays === actualFrom && span.toDays !== actualTo) {
      const actualDir = actualTo < actualFrom ? "reduced" : actualTo > actualFrom ? "increased" : "stayed at";
      corrections.push(
        `The planner refers to ${span.fromDays} → ${span.toDays} days, but the imported revision history shows ${actualFrom} → ${actualTo} days (duration ${actualDir}). Correct this before answering.`
      );
    } else if (span.fromDays !== actualFrom || span.toDays !== actualTo) {
      corrections.push(
        `The planner's stated durations (${span.fromDays} → ${span.toDays} days) do not match the evidence (baseline ${actualFrom} days, latest ${actualTo} days). Correct politely using the evidence figures.`
      );
    }

    if (span.claimedDirection === "increase" && net != null && net < 0) {
      corrections.push(
        `The planner assumes an increase, but the evidence shows a reduction from ${actualFrom} to ${actualTo} days. Correct this first — do not answer as if an increase occurred.`
      );
    } else if (span.claimedDirection === "decrease" && net != null && net > 0) {
      corrections.push(
        `The planner assumes a reduction, but the evidence shows an increase from ${actualFrom} to ${actualTo} days. Correct this first.`
      );
    } else if (span.claimedDirection === "unchanged" && net != null && net !== 0) {
      corrections.push(
        `The planner assumes no change, but the evidence shows movement from ${actualFrom} to ${actualTo} days. Correct this first.`
      );
    }
  }

  if (/\bincreas(ed|e)\b/.test(question.toLowerCase()) && net != null && net < 0 && baseline != null && latest != null) {
    if (!corrections.some((c) => c.includes("increase"))) {
      corrections.push(
        `The planner asks about an increase, but duration actually reduced from ${baseline} to ${latest} days. State this correction before continuing.`
      );
    }
  }

  return corrections;
}

function verifyCriticalityAssumption(
  question: string,
  pkg: AskRanaEvidencePackage
): string[] {
  const corrections: string[] = [];
  const q = question.toLowerCase();
  if (!/\b(?:why|how)\b.*\bcritical\b/.test(q) && !/\bcritical\b.*\b(?:why|how)\b/.test(q)) {
    return corrections;
  }

  const asksPresentTense = /\bwhy\s+is\b/.test(q) || /\bis\s+(?:it|this)\s+critical\b/.test(q);
  if (!asksPresentTense) return corrections;

  const becameCriticalAt: string[] = [];
  const leftCriticalAt: string[] = [];

  for (const rev of pkg.programmeLogic?.revisions ?? []) {
    for (const ev of rev.events) {
      if (ev.type === "BECAME_CRITICAL") becameCriticalAt.push(rev.label);
      if (ev.type === "LEFT_CRITICAL") leftCriticalAt.push(rev.label);
    }
    for (const obs of rev.plannerObservations) {
      if (/became critical/i.test(obs) && !becameCriticalAt.includes(rev.label)) {
        becameCriticalAt.push(rev.label);
      }
      if (/left the critical path/i.test(obs) && !leftCriticalAt.includes(rev.label)) {
        leftCriticalAt.push(rev.label);
      }
    }
  }

  const uniqueBecame = [...new Set(becameCriticalAt)];
  const uniqueLeft = [...new Set(leftCriticalAt)];

  if (uniqueLeft.length > 0 && uniqueBecame.length > 0) {
    const latestLeft = uniqueLeft[uniqueLeft.length - 1]!;
    const becamePhrase = uniqueBecame.join(", ");
    corrections.push(
      `The planner asks why it IS critical, but the evidence shows it is not currently critical — it left the critical path at ${latestLeft}. Open with the current state ("It isn't currently critical"), then explain when it became critical (${becamePhrase}) and what coincided. Do NOT stop after the correction — continue with the full investigation.`
    );
  } else if (uniqueLeft.length > 0 && uniqueBecame.length === 0) {
    corrections.push(
      `The planner assumes current criticality, but the evidence shows it left the critical path at ${uniqueLeft[uniqueLeft.length - 1]}. Correct the current-state assumption, then explain the criticality history if recorded.`
    );
  }

  return corrections;
}

function gapAllowedForScope(gap: string, scope: PlannerEvidenceScope | undefined): boolean {
  if (!scope || scope === "AUTO" || scope === "BOTH") return true;
  const g = gap.toLowerCase();
  if (scope === "PROJECT_EVOLUTION") {
    return !(
      g.includes("completed project") ||
      g.includes("similar completed") ||
      g.includes("lessons learned") ||
      g.includes("benchmark")
    );
  }
  if (scope === "PREVIOUS_PROJECTS") {
    return !(
      g.includes("revision") ||
      g.includes("programme logic") ||
      g.includes("evolution")
    );
  }
  if (scope === "PORTFOLIO") {
    return g.includes("portfolio") || g.includes("organisation") || g.includes("organization") || g.includes("completed project") || g.includes("lessons");
  }
  return true;
}

function gapRelatesToTopic(gap: string, topic: AskRanaQuestionTopic): boolean {
  const g = gap.toLowerCase();
  switch (topic) {
    case "comparison":
      return g.includes("completed project") || g.includes("comparison") || g.includes("recommendation");
    case "evolution":
      return g.includes("revision") || g.includes("programme");
    case "recommendation":
      return g.includes("recommendation") || g.includes("completed project");
    case "out_of_scope_plant":
    case "out_of_scope_people":
      return false;
    default:
      return true;
  }
}

function relevantMissingEvidence(
  question: string,
  topic: AskRanaQuestionTopic,
  pkg: AskRanaEvidencePackage,
  plannerQuery?: PlannerQuery
): string[] {
  const missing: string[] = [];
  const scope = plannerQuery?.scope;
  const baselineOnly = isBaselineOnlyConversationState(pkg);
  const changeQuestion = isChangeOrRevisionQuestion(question, plannerQuery);

  if (topic === "out_of_scope_plant") {
    missing.push("Plant and equipment information is not included in the imported programme evidence.");
    return missing;
  }

  if (topic === "out_of_scope_people") {
    missing.push(
      "Designer, subcontractor, and planning responsibility information is not recorded in the imported programme evidence."
    );
    return missing;
  }

  for (const gap of pkg.evidenceGaps) {
    if (!gapRelatesToTopic(gap, topic)) continue;
    if (!gapAllowedForScope(gap, scope)) continue;
    if (
      topic === "comparison" &&
      scope === "PROJECT_EVOLUTION"
    ) {
      continue;
    }
    if (
      topic === "comparison" &&
      hasEvolutionWithoutComparison(pkg) &&
      scope !== "PREVIOUS_PROJECTS" &&
      (/revision history first|answer from this project/i.test(gap) ||
        /not enough completed projects imported/i.test(gap))
    ) {
      continue;
    }
    if (baselineOnly && changeQuestion && shouldHumanizeGap(gap)) {
      continue;
    }
    missing.push(baselineOnly && shouldHumanizeGap(gap) ? humanizeBaselineOnlyGap(gap) : gap);
  }

  if (
    topic === "comparison" &&
    !pkg.previousProjects?.available &&
    pkg.sources.includes("previousProjects") &&
    scope !== "PROJECT_EVOLUTION"
  ) {
    if (hasEvolutionWithoutComparison(pkg)) {
      // Limitation is conveyed via instruction block — not as a leading error-style gap.
    } else if (!missing.some((m) => m.includes("completed project"))) {
      missing.push("No completed projects have been imported yet to judge this duration.");
    }
  }

  if (topic === "evolution" && !pkg.projectEvolution?.available && pkg.sources.includes("projectEvolution")) {
    if (!missing.some((m) => m.includes("revision") || m.includes("programme update"))) {
      missing.push(humanizeBaselineOnlyGap("No revision history on this project yet."));
    }
  }

  if (baselineOnly && changeQuestion && (topic === "evolution" || scope === "PROJECT_EVOLUTION")) {
    return [];
  }

  if (scope === "PREVIOUS_PROJECTS") {
    return missing.filter(
      (m) =>
        !m.toLowerCase().includes("revision") &&
        !m.toLowerCase().includes("programme logic")
    );
  }

  // Suppress irrelevant gaps — never dump lessons/recommendations for evolution-only why questions
  if (topic === "evolution" || scope === "PROJECT_EVOLUTION") {
    return missing.filter(
      (m) =>
        !m.toLowerCase().includes("lessons learned") &&
        !m.toLowerCase().includes("similar completed projects")
    );
  }

  return missing.slice(0, 2);
}

function responseStyleFromDepth(depth: PlannerResponseDepth): AskRanaResponseStyle {
  if (depth === "ONE_LINE" || depth === "BRIEF") return "brief";
  if (depth === "INVESTIGATION" || depth === "REPORT") return "detailed";
  return "standard";
}

function buildInstructionBlock(args: {
  corrections: string[];
  relevantMissingEvidence: string[];
  responseStyle: AskRanaResponseStyle;
  isFollowUp: boolean;
  doNotRepeat: string[];
  topicsAlreadyExplained: string[];
  topic: AskRanaQuestionTopic;
  evidencePackage: AskRanaEvidencePackage;
  plannerQuery?: PlannerQuery;
  responseDepth?: PlannerResponseDepth;
}): string {
  const lines: string[] = [];

  if (args.corrections.length > 0) {
    lines.push(
      "Factual corrections (address these FIRST in one sentence, then continue with the full answer — corrections must not replace the investigation):"
    );
    for (const c of args.corrections) lines.push(`- ${c}`);
    lines.push("");
  }

  if (args.isFollowUp && args.responseDepth !== "INVESTIGATION" && args.responseDepth !== "REPORT") {
    lines.push(
      "This is a follow-up. Answer only what is newly asked — assume shared context. Refer briefly to earlier points; do not regenerate the previous answer or re-list established metrics."
    );
    lines.push("");
  }

  const explained = [...new Set([...args.doNotRepeat, ...args.topicsAlreadyExplained])];
  if (explained.length > 0) {
    lines.push("Already established in this conversation — refer briefly if needed; do not restate in full:");
    for (const item of explained) lines.push(`- ${item}`);
    lines.push("");
  }

  if (args.responseDepth === "ONE_LINE" || args.responseDepth === "BRIEF") {
    lines.push("Response length: Keep this concise. Judgement + one reason + next step if useful. No section headings or replay.");
  } else if (args.responseDepth === "STANDARD") {
    lines.push("Response length: Focused — judgement first, brief synthesis, advice. No full report unless asked.");
  } else if (args.responseDepth === "REPORT") {
    lines.push(
      "Response shape: executive assessment — Overall assessment → Key reasons → Evidence → Recommendation → Confidence/limitations (≤5 sections). Lead with judgement; never lead with gaps."
    );
  }

  const scope = args.plannerQuery?.scope;
  if (scope && scope !== "AUTO") {
    lines.push("");
    lines.push(
      `Evidence boundary: ${humanPlannerScopeLabel(scope)}. Do not cite evidence outside this scope.`
    );
  }

  if (
    args.topic === "comparison" &&
    hasEvolutionWithoutComparison(args.evidencePackage) &&
    scope !== "PROJECT_EVOLUTION" &&
    scope !== "PREVIOUS_PROJECTS"
  ) {
    lines.push("");
    lines.push("PARTIAL EVIDENCE — response order:");
    lines.push(
      "1. Lead with a professional judgement using this project's revision history (remaining work trend, planning changes, concentration of pressure)."
    );
    lines.push(
      "2. Then note that completed-project benchmarking is still thin — after the judgement, never as the opening line."
    );
    lines.push(
      "3. Never open with “I don't have enough evidence” when programme revision history is available."
    );
    lines.push(
      "4. Use short Markdown headings only if they help an executive answer — restrained and professional."
    );
  } else if (args.relevantMissingEvidence.length > 0) {
    lines.push("");
    lines.push("Limitations relevant to THIS question (state after what you can assess — do not open with them):");
    for (const m of args.relevantMissingEvidence) lines.push(`- ${m}`);
  } else if (args.topic === "out_of_scope_plant" || args.topic === "out_of_scope_people") {
    lines.push("");
    lines.push(
      "This question is outside programme duration intelligence. Say clearly what is not available — do not mention previous projects, benchmarks, or recommendations."
    );
  } else {
    lines.push("");
    lines.push(
      "Do not mention missing evidence categories (previous projects, lessons, recommendations) unless directly relevant to this specific question."
    );
  }

  lines.push("");
  lines.push(
    "Always close substantive answers with what you would do next, grounded in the evidence."
  );

  return lines.join("\n");
}

/** Lightweight verification pass before the LLM prompt is built. */
export function verifyPlannerQuestion(args: {
  question: string;
  evidencePackage: AskRanaEvidencePackage;
  conversation?: AskRanaConversationTurn[];
  plannerQuery?: PlannerQuery;
  responseDepth?: PlannerResponseDepth;
}): AskRanaVerificationResult {
  const topic = detectQuestionTopic(args.question);
  const corrections = [
    ...verifyDurationClaims(args.question, args.evidencePackage),
    ...verifyCriticalityAssumption(args.question, args.evidencePackage),
  ];
  const followUp = isFollowUpQuestion(args.question, args.conversation);
  const doNotRepeat = followUp ? extractDoNotRepeat(args.conversation) : [];
  const topicsAlreadyExplained = followUp ? extractExplainedTopics(args.conversation) : [];
  const relevantMissing = relevantMissingEvidence(
    args.question,
    topic,
    args.evidencePackage,
    args.plannerQuery
  );
  const responseStyle = args.responseDepth
    ? responseStyleFromDepth(args.responseDepth)
    : detectResponseStyle(args.question, topic);

  const result: AskRanaVerificationResult = {
    corrections,
    relevantMissingEvidence: relevantMissing,
    responseStyle,
    isFollowUp: followUp,
    doNotRepeat,
    topic,
    instructionBlock: "",
  };

  result.instructionBlock = buildInstructionBlock({
    ...result,
    evidencePackage: args.evidencePackage,
    plannerQuery: args.plannerQuery,
    topicsAlreadyExplained,
    responseDepth: args.responseDepth,
  });
  return result;
}
