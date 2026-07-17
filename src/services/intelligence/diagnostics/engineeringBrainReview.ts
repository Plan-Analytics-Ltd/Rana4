/**
 * Engineering Brain review detail — DEVELOPER ONLY.
 *
 * Pure, deterministic builders that turn an already-resolved Engineering
 * Identity (and the context it was resolved from) into the rich, review-grade
 * detail a developer needs to approve/modify without inspecting the database.
 *
 * This module changes NOTHING about reasoning, comparison, statistics or the
 * identity itself — it only re-presents evidence and deterministic outputs that
 * already exist. No chain-of-thought, no prompts, no hidden reasoning.
 */
import { ENGINEERING_OBJECT_RULES } from "../taxonomy/engineeringVocabulary.data.js";
import type {
  EngineeringIdentity,
  EngineeringIdentityComponent,
  EngineeringIdentityEvidence,
} from "../taxonomy/engineeringIdentity.service.js";
import type { EngineeringIdentityValidation } from "../taxonomy/engineeringIdentityValidation.service.js";
import type { EngineeringTrustReason } from "../taxonomy/engineeringTrust.service.js";

export type EngineeringComponentView = {
  id: string | null;
  label: string | null;
  confidence: number;
  evidence: EngineeringIdentityEvidence[];
};

export type EngineeringIdentityView = {
  status: EngineeringIdentity["status"];
  overallConfidence: number;
  discipline: EngineeringComponentView;
  engineeringObject: EngineeringComponentView;
  engineeringWork: EngineeringComponentView;
  deliverableType: EngineeringComponentView;
  lifecycleStage: EngineeringComponentView;
  projectContext: EngineeringComponentView;
  fragnetContext: EngineeringComponentView;
};

export type DeliverableContextView = {
  projectName: string;
  fragnetName: string | null;
  parentWbs: string | null;
  wbsPath: string | null;
  deliverableName: string;
  neighbouringDeliverables: string[];
  relatedActivities: string[];
  disciplineMetadata: string | null;
  classificationTags: string[];
  lifecycleStage: string | null;
};

export type InboxReasonDetail = {
  reason: EngineeringTrustReason;
  detail: string;
  closestKnownObjects?: string[];
  modelConfidence?: number;
  validationRule?: string;
};

export type HistoricalMatch = {
  projectName: string;
  fragnetName: string | null;
  deliverableName: string;
  durationDays: number | null;
  matchedIdentity: { discipline: string | null; engineeringObject: string | null; engineeringWork: string | null };
  matchedComponents: string[];
  reason: string;
};

export type WhyExplanation = {
  component: string;
  conclusion: string | null;
  because: string[];
  rejectedAlternatives: string[];
};

export type DeveloperImpact = {
  deliverables: number;
  projects: number;
  futureComparisons: number;
  historicalDurationMatches: number;
};

const SOURCE_PHRASE: Record<string, string> = {
  DELIVERABLE_NAME: "Deliverable title",
  FRAGNET: "Fragnet / WBS",
  PARENT_WBS: "Parent WBS",
  WBS_PATH: "WBS path",
  RELATED_ACTIVITY: "Related activities",
  DISCIPLINE_METADATA: "Discipline metadata",
  CLASSIFICATION: "Classification",
  PROJECT_CONTEXT: "Project context",
  TAXONOMY: "Taxonomy",
};

function componentConfidence(component: EngineeringIdentityComponent): number {
  if (!component.id) return 0;
  const sources = new Set(component.evidence.map((e) => e.source));
  const base = Math.min(95, 55 + sources.size * 13);
  const taxonomyBonus = sources.has("TAXONOMY") ? 5 : 0;
  return Math.min(100, base + taxonomyBonus);
}

function view(component: EngineeringIdentityComponent): EngineeringComponentView {
  return {
    id: component.id,
    label: component.label,
    confidence: componentConfidence(component),
    evidence: component.evidence,
  };
}

export function buildIdentityView(identity: EngineeringIdentity): EngineeringIdentityView {
  const discipline = view(identity.discipline);
  const engineeringObject = view(identity.engineeringObject);
  const engineeringWork = view(identity.engineeringWork);
  const overallConfidence = Math.round(
    discipline.confidence * 0.3 + engineeringObject.confidence * 0.4 + engineeringWork.confidence * 0.3
  );
  return {
    status: identity.status,
    overallConfidence,
    discipline,
    engineeringObject,
    engineeringWork,
    deliverableType: view(identity.deliverableType),
    lifecycleStage: view(identity.lifecycleStage),
    projectContext: view(identity.projectContext),
    fragnetContext: view(identity.fragnetContext),
  };
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .map((t) => t.replace(/s$/, ""))
      .filter((t) => t.length > 2)
  );
}

/**
 * Deterministic "closest known objects" for an unknown/uncertain object: object
 * rules whose patterns fire against the evidence text, then rules whose label
 * tokens overlap with it. Never mutates vocabulary — read-only ranking.
 */
export function closestKnownObjects(evidenceText: string, chosenObjectId: string | null): string[] {
  const text = evidenceText.toLowerCase();
  const textTokens = tokens(evidenceText);
  const scored = ENGINEERING_OBJECT_RULES.filter((rule) => rule.id !== chosenObjectId).map((rule) => {
    const patternHit = rule.patterns.some((p) => {
      try {
        return new RegExp(p, "i").test(text);
      } catch {
        return false;
      }
    });
    const labelTokens = tokens(rule.label);
    let overlap = 0;
    for (const t of labelTokens) if (textTokens.has(t)) overlap += 1;
    return { label: rule.label, score: (patternHit ? 100 : 0) + overlap };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.label);
}

export function buildReasonDetails(args: {
  reasons: EngineeringTrustReason[];
  identity: EngineeringIdentity;
  validation: EngineeringIdentityValidation;
  evidenceText: string;
  driftDetail?: string | null;
}): InboxReasonDetail[] {
  const { reasons, identity, validation, evidenceText, driftDetail } = args;
  const details: InboxReasonDetail[] = [];
  for (const reason of reasons) {
    if (reason === "UNKNOWN_ENGINEERING_OBJECT") {
      details.push({
        reason,
        detail: "No known engineering object matched the available evidence.",
        closestKnownObjects: closestKnownObjects(evidenceText, identity.engineeringObject.id),
        modelConfidence: componentConfidence(identity.engineeringObject),
      });
    } else if (reason === "UNKNOWN_ENGINEERING_WORK") {
      details.push({
        reason,
        detail: "The engineering work (what is being done to the object) could not be determined.",
        modelConfidence: componentConfidence(identity.engineeringWork),
      });
    } else if (reason === "CONTRADICTORY_IDENTITY" || reason === "VALIDATION_CONFLICT") {
      for (const contradiction of validation.contradictions) {
        details.push({ reason, detail: contradiction.detail, validationRule: contradiction.rule });
      }
      if (validation.contradictions.length === 0) {
        details.push({ reason, detail: "Validator rejected this identity as internally inconsistent." });
      }
    } else if (reason === "REASONING_DISAGREEMENT") {
      details.push({
        reason,
        detail:
          driftDetail ?? "The same engineering work has resolved to different identities across imports.",
      });
    } else if (reason === "INSUFFICIENT_EVIDENCE") {
      details.push({
        reason,
        detail: `Only ${identity.supportingEvidence.length} supporting signal(s); core identity lacks corroboration.`,
      });
    } else if (reason === "MULTIPLE_INTERPRETATIONS") {
      details.push({
        reason,
        detail: "More than one engineering interpretation scored comparably.",
        closestKnownObjects: closestKnownObjects(evidenceText, identity.engineeringObject.id),
      });
    }
  }
  return details;
}

export function buildWhy(identity: EngineeringIdentity, evidenceText: string): WhyExplanation[] {
  const explain = (label: string, component: EngineeringIdentityComponent, withAlternatives: boolean): WhyExplanation | null => {
    if (!component.id) return null;
    const because = component.evidence.map((e) => `${SOURCE_PHRASE[e.source] ?? e.source} — “${e.value}”`);
    if (because.length === 0) return null;
    return {
      component: label,
      conclusion: component.label,
      because,
      rejectedAlternatives: withAlternatives ? closestKnownObjects(evidenceText, component.id) : [],
    };
  };
  return [
    explain("Discipline", identity.discipline, false),
    explain("Engineering Object", identity.engineeringObject, true),
    explain("Engineering Work", identity.engineeringWork, false),
    explain("Deliverable Type", identity.deliverableType, false),
    explain("Lifecycle", identity.lifecycleStage, false),
  ].filter((w): w is WhyExplanation => w !== null);
}

export function buildImpact(args: {
  occurrences: number;
  projects: number;
  historicalMatchCount: number;
  historicalDurationMatches: number;
}): DeveloperImpact {
  const intraPairs = (args.occurrences * (args.occurrences - 1)) / 2;
  return {
    deliverables: args.occurrences,
    projects: args.projects,
    futureComparisons: Math.round(args.occurrences * args.historicalMatchCount + intraPairs),
    historicalDurationMatches: args.historicalDurationMatches,
  };
}

export function evidenceTextForIdentity(identity: EngineeringIdentity): string {
  return identity.supportingEvidence.map((e) => e.value).join(" ");
}
