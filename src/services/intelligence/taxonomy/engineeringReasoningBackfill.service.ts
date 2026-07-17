/**
 * Backfill reasoned identities onto existing DeliverableSnapshot rows
 * that pre-date Phase 2 capture-time reasoning.
 *
 * Used by scripts/backfill-engineering-reasoning.ts — not an API path.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildEngineeringReasoningContextFromObserved,
  ENGINEERING_REASONING_MAX_CONCURRENCY,
  runBoundedEngineeringReasoning,
  storedReasoningFieldsFromResult,
} from "./engineeringReasoningOrchestration.service.js";

/** Phase 2 measured: 6 deliverables → 5,067 tokens, ~$0.026, ~9.3s wall @ concurrency 3. */
export const BACKFILL_ESTIMATE_TOKENS_PER_ROW = 845;
export const BACKFILL_ESTIMATE_COST_USD_PER_ROW = 0.0045;
/** Wall time per row at concurrency 3, extrapolated from Phase 2 (~9.3s / 6). */
export const BACKFILL_ESTIMATE_WALL_MS_PER_ROW = 1_550;

/**
 * Batch jobs are not page-load bound — use a very large budget so concurrency
 * is the rate limiter, not a 30s request cutoff.
 */
export const ENGINEERING_REASONING_BACKFILL_BUDGET_MS = 24 * 60 * 60 * 1000;

export const BACKFILL_PAGE_SIZE = 50;

export type BackfillCliArgs = {
  confirm: boolean;
  companyId: string | null;
  allCompanies: boolean;
  pageSize: number;
  concurrency: number;
};

export type BackfillCostEstimate = {
  eligibleCount: number;
  insufficientContextCount: number;
  alreadyReasonedCount: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
  estimatedWallMs: number;
  concurrency: number;
};

export type BackfillSkipReason = "INSUFFICIENT_CONTEXT" | "ALREADY_REASONED";

export type BackfillRowError = {
  deliverableSnapshotId: string;
  name: string;
  snapshotId: string;
  message: string;
};

export type BackfillRunResult = {
  processed: number;
  storedReasoned: number;
  ruleBasedFallbacks: number;
  skippedInsufficientContext: number;
  skippedAlreadyReasoned: number;
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  wallMs: number;
  errors: BackfillRowError[];
};

export type EligibleSnapshotRow = {
  id: string;
  name: string;
  snapshotId: string;
  deliverableId: string | null;
  parentWbs: string | null;
  wbsPath: string | null;
  discipline: string | null;
  stage: string | null;
  classificationTags: Prisma.JsonValue;
  reasoningSource: string | null;
  relatedActivityNames: string[];
  neighbourNames: string[];
  projectContext: { sector: string | null; projectType: string | null };
};

export function parseBackfillArgs(argv: string[]): BackfillCliArgs {
  const args: BackfillCliArgs = {
    confirm: false,
    companyId: null,
    allCompanies: false,
    pageSize: BACKFILL_PAGE_SIZE,
    concurrency: ENGINEERING_REASONING_MAX_CONCURRENCY,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--confirm" || arg === "--execute") {
      args.confirm = true;
      continue;
    }
    if (arg === "--all-companies") {
      args.allCompanies = true;
      continue;
    }
    if (arg === "--companyId" || arg.startsWith("--companyId=")) {
      const value = arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[++i];
      if (!value?.trim()) throw new Error("--companyId requires a value");
      args.companyId = value.trim();
      continue;
    }
    if (arg === "--pageSize" || arg.startsWith("--pageSize=")) {
      const value = arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[++i];
      const n = Number(value);
      if (!Number.isFinite(n) || n < 1) throw new Error("--pageSize must be a positive integer");
      args.pageSize = Math.floor(n);
      continue;
    }
    if (arg === "--concurrency" || arg.startsWith("--concurrency=")) {
      const value = arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[++i];
      const n = Number(value);
      if (!Number.isFinite(n) || n < 1) throw new Error("--concurrency must be a positive integer");
      args.concurrency = Math.floor(n);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.allCompanies && args.companyId) {
    throw new Error("Pass either --companyId or --all-companies, not both");
  }
  return args;
}

export function hasUsableReasoningContext(row: {
  parentWbs?: string | null;
  wbsPath?: string | null;
  relatedActivityNames?: string[] | null;
}): boolean {
  const hasFragnet = Boolean(row.parentWbs?.trim() || row.wbsPath?.trim());
  const hasActivities = (row.relatedActivityNames ?? []).some((name) => Boolean(name?.trim()));
  return hasFragnet || hasActivities;
}

export function estimateBackfillCost(
  eligibleCount: number,
  concurrency: number = ENGINEERING_REASONING_MAX_CONCURRENCY
): Omit<
  BackfillCostEstimate,
  "eligibleCount" | "insufficientContextCount" | "alreadyReasonedCount"
> {
  const safeConcurrency = Math.max(1, concurrency);
  // Phase 2: 9.3s wall for 6 rows at concurrency 3 → ~4.65s per concurrent wave.
  const phase2BatchWallMs = 9_300 / Math.ceil(6 / 3);
  return {
    estimatedTokens: Math.round(eligibleCount * BACKFILL_ESTIMATE_TOKENS_PER_ROW),
    estimatedCostUsd: Number((eligibleCount * BACKFILL_ESTIMATE_COST_USD_PER_ROW).toFixed(4)),
    estimatedWallMs: Math.round(Math.ceil(eligibleCount / safeConcurrency) * phase2BatchWallMs),
    concurrency: safeConcurrency,
  };
}

export async function resolveDefaultCompanyId(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ companyId: string; email: string; companyName: string | null }> {
  const email = (env.DEV_PANEL_EMAIL ?? "aelsaman@plananalytics.co.uk").trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { companyId: true, email: true, company: { select: { name: true } } },
  });
  if (!user?.companyId) {
    throw new Error(
      `No user found for DEV_PANEL_EMAIL=${email}. Pass --companyId explicitly, or set DEV_PANEL_EMAIL.`
    );
  }
  return { companyId: user.companyId, email: user.email, companyName: user.company?.name ?? null };
}

type PrismaLike = {
  deliverableSnapshot: {
    count: (args: unknown) => Promise<number>;
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        name: string;
        snapshotId: string;
        deliverableId: string | null;
        parentWbs: string | null;
        wbsPath: string | null;
        discipline: string | null;
        stage: string | null;
        classificationTags: Prisma.JsonValue;
        reasoningSource: string | null;
        snapshot: {
          id: string;
          sector: string | null;
          projectType: string | null;
          stage: string | null;
          activitySnapshots: Array<{
            deliverableId: string | null;
            name: string | null;
          }>;
          deliverableSnapshots: Array<{
            id: string;
            name: string;
            parentWbs: string | null;
            wbsPath: string | null;
          }>;
        };
      }>
    >;
    update: (args: unknown) => Promise<unknown>;
  };
};

function companyFilter(companyId: string | null, allCompanies: boolean): Record<string, unknown> {
  if (allCompanies) return {};
  if (!companyId) throw new Error("companyId is required unless --all-companies is set");
  return { snapshot: { companyId } };
}

export async function countBackfillScope(
  prisma: PrismaLike,
  options: { companyId: string | null; allCompanies: boolean }
): Promise<{
  nullReasoningSourceCount: number;
  alreadyReasonedCount: number;
}> {
  const base = companyFilter(options.companyId, options.allCompanies);
  const [nullReasoningSourceCount, alreadyReasonedCount] = await Promise.all([
    prisma.deliverableSnapshot.count({
      where: { ...base, reasoningSource: null },
    }),
    prisma.deliverableSnapshot.count({
      where: { ...base, reasoningSource: { not: null } },
    }),
  ]);
  return { nullReasoningSourceCount, alreadyReasonedCount };
}

/**
 * Load one page of reasoningSource-null rows and attach activity/neighbour context.
 * Returns both eligible (usable context) and insufficient-context rows for the page.
 */
export async function loadBackfillPage(
  prisma: PrismaLike,
  options: {
    companyId: string | null;
    allCompanies: boolean;
    pageSize: number;
    cursorId?: string | null;
  }
): Promise<{
  eligible: EligibleSnapshotRow[];
  insufficientContext: EligibleSnapshotRow[];
  nextCursorId: string | null;
}> {
  const rows = await prisma.deliverableSnapshot.findMany({
    where: {
      ...companyFilter(options.companyId, options.allCompanies),
      reasoningSource: null,
      ...(options.cursorId ? { id: { gt: options.cursorId } } : {}),
    },
    orderBy: { id: "asc" },
    take: options.pageSize,
    select: {
      id: true,
      name: true,
      snapshotId: true,
      deliverableId: true,
      parentWbs: true,
      wbsPath: true,
      discipline: true,
      stage: true,
      classificationTags: true,
      reasoningSource: true,
      snapshot: {
        select: {
          id: true,
          sector: true,
          projectType: true,
          stage: true,
          activitySnapshots: {
            select: { deliverableId: true, name: true },
          },
          deliverableSnapshots: {
            select: { id: true, name: true, parentWbs: true, wbsPath: true },
          },
        },
      },
    },
  });

  const eligible: EligibleSnapshotRow[] = [];
  const insufficientContext: EligibleSnapshotRow[] = [];

  for (const row of rows) {
    const relatedActivityNames = row.deliverableId
      ? row.snapshot.activitySnapshots
          .filter((a) => a.deliverableId === row.deliverableId)
          .map((a) => a.name?.trim())
          .filter((name): name is string => Boolean(name))
      : [];
    const fragnetKey = row.parentWbs ?? row.wbsPath ?? "";
    const neighbourNames = fragnetKey
      ? row.snapshot.deliverableSnapshots
          .filter((sibling) => {
            const key = sibling.parentWbs ?? sibling.wbsPath ?? "";
            return key === fragnetKey && sibling.id !== row.id;
          })
          .map((sibling) => sibling.name)
          .slice(0, 8)
      : [];

    const shaped: EligibleSnapshotRow = {
      id: row.id,
      name: row.name,
      snapshotId: row.snapshotId,
      deliverableId: row.deliverableId,
      parentWbs: row.parentWbs,
      wbsPath: row.wbsPath,
      discipline: row.discipline,
      stage: row.stage ?? row.snapshot.stage,
      classificationTags: row.classificationTags,
      reasoningSource: row.reasoningSource,
      relatedActivityNames,
      neighbourNames,
      projectContext: {
        sector: row.snapshot.sector,
        projectType: row.snapshot.projectType,
      },
    };

    if (hasUsableReasoningContext(shaped)) eligible.push(shaped);
    else insufficientContext.push(shaped);
  }

  const nextCursorId = rows.length === options.pageSize ? rows[rows.length - 1]!.id : null;
  return { eligible, insufficientContext, nextCursorId };
}

export async function buildBackfillEstimate(
  prisma: PrismaLike,
  options: {
    companyId: string | null;
    allCompanies: boolean;
    pageSize?: number;
    concurrency?: number;
  }
): Promise<BackfillCostEstimate> {
  const pageSize = options.pageSize ?? BACKFILL_PAGE_SIZE;
  const concurrency = options.concurrency ?? ENGINEERING_REASONING_MAX_CONCURRENCY;
  const counts = await countBackfillScope(prisma, options);

  let eligibleCount = 0;
  let insufficientContextCount = 0;
  let cursorId: string | null = null;
  do {
    const page = await loadBackfillPage(prisma, {
      companyId: options.companyId,
      allCompanies: options.allCompanies,
      pageSize,
      cursorId,
    });
    eligibleCount += page.eligible.length;
    insufficientContextCount += page.insufficientContext.length;
    cursorId = page.nextCursorId;
  } while (cursorId);

  return {
    eligibleCount,
    insufficientContextCount,
    alreadyReasonedCount: counts.alreadyReasonedCount,
    ...estimateBackfillCost(eligibleCount, concurrency),
  };
}

async function writeReasonedBatch(
  prisma: PrismaLike,
  updates: Array<{ id: string; fields: ReturnType<typeof storedReasoningFieldsFromResult> }>
): Promise<void> {
  // Prisma has no multi-row heterogeneous updateMany — batch via Promise.all in small chunks.
  const chunkSize = 25;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map((update) =>
        prisma.deliverableSnapshot.update({
          where: { id: update.id },
          data: update.fields,
        })
      )
    );
  }
}

/**
 * Execute the backfill. Caller must have already shown the estimate and received --confirm.
 * Writes incrementally per page so interruption preserves completed pages.
 */
export async function executeEngineeringReasoningBackfill(
  prisma: PrismaLike,
  options: {
    companyId: string | null;
    allCompanies: boolean;
    pageSize?: number;
    concurrency?: number;
    onProgress?: (message: string) => void;
  }
): Promise<BackfillRunResult> {
  const pageSize = options.pageSize ?? BACKFILL_PAGE_SIZE;
  const concurrency = options.concurrency ?? ENGINEERING_REASONING_MAX_CONCURRENCY;
  const startedAt = Date.now();
  const result: BackfillRunResult = {
    processed: 0,
    storedReasoned: 0,
    ruleBasedFallbacks: 0,
    skippedInsufficientContext: 0,
    skippedAlreadyReasoned: 0,
    llmCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    wallMs: 0,
    errors: [],
  };

  let cursorId: string | null = null;
  let pageNumber = 0;
  do {
    pageNumber += 1;
    const page = await loadBackfillPage(prisma, {
      companyId: options.companyId,
      allCompanies: options.allCompanies,
      pageSize,
      cursorId,
    });

    for (const row of page.insufficientContext) {
      result.skippedInsufficientContext += 1;
      options.onProgress?.(
        `SKIP INSUFFICIENT_CONTEXT id=${row.id} name=${JSON.stringify(row.name)} snapshotId=${row.snapshotId}`
      );
    }

    if (page.eligible.length > 0) {
      const { results, summary } = await runBoundedEngineeringReasoning(
        page.eligible.map((row) => ({
          key: row.id,
          context: buildEngineeringReasoningContextFromObserved({
            name: row.name,
            fragnetName: row.parentWbs ?? row.wbsPath ?? null,
            parentWbs: row.parentWbs,
            wbsPath: row.wbsPath,
            discipline: row.discipline,
            classificationTags:
              row.classificationTags != null &&
              typeof row.classificationTags === "object" &&
              !Array.isArray(row.classificationTags)
                ? (row.classificationTags as Record<string, unknown>)
                : null,
            lifecycleStage: row.stage,
            projectContext: row.projectContext,
            relatedActivityNames: row.relatedActivityNames,
            neighbourNames: row.neighbourNames,
          }),
        })),
        {
          budgetMs: ENGINEERING_REASONING_BACKFILL_BUDGET_MS,
          concurrency,
        }
      );

      const computedAt = new Date();
      const updates: Array<{ id: string; fields: ReturnType<typeof storedReasoningFieldsFromResult> }> =
        [];

      for (const row of page.eligible) {
        try {
          const reasoned = results.get(row.id);
          if (!reasoned) {
            result.errors.push({
              deliverableSnapshotId: row.id,
              name: row.name,
              snapshotId: row.snapshotId,
              message: "No reasoning result returned for row",
            });
            continue;
          }
          const fields = storedReasoningFieldsFromResult(reasoned, computedAt);
          result.processed += 1;
          if (fields.reasoningSource != null) {
            result.storedReasoned += 1;
            updates.push({ id: row.id, fields });
          } else {
            result.ruleBasedFallbacks += 1;
            // Leave columns null — same as capture: don't store rule-based as "reasoned".
            // Row stays eligible on re-run; log explicitly so it isn't silent.
            options.onProgress?.(
              `RULE_BASED_FALLBACK id=${row.id} name=${JSON.stringify(row.name)} snapshotId=${row.snapshotId}`
            );
          }
        } catch (err) {
          result.errors.push({
            deliverableSnapshotId: row.id,
            name: row.name,
            snapshotId: row.snapshotId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (updates.length > 0) {
        await writeReasonedBatch(prisma, updates);
      }

      result.llmCalls += summary.llmCalls;
      result.promptTokens += summary.promptTokens;
      result.completionTokens += summary.completionTokens;
      result.totalTokens += summary.totalTokens;

      options.onProgress?.(
        `page ${pageNumber}: eligible=${page.eligible.length} stored=${updates.length} ` +
          `fallbacks=${page.eligible.length - updates.length} ` +
          `tokens=${summary.totalTokens} runningTokens=${result.totalTokens}`
      );
    }

    cursorId = page.nextCursorId;
  } while (cursorId);

  result.wallMs = Date.now() - startedAt;
  return result;
}
