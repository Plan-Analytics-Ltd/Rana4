/**
 * Identity Review Debug Export — DEVELOPER ONLY.
 *
 * Serializes every stage of the Engineering Identity resolution pipeline so an
 * engineer (or another AI) can reconstruct every decision from JSON alone.
 *
 * Zero effect on production logic: this module only reads existing data and
 * re-runs the same pure functions the Brain already uses. Stages that do not
 * exist in the current engine are exported as explicit `null` / status "skipped".
 */
import type { DeliverableClassification, Prisma } from "@prisma/client";
import { prisma } from "../../../utils/prisma.js";
import { getAiExplanationConfig } from "../../explanation/explanationConfig.js";
import { getEngineeringBrainVersions } from "../taxonomy/engineeringBrainVersion.js";
import { classifyDisciplineCandidates } from "../taxonomy/disciplineClassifier.service.js";
import {
  resolveEngineeringIdentity,
  listEngineeringObjectCandidates,
  compareEngineeringIdentities,
  type EngineeringIdentity,
  type EngineeringIdentityComponent,
} from "../taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../taxonomy/engineeringIdentityValidation.service.js";
import {
  resolveWorkPackageTaxonomy,
  gatherClassificationContext,
  listWorkPackageCandidatesInDiscipline,
} from "../taxonomy/workPackageTaxonomy.service.js";
import { WORK_PACKAGE_TAXONOMY } from "../taxonomy/workPackageTaxonomy.config.js";
import { extractDocumentType } from "../taxonomy/documentType.extraction.js";
import { normaliseDeliverableNameForTaxonomy } from "../taxonomy/taxonomyMatching.utils.js";
import {
  assessEngineeringTrust,
  engineeringIdentityFingerprint,
  type EngineeringTrustReason,
} from "../taxonomy/engineeringTrust.service.js";
import { getEngineeringReasoningConfig } from "../taxonomy/engineeringReasoning.service.js";
import {
  buildIdentityView,
  buildReasonDetails,
  buildWhy,
  buildImpact,
  evidenceTextForIdentity,
  closestKnownObjects,
} from "./engineeringBrainReview.js";
import {
  loadEngineeringKnowledge,
  isEngineeringKnowledgeStoreAvailable,
  type StoredEngineeringKnowledge,
} from "./engineeringKnowledgeStore.service.js";
import {
  buildConfidenceBreakdown,
  analyseIdentityStability,
  detectDiagnosticContradictions,
  buildMissingEvidence,
  assessIdentityRisk,
  buildKnowledgeCoverage,
  findNearestIdentities,
  buildHumanSummary,
  buildQualityWarnings,
  validateExportRecord,
  subjectKeyFromName,
} from "./engineeringIdentityDebugQuality.js";
import {
  enrichBrainExportV2_2,
  enrichDeliverableObservations,
  type EnrichedEngineeringBrainExport,
} from "./engineeringBrainExportEnrichment.service.js";
import {
  buildExportObservationGrouping,
  buildExportRootSummary,
  type ExportObservationGroup,
  type ExportRootSummary,
} from "./engineeringBrainExportGrouping.service.js";
import { mapDiagnosticsReportToBrainExportV2 } from "./engineeringBrainExportMapper.service.js";
import { validateBrainUiParity } from "./engineeringBrainParity.service.js";
import { getEngineeringBrainDiagnostics } from "./engineeringBrainDiagnostics.service.js";

export const IDENTITY_DEBUG_EXPORT_SCHEMA_VERSION = "2.2.0";

export type IdentityDebugExportFilters = {
  projectId?: string;
  fragnetId?: string;
  deliverableId?: string;
};

export type PipelineStageStatus = "completed" | "skipped" | "failed";

export type PipelineStage = {
  stage: string;
  status: PipelineStageStatus;
  durationMs: number;
  input: unknown;
  output: unknown;
};

export type DebugCandidate = {
  candidateId: string;
  value: string;
  score: number;
  selected: boolean;
  rejectedBecause: string[] | null;
  detail?: unknown;
};

export type RuleTrace = {
  rule: string;
  type: "bonus" | "penalty" | "weight" | "info";
  contribution: number;
  evidence: string;
};

type RichActivity = {
  id: string | null;
  activityId: string | null;
  activityCode: string;
  name: string | null;
  discipline: string | null;
  classificationTags: Record<string, unknown> | null;
};

type RichObserved = {
  key: string;
  id: string | null;
  name: string;
  projectId: string;
  projectName: string;
  fragnetId: string | null;
  fragnetName: string | null;
  parentWbs: string | null;
  wbsPath: string | null;
  discipline: string | null;
  activityCodeDiscipline: string | null;
  classificationTags: Record<string, unknown> | null;
  classification: DeliverableClassification | null;
  lifecycleStage: string | null;
  projectContext: { sector: string | null; projectType: string | null } | null;
  durationDays: number | null;
  importVersion: number;
  importedAt: string;
  snapshotId: string;
  activities: RichActivity[];
  neighboursSameFragnet: string[];
  neighboursSameWbs: string[];
};

function tagsRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function activityDiscipline(tags: Record<string, unknown> | null): string | null {
  if (!tags) return null;
  for (const [key, value] of Object.entries(tags)) {
    if (!key.toLowerCase().includes("discipline")) continue;
    const resolved = String(value ?? "").trim();
    if (resolved) return resolved;
  }
  return null;
}

function identityKey(identity: EngineeringIdentity): string {
  return [
    identity.discipline.id ?? "?",
    identity.engineeringObject.id ?? "?",
    identity.engineeringWork.id ?? "?",
  ].join(".");
}

function signature(identity: EngineeringIdentity): string {
  return [
    identity.discipline.id ?? "?",
    identity.engineeringObject.id ?? "?",
    identity.engineeringWork.id ?? "?",
  ].join("|");
}

function roundMs(ns: bigint): number {
  return Math.round(Number(ns) / 1_000_000 * 1000) / 1000;
}

function timedStage(
  stage: string,
  input: unknown,
  run: () => { status: PipelineStageStatus; output: unknown }
): PipelineStage {
  const started = process.hrtime.bigint();
  try {
    const { status, output } = run();
    return { stage, status, durationMs: status === "skipped" ? 0 : roundMs(process.hrtime.bigint() - started), input, output };
  } catch (err) {
    return {
      stage,
      status: "failed",
      durationMs: roundMs(process.hrtime.bigint() - started),
      input,
      output: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

/** Actual runtime configuration that can influence identity behaviour / diagnostics. */
export function captureIdentityRuntimeConfiguration() {
  const reasoning = getEngineeringReasoningConfig();
  const explanation = getAiExplanationConfig();
  return {
    aiEngineeringReasoningEnabled: reasoning.enabled,
    aiEngineeringReasoning: {
      enabled: reasoning.enabled,
      model: reasoning.model,
      temperature: reasoning.temperature,
      maxTokens: reasoning.maxTokens,
    },
    aiExplanation: {
      enabled: explanation.enabled,
      provider: explanation.provider,
      model: explanation.model,
      temperature: explanation.temperature,
      maxTokens: explanation.maxTokens,
    },
    /** Trust is criteria-based (no numeric threshold env). Documented as observed. */
    trustCriteria: {
      requireResolvedStatus: true,
      requireValidationValid: true,
      requireCoreComponentEvidence: true,
      minimumSupportingEvidenceCount: 3,
      requireHistoricallyConsistent: true,
      autoTrustedWhenCriteriaMet: true,
    },
    featureFlags: {
      AI_ENGINEERING_REASONING_ENABLED: process.env.AI_ENGINEERING_REASONING_ENABLED ?? null,
      AI_EXPLANATION_ENABLED: process.env.AI_EXPLANATION_ENABLED ?? null,
      AI_EXPLANATION_PROVIDER: process.env.AI_EXPLANATION_PROVIDER ?? null,
      AI_EXPLANATION_MODEL: process.env.AI_EXPLANATION_MODEL ?? null,
      NEXT_PUBLIC_SHOW_ACTIVITY_DEV_TOOLS: process.env.NEXT_PUBLIC_SHOW_ACTIVITY_DEV_TOOLS ?? null,
    },
    environment: {
      nodeEnv: process.env.NODE_ENV ?? null,
      buildVersion:
        process.env.BUILD_VERSION?.trim() ||
        process.env.npm_package_version?.trim() ||
        null,
      gitCommit:
        process.env.GIT_COMMIT?.trim() ||
        process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
        process.env.SOURCE_VERSION?.trim() ||
        null,
    },
    knowledgeStoreAvailable: isEngineeringKnowledgeStoreAvailable(),
    identityEngineVersion: getEngineeringBrainVersions(),
  };
}

function provenance(
  component: EngineeringIdentityComponent,
  sourceService: string,
  confidence: number
) {
  const primary = component.evidence[0];
  return {
    value: component.label ?? component.id,
    id: component.id,
    source: sourceService,
    evidenceSource: primary?.source ?? null,
    confidence,
    evidence: component.evidence,
  };
}

function buildRuleTrace(args: {
  identity: EngineeringIdentity;
  validation: ReturnType<typeof enforceEngineeringIdentityValidation>["validation"];
  objectCandidates: ReturnType<typeof listEngineeringObjectCandidates>;
  identityView: ReturnType<typeof buildIdentityView>;
}): RuleTrace[] {
  const rules: RuleTrace[] = [];

  for (const e of args.identity.supportingEvidence) {
    const weightBySource: Record<string, number> = {
      DELIVERABLE_NAME: 0.15,
      FRAGNET: 0.1,
      PARENT_WBS: 0.08,
      WBS_PATH: 0.06,
      RELATED_ACTIVITY: 0.05,
      DISCIPLINE_METADATA: 0.12,
      CLASSIFICATION: 0.08,
      PROJECT_CONTEXT: 0.04,
      TAXONOMY: 0.1,
    };
    rules.push({
      rule: `EVIDENCE_${e.source}`,
      type: "bonus",
      contribution: weightBySource[e.source] ?? 0.03,
      evidence: `${e.source}: “${e.value}” (matched “${e.matched}”)`,
    });
  }

  const winner = args.objectCandidates.find((c) => c.winner);
  if (winner) {
    rules.push({
      rule: "ENGINEERING_OBJECT_NAME_MATCH",
      type: "bonus",
      contribution: Math.min(0.25, winner.score / 660),
      evidence: `Matched ${winner.label} via ${winner.source} (“${winner.value}”, pattern ${winner.matchedPattern}, score ${winner.score})`,
    });
  }

  if (args.identity.discipline.evidence.some((e) => e.source === "TAXONOMY")) {
    rules.push({
      rule: "COMPONENT_TAXONOMY_BONUS",
      type: "bonus",
      contribution: 0.05,
      evidence: "Taxonomy contributed to discipline resolution (+5 component confidence)",
    });
  }

  for (const c of args.validation.contradictions) {
    rules.push({
      rule: c.rule,
      type: "penalty",
      contribution: -0.1,
      evidence: c.detail,
    });
  }

  rules.push({
    rule: "OVERALL_CONFIDENCE_WEIGHTING",
    type: "weight",
    contribution: args.identityView.overallConfidence / 100,
    evidence: `0.3*discipline(${args.identityView.discipline.confidence}) + 0.4*object(${args.identityView.engineeringObject.confidence}) + 0.3*work(${args.identityView.engineeringWork.confidence})`,
  });

  return rules;
}

async function loadRichObserved(
  companyId: string,
  filters: IdentityDebugExportFilters
): Promise<RichObserved[]> {
  const snapshots = await prisma.programmeSnapshot.findMany({
    where: {
      companyId,
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
    },
    select: {
      id: true,
      projectId: true,
      project: { select: { name: true } },
      importedAt: true,
      snapshotVersion: true,
      stage: true,
      sector: true,
      projectType: true,
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
          fragnetId: true,
        },
      },
      activitySnapshots: {
        select: {
          id: true,
          activityId: true,
          activityCode: true,
          deliverableId: true,
          name: true,
          classificationTags: true,
          fragnetId: true,
        },
      },
    },
    orderBy: { importedAt: "desc" },
    take: 400,
  });

  const observed: RichObserved[] = [];
  for (const snapshot of snapshots) {
    const activitiesByDeliverable = new Map<string, typeof snapshot.activitySnapshots>();
    for (const activity of snapshot.activitySnapshots) {
      if (!activity.deliverableId) continue;
      const list = activitiesByDeliverable.get(activity.deliverableId) ?? [];
      list.push(activity);
      activitiesByDeliverable.set(activity.deliverableId, list);
    }

    const byFragnet = new Map<string, string[]>();
    const byWbs = new Map<string, string[]>();
    for (const d of snapshot.deliverableSnapshots) {
      const fragKey = d.fragnetId ?? d.parentWbs ?? d.wbsPath ?? "";
      if (fragKey) {
        const list = byFragnet.get(fragKey) ?? [];
        list.push(d.name);
        byFragnet.set(fragKey, list);
      }
      const wbsKey = d.parentWbs ?? d.wbsPath ?? "";
      if (wbsKey) {
        const list = byWbs.get(wbsKey) ?? [];
        list.push(d.name);
        byWbs.set(wbsKey, list);
      }
    }

    for (const deliverable of snapshot.deliverableSnapshots) {
      if (filters.deliverableId && deliverable.deliverableId !== filters.deliverableId) continue;
      if (filters.fragnetId) {
        const frag = deliverable.fragnetId ?? deliverable.parentWbs ?? null;
        if (frag !== filters.fragnetId) continue;
      }

      const related = deliverable.deliverableId
        ? activitiesByDeliverable.get(deliverable.deliverableId) ?? []
        : [];
      const fragKey = deliverable.fragnetId ?? deliverable.parentWbs ?? deliverable.wbsPath ?? "";
      const wbsKey = deliverable.parentWbs ?? deliverable.wbsPath ?? "";

      observed.push({
        key: `${snapshot.id}:${deliverable.deliverableId ?? deliverable.name}`,
        id: deliverable.deliverableId,
        name: deliverable.name,
        projectId: snapshot.projectId,
        projectName: snapshot.project.name,
        fragnetId: deliverable.fragnetId,
        fragnetName: deliverable.parentWbs ?? deliverable.wbsPath ?? null,
        parentWbs: deliverable.parentWbs,
        wbsPath: deliverable.wbsPath,
        discipline: deliverable.discipline,
        activityCodeDiscipline:
          related.map((a) => activityDiscipline(tagsRecord(a.classificationTags))).find(Boolean) ?? null,
        classificationTags: tagsRecord(deliverable.classificationTags),
        classification: deliverable.classification,
        lifecycleStage: deliverable.stage ?? snapshot.stage,
        projectContext: { sector: snapshot.sector, projectType: snapshot.projectType },
        durationDays: deliverable.workPackageDurationDays ?? null,
        importVersion: snapshot.snapshotVersion,
        importedAt: snapshot.importedAt.toISOString(),
        snapshotId: snapshot.id,
        activities: related.map((a) => ({
          id: a.id,
          activityId: a.activityId,
          activityCode: a.activityCode,
          name: a.name,
          discipline: activityDiscipline(tagsRecord(a.classificationTags)),
          classificationTags: tagsRecord(a.classificationTags),
        })),
        neighboursSameFragnet: (byFragnet.get(fragKey) ?? [])
          .filter((n) => n !== deliverable.name)
          .slice(0, 20),
        neighboursSameWbs: (byWbs.get(wbsKey) ?? [])
          .filter((n) => n !== deliverable.name)
          .slice(0, 20),
      });
    }
  }
  return observed;
}

function reviewReasonSeverity(code: EngineeringTrustReason): "error" | "warning" | "info" {
  if (code === "CONTRADICTORY_IDENTITY" || code === "VALIDATION_CONFLICT") return "error";
  return "warning";
}

function serializeDeliverable(
  observed: RichObserved,
  allResolved: Array<{ observed: RichObserved; identity: EngineeringIdentity }>,
  decisions: Map<string, StoredEngineeringKnowledge>,
  driftingSubjects: Set<string>
) {
  const taxonomyInput = {
    deliverableName: observed.name,
    fragnetName: observed.fragnetName,
    parentWbs: observed.parentWbs,
    wbsPath: observed.wbsPath,
    disciplineTag: observed.discipline,
    activityCodeDiscipline: observed.activityCodeDiscipline,
    classificationTags: observed.classificationTags,
    classification: observed.classification,
    lifecycleStage: observed.lifecycleStage,
    projectContext: observed.projectContext,
    relatedActivityNames: observed.activities
      .map((a) => a.name?.trim())
      .filter((n): n is string => Boolean(n)),
  };

  const stages: PipelineStage[] = [];
  const missingInputs: string[] = [];

  // 1. Activity parsing — not implemented
  stages.push(
    timedStage("activity parsing", { activities: observed.activities }, () => {
      missingInputs.push("activity.parsedVerb", "activity.parsedObject");
      return { status: "skipped", output: null };
    })
  );

  // 2. Context gathering
  let context = gatherClassificationContext(taxonomyInput);
  stages.push(
    timedStage("context gathering", { ...taxonomyInput }, () => {
      context = gatherClassificationContext(taxonomyInput);
      return { status: "completed", output: context };
    })
  );

  // 3. Document type
  const normalisedName = normaliseDeliverableNameForTaxonomy(observed.name);
  let documentType = extractDocumentType(normalisedName);
  stages.push(
    timedStage("document type extraction", { normalisedName }, () => {
      documentType = extractDocumentType(normalisedName);
      return { status: "completed", output: documentType };
    })
  );

  // 4. Discipline classifier
  let disciplineCandidates = classifyDisciplineCandidates(taxonomyInput);
  const disciplineDebugCandidates: DebugCandidate[] = [];
  stages.push(
    timedStage("classifyDiscipline", { ...taxonomyInput }, () => {
      disciplineCandidates = classifyDisciplineCandidates(taxonomyInput);
      const winner = disciplineCandidates[0] ?? null;
      for (let i = 0; i < disciplineCandidates.length; i += 1) {
        const c = disciplineCandidates[i]!;
        disciplineDebugCandidates.push({
          candidateId: `discipline:${c.disciplineId}:${c.source}:${i}`,
          value: c.disciplineId,
          score: c.confidence,
          selected: i === 0,
          rejectedBecause:
            i === 0
              ? null
              : [
                  `Outranked by ${winner?.disciplineId ?? "winner"} (source=${winner?.source}, confidence=${winner?.confidence})`,
                  `This candidate source=${c.source}, confidence=${c.confidence}`,
                ],
          detail: c,
        });
      }
      return {
        status: "completed",
        output: { winner, candidates: disciplineDebugCandidates },
      };
    })
  );

  // 5. Work-package taxonomy
  let taxonomy = resolveWorkPackageTaxonomy(taxonomyInput);
  let workPackageDebugCandidates: DebugCandidate[] = [];
  stages.push(
    timedStage("resolveWorkPackageTaxonomy", { taxonomyInput, documentType }, () => {
      taxonomy = resolveWorkPackageTaxonomy(taxonomyInput);
      const disciplineDef = WORK_PACKAGE_TAXONOMY.find((d) => d.id === taxonomy.disciplineId);
      const wpCandidates = disciplineDef
        ? listWorkPackageCandidatesInDiscipline(disciplineDef, normalisedName, documentType)
        : [];
      workPackageDebugCandidates = wpCandidates.map((c, i) => ({
        candidateId: `workPackage:${c.workPackageId}:${i}`,
        value: c.workPackageId,
        score: c.score,
        selected: c.workPackageId === taxonomy.workPackageId || (i === 0 && !taxonomy.isUnknownWorkPackage),
        rejectedBecause:
          c.workPackageId === taxonomy.workPackageId || (i === 0 && !taxonomy.isUnknownWorkPackage)
            ? null
            : [
                `Score ${c.score} below or tied below selected work package`,
                c.reason,
              ],
        detail: c,
      }));
      // Soft-failure / unknown: mark none selected if soft failure
      if (taxonomy.isUnknownWorkPackage) {
        workPackageDebugCandidates = workPackageDebugCandidates.map((c) => ({
          ...c,
          selected: false,
          rejectedBecause: c.rejectedBecause ?? ["Soft failure — no configured work package matched"],
        }));
      }
      return {
        status: "completed",
        output: {
          resolution: {
            disciplineId: taxonomy.disciplineId,
            categoryId: taxonomy.categoryId,
            workPackageId: taxonomy.workPackageId,
            matched: taxonomy.matched,
            isUnknownWorkPackage: taxonomy.isUnknownWorkPackage,
            disciplineSource: taxonomy.disciplineSource,
          },
          diagnostics: taxonomy.diagnostics,
          candidates: workPackageDebugCandidates,
        },
      };
    })
  );

  // 6. Embedding — skipped
  stages.push(
    timedStage("embedding search", { queryText: observed.name }, () => {
      missingInputs.push("embeddingMatches", "embeddingVectors");
      return { status: "skipped", output: null };
    })
  );

  // 7. Engineering object candidates
  let objectCandidates = listEngineeringObjectCandidates(taxonomyInput, taxonomy);
  let objectDebugCandidates: DebugCandidate[] = [];
  stages.push(
    timedStage("listEngineeringObjectCandidates", { taxonomyInput, taxonomyResolution: {
      disciplineId: taxonomy.disciplineId,
      workPackageId: taxonomy.workPackageId,
    } }, () => {
      objectCandidates = listEngineeringObjectCandidates(taxonomyInput, taxonomy);
      objectDebugCandidates = objectCandidates.map((c, i) => ({
        candidateId: `engineeringObject:${c.id}:${i}`,
        value: c.id,
        score: c.score,
        selected: c.winner,
        rejectedBecause: c.winner
          ? null
          : [
              `Score ${c.score} below winner ${objectCandidates[0]?.id ?? "?"} (${objectCandidates[0]?.score ?? 0})`,
              `Evidence source ${c.source}: “${c.value}”`,
            ],
        detail: c,
      }));
      return {
        status: "completed",
        output: {
          candidates: objectDebugCandidates,
          closestKnownObjects: closestKnownObjects(
            [observed.name, observed.fragnetName, observed.parentWbs, ...(taxonomyInput.relatedActivityNames ?? [])]
              .filter(Boolean)
              .join(" "),
            objectCandidates[0]?.id ?? null
          ),
          textEvidenceWeights: {
            DELIVERABLE_NAME: 100,
            FRAGNET: 65,
            PARENT_WBS: 55,
            WBS_PATH: 45,
            RELATED_ACTIVITY: 35,
          },
        },
      };
    })
  );

  // 8. resolveEngineeringIdentity
  let rawIdentity = resolveEngineeringIdentity(taxonomyInput);
  stages.push(
    timedStage("resolveEngineeringIdentity", { taxonomyInput }, () => {
      rawIdentity = resolveEngineeringIdentity(taxonomyInput);
      return {
        status: "completed",
        output: {
          status: rawIdentity.status,
          key: identityKey(rawIdentity),
          discipline: rawIdentity.discipline.id,
          engineeringObject: rawIdentity.engineeringObject.id,
          engineeringWork: rawIdentity.engineeringWork.id,
          deliverableType: rawIdentity.deliverableType.id,
          lifecycleStage: rawIdentity.lifecycleStage.id,
          projectContext: rawIdentity.projectContext.id,
          fragnetContext: rawIdentity.fragnetContext.id,
          taxonomy: rawIdentity.taxonomy,
          supportingEvidence: rawIdentity.supportingEvidence,
        },
      };
    })
  );

  // 9. Candidate merge (LLM not used on this path)
  stages.push(
    timedStage("candidate merge", {
      ruleBasedIdentity: {
        status: rawIdentity.status,
        key: identityKey(rawIdentity),
      },
      llmReasonedIdentity: null,
    }, () => {
      missingInputs.push("llmReasonedIdentity");
      return {
        status: "completed",
        output: {
          mergedIdentity: {
            status: rawIdentity.status,
            key: identityKey(rawIdentity),
          },
          overrides: [],
          source: "RULE_BASED",
        },
      };
    })
  );

  // 10. Validation
  let enforced = enforceEngineeringIdentityValidation(rawIdentity);
  stages.push(
    timedStage("enforceEngineeringIdentityValidation", {
      identityKey: identityKey(rawIdentity),
      identity: {
        discipline: rawIdentity.discipline.id,
        engineeringObject: rawIdentity.engineeringObject.id,
        engineeringWork: rawIdentity.engineeringWork.id,
      },
    }, () => {
      enforced = enforceEngineeringIdentityValidation(rawIdentity);
      return { status: "completed", output: enforced.validation };
    })
  );

  // 11. Confidence
  const identityView = buildIdentityView(enforced);
  const subjectKey = normaliseDeliverableNameForTaxonomy(
    documentType?.residualSubject ?? observed.name
  );
  const trustSignal = { historicallyConsistent: !driftingSubjects.has(subjectKey) };
  let trust = assessEngineeringTrust({
    identity: enforced,
    validation: enforced.validation,
    signal: trustSignal,
  });
  const ruleTrace = buildRuleTrace({
    identity: enforced,
    validation: enforced.validation,
    objectCandidates,
    identityView,
  });
  stages.push(
    timedStage("confidence calculation", {
      identity: {
        discipline: enforced.discipline.id,
        engineeringObject: enforced.engineeringObject.id,
        engineeringWork: enforced.engineeringWork.id,
      },
      evidenceCounts: {
        discipline: enforced.discipline.evidence.length,
        engineeringObject: enforced.engineeringObject.evidence.length,
        engineeringWork: enforced.engineeringWork.evidence.length,
        supporting: enforced.supportingEvidence.length,
      },
    }, () => ({
      status: "completed",
      output: {
        overall: identityView.overallConfidence,
        components: {
          discipline: identityView.discipline.confidence,
          engineeringObject: identityView.engineeringObject.confidence,
          engineeringWork: identityView.engineeringWork.confidence,
          deliverableType: identityView.deliverableType.confidence,
          lifecycle: identityView.lifecycleStage.confidence,
          projectContext: identityView.projectContext.confidence,
          fragnetContext: identityView.fragnetContext.confidence,
        },
        ruleTrace,
        finalWeighting: {
          disciplineWeight: 0.3,
          engineeringObjectWeight: 0.4,
          engineeringWorkWeight: 0.3,
          formula: "0.3*discipline + 0.4*object + 0.3*work",
        },
      },
    }))
  );

  // 12. Trust / review decision
  const fingerprintRaw = `${subjectKey.trim().toLowerCase()}::${signature(enforced)}`;
  const fingerprint = engineeringIdentityFingerprint(subjectKey, enforced);
  const knowledge = decisions.get(fingerprint) ?? null;
  stages.push(
    timedStage("review decision", {
      identity: {
        status: enforced.status,
        key: identityKey(enforced),
      },
      validation: enforced.validation,
      signal: trustSignal,
      fingerprint,
      existingDeveloperDecision: knowledge
        ? {
            knowledgeEntryId: knowledge.knowledgeEntryId,
            status: knowledge.status,
            lastAction: knowledge.lastAction,
          }
        : null,
    }, () => {
      trust = assessEngineeringTrust({
        identity: enforced,
        validation: enforced.validation,
        signal: trustSignal,
      });
      return {
        status: "completed",
        output: {
          state: trust.state,
          reasons: trust.reasons,
          evidenceSufficient: trust.evidenceSufficient,
          confidence: trust.confidence,
          approvalStatus:
            knowledge?.status ?? (trust.state === "TRUSTED" ? "AUTO_APPROVED" : "PENDING_REVIEW"),
        },
      };
    })
  );

  /* Historical matches */
  const ownSig = signature(enforced);
  const historicalMatches =
    ownSig.includes("?") || enforced.status !== "RESOLVED"
      ? []
      : allResolved
          .filter(
            (r) =>
              r.observed.key !== observed.key &&
              r.identity.status === "RESOLVED" &&
              signature(r.identity) === ownSig
          )
          .map((r) => {
            const comparison = compareEngineeringIdentities(enforced, r.identity);
            return {
              project: r.observed.projectName,
              projectId: r.observed.projectId,
              fragnet: r.observed.fragnetName,
              deliverable: r.observed.name,
              deliverableId: r.observed.id,
              durationDays: r.observed.durationDays,
              similarity: comparison.equivalent ? 1 : 0,
              identity: identityKey(r.identity),
              matchedComponents: comparison.matchedIdentityComponents,
              reason: comparison.reason,
              rejectedBy: comparison.rejectedBy,
            };
          });

  const seenHist = new Set<string>();
  const historicalMatchesDeduped = historicalMatches.filter((m) => {
    const k = `${m.projectId}:${m.deliverable}`;
    if (seenHist.has(k)) return false;
    seenHist.add(k);
    return true;
  });

  const evidenceSources = new Set(enforced.supportingEvidence.map((e) => e.source));
  const activities = observed.activities.map((a) => {
    const name = a.name?.trim() ?? "";
    const contributed =
      Boolean(name) &&
      enforced.supportingEvidence.some(
        (e) => e.source === "RELATED_ACTIVITY" && e.value.toLowerCase() === name.toLowerCase()
      );
    return {
      id: a.id,
      activityId: a.activityId,
      activityCode: a.activityCode,
      name: a.name,
      parsedVerb: null as null,
      parsedObject: null as null,
      discipline: a.discipline,
      contributed,
      contributionWeight: contributed ? 35 : 0,
      classificationTags: a.classificationTags,
    };
  });

  const why = buildWhy(enforced, evidenceTextForIdentity(enforced));
  const reasonDetails = buildReasonDetails({
    reasons: trust.reasons,
    identity: enforced,
    validation: enforced.validation,
    evidenceText: evidenceTextForIdentity(enforced),
  });
  const impact = buildImpact({
    occurrences: allResolved.filter((r) => {
      const sk = normaliseDeliverableNameForTaxonomy(
        extractDocumentType(normaliseDeliverableNameForTaxonomy(r.observed.name))?.residualSubject ??
          r.observed.name
      );
      return engineeringIdentityFingerprint(sk, r.identity) === fingerprint;
    }).length,
    projects: new Set(
      allResolved
        .filter((r) => {
          const sk = normaliseDeliverableNameForTaxonomy(
            extractDocumentType(normaliseDeliverableNameForTaxonomy(r.observed.name))?.residualSubject ??
              r.observed.name
          );
          return engineeringIdentityFingerprint(sk, r.identity) === fingerprint;
        })
        .map((r) => r.observed.projectId)
    ).size,
    historicalMatchCount: historicalMatchesDeduped.length,
    historicalDurationMatches: historicalMatchesDeduped.filter((m) => m.durationDays != null).length,
  });

  const reasoningConfig = getEngineeringReasoningConfig();
  missingInputs.push(
    "neighbouringDeliverables.precedingDeliverables",
    "neighbouringDeliverables.followingDeliverables",
    "neighbouringDeliverables.sharedActivities",
    "neighbouringDeliverables.relationshipWeights"
  );

  const decision = {
    trusted: trust.state === "TRUSTED" || (knowledge != null && knowledge.status !== "REJECTED"),
    reviewRequired: trust.state !== "TRUSTED" && knowledge == null,
    confidence: trust.confidence / 100,
    overallIdentityConfidence: identityView.overallConfidence / 100,
    fingerprint,
    knowledgeEntryId: knowledge?.knowledgeEntryId ?? null,
    identity: {
      status: enforced.status,
      key: identityKey(enforced),
      discipline: enforced.discipline.id,
      engineeringObject: enforced.engineeringObject.id,
      engineeringWork: enforced.engineeringWork.id,
      deliverableType: enforced.deliverableType.id,
      lifecycleStage: enforced.lifecycleStage.id,
      projectContext: enforced.projectContext.id,
    },
    reasons: trust.reasons,
    approvalStatus: knowledge?.status ?? (trust.state === "TRUSTED" ? "AUTO_APPROVED" : "PENDING_REVIEW"),
    reviewStatus: trust.state,
  };

  const fingerprintDetails = {
    algorithm: "sha256(subjectKey::discipline|engineeringObject|engineeringWork).hex.slice(0,24)",
    fingerprintId: fingerprint,
    inputs: [
      { name: "subjectKey", value: subjectKey },
      { name: "discipline", value: enforced.discipline.id ?? "?" },
      { name: "engineeringObject", value: enforced.engineeringObject.id ?? "?" },
      { name: "engineeringWork", value: enforced.engineeringWork.id ?? "?" },
    ],
    raw: fingerprintRaw,
    note: "Fingerprint is keyed on concept subject + resolved IDENTITY signature so developer corrections attach to identical future reasoning.",
  };

  const replay = {
    supported: missingInputs.length === 0,
    deterministic: true,
    missingInputs: [...new Set(missingInputs)],
    note:
      missingInputs.length === 0
        ? "Export contains enough observed inputs to deterministically re-run the rule-based identity pipeline."
        : "Rule-based identity stages are replayable from this export. Listed missingInputs are stages not implemented or not loaded into the identity path today.",
  };

  /* ---- v1.2.0 quality diagnostics (observe only) ---- */
  const confidenceBreakdown = buildConfidenceBreakdown({
    identityView,
    ruleTrace,
    validation: enforced.validation,
  });

  const stability = analyseIdentityStability({
    deliverableName: observed.name,
    taxonomyInput,
    identity: enforced,
  });

  const contradictions = detectDiagnosticContradictions({
    identity: enforced,
    validation: enforced.validation,
    taxonomy,
  });

  const peerFingerprints = allResolved.map((r) => {
    const sk = subjectKeyFromName(r.observed.name);
    return {
      fingerprint: engineeringIdentityFingerprint(sk, r.identity),
      deliverableId: r.observed.id,
      deliverableName: r.observed.name,
      projectName: r.observed.projectName,
      identity: r.identity,
    };
  });

  const nearestIdentities = findNearestIdentities({
    identity: enforced,
    fingerprint,
    subjectKey,
    peers: peerFingerprints,
    limit: 5,
  });

  const knowledgeCoverage = buildKnowledgeCoverage({
    decisions,
    fingerprint,
    nearestFingerprints: nearestIdentities.map((n) => n.fingerprint),
  });

  const activityContributed = activities.filter((a) => a.contributed).length;
  const missingEvidence = buildMissingEvidence({
    identity: enforced,
    trust,
    activityCount: observed.activities.length,
    historicalMatchCount: historicalMatchesDeduped.length,
    neighbourCount: observed.neighboursSameFragnet.length + observed.neighboursSameWbs.length,
    knowledgeMatched: knowledgeCoverage.matchedEntries,
  });

  const riskAssessment = assessIdentityRisk({
    identity: enforced,
    trust,
    stability,
    contradictions,
    historicalMatchCount: historicalMatchesDeduped.length,
    activityContributed,
  });

  const summary = buildHumanSummary({
    identity: enforced,
    trust,
    confidenceBreakdown,
    missingEvidence,
    contradictions,
    stability,
    historicalMatchCount: historicalMatchesDeduped.length,
  });

  const qualityWarnings = buildQualityWarnings({
    identity: enforced,
    ruleTrace,
    confidenceBreakdown,
    activityContributed,
    historicalMatchCount: historicalMatchesDeduped.length,
    stability,
    contradictions,
  });

  const record = {
    deliverableId: observed.id,
    key: observed.key,
    name: observed.name,
    project: { id: observed.projectId, name: observed.projectName },
    fragnet: { id: observed.fragnetId, name: observed.fragnetName },
    parentWbs: observed.parentWbs,
    wbsPath: observed.wbsPath,
    decision: {
      ...decision,
      missingEvidence,
      risk: riskAssessment.risk,
      riskScore: riskAssessment.score,
    },
    fingerprint,
    fingerprintDetails,
    knowledgeEntryId: knowledge?.knowledgeEntryId ?? null,
    confidenceBreakdown,
    stability,
    contradictions,
    missingEvidence,
    riskAssessment,
    knowledgeCoverage,
    nearestIdentities,
    summary,
    qualityWarnings,
    provenance: {
      discipline: provenance(enforced.discipline, "DisciplineClassifier", identityView.discipline.confidence / 100),
      engineeringObject: provenance(
        enforced.engineeringObject,
        "EngineeringObjectRules",
        identityView.engineeringObject.confidence / 100
      ),
      engineeringWork: provenance(
        enforced.engineeringWork,
        "EngineeringWorkResolver",
        identityView.engineeringWork.confidence / 100
      ),
      deliverableType: provenance(
        enforced.deliverableType,
        "DocumentTypeExtractor",
        identityView.deliverableType.confidence / 100
      ),
      lifecycle: provenance(
        enforced.lifecycleStage,
        "LifecycleStageNormaliser",
        identityView.lifecycleStage.confidence / 100
      ),
      workPackage: {
        value: taxonomy.workPackageLabel,
        id: taxonomy.workPackageId,
        source: "WorkPackageTaxonomy",
        confidence: taxonomy.diagnostics.disciplineConfidence != null
          ? (taxonomy.diagnostics.disciplineConfidence as number) / 100
          : null,
        reason: taxonomy.diagnostics.workPackageReason,
        isUnknownWorkPackage: taxonomy.isUnknownWorkPackage,
      },
      taxonomy: {
        value: taxonomy.taxonomyKey,
        id: taxonomy.taxonomyKey,
        source: "WorkPackageTaxonomy",
        confidence: taxonomy.matched ? 1 : 0,
        diagnostics: taxonomy.diagnostics,
      },
      projectContext: provenance(
        enforced.projectContext,
        "ProjectContextPassthrough",
        identityView.projectContext.confidence / 100
      ),
    },
    currentIdentity: {
      status: enforced.status,
      key: identityKey(enforced),
      discipline: {
        id: enforced.discipline.id,
        label: enforced.discipline.label,
        evidence: enforced.discipline.evidence,
      },
      engineeringObject: {
        id: enforced.engineeringObject.id,
        label: enforced.engineeringObject.label,
        evidence: enforced.engineeringObject.evidence,
      },
      engineeringWork: {
        id: enforced.engineeringWork.id,
        label: enforced.engineeringWork.label,
        evidence: enforced.engineeringWork.evidence,
      },
      deliverableType: {
        id: enforced.deliverableType.id,
        label: enforced.deliverableType.label,
        evidence: enforced.deliverableType.evidence,
      },
      lifecycle: {
        id: enforced.lifecycleStage.id,
        label: enforced.lifecycleStage.label,
        evidence: enforced.lifecycleStage.evidence,
      },
      projectContext: {
        id: enforced.projectContext.id,
        label: enforced.projectContext.label,
        evidence: enforced.projectContext.evidence,
      },
      fragnetContext: {
        id: enforced.fragnetContext.id,
        label: enforced.fragnetContext.label,
        evidence: enforced.fragnetContext.evidence,
      },
      taxonomy: enforced.taxonomy,
      supportingEvidence: enforced.supportingEvidence,
    },
    confidenceScores: {
      overall: identityView.overallConfidence,
      discipline: identityView.discipline.confidence,
      engineeringObject: identityView.engineeringObject.confidence,
      engineeringWork: identityView.engineeringWork.confidence,
      deliverableType: identityView.deliverableType.confidence,
      lifecycle: identityView.lifecycleStage.confidence,
      projectContext: identityView.projectContext.confidence,
      fragnetContext: identityView.fragnetContext.confidence,
      trust: trust.confidence,
      embeddingContribution: null,
      activityContribution: evidenceSources.has("RELATED_ACTIVITY") ? 35 : 0,
      neighbourContribution: null,
      historicalContribution: null,
      ruleTrace,
      penalties: ruleTrace.filter((r) => r.type === "penalty"),
      bonuses: ruleTrace.filter((r) => r.type === "bonus"),
      finalWeighting: {
        disciplineWeight: 0.3,
        engineeringObjectWeight: 0.4,
        engineeringWorkWeight: 0.3,
      },
    },
    reviewStatus: trust.state,
    approvalStatus: decision.approvalStatus,
    manualOverrides: knowledge
      ? {
          knowledgeEntryId: knowledge.knowledgeEntryId,
          identity: knowledge.identity,
          aliases: knowledge.aliases,
          notes: knowledge.reviewNotes,
          reviewedBy: knowledge.reviewedBy,
          lastAction: knowledge.lastAction,
        }
      : null,
    reasoning: {
      why,
      trustReasons: trust.reasons,
      validation: enforced.validation,
      taxonomyDiagnostics: taxonomy.diagnostics,
    },
    whyNeedsReview: reasonDetails.map((d) => ({
      code: d.reason,
      severity: reviewReasonSeverity(d.reason),
      details: d.detail,
      closestKnownObjects: d.closestKnownObjects ?? null,
      modelConfidence: d.modelConfidence ?? null,
      validationRule: d.validationRule ?? null,
    })),
    reviewReasons: reasonDetails.map((d) => ({
      code: d.reason,
      severity: reviewReasonSeverity(d.reason),
      details: d.detail,
      closestKnownObjects: d.closestKnownObjects ?? null,
      modelConfidence: d.modelConfidence ?? null,
      validationRule: d.validationRule ?? null,
    })),
    historicalMatches: historicalMatchesDeduped,
    historicalDurationEvidence: historicalMatchesDeduped.map((m) => ({
      project: m.project,
      deliverable: m.deliverable,
      deliverableId: m.deliverableId,
      durationDays: m.durationDays,
      identity: m.identity,
    })),
    durationPrecedent: {
      matchCount: historicalMatchesDeduped.length,
      withDuration: historicalMatchesDeduped.filter((m) => m.durationDays != null).length,
      durations: historicalMatchesDeduped
        .map((m) => m.durationDays)
        .filter((d): d is number => d != null),
    },
    comparisonCounts: {
      equivalentHistorical: historicalMatchesDeduped.length,
      futureComparisons: impact.futureComparisons,
      historicalDurationMatches: impact.historicalDurationMatches,
    },
    futureComparisonCounts: impact.futureComparisons,
    candidateIdentities: {
      discipline: disciplineDebugCandidates,
      engineeringObject: objectDebugCandidates,
      workPackage: workPackageDebugCandidates,
    },
    embeddingMatches: null,
    deterministicMatches: {
      disciplineCandidates: disciplineDebugCandidates,
      objectCandidates: objectDebugCandidates,
      workPackageCandidates: workPackageDebugCandidates,
      taxonomyDiagnostics: taxonomy.diagnostics,
    },
    aiMatches: reasoningConfig.enabled
      ? {
          note: "LLM reasoning is enabled in config, but this export path resolves rule-based identities only (zero side-effects — no LLM call).",
          enabled: true,
          model: reasoningConfig.model,
          matches: null,
        }
      : null,
    activities,
    neighbouringDeliverables: {
      precedingDeliverables: null,
      followingDeliverables: null,
      sameWbs: observed.neighboursSameWbs,
      sameFragnet: observed.neighboursSameFragnet,
      sharedActivities: null,
      relationshipWeights: null,
    },
    metadata: {
      classification: observed.classification,
      classificationTags: observed.classificationTags,
      importVersion: observed.importVersion,
      importedAt: observed.importedAt,
      snapshotId: observed.snapshotId,
      durationDays: observed.durationDays,
    },
    disciplineMetadata: {
      deliverableDiscipline: observed.discipline,
      activityCodeDiscipline: observed.activityCodeDiscipline,
    },
    lifecycle: identityView.lifecycleStage,
    deliverableType: identityView.deliverableType,
    engineeringObject: identityView.engineeringObject,
    engineeringWork: identityView.engineeringWork,
    projectContext: identityView.projectContext,
    approvalHistory: knowledge
      ? knowledge.versionHistory.map((v) => ({
          at: v.at,
          action: v.action,
          status: v.status,
          reviewedBy: v.reviewedBy,
          notes: v.notes,
          identity: v.identity,
        }))
      : [],
    impact,
    replay,
    pipeline: stages,
    pipelineTimingSummary: {
      totalDurationMs: Math.round(stages.reduce((sum, s) => sum + s.durationMs, 0) * 1000) / 1000,
      stages: stages.map((s) => ({
        stage: s.stage,
        status: s.status,
        durationMs: s.durationMs,
      })),
    },
  };

  const validation = validateExportRecord(record as unknown as Record<string, unknown>);
  return { ...record, validation };
}

export type IdentityDebugExport = {
  schemaVersion: string;
  generatedAt: string;
  gitCommit: string | null;
  buildVersion: string | null;
  identityEngineVersion: ReturnType<typeof getEngineeringBrainVersions>;
  configuration: ReturnType<typeof captureIdentityRuntimeConfiguration>;
  filters: IdentityDebugExportFilters;
  storeAvailable: boolean;
  llmReasoningEnabled: boolean;
  replay: {
    supported: boolean;
    deterministic: boolean;
    missingInputs: string[];
    note: string;
  };
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    deliverableValidationFailures: number;
    brainUiParityErrors: string[];
  };
  summary: {
    deliverableCount: number;
    projectCount: number;
    trustedCount: number;
    needsReviewCount: number;
    contradictoryCount: number;
  };
  brain: EnrichedEngineeringBrainExport;
  exportSummary: ExportRootSummary;
  grouping: { groups: ExportObservationGroup[] };
  data: {
    deliverables: ReturnType<typeof enrichDeliverableObservations>;
  };
};

/**
 * Build a complete identity-review debug export for a company.
 * Read-only. Does not call the LLM. Does not mutate knowledge store.
 */
export async function buildIdentityReviewDebugExport(args: {
  companyId: string;
  filters?: IdentityDebugExportFilters;
}): Promise<IdentityDebugExport> {
  const filters = args.filters ?? {};
  const configuration = captureIdentityRuntimeConfiguration();

  // Brain section: SAME source as GET /dev/engineering-brain (fingerprint-grouped, UI parity).
  const diagnosticsReport = await getEngineeringBrainDiagnostics({ companyId: args.companyId });
  const decisions = await loadEngineeringKnowledge(args.companyId);

  const observed = await loadRichObserved(args.companyId, filters);
  const hasFilters = Boolean(filters.projectId || filters.fragnetId || filters.deliverableId);
  const groupingObserved = hasFilters
    ? await loadRichObserved(args.companyId, {})
    : observed;

  const resolveRows = (rows: typeof observed) =>
    rows.map((o) => {
      const identity = enforceEngineeringIdentityValidation(
        resolveEngineeringIdentity({
          deliverableName: o.name,
          fragnetName: o.fragnetName,
          parentWbs: o.parentWbs,
          wbsPath: o.wbsPath,
          disciplineTag: o.discipline,
          activityCodeDiscipline: o.activityCodeDiscipline,
          classificationTags: o.classificationTags,
          classification: o.classification,
          lifecycleStage: o.lifecycleStage,
          projectContext: o.projectContext,
          relatedActivityNames: o.activities
            .map((a) => a.name?.trim())
            .filter((n): n is string => Boolean(n)),
        })
      );
      return { observed: o, identity };
    });

  const allResolved = resolveRows(observed);
  const groupingResolved = hasFilters ? resolveRows(groupingObserved) : allResolved;

  const bySubject = new Map<string, Set<string>>();
  for (const r of allResolved) {
    const doc = extractDocumentType(normaliseDeliverableNameForTaxonomy(r.observed.name));
    const subjectKey = normaliseDeliverableNameForTaxonomy(doc?.residualSubject ?? r.observed.name);
    const set = bySubject.get(subjectKey) ?? new Set();
    if (r.identity.engineeringObject.id) set.add(r.identity.engineeringObject.id);
    bySubject.set(subjectKey, set);
  }
  const driftingSubjects = new Set<string>();
  for (const [key, objects] of bySubject) {
    if (objects.size > 1) driftingSubjects.add(key);
  }

  const deliverables = observed.map((o) =>
    serializeDeliverable(o, allResolved, decisions, driftingSubjects)
  );

  let trustedCount = 0;
  let needsReviewCount = 0;
  let contradictoryCount = 0;
  for (const d of deliverables) {
    if (d.reviewStatus === "TRUSTED") trustedCount += 1;
    else if (d.reviewStatus === "CONTRADICTORY") contradictoryCount += 1;
    else needsReviewCount += 1;
  }

  const aggregateMissing = [
    ...new Set(deliverables.flatMap((d) => d.replay.missingInputs)),
  ];
  const deliverableValidationFailures = deliverables.filter((d) => !d.validation.valid).length;
  const topErrors = [
    ...new Set(deliverables.flatMap((d) => d.validation.errors)),
  ].slice(0, 20);
  const topWarnings = [
    ...new Set(deliverables.flatMap((d) => d.validation.warnings)),
  ].slice(0, 20);

  const brainBase = mapDiagnosticsReportToBrainExportV2(diagnosticsReport, decisions);
  const brainParity = validateBrainUiParity(brainBase, diagnosticsReport);
  const groupingContext = buildExportObservationGrouping(groupingResolved, diagnosticsReport);
  const brain = enrichBrainExportV2_2(brainBase, groupingContext, decisions);
  const enrichedDeliverables = enrichDeliverableObservations(
    deliverables as unknown as Record<string, unknown>[],
    groupingContext
  );
  const exportSummary = buildExportRootSummary({
    observationCount: groupingResolved.length,
    grouping: groupingContext,
    brainSummary: diagnosticsReport.summary,
  });

  return {
    schemaVersion: IDENTITY_DEBUG_EXPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    gitCommit: configuration.environment.gitCommit,
    buildVersion: configuration.environment.buildVersion,
    identityEngineVersion: configuration.identityEngineVersion,
    configuration,
    filters,
    storeAvailable: configuration.knowledgeStoreAvailable,
    llmReasoningEnabled: configuration.aiEngineeringReasoningEnabled,
    replay: {
      supported: aggregateMissing.length === 0,
      deterministic: true,
      missingInputs: aggregateMissing,
      note:
        aggregateMissing.length === 0
          ? "Export supports full deterministic replay of the rule-based identity pipeline."
          : "Rule-based stages are replayable. missingInputs list stages not implemented or not loaded into the identity path.",
    },
    validation: {
      valid: deliverableValidationFailures === 0 && brainParity.valid,
      errors: [...topErrors, ...brainParity.errors],
      warnings: topWarnings,
      deliverableValidationFailures,
      brainUiParityErrors: brainParity.errors,
    },
    summary: {
      deliverableCount: deliverables.length,
      projectCount: new Set(observed.map((o) => o.projectId)).size,
      trustedCount,
      needsReviewCount,
      contradictoryCount,
    },
    brain,
    exportSummary,
    grouping: { groups: groupingContext.groups },
    data: { deliverables: enrichedDeliverables },
  };
}
