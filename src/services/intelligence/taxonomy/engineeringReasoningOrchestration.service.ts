/**
 * Phase-1 bounded orchestration for Engineering Reasoning — concurrency cap,
 * per-request time budget, and context assembly for callers that must not
 * fire unbounded live LLM calls inside loops.
 */
import { resolveWorkPackageTaxonomy } from "./workPackageTaxonomy.service.js";
import {
  ENGINEERING_OBJECT_RULES,
  DISCIPLINE_OBJECT_FALLBACKS,
  WORK_PACKAGE_OBJECT_FALLBACKS,
} from "./engineeringVocabulary.data.js";
import {
  getEngineeringReasoningConfig,
  reasonEngineeringIdentity,
  type EngineeringReasoningContext,
  type ReasonedEngineeringIdentity,
} from "./engineeringReasoning.service.js";

const OBJECT_VOCABULARY = [
  ...new Set([
    ...ENGINEERING_OBJECT_RULES.map((rule) => rule.id),
    ...Object.values(DISCIPLINE_OBJECT_FALLBACKS).map((entry) => entry.id),
    ...Object.values(WORK_PACKAGE_OBJECT_FALLBACKS).map((entry) => entry.id),
  ]),
];

/** Max simultaneous in-flight reasoning calls per request. */
export const ENGINEERING_REASONING_MAX_CONCURRENCY = 3;

/** Hard wall-clock budget for all reasoning in one request; unfinished → rule-based. */
export const ENGINEERING_REASONING_REQUEST_BUDGET_MS = 30_000;

/**
 * Import-time budget — paid once per snapshot capture, not per page view.
 * Larger than the live-request budget so more uncertain groups can complete.
 */
export const ENGINEERING_REASONING_IMPORT_BUDGET_MS = 120_000;

export type EngineeringReasoningRunItem = {
  key: string;
  context: EngineeringReasoningContext;
};

export type EngineeringReasoningRunSummary = {
  requested: number;
  completed: number;
  llmCalls: number;
  ruleBasedFallbacks: number;
  totalDurationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  budgetExceeded: boolean;
};

export type EngineeringReasoningObservedInput = {
  name: string;
  fragnetName: string | null;
  parentWbs?: string | null;
  wbsPath?: string | null;
  discipline?: string | null;
  activityCodeDiscipline?: string | null;
  classificationTags?: Record<string, unknown> | null;
  lifecycleStage?: string | null;
  projectContext?: { sector?: string | null; projectType?: string | null } | null;
  relatedActivityNames?: string[];
  neighbourNames?: string[];
};

export function buildEngineeringReasoningContextFromObserved(
  observed: EngineeringReasoningObservedInput,
  aliases: string[] = []
): EngineeringReasoningContext {
  const taxonomy = resolveWorkPackageTaxonomy({
    deliverableName: observed.name,
    fragnetName: observed.fragnetName,
    parentWbs: observed.parentWbs ?? null,
    wbsPath: observed.wbsPath ?? null,
  });

  return {
    deliverableName: observed.name,
    fragnetName: observed.fragnetName,
    parentWbs: observed.parentWbs ?? null,
    wbsPath: observed.wbsPath ?? null,
    activityNames: observed.relatedActivityNames ?? [],
    neighbours: (observed.neighbourNames ?? []).map((name) => ({
      name,
      relation: "SIBLING",
    })),
    projectType: observed.projectContext?.projectType ?? null,
    sector: observed.projectContext?.sector ?? null,
    client: null,
    stage: observed.lifecycleStage ?? null,
    disciplineTag: observed.discipline ?? null,
    activityCodeDiscipline: observed.activityCodeDiscipline ?? null,
    classificationTags: observed.classificationTags ?? null,
    taxonomy: {
      disciplineId: taxonomy.disciplineId,
      disciplineLabel: taxonomy.disciplineLabel,
      workPackageId: taxonomy.workPackageId,
      workPackageLabel: taxonomy.workPackageLabel,
      matched: taxonomy.matched,
      isUnknownWorkPackage: taxonomy.isUnknownWorkPackage,
    },
    aliases,
    vocabulary: OBJECT_VOCABULARY,
  };
}

export type DurationReasoningTargetInput = {
  name: string;
  fragnetName?: string | null;
  classification?: import("@prisma/client").DeliverableClassification | null;
  lifecycleStage?: string | null;
  projectContext?: {
    sector?: string | null;
    projectType?: string | null;
    stage?: string | null;
    clientType?: string | null;
  } | null;
  relatedActivityNames?: string[];
};

export function buildEngineeringReasoningContextForDurationTarget(
  target: DurationReasoningTargetInput
): EngineeringReasoningContext {
  const taxonomy = resolveWorkPackageTaxonomy({
    deliverableName: target.name,
    fragnetName: target.fragnetName ?? null,
  });

  return {
    deliverableName: target.name,
    fragnetName: target.fragnetName ?? null,
    parentWbs: null,
    wbsPath: null,
    activityNames: target.relatedActivityNames ?? [],
    neighbours: [],
    projectType: target.projectContext?.projectType ?? null,
    sector: target.projectContext?.sector ?? null,
    client: target.projectContext?.clientType ?? null,
    stage: target.lifecycleStage ?? target.projectContext?.stage ?? null,
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
    vocabulary: OBJECT_VOCABULARY,
  };
}

export function isEngineeringReasoningActive(options?: { forceRuleBased?: boolean }): boolean {
  if (options?.forceRuleBased) return false;
  const config = getEngineeringReasoningConfig();
  return config.enabled;
}

/**
 * Run reasoning for a bounded list of contexts with concurrency + time budget.
 * Anything not completed within the budget falls back to rule-based resolution.
 */
export async function runBoundedEngineeringReasoning(
  items: EngineeringReasoningRunItem[],
  options: {
    forceRuleBased?: boolean;
    budgetMs?: number;
    concurrency?: number;
  } = {}
): Promise<{ results: Map<string, ReasonedEngineeringIdentity>; summary: EngineeringReasoningRunSummary }> {
  const startedAt = Date.now();
  const budgetMs = options.budgetMs ?? ENGINEERING_REASONING_REQUEST_BUDGET_MS;
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? ENGINEERING_REASONING_MAX_CONCURRENCY, items.length || 1)
  );
  const results = new Map<string, ReasonedEngineeringIdentity>();
  const summary: EngineeringReasoningRunSummary = {
    requested: items.length,
    completed: 0,
    llmCalls: 0,
    ruleBasedFallbacks: 0,
    totalDurationMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    budgetExceeded: false,
  };

  if (items.length === 0) {
    return { results, summary };
  }

  let nextIndex = 0;

  async function runOne(item: EngineeringReasoningRunItem): Promise<void> {
    const forceRuleBased =
      options.forceRuleBased ||
      !isEngineeringReasoningActive(options) ||
      Date.now() - startedAt >= budgetMs;
    const result = await reasonEngineeringIdentity(item.context, { forceRuleBased });
    results.set(item.key, result);
    summary.completed += 1;
    summary.totalDurationMs += result.durationMs ?? 0;
    if (result.source === "RULE_BASED") summary.ruleBasedFallbacks += 1;
    else summary.llmCalls += 1;
    if (result.usage?.promptTokens) summary.promptTokens += result.usage.promptTokens;
    if (result.usage?.completionTokens) summary.completionTokens += result.usage.completionTokens;
    if (result.usage?.totalTokens) summary.totalTokens += result.usage.totalTokens;
  }

  async function worker(): Promise<void> {
    while (true) {
      if (Date.now() - startedAt >= budgetMs) {
        summary.budgetExceeded = true;
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      await runOne(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  for (const item of items) {
    if (results.has(item.key)) continue;
    summary.budgetExceeded = true;
    const fallback = await reasonEngineeringIdentity(item.context, { forceRuleBased: true });
    results.set(item.key, fallback);
    summary.completed += 1;
    summary.ruleBasedFallbacks += 1;
    summary.totalDurationMs += fallback.durationMs ?? 0;
  }

  summary.totalDurationMs = Date.now() - startedAt;
  return { results, summary };
}

/**
 * Columns to persist on DeliverableSnapshot. Only real LLM/merged results are stored —
 * RULE_BASED fallbacks leave the columns null so readers fall back to rule-based identity.
 */
export type StoredDeliverableReasoningFields = {
  reasonedDiscipline: string | null;
  reasonedEngineeringObject: string | null;
  reasonedEngineeringWork: string | null;
  reasonedDeliverableType: string | null;
  reasonedLifecycleStage: string | null;
  reasoningSource: string | null;
  reasoningComputedAt: Date | null;
};

export const EMPTY_STORED_REASONING_FIELDS: StoredDeliverableReasoningFields = {
  reasonedDiscipline: null,
  reasonedEngineeringObject: null,
  reasonedEngineeringWork: null,
  reasonedDeliverableType: null,
  reasonedLifecycleStage: null,
  reasoningSource: null,
  reasoningComputedAt: null,
};

export function storedReasoningFieldsFromResult(
  result: ReasonedEngineeringIdentity | undefined,
  computedAt: Date = new Date()
): StoredDeliverableReasoningFields {
  if (!result || result.source === "RULE_BASED") {
    return EMPTY_STORED_REASONING_FIELDS;
  }
  return {
    reasonedDiscipline: result.discipline.id,
    reasonedEngineeringObject: result.engineeringObject.id,
    reasonedEngineeringWork: result.engineeringWork.id,
    reasonedDeliverableType: result.deliverableType.id,
    reasonedLifecycleStage: result.lifecycleStage.id,
    reasoningSource: result.source,
    reasoningComputedAt: computedAt,
  };
}
