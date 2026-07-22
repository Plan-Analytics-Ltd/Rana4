import type { DeliverableClassification } from "@prisma/client";
import {
  DISCIPLINE_OBJECT_FALLBACKS,
  ENGINEERING_OBJECT_RULES,
  WORK_PACKAGE_OBJECT_FALLBACKS,
  type EngineeringObjectRule,
} from "./engineeringVocabulary.data.js";
import { extractDocumentType } from "./documentType.extraction.js";
import {
  normaliseDeliverableNameForTaxonomy,
  resolveWorkPackageTaxonomy,
  type WorkPackageTaxonomyInput,
  type WorkPackageTaxonomyResolution,
} from "./workPackageTaxonomy.service.js";

export type EngineeringEvidenceSource =
  | "DELIVERABLE_NAME"
  | "FRAGNET"
  | "PARENT_WBS"
  | "WBS_PATH"
  | "RELATED_ACTIVITY"
  | "DISCIPLINE_METADATA"
  | "CLASSIFICATION"
  | "PROJECT_CONTEXT"
  | "TAXONOMY";

export type EngineeringIdentityEvidence = {
  source: EngineeringEvidenceSource;
  value: string;
  matched: string;
  /**
   * Which rule produced this — a hand-authored taxonomy rule, or one merged
   * in from an approved EngineeringLearnedRule (spec section 7). Only ever
   * set on engineeringObject evidence today, the only injection point wired
   * so far. Absent means TAXONOMY (hand-authored); never omitted vs. explicit
   * "TAXONOMY" for backward compatibility with existing evidence consumers.
   */
  ruleOrigin?: "LEARNED_RULE" | "TAXONOMY";
};

export type EngineeringIdentityComponent = {
  id: string | null;
  label: string | null;
  evidence: EngineeringIdentityEvidence[];
};

export type EngineeringIdentityStatus = "RESOLVED" | "INSUFFICIENT";

export type EngineeringIdentity = {
  status: EngineeringIdentityStatus;
  discipline: EngineeringIdentityComponent;
  engineeringObject: EngineeringIdentityComponent;
  engineeringWork: EngineeringIdentityComponent;
  deliverableType: EngineeringIdentityComponent;
  lifecycleStage: EngineeringIdentityComponent;
  projectContext: EngineeringIdentityComponent;
  fragnetContext: EngineeringIdentityComponent;
  taxonomy: {
    taxonomyKey: string | null;
    categoryId: string | null;
    workPackageId: string | null;
    isUnknownWorkPackage: boolean;
  };
  supportingEvidence: EngineeringIdentityEvidence[];
};

export type EngineeringIdentityInput = WorkPackageTaxonomyInput & {
  classification?: DeliverableClassification | null;
  lifecycleStage?: string | null;
  projectContext?: {
    sector?: string | null;
    projectType?: string | null;
  } | null;
  relatedActivityNames?: string[];
};

export type EngineeringIdentityComparisonComponent =
  | "DISCIPLINE"
  | "ENGINEERING_OBJECT"
  | "ENGINEERING_WORK"
  | "DELIVERABLE_TYPE"
  | "LIFECYCLE_STAGE"
  | "PROJECT_CONTEXT"
  | "FRAGNET_CONTEXT";

export type EngineeringIdentityComparisonCheck = {
  component: EngineeringIdentityComparisonComponent;
  // IDENTITY: gates on both MISMATCH and UNKNOWN (core discipline/object/work).
  // SOFT_IDENTITY: gates only on a confirmed MISMATCH; an UNKNOWN (either side
  //   unresolved) does not block equivalence on its own. Used for
  //   deliverableType, where a definite conflict (drawing vs. report) is a
  //   real signal that two deliverables are different things, but an
  //   unresolved type on one side shouldn't veto an otherwise-sound match.
  // DESCRIPTOR: informational only, never gates.
  role: "IDENTITY" | "SOFT_IDENTITY" | "DESCRIPTOR";
  target: string | null;
  candidate: string | null;
  result: "MATCH" | "MISMATCH" | "UNKNOWN";
};

export type EngineeringIdentityComparison = {
  equivalent: boolean;
  reason: "EQUIVALENT" | "CONTRADICTORY_IDENTITY" | "INSUFFICIENT_IDENTITY";
  checks: EngineeringIdentityComparisonCheck[];
  matchedIdentityComponents: EngineeringIdentityComparisonComponent[];
  rejectedBy: EngineeringIdentityComparisonComponent[];
};

type TextEvidence = {
  source: EngineeringEvidenceSource;
  value: string;
  weight: number;
};

function text(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}

function evidence(
  source: EngineeringEvidenceSource,
  value: string | null | undefined,
  matched: string
): EngineeringIdentityEvidence[] {
  const actual = text(value);
  return actual ? [{ source, value: actual, matched }] : [];
}

function taxonomyDisciplineEvidence(
  resolution: WorkPackageTaxonomyResolution,
  input: EngineeringIdentityInput
): EngineeringIdentityEvidence[] {
  const source: EngineeringEvidenceSource =
    resolution.disciplineSource === "metadata"
      ? "DISCIPLINE_METADATA"
      : resolution.disciplineSource === "fragnet"
        ? "FRAGNET"
        : resolution.disciplineSource === "wbs"
          ? "PARENT_WBS"
          : resolution.disciplineSource === "unresolved"
            ? "TAXONOMY"
            : "DELIVERABLE_NAME";
  const value =
    source === "DISCIPLINE_METADATA"
      ? input.disciplineTag ?? input.activityCodeDiscipline
      : source === "FRAGNET"
        ? input.fragnetName
        : source === "PARENT_WBS"
          ? input.parentWbs ?? input.wbsPath
          : input.deliverableName;
  return resolution.disciplineId
    ? evidence(source, value, resolution.disciplineLabel ?? resolution.disciplineId)
    : [];
}

function objectTextEvidence(input: EngineeringIdentityInput): TextEvidence[] {
  const sources: TextEvidence[] = [
    { source: "DELIVERABLE_NAME", value: input.deliverableName, weight: 100 },
    { source: "FRAGNET", value: input.fragnetName ?? "", weight: 65 },
    { source: "PARENT_WBS", value: input.parentWbs ?? "", weight: 55 },
    { source: "WBS_PATH", value: input.wbsPath ?? "", weight: 45 },
    ...(input.relatedActivityNames ?? []).map((value) => ({
      source: "RELATED_ACTIVITY" as const,
      value,
      weight: 35,
    })),
  ];
  return sources.filter((item) => text(item.value) != null);
}

export type EngineeringObjectCandidate = {
  identity: string;
  id: string;
  label: string;
  score: number;
  source: EngineeringEvidenceSource;
  value: string;
  matchedPattern: string;
  winner: boolean;
  ruleOrigin: "LEARNED_RULE" | "TAXONOMY";
};

/**
 * All scored engineering-object candidates considered by the rule engine.
 * Debug/export only — resolveEngineeringIdentity still returns the same winner.
 *
 * `learnedObjectRules` (spec section 7, Phase 3): additional rules merged in
 * from developer-approved EngineeringLearnedRule records, on top of the
 * hand-authored ENGINEERING_OBJECT_RULES. Defaults to empty so every existing
 * caller is unaffected until it explicitly opts in by passing learned rules.
 */
export function listEngineeringObjectCandidates(
  input: EngineeringIdentityInput,
  resolution: WorkPackageTaxonomyResolution,
  learnedObjectRules: EngineeringObjectRule[] = []
): EngineeringObjectCandidate[] {
  const rulePool = learnedObjectRules.length
    ? [...ENGINEERING_OBJECT_RULES, ...learnedObjectRules]
    : ENGINEERING_OBJECT_RULES;
  const candidates = rulePool.flatMap((rule) => {
    if (
      rule.disciplines?.length &&
      resolution.disciplineId &&
      !rule.disciplines.includes(resolution.disciplineId)
    ) {
      return [];
    }
    const hits = objectTextEvidence(input).flatMap((item) => {
      const matchedPattern = rule.patterns.find((pattern) => new RegExp(pattern, "i").test(item.value));
      return matchedPattern
        ? [{
            score: item.weight + (rule.priority ?? 0),
            source: item.source,
            value: item.value,
            matchedPattern,
          }]
        : [];
    });
    if (hits.length === 0) return [];
    const best = hits.reduce((winner, hit) => (hit.score > winner.score ? hit : winner));
    return [{ rule, ...best }];
  });

  candidates.sort((a, b) => b.score - a.score || b.rule.id.length - a.rule.id.length);
  return candidates.map((c, index) => ({
    identity: `${resolution.disciplineId ?? "?"}.${c.rule.id}`,
    id: c.rule.id,
    label: c.rule.label,
    score: c.score,
    source: c.source,
    value: c.value,
    matchedPattern: c.matchedPattern,
    winner: index === 0,
    ruleOrigin: c.rule.origin ?? "TAXONOMY",
  }));
}

function resolveEngineeringObject(
  input: EngineeringIdentityInput,
  resolution: WorkPackageTaxonomyResolution,
  learnedObjectRules: EngineeringObjectRule[] = []
): EngineeringIdentityComponent {
  const candidates = listEngineeringObjectCandidates(input, resolution, learnedObjectRules);
  const winner = candidates[0];
  if (winner) {
    return {
      id: winner.id,
      label: winner.label,
      evidence: [{
        source: winner.source,
        value: winner.value,
        matched: winner.matchedPattern,
        ruleOrigin: winner.ruleOrigin,
      }],
    };
  }

  const workPackageFallback =
    resolution.workPackageId && !resolution.isUnknownWorkPackage
      ? WORK_PACKAGE_OBJECT_FALLBACKS[resolution.workPackageId]
      : undefined;
  if (workPackageFallback) {
    return {
      ...workPackageFallback,
      evidence: evidence(
        "TAXONOMY",
        resolution.workPackageLabel,
        `work package ${resolution.workPackageId}`
      ),
    };
  }

  const disciplineFallback = resolution.disciplineId
    ? DISCIPLINE_OBJECT_FALLBACKS[resolution.disciplineId]
    : undefined;
  return disciplineFallback
    ? {
        ...disciplineFallback,
        evidence: evidence(
          "TAXONOMY",
          resolution.disciplineLabel,
          `specialist discipline ${resolution.disciplineId}`
        ),
      }
    : { id: null, label: null, evidence: [] };
}

const WORK_PACKAGE_WORK: Record<string, { id: string; label: string }> = {
  reinforcement_detailing: { id: "detailing", label: "Detailing" },
  steelwork: { id: "detailing", label: "Detailing" },
  general_arrangements: { id: "general_arrangement", label: "General Arrangement" },
  wall_elevations: { id: "detailing", label: "Detailing" },
  column_elevations: { id: "detailing", label: "Detailing" },
  meetings: { id: "meeting", label: "Meeting" },
  milestones: { id: "milestone", label: "Milestone" },
  model_coordination: { id: "coordination", label: "Coordination" },
  model_drawing_development: { id: "modelling", label: "Modelling" },
};

function resolveEngineeringWork(
  input: EngineeringIdentityInput,
  resolution: WorkPackageTaxonomyResolution
): EngineeringIdentityComponent {
  const normalised = normaliseDeliverableNameForTaxonomy(input.deliverableName);
  const documentType = extractDocumentType(normalised);
  const explicitRules: Array<{ id: string; label: string; pattern: RegExp }> = [
    { id: "analysis", label: "Analysis", pattern: /\banalys(?:is|es)\b/i },
    // "detailing" (noun/gerund) names an actual production work activity
    // (e.g. "Reinforcement Detailing"). "Detailed" is an adjective that only
    // ever appears here as the RIBA stage descriptor "Detailed Design" — it
    // does not describe a work TYPE and must not be conflated with detailing
    // work. Matching both under one pattern misclassified every bare
    // "Detailed Design" deliverable as detailing work.
    { id: "detailing", label: "Detailing", pattern: /\bdetailing\b/i },
    { id: "general_arrangement", label: "General Arrangement", pattern: /\bgeneral arrangements?\b/i },
    { id: "calculation", label: "Calculation", pattern: /\bcalc(?:ulation)?s?\b/i },
    { id: "coordination", label: "Coordination", pattern: /\bcoordinat(?:e|ion|ing)\b/i },
    { id: "verification", label: "Verification", pattern: /\bverif(?:y|ication)\b/i },
    { id: "inspection", label: "Inspection", pattern: /\binspect(?:ion|ing)?\b/i },
    { id: "review", label: "Review", pattern: /\breview\b/i },
    { id: "modelling", label: "Modelling", pattern: /\bmodel(?:ling|ing)?\b/i },
  ];
  const explicit = explicitRules.find((rule) => rule.pattern.test(normalised));
  if (explicit) {
    return {
      id: explicit.id,
      label: explicit.label,
      evidence: evidence("DELIVERABLE_NAME", input.deliverableName, explicit.pattern.source),
    };
  }

  if (documentType) {
    const byDocumentType: Record<string, { id: string; label: string }> = {
      analysis: { id: "analysis", label: "Analysis" },
      general_arrangement: { id: "general_arrangement", label: "General Arrangement" },
      calculation: { id: "calculation", label: "Calculation" },
      model: { id: "modelling", label: "Modelling" },
      survey: { id: "inspection", label: "Inspection" },
      technical_note: { id: "technical_note", label: "Technical Note" },
      drawing: { id: "design", label: "Design" },
      design_drawing: { id: "design", label: "Design" },
    };
    const work = byDocumentType[documentType.id];
    if (work) {
      return {
        ...work,
        evidence: evidence("DELIVERABLE_NAME", input.deliverableName, documentType.label),
      };
    }
  }

  const workPackageWork =
    resolution.workPackageId && !resolution.isUnknownWorkPackage
      ? WORK_PACKAGE_WORK[resolution.workPackageId]
      : undefined;
  if (workPackageWork) {
    return {
      ...workPackageWork,
      evidence: evidence(
        "TAXONOMY",
        resolution.workPackageLabel,
        `work package ${resolution.workPackageId}`
      ),
    };
  }

  if (resolution.categoryId === "design") {
    return {
      id: "design",
      label: "Design",
      evidence: evidence("TAXONOMY", resolution.categoryLabel, "design category"),
    };
  }

  return { id: null, label: null, evidence: [] };
}

function resolveDeliverableType(
  input: EngineeringIdentityInput,
  resolution: WorkPackageTaxonomyResolution
): EngineeringIdentityComponent {
  const documentType = extractDocumentType(
    normaliseDeliverableNameForTaxonomy(input.deliverableName)
  );
  if (documentType) {
    return {
      id: documentType.id,
      label: documentType.label,
      evidence: evidence("DELIVERABLE_NAME", input.deliverableName, documentType.label),
    };
  }
  const workPackageType: Record<string, { id: string; label: string }> = {
    meetings: { id: "meeting", label: "Meeting" },
    milestones: { id: "milestone", label: "Milestone" },
  };
  const fallback = resolution.workPackageId
    ? workPackageType[resolution.workPackageId]
    : undefined;
  return fallback
    ? {
        ...fallback,
        evidence: evidence("TAXONOMY", resolution.workPackageLabel, fallback.label),
      }
    : { id: null, label: null, evidence: [] };
}

function normaliseLifecycleStage(
  input: EngineeringIdentityInput
): EngineeringIdentityComponent {
  const sources: Array<[EngineeringEvidenceSource, string | null | undefined]> = [
    ["CLASSIFICATION", input.lifecycleStage],
    ["DELIVERABLE_NAME", input.deliverableName],
    ["FRAGNET", input.fragnetName],
    ["PARENT_WBS", input.parentWbs],
  ];
  const stageRules: Array<{ id: string; label: string; pattern: RegExp }> = [
    { id: "ifc", label: "IFC", pattern: /\bifc\b|issued for construction/i },
    { id: "commissioning", label: "Commissioning", pattern: /\bcommissioning\b/i },
    { id: "construction", label: "Construction", pattern: /\bconstruction\b/i },
    { id: "stage_4", label: "Stage 4", pattern: /\b(?:stage|riba)\s*4\b/i },
    { id: "stage_3", label: "Stage 3", pattern: /\b(?:stage|riba)\s*3\b|detailed design/i },
    { id: "stage_2", label: "Stage 2", pattern: /\b(?:stage|riba)\s*2\b|concept design/i },
    { id: "concept", label: "Concept", pattern: /\bconcept\b/i },
  ];
  for (const [source, value] of sources) {
    const actual = text(value);
    if (!actual) continue;
    const rule = stageRules.find((candidate) => candidate.pattern.test(actual));
    if (rule) {
      return {
        id: rule.id,
        label: rule.label,
        evidence: evidence(source, actual, rule.pattern.source),
      };
    }
  }

  if (input.classification === "CONSTRUCTION" || input.classification === "COMMISSIONING") {
    const id = input.classification.toLowerCase();
    return {
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      evidence: evidence("CLASSIFICATION", input.classification, input.classification),
    };
  }
  return { id: null, label: null, evidence: [] };
}

function projectContext(input: EngineeringIdentityInput): EngineeringIdentityComponent {
  const value = text(input.projectContext?.sector) ?? text(input.projectContext?.projectType);
  return value
    ? {
        id: value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
        label: value,
        evidence: evidence("PROJECT_CONTEXT", value, value),
      }
    : { id: null, label: null, evidence: [] };
}

function fragnetContext(input: EngineeringIdentityInput): EngineeringIdentityComponent {
  const value = text(input.fragnetName) ?? text(input.parentWbs) ?? text(input.wbsPath);
  const id = value ? normaliseDeliverableNameForTaxonomy(value) : null;
  return value && id
    ? {
        id,
        label: value,
        evidence: evidence("FRAGNET", value, id),
      }
    : { id: null, label: null, evidence: [] };
}

/**
 * Learned rules merged in at resolution time (spec section 7, Phase 3).
 * Company-scoped, loaded by the caller (engineeringLearnedRule.service.ts)
 * from developer-approved EngineeringLearnedRule records. Every field
 * defaults to empty so omitting this argument entirely reproduces the exact
 * pre-Phase-3 behavior — only OBJECT rules are wired today, matching the
 * only kind the proposal engine currently generates.
 */
export type EngineeringLearnedRuleOverlay = {
  objectRules?: EngineeringObjectRule[];
};

export function resolveEngineeringIdentity(
  input: EngineeringIdentityInput,
  learnedRules: EngineeringLearnedRuleOverlay = {}
): EngineeringIdentity {
  const resolution = resolveWorkPackageTaxonomy(input);
  const discipline: EngineeringIdentityComponent = {
    id: resolution.matched ? resolution.disciplineId : null,
    label: resolution.matched ? resolution.disciplineLabel : null,
    evidence: taxonomyDisciplineEvidence(resolution, input),
  };
  const engineeringObject = resolveEngineeringObject(input, resolution, learnedRules.objectRules ?? []);
  const engineeringWork = resolveEngineeringWork(input, resolution);
  const deliverableType = resolveDeliverableType(input, resolution);
  const lifecycleStage = normaliseLifecycleStage(input);
  const resolvedProjectContext = projectContext(input);
  const resolvedFragnetContext = fragnetContext(input);
  const components = [
    discipline,
    engineeringObject,
    engineeringWork,
    deliverableType,
    lifecycleStage,
    resolvedProjectContext,
    resolvedFragnetContext,
  ];

  return {
    status:
      discipline.id && engineeringObject.id && engineeringWork.id
        ? "RESOLVED"
        : "INSUFFICIENT",
    discipline,
    engineeringObject,
    engineeringWork,
    deliverableType,
    lifecycleStage,
    projectContext: resolvedProjectContext,
    fragnetContext: resolvedFragnetContext,
    taxonomy: {
      taxonomyKey: resolution.matched ? resolution.taxonomyKey : null,
      categoryId: resolution.matched ? resolution.categoryId : null,
      workPackageId: resolution.matched ? resolution.workPackageId : null,
      isUnknownWorkPackage: resolution.isUnknownWorkPackage,
    },
    supportingEvidence: components.flatMap((component) => component.evidence),
  };
}

function compareComponent(
  component: EngineeringIdentityComparisonComponent,
  role: EngineeringIdentityComparisonCheck["role"],
  target: EngineeringIdentityComponent,
  candidate: EngineeringIdentityComponent
): EngineeringIdentityComparisonCheck {
  const result =
    !target.id || !candidate.id
      ? "UNKNOWN"
      : target.id === candidate.id
        ? "MATCH"
        : "MISMATCH";
  return { component, role, target: target.id, candidate: candidate.id, result };
}

export function compareEngineeringIdentities(
  target: EngineeringIdentity,
  candidate: EngineeringIdentity
): EngineeringIdentityComparison {
  const checks: EngineeringIdentityComparisonCheck[] = [
    compareComponent("DISCIPLINE", "IDENTITY", target.discipline, candidate.discipline),
    compareComponent(
      "ENGINEERING_OBJECT",
      "IDENTITY",
      target.engineeringObject,
      candidate.engineeringObject
    ),
    compareComponent(
      "ENGINEERING_WORK",
      "IDENTITY",
      target.engineeringWork,
      candidate.engineeringWork
    ),
    compareComponent(
      "DELIVERABLE_TYPE",
      "SOFT_IDENTITY",
      target.deliverableType,
      candidate.deliverableType
    ),
    compareComponent(
      "LIFECYCLE_STAGE",
      "DESCRIPTOR",
      target.lifecycleStage,
      candidate.lifecycleStage
    ),
    compareComponent(
      "PROJECT_CONTEXT",
      "DESCRIPTOR",
      target.projectContext,
      candidate.projectContext
    ),
    compareComponent(
      "FRAGNET_CONTEXT",
      "DESCRIPTOR",
      target.fragnetContext,
      candidate.fragnetContext
    ),
  ];
  const identityChecks = checks.filter((check) => check.role === "IDENTITY");
  const gatingChecks = checks.filter(
    (check) => check.role === "IDENTITY" || check.role === "SOFT_IDENTITY"
  );
  // Any gating check (hard or soft identity) that definitively conflicts rejects
  // equivalence. Only the hard IDENTITY checks (discipline/object/work) also
  // reject on UNKNOWN — a soft identity check left unresolved on either side is
  // not treated as a conflict.
  const rejectedBy = gatingChecks
    .filter((check) => check.result === "MISMATCH")
    .map((check) => check.component);
  const hasUnknownIdentity = identityChecks.some((check) => check.result === "UNKNOWN");
  const equivalent = rejectedBy.length === 0 && !hasUnknownIdentity;

  return {
    equivalent,
    reason: equivalent
      ? "EQUIVALENT"
      : rejectedBy.length > 0
        ? "CONTRADICTORY_IDENTITY"
        : "INSUFFICIENT_IDENTITY",
    checks,
    matchedIdentityComponents: identityChecks
      .filter((check) => check.result === "MATCH")
      .map((check) => check.component),
    rejectedBy,
  };
}
