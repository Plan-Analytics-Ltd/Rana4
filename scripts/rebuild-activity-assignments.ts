/**
 * Deterministically rebuild activity→deliverable assignments for a standard.
 *
 * Usage:
 *   REBUILD_USER_ID=... REBUILD_COMPANY_ID=... STANDARD_ID=... tsx scripts/rebuild-activity-assignments.ts [--dry-run] [--debug]
 */
import "dotenv/config";
import { runWithAuthContextAsync } from "../src/utils/requestContext.js";
import { prisma } from "../src/utils/prisma.js";
import { rebuildActivityAssignmentsForStandard } from "../src/services/activityAssignmentRebuild.service.js";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const userId = String(process.env.REBUILD_USER_ID ?? "").trim();
  const companyId = String(process.env.REBUILD_COMPANY_ID ?? "").trim();
  const standardId = String(process.env.STANDARD_ID ?? "").trim();

  if (!userId || !companyId || !standardId) {
    throw new Error("Missing env vars: REBUILD_USER_ID, REBUILD_COMPANY_ID, STANDARD_ID are required");
  }

  const dryRun = hasFlag("--dry-run");
  const debug = hasFlag("--debug");

  await runWithAuthContextAsync({ userId, companyId }, async () => {
    const res = await rebuildActivityAssignmentsForStandard(standardId, { dryRun, debug });
    console.log(`[rebuild] done: standard=${res.standardId} updated=${res.updated} created=${res.created} dryRun=${dryRun}`);
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

