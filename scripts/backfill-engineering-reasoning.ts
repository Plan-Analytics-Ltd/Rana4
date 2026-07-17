/**
 * Backfill reasoned identities onto existing DeliverableSnapshot rows
 * (captured before Phase 2, or while reasoning was off).
 *
 * Always prints a cost/time estimate first and exits unless --confirm / --execute.
 *
 *   npx tsx scripts/backfill-engineering-reasoning.ts
 *   npx tsx scripts/backfill-engineering-reasoning.ts --confirm
 *   npx tsx scripts/backfill-engineering-reasoning.ts --companyId <id> --confirm
 *   npx tsx scripts/backfill-engineering-reasoning.ts --all-companies --confirm
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  buildBackfillEstimate,
  executeEngineeringReasoningBackfill,
  parseBackfillArgs,
  resolveDefaultCompanyId,
} from "../src/services/intelligence/taxonomy/engineeringReasoningBackfill.service.js";

const prisma = new PrismaClient();

const MODEL_COST_PER_MILLION = { input: 2.5, output: 10.0 };

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = ms / 60_000;
  if (minutes < 60) return `${minutes.toFixed(1)} min`;
  return `${(minutes / 60).toFixed(2)} h`;
}

function printHelp(): void {
  console.log(`Usage:
  npx tsx scripts/backfill-engineering-reasoning.ts [options]

Options:
  --confirm | --execute   Actually run LLM reasoning and write reasoned* columns
  --companyId <id>        Scope to one company (overrides DEV_PANEL_EMAIL default)
  --all-companies         Process every company (never the default)
  --pageSize <n>          Page size for scanning/writing (default 50)
  --concurrency <n>       Max in-flight LLM calls (default 3)
  -h | --help             Show this help

Without --confirm, the script only counts eligible rows and prints a cost estimate.`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const args = parseBackfillArgs(argv);

  let companyId: string | null = args.companyId;
  let scopeLabel: string;

  if (args.allCompanies) {
    companyId = null;
    scopeLabel = "ALL COMPANIES";
  } else if (companyId) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true },
    });
    if (!company) throw new Error(`Company not found: ${companyId}`);
    scopeLabel = `${company.name} (${company.id})`;
  } else {
    const resolved = await resolveDefaultCompanyId(prisma);
    companyId = resolved.companyId;
    scopeLabel = `${resolved.companyName ?? "?"} (${companyId}) via DEV_PANEL_EMAIL=${resolved.email}`;
  }

  console.log(`Scope: ${scopeLabel}`);
  console.log(`Mode: ${args.confirm ? "EXECUTE (--confirm)" : "DRY-RUN (estimate only — no writes)"}`);
  console.log(`Concurrency: ${args.concurrency}, pageSize: ${args.pageSize}`);

  console.log("\n=== Step 1: count + estimate (no side effects) ===");
  const estimate = await buildBackfillEstimate(prisma, {
    companyId,
    allCompanies: args.allCompanies,
    pageSize: args.pageSize,
    concurrency: args.concurrency,
  });

  console.log(
    JSON.stringify(
      {
        alreadyReasonedCount: estimate.alreadyReasonedCount,
        insufficientContextCount: estimate.insufficientContextCount,
        eligibleCount: estimate.eligibleCount,
        estimatedTokens: estimate.estimatedTokens,
        estimatedCostUsd: estimate.estimatedCostUsd,
        estimatedWall: formatDuration(estimate.estimatedWallMs),
        estimatedWallMs: estimate.estimatedWallMs,
        concurrency: estimate.concurrency,
        assumptions: {
          tokensPerRow: 845,
          costUsdPerRow: 0.0045,
          basedOn: "Phase 2 capture: 6 rows → 5067 tokens / ~$0.026 / 9.3s @ concurrency 3",
        },
      },
      null,
      2
    )
  );

  if (!args.confirm) {
    console.log(
      "\nStopped before any LLM calls or database writes.\n" +
        "Re-run with --confirm (or --execute) to process the eligible rows above."
    );
    process.exit(0);
  }

  if (estimate.eligibleCount === 0) {
    console.log("\nNothing to do — zero eligible rows.");
    process.exit(0);
  }

  console.log("\n=== Step 2: execute backfill ===");
  process.env.AI_ENGINEERING_REASONING_ENABLED = "true";
  const run = await executeEngineeringReasoningBackfill(prisma, {
    companyId,
    allCompanies: args.allCompanies,
    pageSize: args.pageSize,
    concurrency: args.concurrency,
    onProgress: (message) => console.log(`  ${message}`),
  });

  const actualCostUsd =
    (run.promptTokens / 1_000_000) * MODEL_COST_PER_MILLION.input +
    (run.completionTokens / 1_000_000) * MODEL_COST_PER_MILLION.output;

  console.log("\n=== Results ===");
  console.log(
    JSON.stringify(
      {
        processed: run.processed,
        storedReasoned: run.storedReasoned,
        ruleBasedFallbacks: run.ruleBasedFallbacks,
        skippedInsufficientContext: run.skippedInsufficientContext,
        llmCalls: run.llmCalls,
        promptTokens: run.promptTokens,
        completionTokens: run.completionTokens,
        totalTokens: run.totalTokens,
        actualCostUsd: Number(actualCostUsd.toFixed(4)),
        wallMs: run.wallMs,
        wall: formatDuration(run.wallMs),
        errorCount: run.errors.length,
      },
      null,
      2
    )
  );

  if (run.errors.length > 0) {
    console.log("\n=== Errors (retry these rows) ===");
    for (const err of run.errors) {
      console.log(
        `  id=${err.deliverableSnapshotId} snapshotId=${err.snapshotId} name=${JSON.stringify(err.name)}: ${err.message}`
      );
    }
    process.exit(1);
  }

  console.log(`\nDone. Stored ${run.storedReasoned} reasoned identities. Actual cost ~${formatUsd(actualCostUsd)}.`);
  process.exit(0);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
