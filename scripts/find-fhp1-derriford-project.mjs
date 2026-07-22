#!/usr/bin/env node
/**
 * The seeded healthcare project ID these tests hardcode (cmr1ztdj50001sybs8jbn4qf4)
 * is confirmed gone. Check whether the same underlying project still exists
 * under a different ID (e.g. re-imported), by name.
 */
import { prisma } from "../dist/utils/prisma.js";
import { runWithAuthContextAsync } from "../dist/utils/requestContext.js";

const companyId = "cmo8dvlc10000syx0861h1zr5";

async function main() {
  await runWithAuthContextAsync({ userId: "bootstrap", companyId }, async () => {
    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    console.log(`All projects in PlanAnalytics Dev (${projects.length}):`);
    for (const p of projects) {
      console.log(`  ${p.id}  "${p.name}"`);
    }
  });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
