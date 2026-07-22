import type {
  DeliverableClassification,
  ProgrammeSnapshotRole,
  ProgrammeState,
  Prisma,
} from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import { conceptSubject } from "./intelligence/diagnostics/engineeringBrainDiagnostics.service.js";
import {
  isEngineeringKnowledgeStoreAvailable,
  loadEngineeringKnowledge,
  type StoredEngineeringKnowledge,
} from "./intelligence/diagnostics/engineeringKnowledgeStore.service.js";
import { loadActiveLearnedObjectRules } from "./intelligence/diagnostics/engineeringLearnedRule.service.js";
import {
  compareEngineeringIdentities,
  resolveEngineeringIdentity,
  type EngineeringIdentity,
  type EngineeringIdentityComponent,
  type EngineeringEvidenceSource,
} from "./intelligence/taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "./intelligence/taxonomy/engineeringIdentityValidation.service.js";
import { engineeringIdentityFingerprint } from "./intelligence/taxonomy/engineeringTrust.service.js";
import {
  buildEngineeringReasoningContextForDurationTarget,
  isEngineeringReasoningActive,
  runBoundedEngineeringReasoning,
} from "./intelligence/taxonomy/engineeringReasoningOrchestration.service.js";
import { classifyDeliverableName } from "./intelligence/profiles/deliverableClassification.service.js";
import { P6_HOURS_PER_DAY } from "./intelligence/shared/types.js";
import {
  ENGINEERING_OBJECT_RULES,
  type EngineeringObjectRule,
} from "./intelligence/taxonomy/engineeringVocabulary.data.js";

/** Rough starting point — tune once more project history exists; not validated. */
export const LOW_NAME_CONSISTENCY_THRESHOLD = 0.3;

/** Minimum stem length after suffix stripping — avoid mangling short tokens. */
const MIN_STEM_LENGTH = 4;

/**
 * Conservative suffix strip for deliverable-name tokens.
 * Plural first, then verbal (-ing/-ed), so "meetings" and "meeting" both → "meet".
 * "es" only after s/x/z/ch/sh so "foundations" → "foundation" (via plain "s"), not "foundati".
 */
function lightStem(token: string): string {
  if (token.length < MIN_STEM_LENGTH + 1) return token;

  let stemmed = token;
  if (
    /(?:[sxz]|ch|sh)es$/i.test(stemmed) &&
    stemmed.length - 2 >= MIN_STEM_LENGTH
  ) {
    stemmed = stemmed.slice(0, -2);
  } else if (
    stemmed.endsWith("s") &&
    !stemmed.endsWith("ss") &&
    stemmed.length - 1 >= MIN_STEM_LENGTH
  ) {
    stemmed = stemmed.slice(0, -1);
  }

  if (stemmed.endsWith("ing") && stemmed.length - 3 >= MIN_STEM_LENGTH) {
    return stemmed.slice(0, -3);
  }
  if (stemmed.endsWith("ed") && stemmed.length - 2 >= MIN_STEM_LENGTH) {
    return stemmed.slice(0, -2);
  }
  return stemmed;
}

const OBJECT_RULES_BY_PRIORITY = [...ENGINEERING_OBJECT_RULES].sort(
  (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
);

const COMPILED_OBJECT_RULES = OBJECT_RULES_BY_PRIORITY.map((rule) => ({
  id: rule.id,
  patterns: rule.patterns.map((pattern) => new RegExp(pattern, "i")),
}));

/**
 * Collapse known engineering-object synonyms to the rule id
 * (e.g. rebar / reinforcement → "reinforcement"). Read-only reuse of taxonomy.
 * Prefer matching the raw token before stemming so "footing" hits `\bfootings?\b`
 * instead of being mangled to "foot" first.
 */
function canonicalizeToken(token: string): string | null {
  for (const rule of COMPILED_OBJECT_RULES) {
    for (const re of rule.patterns) {
      if (re.test(token)) {
        return rule.id;
      }
    }
  }
  return null;
}

function normaliseToken(token: string): string {
  const direct = canonicalizeToken(token);
  if (direct) return direct;
  const stemmed = lightStem(token);
  return canonicalizeToken(stemmed) ?? stemmed;
}

function normaliseForSimilarity(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length >= 3)
      .map((token) => normaliseToken(token))
  );
}

export function nameSimilarity(a: string, b: string): number {
  const setA = normaliseForSimilarity(a);
  const setB = normaliseForSimilarity(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter((token) => setB.has(token)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export const STRICT_ORIGINAL_DURATION_DEFINITION = {
  measure: "HISTORICAL_PLANNED_WORK_PACKAGE_DURATION",
  aggregation: "MAX_ACTIVITY_ORIGINAL_DURATION",
  source: "ACTIVITY_SNAPSHOT_ORIGINAL_DURATION",
  liveFallbackSource: "CURRENT_BEST_PLANNING_DURATION_NORMALISED_FROM_P6_HOURS",
  unit: "PLANNING_DAYS",
  fallbacksPossible: false,
} as const;

export type HistoricalDurationTarget = {
  key: string;
  deliverableId?: string;
  name?: string;
};

export type HistoricalDurationStatistics = {
  available: boolean;
  projectsUsed: number;
  sampleCount: number;
  minimumDays: number | null;
  averageDays: number | null;
  maximumDays: number | null;
};

export type HistoricalComparisonBasis =
  | "SAME_FRAGNET"
  | "SAME_DISCIPLINE"
  | "ORGANISATION_WIDE";

export type HistoricalDurationItem = {
  key: string;
  deliverableId: string | null;
  name: string;
  matchMode: "FULL_DELIVERABLE_CONTEXT" | "NAME_ONLY";
  provisional: boolean;
  statistics: HistoricalDurationStatistics;
  comparisonBasis: HistoricalComparisonBasis | null;
  contributingProjects: Array<{
    projectId: string;
    projectName: string;
    matchedDeliverableName: string;
    fragnetName: string | null;
    planningDurationDays: number;
  }>;
  projectDiagnostics: Array<{
    projectId: string;
    projectName: string;
    used: boolean;
    reason:
      | "USED"
      | "NO_EQUIVALENT_DELIVERABLE"
      | "NO_PLANNING_DURATION"
      | "CLOSER_COMPARISON_AVAILABLE";
  }>;
  unavailableReason:
    | "NO_MATCHING_DELIVERABLES"
    | "NO_HISTORICAL_PLANNING_DATA"
    | null;
};

type TargetContext = Omit<HistoricalDurationTarget, "deliverableId" | "name"> & {
  deliverableId: string | null;
  name: string;
  fragnetName: string | null;
  classification: DeliverableClassification | null;
  lifecycleStage?: string | null;
  projectContext?: {
    sector?: string | null;
    projectType?: string | null;
  } | null;
  relatedActivityNames?: string[];
  provisional: boolean;
};

export type HistoricalSnapshotInput = {
  id: string;
  projectId: string;
  projectName: string;
  importedAt: Date;
  snapshotVersion: number;
  snapshotRole: ProgrammeSnapshotRole | null;
  programmeState: ProgrammeState | null;
  sector?: string | null;
  projectType?: string | null;
  stage?: string | null;
  deliverableSnapshots: Array<{
    deliverableId: string | null;
    name: string;
    classification: DeliverableClassification | null;
    fragnetId: string | null;
    parentWbs: string | null;
    wbsPath: string | null;
    stage?: string | null;
    discipline: string | null;
    classificationTags: Prisma.JsonValue;
    reasonedDiscipline?: string | null;
    reasonedEngineeringObject?: string | null;
    reasonedEngineeringWork?: string | null;
    reasonedDeliverableType?: string | null;
    reasonedLifecycleStage?: string | null;
    /** Non-null means use stored reasoned* fields; null falls back to rule-based. */
    reasoningSource?: string | null;
  }>;
  activitySnapshots: Array<{
    deliverableId: string | null;
    originalDuration: number | null;
    name?: string | null;
    classificationTags?: Prisma.JsonValue;
  }>;
};

export type HistoricalLiveProjectInput = {
  projectId: string;
  projectName: string;
  projectContext?: {
    sector?: string | null;
    projectType?: string | null;
    stage?: string | null;
  } | null;
  deliverables: Array<{
    deliverableId: string;
    name: string;
    classification: DeliverableClassification | null;
    fragnetName: string | null;
    bestDuration: number | null;
    activities: Array<{
      bestDuration: number | null;
      name?: string | null;
    }>;
  }>;
};

function classificationTags(value: Prisma.JsonValue): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function activityCodeDiscipline(
  activities: HistoricalSnapshotInput["activitySnapshots"]
): string | null {
  for (const activity of activities) {
    const tags = activity.classificationTags
      ? classificationTags(activity.classificationTags)
      : null;
    if (!tags) continue;
    for (const [key, value] of Object.entries(tags)) {
      if (!key.toLowerCase().includes("discipline")) continue;
      const resolved = String(value ?? "").trim();
      if (resolved) return resolved;
    }
  }
  return null;
}

type EngineeringIdentityInput = {
  name: string;
  fragnetName?: string | null;
  parentWbs?: string | null;
  wbsPath?: string | null;
  discipline?: string | null;
  activityCodeDiscipline?: string | null;
  classificationTags?: Record<string, unknown> | null;
  classification?: DeliverableClassification | null;
  lifecycleStage?: string | null;
  projectContext?: {
    sector?: string | null;
    projectType?: string | null;
  } | null;
  relatedActivityNames?: string[];
};

const NULL_IDENTITY_COMPONENT: EngineeringIdentityComponent = {
  id: null,
  label: null,
  evidence: [],
};

function engineeringIdentity(
  input: EngineeringIdentityInput,
  learnedObjectRules: EngineeringObjectRule[] = []
): EngineeringIdentity {
  // Validation gate: reject internally contradictory identities before any
  // historical comparison. Rule-based identities are consistent by
  // construction, so this is inert for extraction but fails closed if a
  // reasoning-produced identity ever contradicts itself.
  return enforceEngineeringIdentityValidation(
    resolveEngineeringIdentity(
      {
        deliverableName: input.name,
        fragnetName: input.fragnetName,
        parentWbs: input.parentWbs,
        wbsPath: input.wbsPath,
        disciplineTag: input.discipline,
        activityCodeDiscipline: input.activityCodeDiscipline,
        classificationTags: input.classificationTags,
        classification: input.classification,
        lifecycleStage: input.lifecycleStage,
        projectContext: input.projectContext,
        relatedActivityNames: input.relatedActivityNames,
      },
      { objectRules: learnedObjectRules }
    )
  );
}

function componentFromStoredId(id: string | null): EngineeringIdentityComponent {
  return id ? { id, label: id, evidence: [] } : NULL_IDENTITY_COMPONENT;
}

/**
 * Same shape as componentFromStoredId, but for persisted/live LLM reasoning output
 * rather than a developer-reviewed knowledge decision. These carry very different
 * trust levels — a developer decision means a human explicitly confirmed the
 * equivalence; a reasoned column is just an unreviewed model guess (whether made
 * live or written by the backfill script). Tagging it with a TAXONOMY-sourced
 * evidence entry (matching how live reasoning already marks itself in
 * mergeReasonedIdentity/componentFrom) means requiresCorroboration treats
 * reasoning-derived components consistently, however they were produced —
 * without this, a backfilled reasoning guess for one deliverable was silently
 * exempted from corroboration just because it happened to carry no other evidence.
 */
function componentFromReasonedId(id: string | null): EngineeringIdentityComponent {
  return id
    ? { id, label: id, evidence: [{ source: "TAXONOMY", value: "engineering reasoning", matched: id }] }
    : NULL_IDENTITY_COMPONENT;
}

function rejectedEngineeringIdentity(): EngineeringIdentity {
  return {
    status: "INSUFFICIENT",
    discipline: NULL_IDENTITY_COMPONENT,
    engineeringObject: NULL_IDENTITY_COMPONENT,
    engineeringWork: NULL_IDENTITY_COMPONENT,
    deliverableType: NULL_IDENTITY_COMPONENT,
    lifecycleStage: NULL_IDENTITY_COMPONENT,
    projectContext: NULL_IDENTITY_COMPONENT,
    fragnetContext: NULL_IDENTITY_COMPONENT,
    taxonomy: {
      taxonomyKey: null,
      categoryId: null,
      workPackageId: null,
      isUnknownWorkPackage: false,
    },
    supportingEvidence: [],
  };
}

function applyKnowledgeDecision(
  raw: EngineeringIdentity,
  decision: StoredEngineeringKnowledge | undefined
): EngineeringIdentity {
  if (!decision) return raw;
  if (decision.status === "REJECTED") {
    return rejectedEngineeringIdentity();
  }
  if (decision.status !== "DEVELOPER_APPROVED" && decision.status !== "DEVELOPER_MODIFIED") {
    return raw;
  }
  const stored = decision.identity;
  const discipline = componentFromStoredId(stored.discipline);
  const engineeringObject = componentFromStoredId(stored.engineeringObject);
  const engineeringWork = componentFromStoredId(stored.engineeringWork);
  const deliverableType = componentFromStoredId(stored.deliverableType);
  const lifecycleStage = componentFromStoredId(stored.lifecycleStage);
  const status =
    discipline.id && engineeringObject.id && engineeringWork.id ? "RESOLVED" : "INSUFFICIENT";
  return {
    ...raw,
    status,
    discipline,
    engineeringObject,
    engineeringWork,
    deliverableType,
    lifecycleStage,
  };
}

/**
 * Overlay pre-computed reasoned identity components onto a rule-based base identity.
 * Same component-building approach as applyKnowledgeDecision — keeps fragnet/project
 * context from the base while replacing the identity components that reasoning owns.
 */
function applyStoredReasonedIdentity(
  raw: EngineeringIdentity,
  stored: {
    reasonedDiscipline?: string | null;
    reasonedEngineeringObject?: string | null;
    reasonedEngineeringWork?: string | null;
    reasonedDeliverableType?: string | null;
    reasonedLifecycleStage?: string | null;
    reasoningSource?: string | null;
  }
): EngineeringIdentity {
  if (stored.reasoningSource == null) return raw;
  const discipline = componentFromReasonedId(stored.reasonedDiscipline ?? null);
  const engineeringObject = componentFromReasonedId(stored.reasonedEngineeringObject ?? null);
  const engineeringWork = componentFromReasonedId(stored.reasonedEngineeringWork ?? null);
  const deliverableType = componentFromReasonedId(stored.reasonedDeliverableType ?? null);
  const lifecycleStage = componentFromReasonedId(stored.reasonedLifecycleStage ?? null);
  const status =
    discipline.id && engineeringObject.id && engineeringWork.id ? "RESOLVED" : "INSUFFICIENT";
  return {
    ...raw,
    status,
    discipline,
    engineeringObject,
    engineeringWork,
    deliverableType,
    lifecycleStage,
  };
}

function resolveCandidateIdentityFromSnapshot(
  input: EngineeringIdentityInput,
  stored: {
    reasonedDiscipline?: string | null;
    reasonedEngineeringObject?: string | null;
    reasonedEngineeringWork?: string | null;
    reasonedDeliverableType?: string | null;
    reasonedLifecycleStage?: string | null;
    reasoningSource?: string | null;
  },
  knowledge: Map<string, StoredEngineeringKnowledge>,
  useKnowledge: boolean,
  learnedObjectRules: EngineeringObjectRule[] = []
): EngineeringIdentity {
  // Fingerprint always uses rule-based signature so existing knowledge-store
  // decisions continue to look up correctly.
  const raw = engineeringIdentity(input, learnedObjectRules);
  const withReasoning = applyStoredReasonedIdentity(raw, stored);
  if (!useKnowledge) return withReasoning;
  const fingerprint = engineeringIdentityFingerprint(conceptSubject(input.name).key, raw);
  return applyKnowledgeDecision(withReasoning, knowledge.get(fingerprint));
}

function resolveTargetIdentity(
  target: TargetContext,
  knowledge: Map<string, StoredEngineeringKnowledge>,
  useKnowledge: boolean,
  reasonedTargetIdentities?: Map<string, EngineeringIdentity>,
  learnedObjectRules: EngineeringObjectRule[] = []
): EngineeringIdentity {
  const input: EngineeringIdentityInput = {
    name: target.name,
    fragnetName: target.provisional ? null : target.fragnetName,
    classification: target.classification,
    lifecycleStage: target.lifecycleStage,
    projectContext: target.projectContext,
    relatedActivityNames: target.relatedActivityNames,
  };
  if (reasonedTargetIdentities?.has(target.key)) {
    const raw = engineeringIdentity(input, learnedObjectRules);
    const reasoned = reasonedTargetIdentities.get(target.key)!;
    if (!useKnowledge) return reasoned;
    const fingerprint = engineeringIdentityFingerprint(conceptSubject(input.name).key, raw);
    return applyKnowledgeDecision(reasoned, knowledge.get(fingerprint));
  }
  return resolveIdentityWithReview(input, knowledge, useKnowledge, learnedObjectRules);
}

function resolveIdentityWithReview(
  input: EngineeringIdentityInput,
  knowledge: Map<string, StoredEngineeringKnowledge>,
  useKnowledge: boolean,
  learnedObjectRules: EngineeringObjectRule[] = []
): EngineeringIdentity {
  const raw = engineeringIdentity(input, learnedObjectRules);
  if (!useKnowledge) return raw;
  const fingerprint = engineeringIdentityFingerprint(conceptSubject(input.name).key, raw);
  return applyKnowledgeDecision(raw, knowledge.get(fingerprint));
}

/**
 * Evidence sources that describe THIS specific deliverable's own content directly —
 * its own name, the concrete activities actually carried out under it, or an
 * explicit metadata/classification tag applied to it. These are trusted on their
 * own for equivalence purposes.
 *
 * Every other source describes the CONTAINER a deliverable happens to sit in
 * (fragnet, parent WBS, WBS path) or a generic taxonomy fallback bucket — a
 * folder-level label, not a statement about what this deliverable specifically is.
 * Treat these the same way as an unauthenticated boundary at the edge of the
 * Engineering Brain: never trust a match on container/fallback evidence alone,
 * require independent corroboration (name similarity) before letting it through.
 */
const STRONG_EVIDENCE_SOURCES = new Set<EngineeringEvidenceSource>([
  "DELIVERABLE_NAME",
  "RELATED_ACTIVITY",
  "DISCIPLINE_METADATA",
  "CLASSIFICATION",
]);

/**
 * True when a component's id came from container-level or fallback evidence
 * (FRAGNET, PARENT_WBS, WBS_PATH, TAXONOMY) rather than something that actually
 * describes this deliverable directly. Audit finding (2026-07): matching gated
 * only on discipline/object/work meant deliverables that only agreed because they
 * shared a fragnet name, WBS location, or generic taxonomy fallback (e.g. every
 * "*_design" work package falling back to one coarse object, or two deliverables
 * merely sitting in similarly-named fragnets) were treated as fully equivalent
 * regardless of what they actually are. Across real project data, 92% of matches
 * had near-zero name overlap with at least one contributing match, and 23% had a
 * 3x+ duration spread (worst case 95x) before this check existed; a fallback-only
 * version of this check still missed cases driven purely by shared fragnet naming.
 */
function requiresCorroboration(component: EngineeringIdentityComponent): boolean {
  // Developer-approved knowledge decisions and stored/live LLM reasoning overrides both
  // go through componentFromStoredId, which always produces an empty evidence array —
  // that's not a weak signal, it's the strongest one available: a human explicitly
  // confirmed the equivalence, or reasoning explicitly concluded it, specifically to
  // override a case the automated rules couldn't see (that's the whole point of the
  // review workflow). Never demand corroboration for those. Only rule-based resolution
  // can produce a non-null id with real evidence, so this check only ever narrows what
  // the rule-based path already produced.
  if (component.evidence.length === 0) return false;
  const source = component.evidence[0]?.source;
  return source == null || !STRONG_EVIDENCE_SOURCES.has(source);
}

function componentMatchNeedsCorroboration(
  target: EngineeringIdentityComponent,
  candidate: EngineeringIdentityComponent
): boolean {
  return (
    target.id != null &&
    candidate.id != null &&
    target.id === candidate.id &&
    (requiresCorroboration(target) || requiresCorroboration(candidate))
  );
}

/**
 * When a matched identity component was resolved via container-level or fallback
 * evidence on either side, require the deliverable names to clear the existing
 * (previously unused) name-similarity threshold before trusting the match.
 * Components resolved from strong, deliverable-specific evidence are left exactly
 * as before — this only tightens the cases that were already just guesses.
 */
function isCorroboratedEquivalence(
  target: EngineeringIdentity,
  candidate: EngineeringIdentity,
  targetName: string,
  candidateName: string
): boolean {
  const anyMatchNeedsCorroboration =
    componentMatchNeedsCorroboration(target.discipline, candidate.discipline) ||
    componentMatchNeedsCorroboration(target.engineeringObject, candidate.engineeringObject) ||
    componentMatchNeedsCorroboration(target.engineeringWork, candidate.engineeringWork);
  if (!anyMatchNeedsCorroboration) return true;
  return nameSimilarity(targetName, candidateName) >= LOW_NAME_CONSISTENCY_THRESHOLD;
}

function comparisonBasis(
  target: EngineeringIdentity,
  candidate: EngineeringIdentity
): HistoricalComparisonBasis {
  if (
    target.fragnetContext.id &&
    candidate.fragnetContext.id &&
    target.fragnetContext.id === candidate.fragnetContext.id
  ) {
    return "SAME_FRAGNET";
  }
  if (
    target.discipline.id &&
    candidate.discipline.id &&
    target.discipline.id === candidate.discipline.id
  ) {
    return "SAME_DISCIPLINE";
  }
  return "ORGANISATION_WIDE";
}

/** Legacy current-project imports retain Primavera planning durations in hours. */
export function currentPlanningDurationDays(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Math.round((value / P6_HOURS_PER_DAY) * 100) / 100;
}

type PlanningObservation = {
  durationDays: number;
  basis: HistoricalComparisonBasis;
  matchedDeliverableName: string;
  fragnetName: string | null;
};

type PrecomputedSnapshotCandidate = {
  deliverable: HistoricalSnapshotInput["deliverableSnapshots"][number];
  candidateIdentity: EngineeringIdentity;
  fragnetName: string | null;
};

type PrecomputedSnapshotContext = {
  snapshot: HistoricalSnapshotInput;
  activitiesByDeliverable: Map<string, HistoricalSnapshotInput["activitySnapshots"]>;
  candidates: PrecomputedSnapshotCandidate[];
};

type PrecomputedLiveCandidate = {
  deliverable: HistoricalLiveProjectInput["deliverables"][number];
  candidateIdentity: EngineeringIdentity;
  fragnetName: string | null;
};

type PrecomputedLiveContext = {
  project: HistoricalLiveProjectInput;
  candidates: PrecomputedLiveCandidate[];
};

function buildActivitiesByDeliverable(
  snapshot: HistoricalSnapshotInput
): Map<string, HistoricalSnapshotInput["activitySnapshots"]> {
  const activitiesByDeliverable = new Map<
    string,
    HistoricalSnapshotInput["activitySnapshots"]
  >();
  for (const activity of snapshot.activitySnapshots) {
    if (!activity.deliverableId) continue;
    const existing = activitiesByDeliverable.get(activity.deliverableId) ?? [];
    existing.push(activity);
    activitiesByDeliverable.set(activity.deliverableId, existing);
  }
  return activitiesByDeliverable;
}

function precomputeSnapshotCandidates(
  snapshot: HistoricalSnapshotInput,
  knowledge: Map<string, StoredEngineeringKnowledge>,
  useKnowledge: boolean,
  learnedObjectRules: EngineeringObjectRule[] = []
): PrecomputedSnapshotContext {
  const activitiesByDeliverable = buildActivitiesByDeliverable(snapshot);
  const candidates = snapshot.deliverableSnapshots.map((deliverable) => {
    const relatedActivities = deliverable.deliverableId
      ? activitiesByDeliverable.get(deliverable.deliverableId) ?? []
      : [];
    const candidateIdentity = resolveCandidateIdentityFromSnapshot(
      {
        name: deliverable.name,
        parentWbs: deliverable.parentWbs,
        wbsPath: deliverable.wbsPath,
        discipline: deliverable.discipline,
        activityCodeDiscipline: activityCodeDiscipline(relatedActivities),
        classificationTags: classificationTags(deliverable.classificationTags),
        classification: deliverable.classification,
        lifecycleStage: deliverable.stage ?? snapshot.stage,
        projectContext: {
          sector: snapshot.sector,
          projectType: snapshot.projectType,
        },
        relatedActivityNames: relatedActivities
          .map((activity) => activity.name?.trim())
          .filter((name): name is string => Boolean(name)),
      },
      deliverable,
      knowledge,
      useKnowledge,
      learnedObjectRules
    );
    return {
      deliverable,
      candidateIdentity,
      fragnetName: deliverable.parentWbs ?? deliverable.wbsPath ?? null,
    };
  });
  return { snapshot, activitiesByDeliverable, candidates };
}

function precomputeLiveCandidates(
  project: HistoricalLiveProjectInput,
  knowledge: Map<string, StoredEngineeringKnowledge>,
  useKnowledge: boolean,
  learnedObjectRules: EngineeringObjectRule[] = []
): PrecomputedLiveContext {
  const candidates = project.deliverables.map((deliverable) => ({
    deliverable,
    candidateIdentity: resolveIdentityWithReview(
      {
        name: deliverable.name,
        fragnetName: deliverable.fragnetName,
        classification: deliverable.classification,
        lifecycleStage: project.projectContext?.stage,
        projectContext: project.projectContext,
        relatedActivityNames: deliverable.activities
          .map((activity) => activity.name?.trim())
          .filter((name): name is string => Boolean(name)),
      },
      knowledge,
      useKnowledge,
      learnedObjectRules
    ),
    fragnetName: deliverable.fragnetName,
  }));
  return { project, candidates };
}

function highestDurationObservation(
  observations: PlanningObservation[]
): PlanningObservation | null {
  return observations.reduce<PlanningObservation | null>(
    (highest, observation) =>
      !highest || observation.durationDays > highest.durationDays ? observation : highest,
    null
  );
}

function emptyStatistics(): HistoricalDurationStatistics {
  return {
    available: false,
    projectsUsed: 0,
    sampleCount: 0,
    minimumDays: null,
    averageDays: null,
    maximumDays: null,
  };
}

export function computeStrictOriginalDurationItems(
  targets: TargetContext[],
  snapshots: HistoricalSnapshotInput[],
  liveProjects: HistoricalLiveProjectInput[] = [],
  knowledge: Map<string, StoredEngineeringKnowledge> = new Map(),
  useKnowledge = false,
  reasonedTargetIdentities?: Map<string, EngineeringIdentity>,
  /**
   * Active, developer-approved learned object rules (spec section 7, Phase
   * 3). Plain data, not a companyId — the caller loads these once via
   * loadActiveLearnedObjectRules and passes them in, keeping this function
   * itself free of any DB access (see the many tests in
   * tests/integration/deliverable-duration-statistics-presentation.test.mjs,
   * none of which pass this and all of which must keep behaving exactly as
   * before).
   */
  learnedObjectRules: EngineeringObjectRule[] = []
): HistoricalDurationItem[] {
  const latestSnapshotByProject = new Map<string, HistoricalSnapshotInput>();
  for (const snapshot of snapshots) {
    const existing = latestSnapshotByProject.get(snapshot.projectId);
    if (
      !existing ||
      snapshot.importedAt.getTime() > existing.importedAt.getTime() ||
      (snapshot.importedAt.getTime() === existing.importedAt.getTime() &&
        snapshot.snapshotVersion > existing.snapshotVersion)
    ) {
      latestSnapshotByProject.set(snapshot.projectId, snapshot);
    }
  }
  const snapshotProjectIds = new Set(latestSnapshotByProject.keys());
  const eligibleLiveProjects = liveProjects.filter(
    (project) => !snapshotProjectIds.has(project.projectId)
  );

  const precomputedSnapshots = [...latestSnapshotByProject.values()].map((snapshot) =>
    precomputeSnapshotCandidates(snapshot, knowledge, useKnowledge, learnedObjectRules)
  );
  const precomputedLiveProjects = eligibleLiveProjects.map((project) =>
    precomputeLiveCandidates(project, knowledge, useKnowledge, learnedObjectRules)
  );

  return targets.map((target) => {
    const targetIdentity = resolveTargetIdentity(
      target,
      knowledge,
      useKnowledge,
      reasonedTargetIdentities,
      learnedObjectRules
    );
    let matchingProjectCount = 0;
    const samplesByBasis: Record<
      HistoricalComparisonBasis,
      Array<{
        durationDays: number;
        projectId: string;
        projectName: string;
        matchedDeliverableName: string;
        fragnetName: string | null;
      }>
    > = {
      SAME_FRAGNET: [],
      SAME_DISCIPLINE: [],
      ORGANISATION_WIDE: [],
    };
    const consideredProjects: Array<{
      projectId: string;
      projectName: string;
      matched: boolean;
      hasPlanningDuration: boolean;
    }> = [];

    for (const { snapshot, activitiesByDeliverable, candidates } of precomputedSnapshots) {
      const matchingDeliverables = candidates.flatMap(
        ({ deliverable, candidateIdentity, fragnetName }) => {
          if (!compareEngineeringIdentities(targetIdentity, candidateIdentity).equivalent) {
            return [];
          }
          if (
            !isCorroboratedEquivalence(targetIdentity, candidateIdentity, target.name, deliverable.name)
          ) {
            return [];
          }
          return [{
            deliverable,
            basis: comparisonBasis(targetIdentity, candidateIdentity),
            fragnetName,
          }];
        }
      );

      if (matchingDeliverables.length === 0) {
        consideredProjects.push({
          projectId: snapshot.projectId,
          projectName: snapshot.projectName,
          matched: false,
          hasPlanningDuration: false,
        });
        continue;
      }
      matchingProjectCount += 1;
      const observations: PlanningObservation[] = matchingDeliverables.flatMap(
        ({ deliverable, basis, fragnetName }) => {
        const originals = (deliverable.deliverableId
          ? activitiesByDeliverable.get(deliverable.deliverableId) ?? []
          : [])
          .filter(
            (activity) =>
              activity.originalDuration != null &&
              Number.isFinite(activity.originalDuration) &&
              activity.originalDuration > 0
          )
          .map((activity) => activity.originalDuration as number);
        const durationDays = originals.length > 0 ? Math.max(...originals) : null;
        if (durationDays == null) return [];
        return [{
          durationDays,
          basis,
          matchedDeliverableName: deliverable.name,
          fragnetName,
        }];
      });
      consideredProjects.push({
        projectId: snapshot.projectId,
        projectName: snapshot.projectName,
        matched: true,
        hasPlanningDuration: observations.length > 0,
      });
      const organisationObservation = highestDurationObservation(observations);
      if (organisationObservation) {
        samplesByBasis.ORGANISATION_WIDE.push({
          durationDays: organisationObservation.durationDays,
          projectId: snapshot.projectId,
          projectName: snapshot.projectName,
          matchedDeliverableName: organisationObservation.matchedDeliverableName,
          fragnetName: organisationObservation.fragnetName,
        });
      }
      const disciplineObservation = highestDurationObservation(
        observations.filter((observation) => observation.basis !== "ORGANISATION_WIDE")
      );
      if (disciplineObservation) {
        samplesByBasis.SAME_DISCIPLINE.push({
          durationDays: disciplineObservation.durationDays,
          projectId: snapshot.projectId,
          projectName: snapshot.projectName,
          matchedDeliverableName: disciplineObservation.matchedDeliverableName,
          fragnetName: disciplineObservation.fragnetName,
        });
      }
      const fragnetObservation = highestDurationObservation(
        observations.filter((observation) => observation.basis === "SAME_FRAGNET")
      );
      if (fragnetObservation) {
        samplesByBasis.SAME_FRAGNET.push({
          durationDays: fragnetObservation.durationDays,
          projectId: snapshot.projectId,
          projectName: snapshot.projectName,
          matchedDeliverableName: fragnetObservation.matchedDeliverableName,
          fragnetName: fragnetObservation.fragnetName,
        });
      }
    }

    for (const { project, candidates } of precomputedLiveProjects) {
      const matchingDeliverables = candidates.flatMap(
        ({ deliverable, candidateIdentity, fragnetName }) => {
          if (!compareEngineeringIdentities(targetIdentity, candidateIdentity).equivalent) {
            return [];
          }
          if (
            !isCorroboratedEquivalence(targetIdentity, candidateIdentity, target.name, deliverable.name)
          ) {
            return [];
          }
          return [{
            deliverable,
            basis: comparisonBasis(targetIdentity, candidateIdentity),
            fragnetName,
          }];
        }
      );

      if (matchingDeliverables.length === 0) {
        consideredProjects.push({
          projectId: project.projectId,
          projectName: project.projectName,
          matched: false,
          hasPlanningDuration: false,
        });
        continue;
      }
      matchingProjectCount += 1;
      const observations: PlanningObservation[] = matchingDeliverables.flatMap(
        ({ deliverable, basis, fragnetName }) => {
        const activityDurations = deliverable.activities
          .map((activity) => currentPlanningDurationDays(activity.bestDuration))
          .filter((duration): duration is number => duration != null);
        const durationDays =
          activityDurations.length > 0
            ? Math.max(...activityDurations)
            : currentPlanningDurationDays(deliverable.bestDuration);
        return durationDays == null
          ? []
          : [{
              durationDays,
              basis,
              matchedDeliverableName: deliverable.name,
              fragnetName,
            }];
      });
      consideredProjects.push({
        projectId: project.projectId,
        projectName: project.projectName,
        matched: true,
        hasPlanningDuration: observations.length > 0,
      });
      const organisationObservation = highestDurationObservation(observations);
      if (organisationObservation) {
        samplesByBasis.ORGANISATION_WIDE.push({
          durationDays: organisationObservation.durationDays,
          projectId: project.projectId,
          projectName: project.projectName,
          matchedDeliverableName: organisationObservation.matchedDeliverableName,
          fragnetName: organisationObservation.fragnetName,
        });
      }
      const disciplineObservation = highestDurationObservation(
        observations.filter((observation) => observation.basis !== "ORGANISATION_WIDE")
      );
      if (disciplineObservation) {
        samplesByBasis.SAME_DISCIPLINE.push({
          durationDays: disciplineObservation.durationDays,
          projectId: project.projectId,
          projectName: project.projectName,
          matchedDeliverableName: disciplineObservation.matchedDeliverableName,
          fragnetName: disciplineObservation.fragnetName,
        });
      }
      const fragnetObservation = highestDurationObservation(
        observations.filter((observation) => observation.basis === "SAME_FRAGNET")
      );
      if (fragnetObservation) {
        samplesByBasis.SAME_FRAGNET.push({
          durationDays: fragnetObservation.durationDays,
          projectId: project.projectId,
          projectName: project.projectName,
          matchedDeliverableName: fragnetObservation.matchedDeliverableName,
          fragnetName: fragnetObservation.fragnetName,
        });
      }
    }

    const comparisonBasisUsed: HistoricalComparisonBasis | null =
      samplesByBasis.SAME_FRAGNET.length > 0
        ? "SAME_FRAGNET"
        : samplesByBasis.SAME_DISCIPLINE.length > 0
          ? "SAME_DISCIPLINE"
          : samplesByBasis.ORGANISATION_WIDE.length > 0
            ? "ORGANISATION_WIDE"
            : null;
    const selectedSamples = comparisonBasisUsed ? samplesByBasis[comparisonBasisUsed] : [];
    const samples = selectedSamples.map((sample) => sample.durationDays);
    const statistics =
      samples.length === 0
        ? emptyStatistics()
        : {
            available: true,
            projectsUsed: samples.length,
            sampleCount: samples.length,
            minimumDays: Math.min(...samples),
            averageDays: Math.round((samples.reduce((sum, duration) => sum + duration, 0) / samples.length) * 10) / 10,
            maximumDays: Math.max(...samples),
          };

    const unavailableReason =
      statistics.available
        ? null
        : matchingProjectCount === 0
          ? "NO_MATCHING_DELIVERABLES"
          : "NO_HISTORICAL_PLANNING_DATA";
    const usedProjectIds = new Set(selectedSamples.map((sample) => sample.projectId));

    const contributingProjects = selectedSamples.map((sample) => ({
      projectId: sample.projectId,
      projectName: sample.projectName,
      matchedDeliverableName: sample.matchedDeliverableName,
      fragnetName: sample.fragnetName,
      planningDurationDays: sample.durationDays,
    }));

    return {
      key: target.key,
      deliverableId: target.deliverableId,
      name: target.name,
      matchMode: target.provisional ? "NAME_ONLY" : "FULL_DELIVERABLE_CONTEXT",
      provisional: target.provisional,
      statistics,
      comparisonBasis: comparisonBasisUsed,
      contributingProjects,
      projectDiagnostics: consideredProjects.map((project) => ({
        projectId: project.projectId,
        projectName: project.projectName,
        used: usedProjectIds.has(project.projectId),
        reason: usedProjectIds.has(project.projectId)
          ? "USED"
          : !project.matched
            ? "NO_EQUIVALENT_DELIVERABLE"
            : !project.hasPlanningDuration
              ? "NO_PLANNING_DURATION"
              : "CLOSER_COMPARISON_AVAILABLE",
      })),
      unavailableReason,
    };
  });
}

function badRequest(message: string): never {
  const error = new Error(message);
  (error as Error & { status: number }).status = 400;
  throw error;
}

export async function getDeliverableDurationStatisticsPresentation(args: {
  companyId: string;
  projectId: string;
  targets?: HistoricalDurationTarget[];
}): Promise<{
  projectId: string;
  durationDefinition: typeof STRICT_ORIGINAL_DURATION_DEFINITION;
  items: HistoricalDurationItem[];
}> {
  if (args.targets && args.targets.length > 200) badRequest("targets must contain at most 200 items");

  const deliverables = await prisma.deliverable.findMany({
    where: { companyId: args.companyId, projectId: args.projectId },
    select: {
      id: true,
      name: true,
      classification: true,
      fragnet: { select: { name: true } },
      activities: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const currentProject = await prisma.project.findFirst({
    where: { companyId: args.companyId, id: args.projectId },
    select: {
      intelligenceProfile: {
        select: {
          sector: true,
          projectType: true,
          stage: true,
        },
      },
    },
  });
  const currentProjectContext = currentProject?.intelligenceProfile ?? null;
  const byId = new Map(deliverables.map((deliverable) => [deliverable.id, deliverable]));

  let targets: TargetContext[];
  if (args.targets === undefined) {
    targets = deliverables.map((deliverable) => ({
      key: deliverable.id,
      deliverableId: deliverable.id,
      name: deliverable.name,
      classification: deliverable.classification,
      fragnetName: deliverable.fragnet?.name ?? null,
      lifecycleStage: currentProjectContext?.stage ?? null,
      projectContext: currentProjectContext,
      relatedActivityNames: deliverable.activities.map((activity) => activity.name),
      provisional: false,
    }));
  } else {
    const keys = new Set<string>();
    targets = args.targets.map((target, index) => {
      if (!target || typeof target !== "object") badRequest(`targets[${index}] must be an object`);
      const key = typeof target.key === "string" ? target.key.trim() : "";
      if (!key) badRequest(`targets[${index}].key is required`);
      if (keys.has(key)) badRequest(`targets[${index}].key must be unique`);
      keys.add(key);

      const deliverableId =
        typeof target.deliverableId === "string" && target.deliverableId.trim()
          ? target.deliverableId.trim()
          : null;
      const deliverable = deliverableId ? byId.get(deliverableId) : undefined;
      if (deliverableId && !deliverable) {
        badRequest(`targets[${index}].deliverableId does not belong to the project`);
      }
      const hasNameOverride = typeof target.name === "string";
      const name = hasNameOverride ? target.name!.trim() : deliverable?.name ?? "";
      if (!name) badRequest(`targets[${index}].name is required`);

      return {
        key,
        deliverableId,
        name,
        classification: deliverable?.classification ?? classifyDeliverableName(name),
        fragnetName: deliverable?.fragnet?.name ?? null,
        lifecycleStage: currentProjectContext?.stage ?? null,
        projectContext: currentProjectContext,
        relatedActivityNames: hasNameOverride
          ? []
          : deliverable?.activities.map((activity) => activity.name) ?? [],
        provisional: !deliverable || hasNameOverride,
      };
    });
  }

  const snapshots = await prisma.programmeSnapshot.findMany({
    where: {
      companyId: args.companyId,
      projectId: { not: args.projectId },
    },
    select: {
      id: true,
      projectId: true,
      project: { select: { name: true } },
      importedAt: true,
      snapshotVersion: true,
      snapshotRole: true,
      programmeState: true,
      sector: true,
      projectType: true,
      stage: true,
      deliverableSnapshots: {
        select: {
          deliverableId: true,
          name: true,
          classification: true,
          fragnetId: true,
          parentWbs: true,
          wbsPath: true,
          stage: true,
          discipline: true,
          classificationTags: true,
          reasonedDiscipline: true,
          reasonedEngineeringObject: true,
          reasonedEngineeringWork: true,
          reasonedDeliverableType: true,
          reasonedLifecycleStage: true,
          reasoningSource: true,
        },
      },
      activitySnapshots: {
        select: {
          deliverableId: true,
          originalDuration: true,
          name: true,
          classificationTags: true,
        },
      },
    },
  });
  const liveProjects = await prisma.project.findMany({
    where: {
      companyId: args.companyId,
      id: { not: args.projectId },
      programmeSnapshots: { none: {} },
    },
    select: {
      id: true,
      name: true,
      intelligenceProfile: {
        select: {
          sector: true,
          projectType: true,
          stage: true,
        },
      },
      deliverables: {
        select: {
          id: true,
          name: true,
          classification: true,
          bestDuration: true,
          fragnet: { select: { name: true } },
          activities: {
            select: {
              bestDuration: true,
              name: true,
            },
          },
        },
      },
    },
  });

  const storeAvailable = isEngineeringKnowledgeStoreAvailable();
  const knowledge = storeAvailable ? await loadEngineeringKnowledge(args.companyId) : new Map();
  // Phase 3 (spec section 7): merge in developer-approved learned object
  // rules for this company. Never throws — [] if not deployed yet.
  const learnedObjectRules = await loadActiveLearnedObjectRules(args.companyId);

  let reasonedTargetIdentities: Map<string, EngineeringIdentity> | undefined;
  if (isEngineeringReasoningActive()) {
    const { results } = await runBoundedEngineeringReasoning(
      targets.map((target) => ({
        key: target.key,
        context: buildEngineeringReasoningContextForDurationTarget({
          name: target.name,
          fragnetName: target.provisional ? null : target.fragnetName,
          classification: target.classification,
          lifecycleStage: target.lifecycleStage,
          projectContext: target.projectContext,
          relatedActivityNames: target.relatedActivityNames,
        }),
      }))
    );
    reasonedTargetIdentities = new Map(
      [...results.entries()].map(([key, reasoned]) => [key, reasoned])
    );
  }

  return {
    projectId: args.projectId,
    durationDefinition: STRICT_ORIGINAL_DURATION_DEFINITION,
    items: computeStrictOriginalDurationItems(
      targets,
      snapshots.map((snapshot) => ({
        ...snapshot,
        projectName: snapshot.project.name,
      })),
      liveProjects.map((project) => ({
        projectId: project.id,
        projectName: project.name,
        projectContext: project.intelligenceProfile,
        deliverables: project.deliverables.map((deliverable) => ({
          deliverableId: deliverable.id,
          name: deliverable.name,
          classification: deliverable.classification,
          fragnetName: deliverable.fragnet?.name ?? null,
          bestDuration: deliverable.bestDuration,
          activities: deliverable.activities,
        })),
      })),
      knowledge,
      storeAvailable,
      reasonedTargetIdentities,
      learnedObjectRules
    ),
  };
}
