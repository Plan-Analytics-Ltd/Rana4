import type { AskRanaConversationTurn, AskRanaEvidencePackage } from "./askRana.types.js";
import type { PlannerQuery, PlannerQueryIntent } from "./askRanaPlannerQuery.types.js";
import type { FollowUpIntent, PlannerResponseDepth } from "./askRanaResponseDepth.service.js";
import { depthAllowsFullInvestigation } from "./askRanaResponseDepth.service.js";
import type { InvestigationFindings } from "./askRanaKnowledgePackage.types.js";

export type AskRanaInvestigationMode = "none" | "why" | "deep";

export type AskRanaInvestigationBrief = {
  mode: AskRanaInvestigationMode;
  findings: InvestigationFindings | null;
};

const WHY_INTENTS = new Set<PlannerQueryIntent>([
  "why",
  "explain_change",
  "explain_criticality",
  "float_change",
  "logic_change",
  "criticality",
  "relationship_change",
  "lag_change",
  "how",
  "investigate",
]);

const INVESTIGATION_FIRST_TURN_PATTERN =
  /\b(investigate|analys(?:e|is) (?:why|how|what)|find out what happened|dig into|look into why)\b/i;

function isExplicitDeepenFollowUp(
  question: string,
  conversation?: AskRanaConversationTurn[]
): boolean {
  if (!conversation?.length) return false;
  const q = question.toLowerCase().trim();
  return /\b(investigate further|go deeper|dig deeper|explain (?:that|this) further)\b/.test(q);
}

/** Detect whether full investigative reasoning is warranted for this turn. */
export function detectInvestigationMode(
  question: string,
  plannerQuery: PlannerQuery,
  conversation?: AskRanaConversationTurn[],
  depth?: PlannerResponseDepth
): AskRanaInvestigationMode {
  if (depth && !depthAllowsFullInvestigation(depth)) {
    return "none";
  }

  const q = question.toLowerCase().trim();

  if (INVESTIGATION_FIRST_TURN_PATTERN.test(q) || isExplicitDeepenFollowUp(q, conversation)) {
    return "deep";
  }

  if (WHY_INTENTS.has(plannerQuery.intent) || /\bwhy\b/.test(q)) {
    return depth === "REPORT" ? "deep" : "why";
  }

  return "none";
}

/** Extract deterministic signals already present in the evidence package — no new calculations. */
export function extractDeterministicInvestigationSignals(pkg: AskRanaEvidencePackage): string[] {
  const signals: string[] = [];
  const evo = pkg.projectEvolution;
  const logic = pkg.programmeLogic;

  if (evo?.available) {
    if (
      evo.netChangeDays === 0 ||
      (evo.baselineDays != null && evo.latestDays != null && evo.baselineDays === evo.latestDays)
    ) {
      signals.push(
        "Remaining work remained unchanged across revisions — rule out remaining-work change as the primary explanation unless evidence shows otherwise."
      );
    } else if (evo.baselineDays != null && evo.latestDays != null) {
      signals.push(`Remaining work moved from ${evo.baselineDays} to ${evo.latestDays} days across revisions.`);
    }

    const stable = evo.stablePeriods?.[0];
    if (stable) {
      signals.push(
        `Remaining work settled at ${stable.durationDays} days early — it stayed stable from ${stable.startLabel} through ${stable.endLabel} (${stable.revisionCount} updates).`
      );
    } else if (evo.changePattern?.toLowerCase().includes("stable")) {
      signals.push("Remaining-work pattern is stable across subsequent programme updates.");
    }
  }

  const floatAt: string[] = [];
  const becameCriticalAt: string[] = [];
  const leftCriticalAt: string[] = [];
  let relationshipChangeCount = 0;

  for (const rev of logic?.revisions ?? []) {
    for (const ev of rev.events) {
      if (
        ev.type === "FLOAT_LOST" ||
        ev.type === "APPROACHING_CRITICAL" ||
        ev.type === "NEGATIVE_FLOAT_INTRODUCED"
      ) {
        floatAt.push(rev.label);
      }
      if (ev.type === "BECAME_CRITICAL") becameCriticalAt.push(rev.label);
      if (ev.type === "LEFT_CRITICAL") leftCriticalAt.push(rev.label);
      if (
        ev.type === "RELATIONSHIP_ADDED" ||
        ev.type === "RELATIONSHIP_REMOVED" ||
        ev.type === "RELATIONSHIP_TYPE_CHANGED" ||
        ev.type.startsWith("LAG_")
      ) {
        relationshipChangeCount += 1;
      }
    }
    for (const obs of rev.plannerObservations) {
      if (/became critical/i.test(obs) && !becameCriticalAt.includes(rev.label)) {
        becameCriticalAt.push(rev.label);
      }
      if (/left the critical path/i.test(obs) && !leftCriticalAt.includes(rev.label)) {
        leftCriticalAt.push(rev.label);
      }
      if (/duration was unchanged/i.test(obs)) {
        signals.push(`${rev.label}: duration unchanged while programme logic changed.`);
      }
    }
  }

  const uniqueFloat = [...new Set(floatAt)];
  if (uniqueFloat.length >= 2) {
    signals.push(
      `Scheduling flexibility reduced progressively across ${uniqueFloat.length} updates (${uniqueFloat.slice(0, 5).join(", ")}) — tell this as one trend, not a revision-by-revision log.`
    );
  } else if (uniqueFloat.length === 1) {
    signals.push(`Scheduling flexibility reduced at ${uniqueFloat[0]}.`);
  }

  if (becameCriticalAt.length > 0) {
    signals.push(`Became critical at: ${[...new Set(becameCriticalAt)].join(", ")}.`);
  }
  if (leftCriticalAt.length > 0) {
    signals.push(
      `Left the critical path at: ${[...new Set(leftCriticalAt)].join(", ")}. Current criticality may differ from historical criticality — address both.`
    );
  }
  if (relationshipChangeCount > 0) {
    signals.push(
      `${relationshipChangeCount} relationship or lag change(s) recorded — check whether they coincide with float or criticality changes.`
    );
  }

  if (logic?.summary) {
    signals.push(`Programme logic summary: ${logic.summary}`);
  }

  return [...new Set(signals)];
}

/** Produce structured investigation findings from deterministic evidence — not LLM instructions. */
export function buildInvestigationFindings(
  pkg: AskRanaEvidencePackage,
  mode: AskRanaInvestigationMode
): InvestigationFindings | null {
  if (mode === "none") return null;

  const signals = extractDeterministicInvestigationSignals(pkg);
  const supportedConclusions: string[] = [];
  const ruledOutExplanations: string[] = [];
  const alternativeExplanations: string[] = [];
  const evidenceLinks: string[] = [];

  for (const s of signals) {
    if (/rule out remaining-work/i.test(s)) {
      ruledOutExplanations.push("Remaining-work change as the primary explanation");
      evidenceLinks.push(s);
    } else if (/progressively|scheduling flexibility reduced/i.test(s)) {
      supportedConclusions.push(
        "Scheduling flexibility reduced progressively across programme updates"
      );
      evidenceLinks.push(s);
    } else if (/planning team appears to have settled/i.test(s)) {
      supportedConclusions.push(s.replace(/^The planning team/, "The planning team"));
      evidenceLinks.push(s);
    } else if (/duration unchanged while programme logic/i.test(s)) {
      evidenceLinks.push(s);
      supportedConclusions.push(
        "Programme logic changed while duration stayed unchanged — network tightening is a plausible explanation"
      );
    } else if (/coincide|relationship or lag/i.test(s)) {
      evidenceLinks.push(s);
    } else if (/became critical/i.test(s)) {
      supportedConclusions.push(s);
      evidenceLinks.push(s);
    } else if (/left the critical path/i.test(s)) {
      supportedConclusions.push(s);
      evidenceLinks.push(s);
    } else if (/Duration moved from/i.test(s)) {
      evidenceLinks.push(s);
    } else if (/Programme logic summary/i.test(s)) {
      supportedConclusions.push(s.replace(/^Programme logic summary: /, ""));
    } else {
      evidenceLinks.push(s);
    }
  }

  if (
    ruledOutExplanations.length > 0 &&
    supportedConclusions.some((c) => /flexibility|logic|network|tightening/i.test(c))
  ) {
    alternativeExplanations.push(
      "Repeated duration adjustments — ruled out if duration remained stable"
    );
  }

  alternativeExplanations.push(
    "Why the planner made each decision — not available in the programme file"
  );

  const strongestConclusion =
    supportedConclusions.find((c) => /network tightening|flexibility reduced progressively/i.test(c)) ??
    supportedConclusions[0] ??
    (pkg.programmeLogic?.summary ?? null);

  return {
    supportedConclusions: [...new Set(supportedConclusions)],
    alternativeExplanations: [...new Set(alternativeExplanations)],
    ruledOutExplanations: [...new Set(ruledOutExplanations)],
    evidenceLinks: [...new Set(evidenceLinks)],
    strongestConclusion,
  };
}

/** Build investigation instructions from existing deterministic evidence. */
export function buildPlannerInvestigation(args: {
  question: string;
  evidencePackage: AskRanaEvidencePackage;
  plannerQuery: PlannerQuery;
  conversation?: AskRanaConversationTurn[];
  depth: PlannerResponseDepth;
  followUpIntent?: FollowUpIntent;
}): AskRanaInvestigationBrief {
  const followUpIntent = args.followUpIntent ?? "none";
  const mode = detectInvestigationMode(
    args.question,
    args.plannerQuery,
    args.conversation,
    args.depth
  );

  return {
    mode,
    findings: buildInvestigationFindings(args.evidencePackage, mode),
  };
}
