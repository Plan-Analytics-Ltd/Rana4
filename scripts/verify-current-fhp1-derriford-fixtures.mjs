#!/usr/bin/env node
/**
 * Verify the CURRENT "FHP1 Derriford June 2026 Programme" project (real ID,
 * post re-import) still has the exact fixtures 3 test files expect from the
 * old, now-gone project ID: "Detailed Design" on fragnet "Level 9",
 * "Reinforcement Detailing" (bare), and 13 unique programme revisions for each.
 */
import { prisma } from "../dist/utils/prisma.js";
import { runWithAuthContextAsync } from "../dist/utils/requestContext.js";
import { getDeliverableProjectEvolution } from "../dist/services/intelligence/shared/deliverableProjectEvolution.service.js";

const companyId = "cmo8dvlc10000syx0861h1zr5";
const projectId = "cmrorxkvf0003sya48lhw12i9"; // current FHP1 Derriford June 2026 Programme

async function main() {
  await runWithAuthContextAsync({ userId: "bootstrap", companyId }, async () => {
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

    const snapshotCount = await prisma.programmeSnapshot.count({ where: { projectId, companyId } });
    console.log("Total programme snapshots (revisions) for this project:", snapshotCount);

    if (detailedDesign) {
      const report = await getDeliverableProjectEvolution({ projectId, companyId, deliverableId: detailedDesign.id });
      console.log(`Detailed Design (Level 9) revisions: ${report.revisions.length} (unique snapshotIds: ${new Set(report.revisions.map((r) => r.snapshotId)).size})`);
    }
    if (reinforcement) {
      const report = await getDeliverableProjectEvolution({ projectId, companyId, deliverableId: reinforcement.id });
      console.log(`Reinforcement Detailing revisions: ${report.revisions.length} (unique snapshotIds: ${new Set(report.revisions.map((r) => r.snapshotId)).size})`);
    }

    const all = await prisma.deliverable.findMany({ where: { projectId, companyId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    console.log("Total deliverables in project:", all.length);
    const picks = [0, 7, 17, 31, 52].map((i) => all[i]).filter(Boolean);
    for (const d of picks) {
      const report = await getDeliverableProjectEvolution({ projectId, companyId, deliverableId: d.id });
      const snapIds = report.revisions.map((r) => r.snapshotId);
      console.log(`  sample "${d.name}": ${report.revisions.length} revisions, ${new Set(snapIds).size} unique snapshotIds`);
    }
  });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
