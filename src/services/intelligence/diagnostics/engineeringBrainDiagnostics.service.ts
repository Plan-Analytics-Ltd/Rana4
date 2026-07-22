/**
 * Engineering Brain Maturity & Diagnostics — DEVELOPER ONLY.
 *
 * This module observes the behaviour of the Engineering Brain across imported
 * programmes. It does NOT learn, does NOT change planner behaviour, does NOT
 * change historical calculations, and adds no database tables — it recomputes a
 * diagnostic view on demand from data that already exists.
 *
 * Its job is observation, validation, and self-assessment: can a developer
 * answer "why did Rana think this?", "has Rana become more consistent?", and
 * "is Rana mature enough to begin learning?" without reading raw logs.
 */
import type { DeliverableClassification, Prisma } from "@prisma/client";
import { prisma } from "../../../utils/prisma.js";
import {
  resolveEngineeringIdentity,
  type EngineeringIdentity,
} from "../taxonomy/engineeringIdentity.service.js";
import type { EngineeringObjectRule } from "../taxonomy/engineeringVocabulary.data.js";
import {
  enforceEngineeringIdentityValidation,
  type EngineeringIdentityValidation,
} from "../taxonomy/engineeringIdentityValidation.service.js";
import {
  normaliseDeliverableNameForTaxonomy,
  titleCaseFromNormalised,
} from "../taxonomy/taxonomyMatching.utils.js";
import { extractDocumentType } from "../taxonomy/documentType.extraction.js";
import {
  getEngineeringBrainVersions,
  type EngineeringBrainVersions,
} from "../taxonomy/engineeringBrainVersion.js";
import {
  getRecentEngineeringReasoningEvents,
  type EngineeringReasoningEvent,
} from "../taxonomy/engineeringReasoningTelemetry.js";
import {
  buildEngineeringReasoningContextFromObserved,
  isEngineeringReasoningActive,
  runBoundedEngineeringReasoning,
} from "../taxonomy/engineeringReasoningOrchestration.service.js";
import {
  assessEngineeringTrust,
  engineeringIdentityFingerprint,
  type EngineeringTrustReason,
  type EngineeringTrustState,
  type TrustedKnowledgeStatus,
} from "../taxonomy/engineeringTrust.service.js";
import {
  loadEngineeringKnowledge,
  isEngineeringKnowledgeStoreAvailable,
  type StoredEngineeringKnowledge,
} from "./engineeringKnowledgeStore.service.js";
import {
  buildIdentityView,
  buildReasonDetails,
  buildWhy,
  buildImpact,
  evidenceTextForIdentity,
  type DeliverableContextView,
  type DeveloperImpact,
  type EngineeringIdentityView,
  type HistoricalMatch,
  type InboxReasonDetail,
  type WhyExplanation,
} from "./engineeringBrainReview.js";
import {
  computeEngineeringRuleProposalCandidates,
  persistEngineeringRuleProposals,
  listPendingRuleProposals,
  isEngineeringRuleProposalStoreAvailable,
  type EngineeringRuleProposalCandidate,
  type StoredEngineeringRuleProposal,
} from "./engineeringRuleProposal.service.js";
import {
  loadActiveLearnedObjectRules,
  isEngineeringLearnedRuleStoreAvailable,
} from "./engineeringLearnedRule.service.js";

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

export type ObservedDeliverable = {
  key: string;
  name: string;
  fragnetName: string | null;
  parentWbs?: string | null;
  wbsPath?: string | null;
  discipline?: string | null;
  activityCodeDiscipline?: string | null;
  classificationTags?: Record<string, unknown> | null;
  classification?: DeliverableClassification | null;
  lifecycleStage?: string | null;
  projectContext?: { sector?: string | null; projectType?: string | null } | null;
  relatedActivityNames?: string[];
  projectId: string;
  projectName: string;
  importVersion: number;
  importedAt: string;
  neighbourNames?: string[];
  durationDays?: number | null;
};

/** A curated wording-variant probe (developer diagnostic fixture, not vocabulary). */
export type ConsistencyProbe = {
  concept: string;
  fragnetName?: string | null;
  variants: string[];
};

/* -------------------------------------------------------------------------- */
/* Output types                                                               */
/* -------------------------------------------------------------------------- */

export type EngineeringIdentityDiagnostic = {
  deliverableKey: string;
  deliverableName: string;
  projectId: string;
  projectName: string;
  importVersion: number;
  importedAt: string;
  identity: {
    discipline: string | null;
    engineeringObject: string | null;
    engineeringWork: string | null;
    deliverableType: string | null;
    lifecycleStage: string | null;
    status: EngineeringIdentity["status"];
  };
  evidenceUsed: string[];
  reasoningResult: EngineeringIdentity["status"];
  validationResult: EngineeringIdentityValidation;
  confidence: number;
  reasoningDurationMs: number;
  versions: EngineeringBrainVersions;
  timestamp: string;
};

export type EngineeringBrainMetrics = {
  projectsAnalysed: number;
  importsAnalysed: number;
  engineeringIdentitiesCreated: number;
  equivalentComparisons: number;
  rejectedComparisons: number;
  unknownEngineeringObjects: number;
  unknownEngineeringWork: number;
  contradictoryIdentities: number;
  validationFailures: number;
  potentialNewEngineeringObjects: number;
  potentialNewEngineeringWork: number;
  reasoningConsistency: number;
};

export type ConsistencyProbeResult = {
  concept: string;
  verdict: "CONSISTENT" | "INCONSISTENT";
  reason:
    | "CONSISTENT"
    | "DIFFERENT_ENGINEERING_OBJECT"
    | "DIFFERENT_DISCIPLINE"
    | "DIFFERENT_ENGINEERING_WORK"
    | "UNKNOWN"
    | "VALIDATION_FAILURE";
  resolvedSignatures: string[];
  variants: Array<{ name: string; signature: string; status: EngineeringIdentity["status"] }>;
};

export type UnknownConcept = {
  concept: string;
  kind: "ENGINEERING_OBJECT" | "ENGINEERING_WORK";
  occurrences: number;
  projects: number;
  confidence: number;
  contradictions: number;
  supportingEvidence: string[];
};

export type CandidateLearning = {
  candidate: string;
  kind: "ENGINEERING_OBJECT" | "ENGINEERING_WORK";
  observed: number;
  projects: number;
  consistency: number;
  contradictions: number;
};

export type ReasoningDrift = {
  concept: string;
  kind: "ENGINEERING_OBJECT";
  variants: Array<{
    resolvedTo: string;
    exampleName: string;
    projectName: string;
    importedAt: string;
  }>;
};

export type LearningOpportunity = {
  rank: number;
  concept: string;
  seen: number;
  projects: number;
  consistency: number;
};

export type EngineeringMaturity = {
  dimensions: {
    consistency: number;
    explainability: number;
    validationSuccess: number;
    coverage: number;
    contradictionControl: number;
    repeatability: number;
    reasoningStability: number;
  };
  trust: {
    autoTrustedRate: number;
    reviewRate: number;
    developerModificationRate: number;
    developerRejectionRate: number;
    trustedAgreement: number;
  };
  overall: number;
  readiness: "NOT_READY" | "MATURING" | "READY_TO_LEARN";
  rationale: string[];
};

export type IdentityFields = {
  discipline: string | null;
  engineeringObject: string | null;
  engineeringWork: string | null;
  deliverableType: string | null;
  lifecycleStage: string | null;
};

export type GroupedExample = { projectName: string; deliverableName: string };

export type BrainInboxItem = {
  fingerprint: string;
  concept: string;
  state: Extract<EngineeringTrustState, "NEEDS_REVIEW" | "CONTRADICTORY">;
  reasons: EngineeringTrustReason[];
  reasonDetails: InboxReasonDetail[];
  exampleDeliverableName: string;
  projectName: string;
  identity: IdentityFields;
  identityView: EngineeringIdentityView;
  context: DeliverableContextView;
  historicalMatches: HistoricalMatch[];
  why: WhyExplanation[];
  impact: DeveloperImpact;
  examples: GroupedExample[];
  evidence: string[];
  occurrences: number;
  projects: number;
  confidence: number;
};

export type TrustedKnowledgeVersionEntry = {
  at: string;
  action: string;
  status: string;
  reviewedBy: string | null;
  notes: string | null;
};

export type TrustedKnowledgeEntry = {
  fingerprint: string;
  concept: string;
  status: TrustedKnowledgeStatus;
  identity: IdentityFields;
  identityView: EngineeringIdentityView | null;
  context: DeliverableContextView | null;
  aliases: string[];
  evidence: string[];
  examples: GroupedExample[];
  historicalMatches: HistoricalMatch[];
  firstObserved: string;
  lastObserved: string;
  projectCount: number;
  successfulComparisons: number;
  versionHistory: TrustedKnowledgeVersionEntry[];
  versionHistoryCount: number;
  lastModificationReason: string | null;
};

/** Canonical pre-bucketed Brain collections — the only place aggregation occurs. */
export type EngineeringBrainCollections = {
  /** Same entries as legacy `brainInbox`. */
  needsReview: BrainInboxItem[];
  autoApproved: TrustedKnowledgeEntry[];
  /** Developer-approved trusted knowledge (export bucket `trustedKnowledge`). */
  developerApproved: TrustedKnowledgeEntry[];
  developerModified: TrustedKnowledgeEntry[];
  /** Audit-only — hidden from the Engineering Brain UI. */
  rejected: TrustedKnowledgeEntry[];
};

/** Immutable Brain counts — every consumer must use these, never recalculate. */
export type EngineeringBrainSummary = {
  brainInbox: number;
  /** Visible trusted entries: autoApproved + developerApproved + developerModified. */
  trustedKnowledge: number;
  autoApproved: number;
  developerApproved: number;
  developerModified: number;
  rejected: number;
  totalVisible: number;
  totalIncludingRejected: number;
};

export function buildEngineeringBrainSummary(
  collections: EngineeringBrainCollections
): EngineeringBrainSummary {
  const trustedKnowledge =
    collections.autoApproved.length +
    collections.developerApproved.length +
    collections.developerModified.length;
  const totalVisible = collections.needsReview.length + trustedKnowledge;
  return {
    brainInbox: collections.needsReview.length,
    trustedKnowledge,
    autoApproved: collections.autoApproved.length,
    developerApproved: collections.developerApproved.length,
    developerModified: collections.developerModified.length,
    rejected: collections.rejected.length,
    totalVisible,
    totalIncludingRejected: totalVisible + collections.rejected.length,
  };
}

function assignTrustedEntry(
  collections: EngineeringBrainCollections,
  entry: TrustedKnowledgeEntry
): void {
  switch (entry.status) {
    case "AUTO_APPROVED":
      collections.autoApproved.push(entry);
      break;
    case "DEVELOPER_APPROVED":
      collections.developerApproved.push(entry);
      break;
    case "DEVELOPER_MODIFIED":
      collections.developerModified.push(entry);
      break;
    case "REJECTED":
      collections.rejected.push(entry);
      break;
    default:
      collections.autoApproved.push(entry);
      break;
  }
}

function sortVisibleTrusted(entries: TrustedKnowledgeEntry[]): TrustedKnowledgeEntry[] {
  return [...entries].sort(
    (a, b) => b.projectCount - a.projectCount || b.successfulComparisons - a.successfulComparisons
  );
}

export type EngineeringBrainDiagnosticsReport = {
  generatedAt: string;
  versions: EngineeringBrainVersions;
  metrics: EngineeringBrainMetrics;
  consistency: {
    reasoningConsistency: number;
    probes: ConsistencyProbeResult[];
    observedConceptsAnalysed: number;
    consistentConcepts: number;
    inconsistentConcepts: number;
  };
  unknownObjects: UnknownConcept[];
  unknownWork: UnknownConcept[];
  candidateLearning: CandidateLearning[];
  /** Scored, thresholded rule-proposal candidates derived from
   * `candidateLearning` (spec section 5). Persisted to `EngineeringRuleProposal`
   * by the DB-touching wrapper immediately after this report is computed. */
  ruleProposalCandidates: EngineeringRuleProposalCandidate[];
  /** PENDING rule proposals for the review UI (spec section 6, Phase 3).
   * Populated by the DB-touching wrapper (getEngineeringBrainDiagnostics) —
   * always [] from the pure function itself, same pattern as trustedKnowledge
   * being companyId-free at this layer. */
  ruleProposals: StoredEngineeringRuleProposal[];
  ruleProposalStoreAvailable: boolean;
  learnedRuleStoreAvailable: boolean;
  reasoningDrift: ReasoningDrift[];
  maturity: EngineeringMaturity;
  topOpportunities: LearningOpportunity[];
  /** Canonical fingerprint-grouped collections. */
  collections: EngineeringBrainCollections;
  /** Precomputed counts — use instead of `.length` on arrays in consumers. */
  summary: EngineeringBrainSummary;
  /** @deprecated Alias of `collections.needsReview`. */
  brainInbox: BrainInboxItem[];
  /** Visible trusted entries (auto + developer approved + modified), sorted. */
  trustedKnowledge: TrustedKnowledgeEntry[];
  storeAvailable: boolean;
  recentReasoningEvents: EngineeringReasoningEvent[];
  sampleIdentities: EngineeringIdentityDiagnostic[];
};

/* -------------------------------------------------------------------------- */
/* Curated consistency probes (wording variants a planner treats as identical) */
/* -------------------------------------------------------------------------- */

export const DEFAULT_CONSISTENCY_PROBES: ConsistencyProbe[] = [
  {
    concept: "Fire Technical Note",
    fragnetName: "Fire Engineering",
    variants: [
      "Fire Technical Note",
      "Fire Engineering Technical Note",
      "FSE Technical Note",
      "Fire Safety Engineering Technical Note",
    ],
  },
  {
    concept: "Reinforcement Detailing",
    fragnetName: "Structures",
    // "Reinforcement Detail Drawings" deliberately excluded: "Detail Drawings" is a
    // drawing/design-production deliverable, not the detailing activity itself. It
    // used to collapse onto this probe only because the old engineeringWork regex
    // matched "detail" as well as "detailing" — the same bug that misclassified bare
    // "Detailed Design" deliverables. Correctly resolves to a different signature now.
    variants: [
      "Reinforcement Detailing",
      "Produce Reinforcement Detailing",
      "Rebar Detailing",
    ],
  },
  {
    concept: "Public Health Technical Note",
    fragnetName: "Public Health",
    variants: [
      "Public Health Technical Note",
      "Technical Notes - Public Health",
      "PHE Technical Note",
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function conceptSubject(name: string): { key: string; label: string } {
  const normalised = normaliseDeliverableNameForTaxonomy(name);
  const doc = extractDocumentType(normalised);
  const residual = (doc?.residualSubject ?? "").trim();
  const subject = residual || normalised;
  const key = subject.replace(/\s+/g, " ").trim().toLowerCase();
  return { key: key || normalised, label: titleCaseFromNormalised(subject || normalised) };
}

function signature(identity: EngineeringIdentity): string {
  return [
    identity.discipline.id ?? "?",
    identity.engineeringObject.id ?? "?",
    identity.engineeringWork.id ?? "?",
  ].join("|");
}

function resolveValidated(
  input: {
    name: string;
    fragnetName?: string | null;
    parentWbs?: string | null;
    wbsPath?: string | null;
    discipline?: string | null;
    activityCodeDiscipline?: string | null;
    classificationTags?: Record<string, unknown> | null;
    classification?: DeliverableClassification | null;
    lifecycleStage?: string | null;
    projectContext?: { sector?: string | null; projectType?: string | null } | null;
    relatedActivityNames?: string[];
  },
  learnedObjectRules: EngineeringObjectRule[] = []
): { identity: EngineeringIdentity; validation: EngineeringIdentityValidation; durationMs: number } {
  const startedAt = process.hrtime.bigint();
  const enforced = enforceEngineeringIdentityValidation(
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
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  return { identity: enforced, validation: enforced.validation, durationMs };
}

/** Deterministic internal confidence — reflects evidence strength, never AI. */
function internalConfidence(identity: EngineeringIdentity): number {
  if (identity.status !== "RESOLVED") return identity.discipline.id ? 40 : 15;
  const identityComponents = [identity.discipline, identity.engineeringObject, identity.engineeringWork];
  const evidenced = identityComponents.filter((c) => c.evidence.length > 0).length;
  const base = 60 + evidenced * 10; // 60..90
  const fragnetBonus = identity.fragnetContext.id ? 5 : 0;
  return Math.min(100, base + fragnetBonus);
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function verdictReason(
  variants: Array<{ status: EngineeringIdentity["status"]; identity: EngineeringIdentity; valid: boolean }>
): ConsistencyProbeResult["reason"] {
  if (variants.some((v) => !v.valid)) return "VALIDATION_FAILURE";
  if (variants.some((v) => v.status !== "RESOLVED")) return "UNKNOWN";
  const disciplines = new Set(variants.map((v) => v.identity.discipline.id));
  if (disciplines.size > 1) return "DIFFERENT_DISCIPLINE";
  const objects = new Set(variants.map((v) => v.identity.engineeringObject.id));
  if (objects.size > 1) return "DIFFERENT_ENGINEERING_OBJECT";
  const works = new Set(variants.map((v) => v.identity.engineeringWork.id));
  if (works.size > 1) return "DIFFERENT_ENGINEERING_WORK";
  return "CONSISTENT";
}

/* -------------------------------------------------------------------------- */
/* Pure computation                                                           */
/* -------------------------------------------------------------------------- */

export type EngineeringBrainDiagnosticsOptions = {
  forceRuleBased?: boolean;
};

export async function computeEngineeringBrainDiagnostics(
  observed: ObservedDeliverable[],
  probes: ConsistencyProbe[] = DEFAULT_CONSISTENCY_PROBES,
  decisions: Map<string, StoredEngineeringKnowledge> = new Map(),
  storeAvailable = false,
  options: EngineeringBrainDiagnosticsOptions = {},
  /**
   * Active, developer-approved learned object rules (spec section 7, Phase
   * 3) to merge in alongside the hand-authored taxonomy. Plain data, not a
   * companyId — the caller (getEngineeringBrainDiagnostics) loads these via
   * loadActiveLearnedObjectRules before calling in, keeping this function
   * itself companyId-free and directly testable (see
   * tests/integration/engineering-brain-diagnostics.test.mjs, which never
   * passes one and gets exactly the pre-Phase-3 behavior).
   */
  learnedObjectRules: EngineeringObjectRule[] = []
): Promise<EngineeringBrainDiagnosticsReport> {
  const versions = getEngineeringBrainVersions();
  const now = new Date().toISOString();

  /* 1. Resolve a validated identity for every observed deliverable. */
  type Record = {
    observed: ObservedDeliverable;
    identity: EngineeringIdentity;
    validation: EngineeringIdentityValidation;
    durationMs: number;
    subject: { key: string; label: string };
  };
  const records: Record[] = observed.map((deliverable) => {
    const resolved = resolveValidated(
      {
        name: deliverable.name,
        fragnetName: deliverable.fragnetName,
        parentWbs: deliverable.parentWbs,
        wbsPath: deliverable.wbsPath,
        discipline: deliverable.discipline,
        activityCodeDiscipline: deliverable.activityCodeDiscipline,
        classificationTags: deliverable.classificationTags,
        classification: deliverable.classification,
        lifecycleStage: deliverable.lifecycleStage,
        projectContext: deliverable.projectContext,
        relatedActivityNames: deliverable.relatedActivityNames,
      },
      learnedObjectRules
    );
    return {
      observed: deliverable,
      identity: resolved.identity,
      validation: resolved.validation,
      durationMs: resolved.durationMs,
      subject: conceptSubject(deliverable.name),
    };
  });

  /* 2. Consistency probes. */
  const probeResults: ConsistencyProbeResult[] = probes.map((probe) => {
    const variants = probe.variants.map((name) => {
      const resolved = resolveValidated({ name, fragnetName: probe.fragnetName ?? null }, learnedObjectRules);
      return {
        name,
        identity: resolved.identity,
        status: resolved.identity.status,
        valid: resolved.validation.valid,
        signature: signature(resolved.identity),
      };
    });
    const reason = verdictReason(variants);
    return {
      concept: probe.concept,
      verdict: reason === "CONSISTENT" ? "CONSISTENT" : "INCONSISTENT",
      reason,
      resolvedSignatures: [...new Set(variants.map((v) => v.signature))],
      variants: variants.map((v) => ({ name: v.name, signature: v.signature, status: v.status })),
    };
  });
  const consistentProbes = probeResults.filter((p) => p.verdict === "CONSISTENT").length;
  const reasoningConsistency = pct(consistentProbes, probeResults.length);

  /* 3. Concept grouping over observed data (drift + observed consistency). */
  const byConcept = new Map<string, Record[]>();
  for (const record of records) {
    const list = byConcept.get(record.subject.key) ?? [];
    list.push(record);
    byConcept.set(record.subject.key, list);
  }

  let observedConceptsAnalysed = 0;
  let consistentConcepts = 0;
  let inconsistentConcepts = 0;
  let equivalentComparisons = 0;
  let rejectedComparisons = 0;
  const reasoningDrift: ReasoningDrift[] = [];
  const driftingSubjects = new Set<string>();

  for (const [subjectKey, group] of byConcept) {
    if (group.length < 2) continue;
    observedConceptsAnalysed += 1;
    const resolvedObjects = group
      .map((r) => r.identity.engineeringObject.id)
      .filter((id): id is string => Boolean(id));
    const distinctObjects = new Set(resolvedObjects);
    // Pairwise comparisons within the concept (bounded by concept size).
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i].identity;
        const b = group[j].identity;
        const equal =
          a.status === "RESOLVED" &&
          b.status === "RESOLVED" &&
          signature(a) === signature(b);
        if (equal) equivalentComparisons += 1;
        else rejectedComparisons += 1;
      }
    }
    if (distinctObjects.size <= 1) {
      consistentConcepts += 1;
    } else {
      inconsistentConcepts += 1;
      driftingSubjects.add(subjectKey);
      const variantMap = new Map<string, Record>();
      for (const record of group) {
        const objectId = record.identity.engineeringObject.id;
        if (objectId && !variantMap.has(objectId)) variantMap.set(objectId, record);
      }
      reasoningDrift.push({
        concept: group[0].subject.label,
        kind: "ENGINEERING_OBJECT",
        variants: [...variantMap.entries()].map(([resolvedTo, record]) => ({
          resolvedTo,
          exampleName: record.observed.name,
          projectName: record.observed.projectName,
          importedAt: record.observed.importedAt,
        })),
      });
    }
  }

  /* 4. Unknown analysis (objects + work). */
  const totalBySubject = new Map<string, number>();
  const objectIdsBySubject = new Map<string, Set<string>>();
  for (const record of records) {
    totalBySubject.set(record.subject.key, (totalBySubject.get(record.subject.key) ?? 0) + 1);
    const set = objectIdsBySubject.get(record.subject.key) ?? new Set<string>();
    if (record.identity.engineeringObject.id) set.add(record.identity.engineeringObject.id);
    objectIdsBySubject.set(record.subject.key, set);
  }

  // Extra field carried alongside each UnknownConcept, scoped to this
  // function only: the subject key it was grouped by, and the raw member
  // records that contributed to it. UnknownConcept stays structurally
  // unchanged for external consumers (frontend dashboard) — this is purely
  // an internal bookkeeping aid so step 5b (rule proposal generation) can
  // trace a candidate back to the specific deliverables/fingerprints behind
  // it without having to reverse-engineer a label back into a subject key.
  type UnknownConceptWithGroup = UnknownConcept & { subjectKey: string; group: Record[] };

  function unknownConcepts(kind: UnknownConcept["kind"]): UnknownConceptWithGroup[] {
    const unknownRecords = records.filter((record) =>
      kind === "ENGINEERING_OBJECT"
        ? record.identity.engineeringObject.id == null
        : record.identity.engineeringWork.id == null
    );
    const grouped = new Map<string, Record[]>();
    for (const record of unknownRecords) {
      const list = grouped.get(record.subject.key) ?? [];
      list.push(record);
      grouped.set(record.subject.key, list);
    }
    return [...grouped.entries()]
      .map(([key, group]) => {
        const occurrences = group.length;
        const projects = new Set(group.map((r) => r.observed.projectId)).size;
        const totalForSubject = totalBySubject.get(key) ?? occurrences;
        const confidence = pct(occurrences, totalForSubject);
        const contradictions =
          kind === "ENGINEERING_OBJECT" ? (objectIdsBySubject.get(key)?.size ?? 0) : 0;
        return {
          concept: group[0].subject.label,
          kind,
          occurrences,
          projects,
          confidence,
          contradictions,
          supportingEvidence: [
            ...new Set(
              group
                .slice(0, 5)
                .map((r) =>
                  r.observed.fragnetName
                    ? `${r.observed.name} — ${r.observed.fragnetName}`
                    : r.observed.name
                )
            ),
          ],
          subjectKey: key,
          group,
        };
      })
      .sort((a, b) => b.occurrences - a.occurrences || b.projects - a.projects);
  }

  // `unknownConcepts()` attaches `subjectKey`/`group` bookkeeping (see the
  // `UnknownConceptWithGroup` comment above) so step 5b can trace a candidate
  // back to its member records. That bookkeeping must never reach the public
  // report: each `group` entry carries a `Record`, and `Record.durationMs` is
  // measured from `process.hrtime.bigint()` — real wall-clock time that is
  // never identical between two calls, even with byte-identical inputs. If
  // `UnknownConceptWithGroup` objects were assigned to the report's
  // `unknownObjects`/`unknownWork` fields as-is (TypeScript's structural
  // typing doesn't strip excess properties at runtime), the report would
  // carry that non-deterministic timing several layers deep and silently
  // break `computeEngineeringBrainDiagnostics` determinism (e.g. the
  // forceRuleBased kill-switch tests, which assert two calls produce
  // byte-identical reports). Strip the bookkeeping back down to the public
  // `UnknownConcept` shape before it leaves this function.
  function stripGroupBookkeeping(concept: UnknownConceptWithGroup): UnknownConcept {
    const { subjectKey: _subjectKey, group: _group, ...publicFields } = concept;
    return publicFields;
  }

  const unknownObjectsWithGroups = unknownConcepts("ENGINEERING_OBJECT");
  const unknownWorkWithGroups = unknownConcepts("ENGINEERING_WORK");
  const unknownObjects: UnknownConcept[] = unknownObjectsWithGroups.map(stripGroupBookkeeping);
  const unknownWork: UnknownConcept[] = unknownWorkWithGroups.map(stripGroupBookkeeping);

  /* 5. Candidate learning (observation only — never auto-promoted). */
  const candidateLearningConcepts = unknownObjectsWithGroups
    .filter((concept) => concept.occurrences >= 3 || concept.projects >= 2)
    .slice(0, 25);
  const candidateLearning: CandidateLearning[] = candidateLearningConcepts.map((concept) => ({
    candidate: concept.concept,
    kind: "ENGINEERING_OBJECT",
    observed: concept.occurrences,
    projects: concept.projects,
    consistency: concept.confidence,
    contradictions: concept.contradictions,
  }));

  /* 5b. Rule proposal candidates (spec section 5) — cross-reference confirmed
   * ground truth, score, draft a pattern for each OBJECT-kind candidate above.
   * Pure computation; the DB-touching wrapper (`getEngineeringBrainDiagnostics`)
   * persists these to `EngineeringRuleProposal` immediately after calling this
   * function, since companyId is not available at this pure-compute layer
   * (this function has no DB access and is exercised directly in tests
   * without a companyId). Scope: ENGINEERING_OBJECT only — see module-level
   * comment in engineeringRuleProposal.service.ts. */
  const ruleProposalCandidates: EngineeringRuleProposalCandidate[] = computeEngineeringRuleProposalCandidates({
    clusters: candidateLearningConcepts.map((concept) => ({
      subjectKey: concept.subjectKey,
      conceptLabel: concept.concept,
      occurrences: concept.occurrences,
      projectCount: concept.projects,
      members: concept.group.map((record) => ({
        fingerprint: engineeringIdentityFingerprint(record.subject.key, record.identity),
        deliverableName: record.observed.name,
        projectId: record.observed.projectId,
      })),
    })),
    decisions,
  });

  /* 6. Top opportunities — "If I had to learn one thing today...". */
  const topOpportunities: LearningOpportunity[] = [...unknownObjects]
    .map((concept) => ({
      concept,
      score:
        concept.occurrences *
        (1 + Math.log(concept.projects + 1)) *
        (concept.confidence / 100),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((entry, index) => ({
      rank: index + 1,
      concept: entry.concept.concept,
      seen: entry.concept.occurrences,
      projects: entry.concept.projects,
      consistency: entry.concept.confidence,
    }));

  /* 7. Metrics. */
  const identitiesCreated = records.length;
  const validationFailures = records.filter((r) => !r.validation.valid).length;
  const unknownObjectCount = records.filter((r) => r.identity.engineeringObject.id == null).length;
  const unknownWorkCount = records.filter((r) => r.identity.engineeringWork.id == null).length;
  const metrics: EngineeringBrainMetrics = {
    projectsAnalysed: new Set(records.map((r) => r.observed.projectId)).size,
    importsAnalysed: new Set(records.map((r) => `${r.observed.projectId}:${r.observed.importVersion}`)).size,
    engineeringIdentitiesCreated: identitiesCreated,
    equivalentComparisons,
    rejectedComparisons,
    unknownEngineeringObjects: unknownObjectCount,
    unknownEngineeringWork: unknownWorkCount,
    contradictoryIdentities: validationFailures,
    validationFailures,
    potentialNewEngineeringObjects: unknownObjects.length,
    potentialNewEngineeringWork: unknownWork.length,
    reasoningConsistency,
  };

  /* 7b. Trust model: self-assess every identity, then split into auto-trusted
   *     knowledge vs the Brain Inbox (only genuinely uncertain cases). */
  type FingerprintGroup = {
    fingerprint: string;
    concept: string;
    identity: EngineeringIdentity;
    state: EngineeringTrustState;
    reasons: EngineeringTrustReason[];
    confidence: number;
    records: Record[];
  };
  const fingerprintGroups = new Map<string, FingerprintGroup>();
  let autoTrustedIdentityCount = 0;
  let reviewIdentityCount = 0;

  for (const record of records) {
    const assessment = assessEngineeringTrust({
      identity: record.identity,
      validation: record.validation,
      signal: { historicallyConsistent: !driftingSubjects.has(record.subject.key) },
    });
    if (assessment.state === "TRUSTED") autoTrustedIdentityCount += 1;
    else reviewIdentityCount += 1;

    const fingerprint = engineeringIdentityFingerprint(record.subject.key, record.identity);
    const existing = fingerprintGroups.get(fingerprint);
    if (existing) {
      existing.records.push(record);
    } else {
      fingerprintGroups.set(fingerprint, {
        fingerprint,
        concept: record.subject.label,
        identity: record.identity,
        state: assessment.state,
        reasons: assessment.reasons,
        confidence: assessment.confidence,
        records: [record],
      });
    }
  }

  if (isEngineeringReasoningActive(options)) {
    const uncertainGroups = [...fingerprintGroups.values()].filter(
      (group) => group.state !== "TRUSTED" && !decisions.has(group.fingerprint)
    );
    if (uncertainGroups.length > 0) {
      const { results } = await runBoundedEngineeringReasoning(
        uncertainGroups.map((group) => ({
          key: group.fingerprint,
          context: buildEngineeringReasoningContextFromObserved(group.records[0]!.observed),
        })),
        options
      );
      for (const group of uncertainGroups) {
        const reasoned = results.get(group.fingerprint);
        if (!reasoned) continue;
        const rep = group.records[0]!;
        group.identity = {
          status: reasoned.status,
          discipline: reasoned.discipline,
          engineeringObject: reasoned.engineeringObject,
          engineeringWork: reasoned.engineeringWork,
          deliverableType: reasoned.deliverableType,
          lifecycleStage: reasoned.lifecycleStage,
          projectContext: reasoned.projectContext,
          fragnetContext: reasoned.fragnetContext,
          taxonomy: reasoned.taxonomy,
          supportingEvidence: reasoned.supportingEvidence,
        };
        const reassessed = assessEngineeringTrust({
          identity: group.identity,
          validation: reasoned.validation,
          signal: { historicallyConsistent: !driftingSubjects.has(rep.subject.key) },
        });
        group.state = reassessed.state;
        group.reasons = reassessed.reasons;
        group.confidence = reassessed.confidence;
      }
    }
  }

  function equivalentPairsWithin(group: Record[]): number {
    let pairs = 0;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        if (
          group[i].identity.status === "RESOLVED" &&
          group[j].identity.status === "RESOLVED" &&
          signature(group[i].identity) === signature(group[j].identity)
        ) {
          pairs += 1;
        }
      }
    }
    return pairs;
  }

  const componentLabels = (identity: EngineeringIdentity): IdentityFields => ({
    discipline: identity.discipline.id,
    engineeringObject: identity.engineeringObject.id,
    engineeringWork: identity.engineeringWork.id,
    deliverableType: identity.deliverableType.id,
    lifecycleStage: identity.lifecycleStage.id,
  });

  const contextView = (o: ObservedDeliverable): DeliverableContextView => ({
    projectName: o.projectName,
    fragnetName: o.fragnetName,
    parentWbs: o.parentWbs ?? null,
    wbsPath: o.wbsPath ?? null,
    deliverableName: o.name,
    neighbouringDeliverables: o.neighbourNames ?? [],
    relatedActivities: o.relatedActivityNames ?? [],
    disciplineMetadata: o.discipline ?? o.activityCodeDiscipline ?? null,
    classificationTags: o.classificationTags
      ? Object.entries(o.classificationTags).map(([k, v]) => `${k}: ${String(v)}`)
      : [],
    lifecycleStage: o.lifecycleStage ?? null,
  });

  const groupedExamples = (group: Record[]): GroupedExample[] => {
    const byProject = new Map<string, GroupedExample>();
    for (const r of group) {
      if (!byProject.has(r.observed.projectId)) {
        byProject.set(r.observed.projectId, {
          projectName: r.observed.projectName,
          deliverableName: r.observed.name,
        });
      }
    }
    return [...byProject.values()].slice(0, 8);
  };

  // Signature index → the historical evidence Rana would compare against. Same
  // (discipline|object|work) signature with no unknowns == equivalent identity.
  const bySignature = new Map<string, Record[]>();
  for (const record of records) {
    if (record.identity.status !== "RESOLVED") continue;
    const sig = signature(record.identity);
    if (sig.includes("?")) continue;
    const list = bySignature.get(sig) ?? [];
    list.push(record);
    bySignature.set(sig, list);
  }

  const driftDetailByLabel = new Map<string, string>();
  for (const drift of reasoningDrift) {
    driftDetailByLabel.set(
      drift.concept,
      `Resolves differently across imports: ${drift.variants
        .map((v) => `${v.resolvedTo} (${v.projectName})`)
        .join(" vs ")}.`
    );
  }

  function historicalFor(
    sig: string,
    ownKeys: Set<string>,
    identityLabels: HistoricalMatch["matchedIdentity"]
  ): { list: HistoricalMatch[]; durationCount: number; total: number } {
    if (sig.includes("?")) return { list: [], durationCount: 0, total: 0 };
    const all = bySignature.get(sig) ?? [];
    const seen = new Set<string>();
    const list: HistoricalMatch[] = [];
    let durationCount = 0;
    let total = 0;
    for (const r of all) {
      if (ownKeys.has(r.observed.key)) continue;
      const dedupeKey = `${r.observed.projectId}:${r.observed.name}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      total += 1;
      if (r.observed.durationDays != null) durationCount += 1;
      if (list.length < 8) {
        list.push({
          projectName: r.observed.projectName,
          fragnetName: r.observed.fragnetName,
          deliverableName: r.observed.name,
          durationDays: r.observed.durationDays ?? null,
          matchedIdentity: identityLabels,
          matchedComponents: ["Discipline", "Engineering Object", "Engineering Work"],
          reason: "EQUIVALENT",
        });
      }
    }
    return { list, durationCount, total };
  }

  const collections: EngineeringBrainCollections = {
    needsReview: [],
    autoApproved: [],
    developerApproved: [],
    developerModified: [],
    rejected: [],
  };

  for (const group of fingerprintGroups.values()) {
    const decision = decisions.get(group.fingerprint);
    const rep = group.records[0];
    const projects = new Set(group.records.map((r) => r.observed.projectId)).size;
    const importedTimes = group.records.map((r) => r.observed.importedAt).sort();
    const firstObserved = importedTimes[0];
    const lastObserved = importedTimes[importedTimes.length - 1];
    const evidence = [
      ...new Set(group.identity.supportingEvidence.slice(0, 6).map((e) => `${e.source}: ${e.value}`)),
    ];
    const successfulComparisons = equivalentPairsWithin(group.records);
    const ownKeys = new Set(group.records.map((r) => r.observed.key));
    const examples = groupedExamples(group.records);

    if (decision) {
      const sig = [decision.identity.discipline ?? "?", decision.identity.engineeringObject ?? "?", decision.identity.engineeringWork ?? "?"].join("|");
      const historical = historicalFor(sig, ownKeys, {
        discipline: decision.identity.discipline,
        engineeringObject: decision.identity.engineeringObject,
        engineeringWork: decision.identity.engineeringWork,
      });
      assignTrustedEntry(collections, {
        fingerprint: group.fingerprint,
        concept: decision.concept || group.concept,
        status: decision.status,
        identity: decision.identity,
        identityView: buildIdentityView(group.identity),
        context: contextView(rep.observed),
        aliases: decision.aliases,
        evidence: decision.evidence.length ? decision.evidence : evidence,
        examples,
        historicalMatches: historical.list,
        firstObserved: decision.firstObservedAt ?? firstObserved,
        lastObserved,
        projectCount: Math.max(projects, decision.projectCount),
        successfulComparisons: Math.max(successfulComparisons, decision.successfulComparisons),
        versionHistory: decision.versionHistory.map((v) => ({
          at: v.at,
          action: v.action,
          status: v.status,
          reviewedBy: v.reviewedBy,
          notes: v.notes,
        })),
        versionHistoryCount: decision.versionHistory.length,
        lastModificationReason: decision.versionHistory[decision.versionHistory.length - 1]?.notes ?? null,
      });
      continue;
    }

    if (group.state === "TRUSTED") {
      const historical = historicalFor(signature(group.identity), ownKeys, {
        discipline: group.identity.discipline.id,
        engineeringObject: group.identity.engineeringObject.id,
        engineeringWork: group.identity.engineeringWork.id,
      });
      assignTrustedEntry(collections, {
        fingerprint: group.fingerprint,
        concept: group.concept,
        status: "AUTO_APPROVED",
        identity: componentLabels(group.identity),
        identityView: buildIdentityView(group.identity),
        context: contextView(rep.observed),
        aliases: [],
        evidence,
        examples,
        historicalMatches: historical.list,
        firstObserved,
        lastObserved,
        projectCount: projects,
        successfulComparisons,
        versionHistory: [],
        versionHistoryCount: 0,
        lastModificationReason: null,
      });
    } else {
      const historical = historicalFor(signature(group.identity), ownKeys, {
        discipline: group.identity.discipline.id,
        engineeringObject: group.identity.engineeringObject.id,
        engineeringWork: group.identity.engineeringWork.id,
      });
      const evidenceText = evidenceTextForIdentity(group.identity);
      collections.needsReview.push({
        fingerprint: group.fingerprint,
        concept: group.concept,
        state: group.state,
        reasons: group.reasons,
        reasonDetails: buildReasonDetails({
          reasons: group.reasons,
          identity: group.identity,
          validation: rep.validation,
          evidenceText,
          driftDetail: driftDetailByLabel.get(group.concept) ?? null,
        }),
        exampleDeliverableName: rep.observed.name,
        projectName: rep.observed.projectName,
        identity: componentLabels(group.identity),
        identityView: buildIdentityView(group.identity),
        context: contextView(rep.observed),
        historicalMatches: historical.list,
        why: buildWhy(group.identity, evidenceText),
        impact: buildImpact({
          occurrences: group.records.length,
          projects,
          historicalMatchCount: historical.total,
          historicalDurationMatches: historical.durationCount,
        }),
        examples,
        evidence,
        occurrences: group.records.length,
        projects,
        confidence: group.confidence,
      });
    }
  }

  // Developer decisions whose fingerprint no longer appears in observed data
  // still belong in the appropriate bucket (trusted or rejected).
  for (const [fingerprint, decision] of decisions) {
    if (fingerprintGroups.has(fingerprint)) continue;
    const sig = [decision.identity.discipline ?? "?", decision.identity.engineeringObject ?? "?", decision.identity.engineeringWork ?? "?"].join("|");
    const historical = historicalFor(sig, new Set(), {
      discipline: decision.identity.discipline,
      engineeringObject: decision.identity.engineeringObject,
      engineeringWork: decision.identity.engineeringWork,
    });
    assignTrustedEntry(collections, {
      fingerprint,
      concept: decision.concept,
      status: decision.status,
      identity: decision.identity,
      identityView: null,
      context: null,
      aliases: decision.aliases,
      evidence: decision.evidence,
      examples: [],
      historicalMatches: historical.list,
      firstObserved: decision.firstObservedAt,
      lastObserved: decision.lastObservedAt,
      projectCount: decision.projectCount,
      successfulComparisons: decision.successfulComparisons,
      versionHistory: decision.versionHistory.map((v) => ({
        at: v.at,
        action: v.action,
        status: v.status,
        reviewedBy: v.reviewedBy,
        notes: v.notes,
      })),
      versionHistoryCount: decision.versionHistory.length,
      lastModificationReason: decision.versionHistory[decision.versionHistory.length - 1]?.notes ?? null,
    });
  }

  collections.needsReview.sort((a, b) => b.occurrences - a.occurrences || b.projects - a.projects);
  collections.autoApproved.sort(
    (a, b) => b.projectCount - a.projectCount || b.successfulComparisons - a.successfulComparisons
  );
  collections.developerApproved.sort(
    (a, b) => b.projectCount - a.projectCount || b.successfulComparisons - a.successfulComparisons
  );
  collections.developerModified.sort(
    (a, b) => b.projectCount - a.projectCount || b.successfulComparisons - a.successfulComparisons
  );
  collections.rejected.sort(
    (a, b) => b.projectCount - a.projectCount || b.successfulComparisons - a.successfulComparisons
  );

  const brainInbox = collections.needsReview;
  const trustedKnowledge = sortVisibleTrusted([
    ...collections.autoApproved,
    ...collections.developerApproved,
    ...collections.developerModified,
  ]);
  const summary = buildEngineeringBrainSummary(collections);

  const decisionList = [...decisions.values()];
  const totalDecisions = decisionList.length;
  const developerModificationRate = pct(
    decisionList.filter((d) => d.status === "DEVELOPER_MODIFIED").length,
    Math.max(1, totalDecisions)
  );
  const developerRejectionRate = pct(
    decisionList.filter((d) => d.status === "REJECTED").length,
    Math.max(1, totalDecisions)
  );
  const trustedAgreement = pct(
    decisionList.filter((d) => d.status === "DEVELOPER_APPROVED").length,
    Math.max(1, totalDecisions)
  );
  const autoTrustedRate = pct(autoTrustedIdentityCount, Math.max(1, records.length));
  const reviewRate = pct(reviewIdentityCount, Math.max(1, records.length));

  /* 8. Maturity assessment (developer-only). */
  const resolvedRecords = records.filter((r) => r.identity.status === "RESOLVED");
  const explainability = pct(
    resolvedRecords.filter((r) => r.identity.supportingEvidence.length > 0).length,
    Math.max(1, resolvedRecords.length)
  );
  const validationSuccess = pct(identitiesCreated - validationFailures, Math.max(1, identitiesCreated));
  const coverage = pct(identitiesCreated - unknownObjectCount, Math.max(1, identitiesCreated));
  const conceptsWithObject = [...objectIdsBySubject.values()].filter((set) => set.size >= 1).length;
  const contradictionControl = pct(
    conceptsWithObject - reasoningDrift.length,
    Math.max(1, conceptsWithObject)
  );
  // Repeatability: re-resolve a bounded sample and confirm identical signatures.
  const repeatSample = records.slice(0, 100);
  const repeatable = repeatSample.filter((record) => {
    const again = resolveValidated(
      {
        name: record.observed.name,
        fragnetName: record.observed.fragnetName,
        parentWbs: record.observed.parentWbs,
        wbsPath: record.observed.wbsPath,
        discipline: record.observed.discipline,
        activityCodeDiscipline: record.observed.activityCodeDiscipline,
        classificationTags: record.observed.classificationTags,
        classification: record.observed.classification,
        lifecycleStage: record.observed.lifecycleStage,
        projectContext: record.observed.projectContext,
        relatedActivityNames: record.observed.relatedActivityNames,
      },
      learnedObjectRules
    );
    return signature(again.identity) === signature(record.identity);
  }).length;
  const repeatability = pct(repeatable, Math.max(1, repeatSample.length));
  const reasoningStability = contradictionControl;

  const dimensions = {
    consistency: reasoningConsistency,
    explainability,
    validationSuccess,
    coverage,
    contradictionControl,
    repeatability,
    reasoningStability,
  };
  const overall =
    Math.round(
      ((dimensions.consistency * 0.2 +
        dimensions.explainability * 0.15 +
        dimensions.validationSuccess * 0.15 +
        dimensions.coverage * 0.15 +
        dimensions.contradictionControl * 0.15 +
        dimensions.repeatability * 0.1 +
        dimensions.reasoningStability * 0.1)) *
        10
    ) / 10;
  const readiness: EngineeringMaturity["readiness"] =
    overall >= 85 && coverage >= 70 && dimensions.repeatability >= 99
      ? "READY_TO_LEARN"
      : overall >= 65
        ? "MATURING"
        : "NOT_READY";
  const rationale: string[] = [];
  if (dimensions.repeatability < 100) {
    rationale.push("Reasoning is not fully repeatable — resolve twice yields different identities.");
  }
  if (coverage < 70) {
    rationale.push(`Coverage is ${coverage}% — too many deliverables resolve to an unknown engineering object.`);
  }
  if (reasoningDrift.length > 0) {
    rationale.push(`${reasoningDrift.length} concept(s) drift between engineering objects across imports.`);
  }
  if (readiness === "READY_TO_LEARN") {
    rationale.push("Reasoning is stable, explainable and repeatable — mature enough to consider autonomous learning.");
  }
  if (autoTrustedRate >= 80) {
    rationale.push(`${autoTrustedRate}% of identities auto-trust — developers only review exceptional cases.`);
  } else if (records.length > 0) {
    rationale.push(`Only ${autoTrustedRate}% of identities auto-trust — the Brain still defers to review too often.`);
  }
  if (developerRejectionRate > 20) {
    rationale.push(`Developer rejection rate is ${developerRejectionRate}% — reasoning is frequently wrong, not yet autonomous.`);
  }

  const maturity: EngineeringMaturity = {
    dimensions,
    trust: {
      autoTrustedRate,
      reviewRate,
      developerModificationRate,
      developerRejectionRate,
      trustedAgreement,
    },
    overall,
    readiness,
    rationale,
  };

  /* 9. Sample per-identity diagnostics (bounded). */
  const sampleIdentities: EngineeringIdentityDiagnostic[] = records.slice(0, 200).map((record) => ({
    deliverableKey: record.observed.key,
    deliverableName: record.observed.name,
    projectId: record.observed.projectId,
    projectName: record.observed.projectName,
    importVersion: record.observed.importVersion,
    importedAt: record.observed.importedAt,
    identity: {
      discipline: record.identity.discipline.id,
      engineeringObject: record.identity.engineeringObject.id,
      engineeringWork: record.identity.engineeringWork.id,
      deliverableType: record.identity.deliverableType.id,
      lifecycleStage: record.identity.lifecycleStage.id,
      status: record.identity.status,
    },
    evidenceUsed: record.identity.supportingEvidence.map((e) => `${e.source}: ${e.value}`),
    reasoningResult: record.identity.status,
    validationResult: record.validation,
    confidence: internalConfidence(record.identity),
    reasoningDurationMs: Math.round(record.durationMs * 1000) / 1000,
    versions,
    timestamp: now,
  }));

  return {
    generatedAt: now,
    versions,
    metrics,
    consistency: {
      reasoningConsistency,
      probes: probeResults,
      observedConceptsAnalysed,
      consistentConcepts,
      inconsistentConcepts,
    },
    unknownObjects,
    unknownWork,
    candidateLearning,
    ruleProposalCandidates,
    ruleProposals: [],
    ruleProposalStoreAvailable: false,
    learnedRuleStoreAvailable: false,
    reasoningDrift,
    maturity,
    topOpportunities,
    collections,
    summary,
    brainInbox,
    trustedKnowledge,
    storeAvailable,
    recentReasoningEvents: getRecentEngineeringReasoningEvents(100),
    sampleIdentities,
  };
}

/* -------------------------------------------------------------------------- */
/* DB loader (reads existing snapshots only — no schema change)               */
/* -------------------------------------------------------------------------- */

const MAX_OBSERVED_DELIVERABLES = 8000;

function tagsRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function activityDisciplineTag(
  activities: Array<{ classificationTags: Prisma.JsonValue | null }>
): string | null {
  for (const activity of activities) {
    const tags = tagsRecord(activity.classificationTags);
    if (!tags) continue;
    for (const [key, value] of Object.entries(tags)) {
      if (!key.toLowerCase().includes("discipline")) continue;
      const resolved = String(value ?? "").trim();
      if (resolved) return resolved;
    }
  }
  return null;
}

/**
 * Build the observed-deliverable set for a company from every imported
 * programme snapshot (all imports, so drift over time is visible).
 * Read-only, tenant-scoped, no new tables.
 */
export async function loadObservedDeliverablesForCompany(args: {
  companyId: string;
}): Promise<ObservedDeliverable[]> {
  const snapshots = await prisma.programmeSnapshot.findMany({
    where: { companyId: args.companyId },
    select: {
      id: true,
      projectId: true,
      project: { select: { name: true } },
      importedAt: true,
      snapshotVersion: true,
      stage: true,
      sector: true,
      projectType: true,
      programmeState: true,
      deliverableSnapshots: {
        select: {
          deliverableId: true,
          name: true,
          classification: true,
          parentWbs: true,
          wbsPath: true,
          stage: true,
          discipline: true,
          classificationTags: true,
          workPackageDurationDays: true,
        },
      },
      activitySnapshots: {
        select: {
          deliverableId: true,
          name: true,
          classificationTags: true,
        },
      },
    },
    orderBy: { importedAt: "desc" },
    take: 400,
  });

  const observed: ObservedDeliverable[] = [];
  for (const snapshot of snapshots) {
    const activitiesByDeliverable = new Map<string, typeof snapshot.activitySnapshots>();
    for (const activity of snapshot.activitySnapshots) {
      if (!activity.deliverableId) continue;
      const list = activitiesByDeliverable.get(activity.deliverableId) ?? [];
      list.push(activity);
      activitiesByDeliverable.set(activity.deliverableId, list);
    }
    // Neighbouring deliverables = siblings under the same fragnet / parent WBS.
    const siblingsByFragnet = new Map<string, string[]>();
    for (const deliverable of snapshot.deliverableSnapshots) {
      const key = deliverable.parentWbs ?? deliverable.wbsPath ?? "";
      if (!key) continue;
      const list = siblingsByFragnet.get(key) ?? [];
      list.push(deliverable.name);
      siblingsByFragnet.set(key, list);
    }
    for (const deliverable of snapshot.deliverableSnapshots) {
      if (observed.length >= MAX_OBSERVED_DELIVERABLES) break;
      const related = deliverable.deliverableId
        ? activitiesByDeliverable.get(deliverable.deliverableId) ?? []
        : [];
      const fragnetKey = deliverable.parentWbs ?? deliverable.wbsPath ?? "";
      const neighbourNames = (siblingsByFragnet.get(fragnetKey) ?? [])
        .filter((name) => name !== deliverable.name)
        .slice(0, 8);
      observed.push({
        key: `${snapshot.id}:${deliverable.deliverableId ?? deliverable.name}`,
        name: deliverable.name,
        fragnetName: deliverable.parentWbs ?? deliverable.wbsPath ?? null,
        parentWbs: deliverable.parentWbs,
        wbsPath: deliverable.wbsPath,
        discipline: deliverable.discipline,
        activityCodeDiscipline: activityDisciplineTag(related),
        classificationTags: tagsRecord(deliverable.classificationTags),
        classification: deliverable.classification,
        lifecycleStage: deliverable.stage ?? snapshot.stage,
        projectContext: { sector: snapshot.sector, projectType: snapshot.projectType },
        relatedActivityNames: related
          .map((activity) => activity.name?.trim())
          .filter((name): name is string => Boolean(name)),
        projectId: snapshot.projectId,
        projectName: snapshot.project.name,
        importVersion: snapshot.snapshotVersion,
        importedAt: snapshot.importedAt.toISOString(),
        neighbourNames,
        durationDays: deliverable.workPackageDurationDays ?? null,
      });
    }
  }

  return observed;
}

/**
 * Load observed deliverables for a company and compute the diagnostics report.
 */
export async function getEngineeringBrainDiagnostics(args: {
  companyId: string;
  options?: EngineeringBrainDiagnosticsOptions;
}): Promise<EngineeringBrainDiagnosticsReport> {
  const observed = await loadObservedDeliverablesForCompany({ companyId: args.companyId });
  const decisions = await loadEngineeringKnowledge(args.companyId);
  // Phase 3 (spec section 7): load developer-approved learned object rules
  // for this company so they're merged into resolution before matching runs.
  // Never throws — [] if the migration hasn't been deployed yet.
  const learnedObjectRules = await loadActiveLearnedObjectRules(args.companyId);
  const report = await computeEngineeringBrainDiagnostics(
    observed,
    DEFAULT_CONSISTENCY_PROBES,
    decisions,
    isEngineeringKnowledgeStoreAvailable(),
    args.options ?? {},
    learnedObjectRules
  );
  // Phase 2 (spec section 5): persist scored rule-proposal candidates
  // immediately after computing the report — this is the DB-touching half of
  // step 5b, kept out of the pure `computeEngineeringBrainDiagnostics` so that
  // function stays companyId-free and directly testable (see existing tests
  // in tests/integration/engineering-brain-diagnostics.test.mjs, which call it
  // without a companyId at all). Never throws — the persistence helper
  // degrades gracefully if the migration hasn't been deployed yet.
  await persistEngineeringRuleProposals({
    companyId: args.companyId,
    candidates: report.ruleProposalCandidates,
  });
  // Phase 3 (spec section 6): attach PENDING proposals for the review UI.
  report.ruleProposals = await listPendingRuleProposals(args.companyId);
  report.ruleProposalStoreAvailable = isEngineeringRuleProposalStoreAvailable();
  report.learnedRuleStoreAvailable = isEngineeringLearnedRuleStoreAvailable();
  return report;
}
