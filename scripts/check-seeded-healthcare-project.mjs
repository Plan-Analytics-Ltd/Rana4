#!/usr/bin/env node
/**
 * Read-only check: does the "seeded healthcare project" that
 * ask-rana-context.test.mjs / deliverable-project-evolution-identity.test.mjs
 * / project-evolution-intelligence.test.mjs hardcode still exist in this
 * database?
 */
import { prisma } from "../dist/utils/prisma.js";
import { runWithAuthContextAsync } from "../dist/utils/requestContext.js";

const projectId = "cmr1ztdj50001sybs8jbn4qf4";
const companyId = "cmo8dvlc10000syx0861h1zr5";

async function main() {
  await runWithAuthContextAsync({ userId: "bootstrap", companyId }, async () => {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
    console.log("Company:", company ?? "NOT FOUND");

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, companyId: true } });
    console.log("Project:", project ?? "NOT FOUND");

    if (project) {
      const detailedDesign = await prisma.deliverable.findFirst({
        where: { projectId, companyId, name: "Detailed Design", fragnet: { name: "Level 9" } },
        select: { id: true, name: true },
      });
      console.log('Deliverable "Detailed Design" (Level 9):', detailedDesign ?? "NOT FOUND");

      const reinforcement = await prisma.deliverable.findFirst({
        where: { projectId, companyId, name: "Reinforcement Detailing" },
        select: { id: true, name: true },
      });
      console.log('Deliverable "Reinforcement Detailing":', reinforcement ?? "NOT FOUND");

      const deliverableCount = await prisma.deliverable.count({ where: { projectId, companyId } });
      console.log("Total deliverables in project:", deliverableCount);

      const snapshotCount = await prisma.programmeSnapshot.count({ where: { projectId, companyId } });
      console.log("Total programme snapshots (revisions):", snapshotCount);
    }
  });

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
