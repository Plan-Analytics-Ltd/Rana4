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

function collectConfirmedFacts(pkg: AskRanaEvidencePackage): string[] {
  const facts: string[] = [];
  const d = pkg.deliverable;

  if (d.name) facts.push(`Deliverable: ${d.name}`);
  if (d.classification) facts.push(`Classification: ${d.classification}`);
  if (d.currentDurationDays != null) {
    facts.push(`Current planned duration: ${d.currentDurationDays} days`);
  }

  const evo = pkg.projectEvolution;
  if (evo?.available) {
    if (evo.summary) facts.push(evo.summary);
    if (evo.baselineDays != null && evo.latestDays != null) {
      facts.push(
        `Duration: baseline ${evo.baselineDays} days → latest ${evo.latestDays} days` +
          (evo.netChangeDays != null ? ` (net ${evo.netChangeDays > 0 ? "+" : ""}${evo.netChangeDays})` : "")
      );
    }
    if (evo.howChangedSummary) facts.push(evo.howChangedSummary);
    if (evo.trend) facts.push(`Duration trend: ${evo.trend}`);
    if (evo.changePattern) facts.push(`Change pattern: ${evo.changePattern}`);
    for (const h of evo.timelineHighlights.slice(0, 6)) facts.push(h);
    for (const h of evo.revisionHighlights.slice(0, 4)) {
      facts.push(
        `${h.label}: ${h.durationDays} days${h.changeDays != null ? ` (${h.changeDays > 0 ? "+" : ""}${h.changeDays})` : ""} — ${h.reason}`
      );
    }
    for (const s of evo.stablePeriods.slice(0, 2)) {
      facts.push(
        `Stable at ${s.durationDays} days from ${s.startLabel} to ${s.endLabel} (${s.revisionCount} updates)`
      );
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
    if (p.typicalRangeLabel) facts.push(`Typical range on similar work: ${p.typicalRangeLabel}`);
    if (p.currentDurationDays != null && p.typicalDurationDays != null) {
      facts.push(
        `Current ${p.currentDurationDays} days vs typical around ${p.typicalDurationDays} days (${p.completedProjectCount} completed projects)`
      );
    }
  }

  if (pkg.observations?.length) {
    for (const o of pkg.observations.slice(0, 4)) facts.push(o);
  }
  if (pkg.keyFactors?.length) {
    for (const k of pkg.keyFactors.slice(0, 4)) facts.push(k);
  }

  return [...new Set(facts.filter(Boolean))];
}

function collectUnknowns(
  pkg: AskRanaEvidencePackage,
  verification: AskRanaVerificationResult
): string[] {
  const unknowns: string[] = [];

  for (const gap of verification.relevantMissingEvidence) {
    unknowns.push(gap);
  }

  const evo = pkg.projectEvolution;
  if (evo?.plannerObservations?.length) {
    for (const obs of evo.plannerObservations) {
      if (/not why|does not record why|not recorded why/i.test(obs)) {
        unknowns.push(obs);
      }
    }
  }

  unknowns.push("Underlying planner rationale for individual planning decisions is not recorded in the imported programme.");
  unknowns.push("Commercial decisions, contractor intent, and off-programme factors are not available.");

  return [...new Set(unknowns)].slice(0, 6);
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
}): AskRanaKnowledgePackage {
  const { evidencePackage: pkg, plannerQuery, verification, responseDepth, investigation } = args;
  const findings = mergeInvestigationFindings(investigation);

  const comparisonContext: string[] = [];
  if (pkg.previousProjects?.available) {
    const p = pkg.previousProjects;
    for (const w of p.comparableWork.slice(0, 4)) {
      comparisonContext.push(
        `${w.deliverableName} on ${w.projectName}${w.durationDays != null ? ` — ${w.durationDays} days` : ""}`
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
      "Partial evidence: this project's revision history is available; completed-project comparison is not."
    );
  }

  return {
    confirmedFacts: collectConfirmedFacts(pkg),
    supportedConclusions: findings?.supportedConclusions ?? [],
    alternativeExplanations: findings?.alternativeExplanations ?? [],
    ruledOutExplanations: findings?.ruledOutExplanations ?? [],
    unknowns: collectUnknowns(pkg, verification),
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
      topicsAlreadyExplained: responseDepth.topicsAlreadyExplained,
      hasDetailedPriorAnswer: responseDepth.hasDetailedPriorAnswer,
      newInformationRequested: responseDepth.newInformationRequested,
    },
    investigationFindings: findings,
    evidenceDomains: pkg.sources,
    revisionObservations: pkg.projectEvolution?.plannerObservations?.slice(0, 6) ?? [],
    programmeLogicObservations:
      pkg.programmeLogic?.revisions.flatMap((r) => r.plannerObservations).slice(0, 8) ?? [],
    comparisonContext,
    recommendations,
    evidenceNotes,
  };
}
