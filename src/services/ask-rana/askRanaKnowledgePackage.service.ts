import type { AskRanaEvidencePackage } from "./askRana.types.js";
import type { PlannerQuery } from "./askRanaPlannerQuery.types.js";
import type { AskRanaVerificationResult } from "./askRanaQuestionVerification.service.js";
import type { AskRanaInvestigationBrief } from "./askRanaInvestigation.service.js";
import type { PlannerResponseDepthResult } from "./askRanaResponseDepth.service.js";
import {
  humanPlannerIntentLabel,
  humanPlannerScopeLabel,
} from "./askRanaPlannerQuery.types.js";
import type {
  AskRanaKnowledgePackage,
  InvestigationFindings,
} from "./askRanaKnowledgePackage.types.js";
import { hasEvolutionWithoutComparison } from "./askRanaPartialEvidence.service.js";
import {
  baselineOnlyFollowUpBullets,
  baselineOnlyPrimaryMessage,
  filterTechnicalBaselineText,
  humanizeBaselineOnlyGap,
  isBaselineOnlyConversationState,
  isChangeOrRevisionQuestion,
  shouldHumanizeGap,
} from "./askRanaBaselineOnlyConversation.service.js";
import {
  buildBroadChangeGuidance,
  buildRevisionChangeSummaries,
  buildRevisionNeighborContext,
  buildRevisionScopedGuidance,
  buildSingleRevisionChangeSummary,
  buildStoryFlowGuidance,
  collectRevisionFocusedFacts,
  extractRevisionTarget,
  humanizePlannerPhrase,
  humanizeUnknowns,
  isBroadChangeQuestion,
} from "./askRanaConversationPolish.service.js";
import {
  buildPlannerReasoningGuidance,
  compressConfirmedFactsForFollowUp,
  extractEstablishedProgrammeFacts,
  isExecutivePlannerQuestion,
  reframeLimitationPhrases,
} from "./askRanaPlannerReasoning.service.js";

function collectConfirmedFacts(pkg: AskRanaEvidencePackage, baselineOnly: boolean): string[] {
  const facts: string[] = [];

  // Project Intelligence first — programme understanding before deliverable drill-down.
  if (pkg.projectIntelligence?.available) {
    facts.push(...pkg.projectIntelligence.facts);
  }

  const d = pkg.deliverable;

  if (d.name) facts.push(`Deliverable: ${d.name}`);
  if (d.classification) facts.push(`Classification: ${d.classification}`);
  if (d.currentDurationDays != null) {
    facts.push(`Current planned duration: ${d.currentDurationDays} days`);
  }

  const evo = pkg.projectEvolution;
  if (evo?.available) {
    if (baselineOnly) {
      facts.push(baselineOnlyPrimaryMessage(pkg));
    } else {
      if (evo.summary) facts.push(evo.summary);
      if (evo.baselineDays != null && evo.latestDays != null) {
        facts.push(
          `Remaining work: baseline ${evo.baselineDays} days → latest ${evo.latestDays} days` +
            (evo.netChangeDays != null ? ` (net ${evo.netChangeDays > 0 ? "+" : ""}${evo.netChangeDays})` : "")
        );
      }
      if (evo.howChangedSummary) facts.push(evo.howChangedSummary);
      if (evo.trend) facts.push(`Remaining-work trend: ${evo.trend}`);
      if (evo.changePattern) facts.push(`Change pattern: ${evo.changePattern}`);
      for (const h of evo.timelineHighlights.slice(0, 6)) facts.push(h);
      for (const h of evo.revisionHighlights.slice(0, 4)) {
        facts.push(
          `${h.label}: ${h.durationDays} days remaining work${h.changeDays != null ? ` (${h.changeDays > 0 ? "+" : ""}${h.changeDays})` : ""} — ${h.reason}`
        );
      }
      for (const s of evo.stablePeriods.slice(0, 2)) {
        facts.push(
          `Remaining work stable at ${s.durationDays} days from ${s.startLabel} to ${s.endLabel} (${s.revisionCount} updates)`
        );
      }
    }
  }

  const logic = pkg.programmeLogic;
  if (logic?.available) {
    if (logic.summary) facts.push(logic.summary);
    for (const rev of logic.revisions) {
      for (const ev of rev.events.slice(0, 6)) {
        if (ev.description) facts.push(`${rev.label}: ${ev.description}`);
      }
      for (const obs of rev.plannerObservations.slice(0, 4)) {
        facts.push(`${rev.label}: ${obs}`);
      }
    }
  }

  if (pkg.previousProjects?.available) {
    const p = pkg.previousProjects;
    if (p.comparisonAssessment) facts.push(p.comparisonAssessment);
    if (p.typicalRangeLabel) facts.push(`Typical planned duration range on similar work: ${p.typicalRangeLabel}`);
    if (p.currentDurationDays != null && p.typicalDurationDays != null) {
      facts.push(
        `Current planned ${p.currentDurationDays} days vs typical planned around ${p.typicalDurationDays} days (${p.completedProjectCount} completed projects)`
      );
    }
  }

  if (pkg.observations?.length) {
    for (const o of pkg.observations.slice(0, 4)) facts.push(o);
  }
  if (pkg.keyFactors?.length) {
    for (const k of pkg.keyFactors.slice(0, 4)) facts.push(k);
  }

  return [...new Set(facts.filter(Boolean).map(humanizePlannerPhrase))];
}

function collectUnknowns(
  pkg: AskRanaEvidencePackage,
  verification: AskRanaVerificationResult,
  baselineOnly: boolean,
  changeQuestion: boolean
): string[] {
  const unknowns: string[] = [];

  if (!(baselineOnly && changeQuestion)) {
    for (const gap of verification.relevantMissingEvidence) {
      unknowns.push(
        baselineOnly && shouldHumanizeGap(gap) ? humanizeBaselineOnlyGap(gap) : gap
      );
    }
  }

  const evo = pkg.projectEvolution;
  if (evo?.plannerObservations?.length) {
    for (const obs of evo.plannerObservations) {
      if (/not why|does not record why|not recorded why/i.test(obs)) {
        unknowns.push(obs);
      }
    }
  }

  if (!(baselineOnly && changeQuestion)) {
    unknowns.push(
      "Why each planning decision was made is not in the programme file."
    );
    unknowns.push("Commercial decisions, contractor intent, and off-programme factors are not available.");
  }

  return humanizeUnknowns(unknowns);
}

function mergeInvestigationFindings(
  investigation: AskRanaInvestigationBrief
): InvestigationFindings | null {
  if (!investigation.findings) return null;
  return investigation.findings;
}

/** Assemble the canonical deterministic knowledge package for the LLM. */
export function buildAskRanaKnowledgePackage(args: {
  evidencePackage: AskRanaEvidencePackage;
  plannerQuery: PlannerQuery;
  verification: AskRanaVerificationResult;
  responseDepth: PlannerResponseDepthResult;
  investigation: AskRanaInvestigationBrief;
  question?: string;
  conversation?: import("./askRana.types.js").AskRanaConversationTurn[];
}): AskRanaKnowledgePackage {
  const { evidencePackage: pkg, plannerQuery, verification, responseDepth, investigation } = args;
  const question = args.question ?? "";
  const findings = mergeInvestigationFindings(investigation);
  const baselineOnly = isBaselineOnlyConversationState(pkg);
  const changeQuestion = isChangeOrRevisionQuestion(question, plannerQuery);
  const broadChangeQuestion = isBroadChangeQuestion(question, plannerQuery);
  const targetRevision = baselineOnly ? null : extractRevisionTarget(question, pkg);
  const establishedFacts = extractEstablishedProgrammeFacts(args.conversation);

  const comparisonContext: string[] = [];
  if (pkg.previousProjects?.available) {
    const p = pkg.previousProjects;
    for (const w of p.comparableWork.slice(0, 4)) {
      comparisonContext.push(
        `${w.deliverableName} on ${w.projectName}${w.durationDays != null ? ` — ${w.durationDays} days planned` : ""}`
      );
    }
    for (const o of p.observations.slice(0, 3)) comparisonContext.push(o);
  }

  const recommendations =
    pkg.recommendations?.items.map((r) => `${r.title}: ${r.summary || r.recommendation}`).slice(0, 4) ??
    [];

  const evidenceNotes: string[] = [];
  if (plannerQuery.scope !== "AUTO") {
    evidenceNotes.push(
      `Evidence boundary: ${humanPlannerScopeLabel(plannerQuery.scope)}.`
    );
  }
  if (hasEvolutionWithoutComparison(pkg) && verification.topic === "comparison") {
    evidenceNotes.push(
      "Partial evidence: this project's revision history is available; completed-project comparison is not. Lead with what the programme shows; mention thin completed-project history only after the judgement — never open with the gap."
    );
  }
  if (baselineOnly && changeQuestion) {
    evidenceNotes.push(
      "This project only contains the Baseline programme — nothing has changed yet. Explain that naturally and describe what you can show after the first programme update. Do not apologise or mention missing evidence."
    );
  }

  const communicationGuidance: string[] = [
    ...buildPlannerReasoningGuidance({
      question,
      isFollowUp: verification.isFollowUp,
      hasDetailedPriorAnswer: responseDepth.hasDetailedPriorAnswer,
      establishedFacts,
    }),
  ];
  if (targetRevision) {
    communicationGuidance.push(buildRevisionScopedGuidance(targetRevision));
  } else if (broadChangeQuestion && !baselineOnly) {
    communicationGuidance.push(buildBroadChangeGuidance());
  }
  const storyFlow = buildStoryFlowGuidance(pkg, question);
  if (storyFlow && !baselineOnly) {
    communicationGuidance.push(storyFlow);
  }
  if (findings?.strongestConclusion && (findings.supportedConclusions?.length ?? 0) <= 1) {
    communicationGuidance.push(
      "When evidence supports one conclusion, state it directly (e.g. “From reviewing the programme…”) — do not hedge with phrases like “a supported reading is…”."
    );
  }
  if (isExecutivePlannerQuestion(question)) {
    communicationGuidance.push(
      "This is an executive programme question — open with your overall assessment in one clear sentence before any chronology."
    );
  }

  const changeSummaries =
    targetRevision && !baselineOnly
      ? (() => {
          const summary = buildSingleRevisionChangeSummary(pkg, targetRevision);
          return summary ? [summary] : [];
        })()
      : broadChangeQuestion && !baselineOnly
        ? buildRevisionChangeSummaries(pkg)
        : [];

  const revisionContextFacts =
    targetRevision && !baselineOnly ? buildRevisionNeighborContext(pkg, targetRevision) : [];

  const rawConfirmedFacts =
    targetRevision && !baselineOnly
      ? [
          ...(pkg.projectIntelligence?.overallAssessment
            ? [`Programme context: ${pkg.projectIntelligence.overallAssessment}`]
            : []),
          ...collectRevisionFocusedFacts(pkg, targetRevision),
        ]
      : collectConfirmedFacts(pkg, baselineOnly && changeQuestion);

  const confirmedFacts = compressConfirmedFactsForFollowUp(
    rawConfirmedFacts,
    establishedFacts,
    verification.isFollowUp
  );

  const baselineConclusions =
    baselineOnly && changeQuestion
      ? [
          baselineOnlyPrimaryMessage(pkg),
          `After the first programme update is imported, I can explain ${baselineOnlyFollowUpBullets().join(", ")}.`,
        ]
      : [];

  return {
    confirmedFacts,
    supportedConclusions: [
      ...baselineConclusions,
      ...(findings?.supportedConclusions ?? []).map(humanizePlannerPhrase),
    ],
    alternativeExplanations: (findings?.alternativeExplanations ?? []).map(humanizePlannerPhrase),
    ruledOutExplanations: findings?.ruledOutExplanations ?? [],
    unknowns: reframeLimitationPhrases(
      collectUnknowns(pkg, verification, baselineOnly, changeQuestion)
    ),
    factualCorrections: verification.corrections,
    plannerContext: {
      intent: humanPlannerIntentLabel(plannerQuery.intent),
      evidenceScope: humanPlannerScopeLabel(plannerQuery.scope),
      entity: plannerQuery.entity,
      comparisonMode: plannerQuery.comparisonMode,
      timeframe: plannerQuery.timeframe,
      qualifiers: plannerQuery.qualifiers,
    },
    projectContext: {
      deliverableName: pkg.deliverable.name,
      classification: pkg.deliverable.classification,
      currentDurationDays: pkg.deliverable.currentDurationDays,
    },
    conversationContext: {
      responseDepth: responseDepth.depth,
      plannerExpectation: responseDepth.plannerExpectation,
      followUpIntent: responseDepth.followUpIntent,
      topicsAlreadyExplained: [
        ...responseDepth.topicsAlreadyExplained,
        ...establishedFacts,
      ],
      hasDetailedPriorAnswer: responseDepth.hasDetailedPriorAnswer,
      newInformationRequested: responseDepth.newInformationRequested,
    },
    investigationFindings: findings,
    evidenceDomains: pkg.sources,
    revisionObservations:
      baselineOnly && changeQuestion
        ? []
        : (pkg.projectEvolution?.plannerObservations
            ?.filter(filterTechnicalBaselineText)
            .filter((obs) => !targetRevision || obs.includes(targetRevision))
            .map(humanizePlannerPhrase)
            .slice(0, 6) ?? []),
    programmeLogicObservations:
      pkg.programmeLogic?.revisions
        .filter((r) => !targetRevision || r.label === targetRevision)
        .flatMap((r) => r.plannerObservations)
        .map(humanizePlannerPhrase)
        .slice(0, 8) ?? [],
    comparisonContext,
    recommendations,
    evidenceNotes,
    changeSummaries,
    communicationGuidance,
    targetRevision,
    revisionContextFacts,
    activityTaskTypes:
      pkg.linkedActivities?.map((a) => ({
        activityCode: a.activityCode,
        p6TaskType: a.p6TaskType,
      })) ?? [],
  };
}
