/**
 * Engineering Reasoning — the intelligence layer that replaces extraction.
 *
 * Target architecture:
 *
 *   Entire Programme → Engineering Reasoning (LLM) → Engineering Understanding
 *     → Structured Engineering Identity → Validation → Historical Comparison
 *
 * The LLM never receives only a deliverable title. It receives the full
 * engineering context (WBS hierarchy, fragnet, activities, relationships,
 * neighbouring deliverables, project context, and the existing taxonomy result
 * as one input among many) and reasons about *what engineering work the
 * deliverable represents*, exactly as an experienced planner would.
 *
 * The rule-based `resolveEngineeringIdentity` remains the deterministic
 * baseline and the guaranteed fallback. Taxonomy is an input, not the answer.
 *
 * Everything is fail-safe: when reasoning is disabled or the provider is not
 * configured / errors, the validated rule-based identity is returned unchanged,
 * so no existing behaviour changes unless reasoning is explicitly enabled.
 */
import { prisma } from "../../../utils/prisma.js";
import { resolveLlmProvider } from "../../explanation/providers/llmProviderRegistry.js";
import type { LlmUsageStats } from "../../explanation/providers/llmProvider.types.js";
import { getAiExplanationConfig } from "../../explanation/explanationConfig.js";
import {
  resolveEngineeringIdentity,
  compareEngineeringIdentities,
  type EngineeringIdentity,
  type EngineeringIdentityInput,
  type EngineeringIdentityComponent,
  type EngineeringIdentityComparison,
} from "./engineeringIdentity.service.js";
import {
  enforceEngineeringIdentityValidation,
  type EngineeringIdentityValidation,
} from "./engineeringIdentityValidation.service.js";
import { resolveWorkPackageTaxonomy } from "./workPackageTaxonomy.service.js";
import { recordEngineeringReasoningEvent } from "./engineeringReasoningTelemetry.js";
import {
  ENGINEERING_OBJECT_RULES,
  DISCIPLINE_OBJECT_FALLBACKS,
  WORK_PACKAGE_OBJECT_FALLBACKS,
} from "./engineeringVocabulary.data.js";
import { DOCUMENT_TYPE_RULES } from "./documentType.extraction.js";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

export type EngineeringReasoningConfig = {
  enabled: boolean;
  model: string;
  temperature: number;
  maxTokens: number | null;
};

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Reasoning reuses the explanation provider/model but has its own enable flag,
 * so classification never accidentally starts calling an LLM when only Ask Rana
 * or explanations are enabled.
 */
export function getEngineeringReasoningConfig(): EngineeringReasoningConfig {
  const ai = getAiExplanationConfig();
  return {
    enabled: parseBool(process.env.AI_ENGINEERING_REASONING_ENABLED, false),
    model: ai.model,
    temperature: ai.temperature,
    maxTokens: ai.maxTokens,
  };
}

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type EngineeringReasoningNeighbour = {
  name: string;
  relation: "PREDECESSOR" | "SUCCESSOR" | "SIBLING";
};

/** Full engineering evidence handed to the reasoning layer for one deliverable. */
export type EngineeringReasoningContext = {
  deliverableName: string;
  fragnetName: string | null;
  parentWbs: string | null;
  wbsPath: string | null;
  activityNames: string[];
  neighbours: EngineeringReasoningNeighbour[];
  projectType: string | null;
  sector: string | null;
  client: string | null;
  stage: string | null;
  disciplineTag: string | null;
  activityCodeDiscipline: string | null;
  classificationTags: Record<string, unknown> | null;
  /** The existing taxonomy result — an input, never the final answer. */
  taxonomy: {
    disciplineId: string | null;
    disciplineLabel: string | null;
    workPackageId: string | null;
    workPackageLabel: string | null;
    matched: boolean;
    isUnknownWorkPackage: boolean;
  };
  aliases: string[];
  vocabulary: string[];
};

export type EngineeringReasoningConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

/**
 * The structured object consumed by the system. It is a strict
 * `EngineeringIdentity` (unchanged shape for existing consumers) plus the
 * reasoning metadata the target architecture requires.
 */
export type ReasonedEngineeringIdentity = EngineeringIdentity & {
  confidence: EngineeringReasoningConfidence;
  reasoning: string | null;
  source: "RULE_BASED" | "LLM_REASONED" | "LLM_MERGED";
  validation: EngineeringIdentityValidation;
  /** Component ids where reasoning overrode the taxonomy baseline. */
  overrides: string[];
  durationMs?: number;
  usage?: LlmUsageStats;
};

/* -------------------------------------------------------------------------- */
/* Vocabulary — allowed ids + labels                                          */
/* -------------------------------------------------------------------------- */

const OBJECT_LABELS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const rule of ENGINEERING_OBJECT_RULES) map[rule.id] = rule.label;
  for (const fallback of Object.values(DISCIPLINE_OBJECT_FALLBACKS)) map[fallback.id] = fallback.label;
  for (const fallback of Object.values(WORK_PACKAGE_OBJECT_FALLBACKS)) map[fallback.id] = fallback.label;
  return map;
})();

const WORK_LABELS: Record<string, string> = {
  design: "Design",
  detailing: "Detailing",
  analysis: "Analysis",
  modelling: "Modelling",
  review: "Review",
  coordination: "Coordination",
  calculation: "Calculation",
  inspection: "Inspection",
  verification: "Verification",
  general_arrangement: "General Arrangement",
  technical_note: "Technical Note",
  meeting: "Meeting",
  milestone: "Milestone",
};

const TYPE_LABELS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const rule of DOCUMENT_TYPE_RULES) map[rule.id] = rule.label;
  map.meeting = "Meeting";
  map.milestone = "Milestone";
  return map;
})();

const OBJECT_IDS = new Set(Object.keys(OBJECT_LABELS));
const WORK_IDS = new Set(Object.keys(WORK_LABELS));
const TYPE_IDS = new Set(Object.keys(TYPE_LABELS));

/* -------------------------------------------------------------------------- */
/* Prompt                                                                     */
/* -------------------------------------------------------------------------- */

export const ENGINEERING_REASONING_SYSTEM_PROMPT = [
  "You are an experienced Planning Director reading an engineering programme.",
  "You do not classify deliverables by keyword. You first understand the engineering work the programme represents, then conclude what each deliverable actually is.",
  "",
  "For the deliverable provided, answer internally: what engineering work does this represent? Not which keywords matched, not which taxonomy key fits.",
  "",
  "Rules:",
  "- The engineeringObject is the physical asset or system (Foundations, Link Bridge, Primary Steelwork, Drainage, Core, Roof, Columns, Slab, Beam, Plant Room). It is NEVER an output such as Drawing, Report, Technical Note, Analysis, Elevation, General Arrangement, Package or Scope.",
  "- engineeringWork is the activity performed (Design, Detailing, Analysis, Modelling, Review, Coordination, Calculation, Inspection, Verification).",
  "- deliverableType is the output form (Drawing Pack, Technical Note, Report, Model, Specification, Schedule).",
  "- The existing taxonomy result is ONE input. Trust the full engineering context over it when they disagree, and explain why.",
  "- If evidence conflicts, identify the conflict. If evidence is insufficient, return \"UNKNOWN\" for that field. UNKNOWN is preferred over an incorrect guess.",
  "",
  "Respond with ONLY a JSON object, no prose, matching:",
  "{",
  '  "discipline": string|null,',
  '  "engineeringObject": string|null,',
  '  "engineeringWork": string|null,',
  '  "deliverableType": string|null,',
  '  "lifecycleStage": string|null,',
  '  "confidence": "HIGH"|"MEDIUM"|"LOW"|"UNKNOWN",',
  '  "reasoning": string,',
  '  "rejectedAlternatives": string,',
  '  "keyEvidence": string',
  "}",
  "Use lowercase snake_case ids that match the provided vocabulary where possible; use null for UNKNOWN fields.",
].join("\n");

export function buildEngineeringReasoningPrompt(context: EngineeringReasoningContext): {
  system: string;
  user: string;
} {
  const lines: string[] = [];
  lines.push(`Deliverable: ${context.deliverableName}`);
  if (context.fragnetName) lines.push(`Fragnet: ${context.fragnetName}`);
  if (context.parentWbs) lines.push(`Parent WBS: ${context.parentWbs}`);
  if (context.wbsPath) lines.push(`WBS hierarchy: ${context.wbsPath}`);
  if (context.activityNames.length) {
    lines.push(`Activities beneath the deliverable: ${context.activityNames.slice(0, 40).join("; ")}`);
  }
  if (context.neighbours.length) {
    lines.push(
      `Neighbouring deliverables: ${context.neighbours
        .slice(0, 20)
        .map((n) => `${n.name} (${n.relation.toLowerCase()})`)
        .join("; ")}`
    );
  }
  const projectBits = [
    context.projectType ? `type ${context.projectType}` : null,
    context.sector ? `sector ${context.sector}` : null,
    context.client ? `client ${context.client}` : null,
    context.stage ? `stage ${context.stage}` : null,
  ].filter(Boolean);
  if (projectBits.length) lines.push(`Project context: ${projectBits.join(", ")}`);
  if (context.disciplineTag) lines.push(`Discipline metadata: ${context.disciplineTag}`);
  lines.push(
    `Existing taxonomy result: discipline=${context.taxonomy.disciplineLabel ?? "none"}` +
      `, work package=${context.taxonomy.workPackageLabel ?? "none"}` +
      `${context.taxonomy.isUnknownWorkPackage ? " (unknown work package)" : ""}`
  );
  if (context.aliases.length) lines.push(`Existing aliases: ${context.aliases.join("; ")}`);
  if (context.vocabulary.length) {
    lines.push(`Allowed engineering-object vocabulary: ${context.vocabulary.join(", ")}`);
  }
  lines.push(`Allowed engineering-work vocabulary: ${[...WORK_IDS].join(", ")}`);
  lines.push(`Allowed deliverable-type vocabulary: ${[...TYPE_IDS].join(", ")}`);
  return { system: ENGINEERING_REASONING_SYSTEM_PROMPT, user: lines.join("\n") };
}

/* -------------------------------------------------------------------------- */
/* Parsing + merge                                                            */
/* -------------------------------------------------------------------------- */

type ParsedReasoning = {
  discipline: string | null;
  engineeringObject: string | null;
  engineeringWork: string | null;
  deliverableType: string | null;
  lifecycleStage: string | null;
  confidence: EngineeringReasoningConfidence;
  reasoning: string | null;
};

function normaliseId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "unknown" || trimmed === "null" || trimmed === "none") return null;
  return trimmed.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function normaliseConfidence(value: unknown): EngineeringReasoningConfidence {
  const v = String(value ?? "").trim().toUpperCase();
  return v === "HIGH" || v === "MEDIUM" || v === "LOW" ? v : "UNKNOWN";
}

export function parseEngineeringReasoning(text: string | null): ParsedReasoning | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const reasoningParts = [raw.reasoning, raw.rejectedAlternatives, raw.keyEvidence]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);
  return {
    discipline: normaliseId(raw.discipline),
    engineeringObject: normaliseId(raw.engineeringObject),
    engineeringWork: normaliseId(raw.engineeringWork),
    deliverableType: normaliseId(raw.deliverableType),
    lifecycleStage: normaliseId(raw.lifecycleStage),
    confidence: normaliseConfidence(raw.confidence),
    reasoning: reasoningParts.length ? reasoningParts.join(" | ") : null,
  };
}

function componentFrom(
  id: string | null,
  labels: Record<string, string>,
  baseline: EngineeringIdentityComponent
): { component: EngineeringIdentityComponent; overridden: boolean } {
  if (!id) {
    // Reasoning abstained → keep the deterministic baseline (UNKNOWN preferred
    // over incorrect, but never discard evidence the baseline already has).
    return { component: baseline, overridden: false };
  }
  const label = labels[id] ?? baseline.label ?? id;
  const overridden = baseline.id != null && baseline.id !== id;
  return {
    component: {
      id,
      label,
      evidence: [
        ...baseline.evidence,
        { source: "TAXONOMY", value: "engineering reasoning", matched: id },
      ],
    },
    overridden,
  };
}

/**
 * Merge reasoning output over the rule-based baseline. Reasoning wins when it
 * confidently supplies a recognised id; it defers to the baseline when it
 * abstains or emits an unrecognised id. The result is then validated and
 * fail-closed enforced by the caller.
 */
export function mergeReasonedIdentity(
  baseline: EngineeringIdentity,
  parsed: ParsedReasoning
): { identity: EngineeringIdentity; overrides: string[] } {
  const overrides: string[] = [];
  const acceptedObject = parsed.engineeringObject && OBJECT_IDS.has(parsed.engineeringObject)
    ? parsed.engineeringObject
    : null;
  const acceptedWork = parsed.engineeringWork && WORK_IDS.has(parsed.engineeringWork)
    ? parsed.engineeringWork
    : null;
  const acceptedType = parsed.deliverableType && TYPE_IDS.has(parsed.deliverableType)
    ? parsed.deliverableType
    : null;

  const discipline = componentFrom(parsed.discipline, {}, baseline.discipline);
  const engineeringObject = componentFrom(acceptedObject, OBJECT_LABELS, baseline.engineeringObject);
  const engineeringWork = componentFrom(acceptedWork, WORK_LABELS, baseline.engineeringWork);
  const deliverableType = componentFrom(acceptedType, TYPE_LABELS, baseline.deliverableType);

  if (discipline.overridden) overrides.push("DISCIPLINE");
  if (engineeringObject.overridden) overrides.push("ENGINEERING_OBJECT");
  if (engineeringWork.overridden) overrides.push("ENGINEERING_WORK");
  if (deliverableType.overridden) overrides.push("DELIVERABLE_TYPE");

  const identity: EngineeringIdentity = {
    ...baseline,
    discipline: discipline.component,
    engineeringObject: engineeringObject.component,
    engineeringWork: engineeringWork.component,
    deliverableType: deliverableType.component,
    status:
      discipline.component.id && engineeringObject.component.id && engineeringWork.component.id
        ? "RESOLVED"
        : "INSUFFICIENT",
  };
  return { identity, overrides };
}

/* -------------------------------------------------------------------------- */
/* Reasoning orchestrator (LLM + cache + fallback)                            */
/* -------------------------------------------------------------------------- */

const CACHE_TTL_MS = 300_000;
const cache = new Map<string, { at: number; value: ReasonedEngineeringIdentity }>();

function contextCacheKey(context: EngineeringReasoningContext): string {
  return [
    context.deliverableName,
    context.fragnetName,
    context.parentWbs,
    context.wbsPath,
    context.disciplineTag,
    context.stage,
    context.projectType,
    context.sector,
  ]
    .map((part) => String(part ?? "").trim().toLowerCase())
    .join("|");
}

function ruleBasedInputFromContext(context: EngineeringReasoningContext): EngineeringIdentityInput {
  return {
    deliverableName: context.deliverableName,
    fragnetName: context.fragnetName,
    parentWbs: context.parentWbs,
    wbsPath: context.wbsPath,
    disciplineTag: context.disciplineTag,
    activityCodeDiscipline: context.activityCodeDiscipline,
    classificationTags: context.classificationTags,
    lifecycleStage: context.stage,
    projectContext: { sector: context.sector, projectType: context.projectType },
    relatedActivityNames: context.activityNames,
  };
}

function ruleBasedResult(baseline: EngineeringIdentity, durationMs = 0): ReasonedEngineeringIdentity {
  const enforced = enforceEngineeringIdentityValidation(baseline);
  return {
    ...enforced,
    confidence: enforced.status === "RESOLVED" ? "MEDIUM" : "UNKNOWN",
    reasoning: null,
    source: "RULE_BASED",
    overrides: [],
    validation: enforced.validation,
    durationMs,
  };
}

/**
 * Produce a validated Engineering Identity for one deliverable by reasoning
 * over its complete engineering context. Falls back to the deterministic
 * rule-based identity whenever reasoning is unavailable.
 */
export async function reasonEngineeringIdentity(
  context: EngineeringReasoningContext,
  options: { forceRuleBased?: boolean } = {}
): Promise<ReasonedEngineeringIdentity> {
  const startedAt = Date.now();
  const result = await computeReasonedIdentity(context, options);
  recordEngineeringReasoningEvent({
    deliverableName: context.deliverableName,
    fragnetName: context.fragnetName,
    source: result.source,
    status: result.status,
    confidence: result.confidence,
    disciplineId: result.discipline.id,
    engineeringObjectId: result.engineeringObject.id,
    engineeringWorkId: result.engineeringWork.id,
    validationValid: result.validation.valid,
    overrides: result.overrides,
    durationMs: result.durationMs ?? Date.now() - startedAt,
    at: startedAt,
    usage: result.usage,
  });
  return result;
}

async function computeReasonedIdentity(
  context: EngineeringReasoningContext,
  options: { forceRuleBased?: boolean }
): Promise<ReasonedEngineeringIdentity> {
  const startedAt = Date.now();
  const baseline = resolveEngineeringIdentity(ruleBasedInputFromContext(context));
  const config = getEngineeringReasoningConfig();
  const provider = resolveLlmProvider();

  if (
    options.forceRuleBased ||
    !config.enabled ||
    provider.id === "mock" ||
    !provider.isConfigured
  ) {
    return ruleBasedResult(baseline, Date.now() - startedAt);
  }

  const key = contextCacheKey(context);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  let result: ReasonedEngineeringIdentity;
  try {
    const prompt = buildEngineeringReasoningPrompt(context);
    const completion = await provider.complete({
      system: prompt.system,
      user: prompt.user,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });
    const durationMs = Date.now() - startedAt;
    const parsed = completion.status === "success" ? parseEngineeringReasoning(completion.text) : null;
    if (!parsed) {
      result = { ...ruleBasedResult(baseline, durationMs), usage: completion.usage };
    } else {
      const merged = mergeReasonedIdentity(baseline, parsed);
      const enforced = enforceEngineeringIdentityValidation(merged.identity);
      result = {
        ...enforced,
        confidence: enforced.status === "RESOLVED" ? parsed.confidence : "UNKNOWN",
        reasoning: parsed.reasoning,
        source: merged.overrides.length > 0 ? "LLM_MERGED" : "LLM_REASONED",
        overrides: enforced.validation.valid ? merged.overrides : [],
        validation: enforced.validation,
        durationMs,
        usage: completion.usage,
      };
    }
  } catch {
    result = ruleBasedResult(baseline, Date.now() - startedAt);
  }

  cache.set(key, { at: Date.now(), value: result });
  return result;
}

export function clearEngineeringReasoningCache(): void {
  cache.clear();
}

/* -------------------------------------------------------------------------- */
/* Explainable comparison (developer-mode diagnostics)                        */
/* -------------------------------------------------------------------------- */

export type EngineeringComparisonExplanation = {
  equivalent: boolean;
  reason: EngineeringIdentityComparison["reason"];
  /** Present for accepted comparisons: which identity fields matched + evidence. */
  matched: Array<{ component: string; value: string | null; evidence: string[] }>;
  /** Present for rejected comparisons: which components conflicted + why. */
  rejected: Array<{ component: string; target: string | null; candidate: string | null }>;
  comparison: EngineeringIdentityComparison;
};

function evidenceStrings(component: EngineeringIdentityComponent): string[] {
  return component.evidence.map((e) => `${e.source}:${e.value}`);
}

/**
 * Compare two Engineering Identities and record WHY they matched or were
 * rejected. This diagnostic detail is available for developer mode; planners
 * only ever see the equivalence decision.
 */
export function explainEngineeringComparison(
  target: EngineeringIdentity,
  candidate: EngineeringIdentity
): EngineeringComparisonExplanation {
  const comparison = compareEngineeringIdentities(target, candidate);
  const byComponent: Record<string, [EngineeringIdentityComponent, EngineeringIdentityComponent]> = {
    DISCIPLINE: [target.discipline, candidate.discipline],
    ENGINEERING_OBJECT: [target.engineeringObject, candidate.engineeringObject],
    ENGINEERING_WORK: [target.engineeringWork, candidate.engineeringWork],
    DELIVERABLE_TYPE: [target.deliverableType, candidate.deliverableType],
    LIFECYCLE_STAGE: [target.lifecycleStage, candidate.lifecycleStage],
    PROJECT_CONTEXT: [target.projectContext, candidate.projectContext],
    FRAGNET_CONTEXT: [target.fragnetContext, candidate.fragnetContext],
  };

  const matched = comparison.matchedIdentityComponents.map((component) => {
    const [tComp] = byComponent[component];
    return {
      component,
      value: tComp.id,
      evidence: [...new Set([...evidenceStrings(byComponent[component][0]), ...evidenceStrings(byComponent[component][1])])],
    };
  });

  const rejected = comparison.checks
    .filter((check) => check.result === "MISMATCH" || (check.role === "IDENTITY" && check.result === "UNKNOWN"))
    .map((check) => ({
      component: check.component,
      target: check.target,
      candidate: check.candidate,
    }));

  return { equivalent: comparison.equivalent, reason: comparison.reason, matched, rejected, comparison };
}

/* -------------------------------------------------------------------------- */
/* Context gathering                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Assemble the full engineering context for a live deliverable: WBS/fragnet,
 * activities, neighbouring deliverables (same fragnet + relationships), project
 * context, and the existing taxonomy result. Reuses existing tables only — no
 * schema change.
 */
export async function gatherLiveEngineeringReasoningContext(args: {
  companyId: string;
  projectId: string;
  deliverableId: string;
}): Promise<EngineeringReasoningContext | null> {
  const deliverable = await prisma.deliverable.findFirst({
    where: { companyId: args.companyId, projectId: args.projectId, id: args.deliverableId },
    select: {
      id: true,
      name: true,
      classification: true,
      fragnetId: true,
      fragnet: { select: { name: true } },
      activities: { select: { name: true } },
    },
  });
  if (!deliverable) return null;

  const project = await prisma.project.findFirst({
    where: { companyId: args.companyId, id: args.projectId },
    select: {
      intelligenceProfile: {
        select: { sector: true, projectType: true, stage: true, clientType: true },
      },
    },
  });
  const profile = project?.intelligenceProfile ?? null;

  const siblings = deliverable.fragnetId
    ? await prisma.deliverable.findMany({
        where: {
          companyId: args.companyId,
          projectId: args.projectId,
          fragnetId: deliverable.fragnetId,
          id: { not: deliverable.id },
        },
        select: { name: true },
        take: 20,
      })
    : [];

  const neighbours: EngineeringReasoningNeighbour[] = siblings.map((s) => ({
    name: s.name,
    relation: "SIBLING",
  }));

  const taxonomy = resolveWorkPackageTaxonomy({
    deliverableName: deliverable.name,
    fragnetName: deliverable.fragnet?.name ?? null,
  });

  return {
    deliverableName: deliverable.name,
    fragnetName: deliverable.fragnet?.name ?? null,
    parentWbs: null,
    wbsPath: null,
    activityNames: deliverable.activities.map((a) => a.name).filter(Boolean),
    neighbours,
    projectType: profile?.projectType ?? null,
    sector: profile?.sector ?? null,
    client: profile?.clientType ?? null,
    stage: profile?.stage ?? null,
    disciplineTag: null,
    activityCodeDiscipline: null,
    classificationTags: null,
    taxonomy: {
      disciplineId: taxonomy.disciplineId,
      disciplineLabel: taxonomy.disciplineLabel,
      workPackageId: taxonomy.workPackageId,
      workPackageLabel: taxonomy.workPackageLabel,
      matched: taxonomy.matched,
      isUnknownWorkPackage: taxonomy.isUnknownWorkPackage,
    },
    aliases: [],
    vocabulary: [...OBJECT_IDS],
  };
}
