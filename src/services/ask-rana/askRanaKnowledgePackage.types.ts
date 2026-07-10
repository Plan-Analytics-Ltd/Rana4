import type { PlannerResponseDepth, FollowUpIntent } from "./askRanaResponseDepth.service.js";
import type { AskRanaEvidenceDomain } from "./askRana.types.js";

/** How firmly a knowledge item is established in deterministic evidence. */
export type KnowledgeConfidence = "confirmed" | "supported" | "possible" | "ruled_out" | "unknown";

export type InvestigationFindings = {
  supportedConclusions: string[];
  alternativeExplanations: string[];
  ruledOutExplanations: string[];
  evidenceLinks: string[];
  strongestConclusion: string | null;
};

export type PlannerContextKnowledge = {
  intent: string;
  evidenceScope: string;
  entity: string;
  comparisonMode: string;
  timeframe: string;
  qualifiers: string[];
};

export type ConversationContextKnowledge = {
  responseDepth: PlannerResponseDepth;
  plannerExpectation: string;
  followUpIntent: FollowUpIntent;
  topicsAlreadyExplained: string[];
  hasDetailedPriorAnswer: boolean;
  newInformationRequested: string;
};

/**
 * Structured deterministic knowledge for the LLM.
 * Everything in this package is pre-computed — the LLM must not calculate or invent beyond it.
 */
export type AskRanaKnowledgePackage = {
  confirmedFacts: string[];
  supportedConclusions: string[];
  alternativeExplanations: string[];
  ruledOutExplanations: string[];
  unknowns: string[];
  factualCorrections: string[];
  plannerContext: PlannerContextKnowledge;
  projectContext: {
    deliverableName: string;
    classification: string | null;
    currentDurationDays: number | null;
  };
  conversationContext: ConversationContextKnowledge;
  investigationFindings: InvestigationFindings | null;
  evidenceDomains: AskRanaEvidenceDomain[];
  revisionObservations: string[];
  programmeLogicObservations: string[];
  comparisonContext: string[];
  recommendations: string[];
  evidenceNotes: string[];
};
