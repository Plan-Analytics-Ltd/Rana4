/**
 * Verify Project Evolution Remaining vs Planning for Reinforcement Detailing (seed project).
 * Read-only — does not mutate snapshots.
 * Run: npx tsx scripts/verify-project-evolution-remaining.ts
 */
import { PrismaClient } from "@prisma/client";
import { getDeliverableProjectEvolution } from "../src/services/intelligence/shared/deliverableProjectEvolution.service.ts";

const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.findFirst({
    where: { name: { contains: "Northvale", mode: "insensitive" } },
    select: { id: true, name: true, companyId: true },
  });
  if (!project) {
    console.error("No Northvale seed project found");
    process.exitCode = 1;
    return;
  }

  const deliverable = await prisma.deliverable.findFirst({
    where: {
      projectId: project.id,
      name: { equals: "Reinforcement Detailing", mode: "insensitive" },
      fragnet: { name: { contains: "Link Structure", mode: "insensitive" } },
    },
    select: { id: true, name: true, fragnet: { select: { name: true } } },
  });
  if (!deliverable) {
    console.error("Reinforcement Detailing / Link Structure not found");
    process.exitCode = 1;
    return;
  }

  console.log("Project:", project.name, project.id);
  console.log("Deliverable:", deliverable.name, deliverable.fragnet?.name, deliverable.id);

  const report = await getDeliverableProjectEvolution({
    projectId: project.id,
    companyId: project.companyId,
    deliverableId: deliverable.id,
  });

  console.log("\nRevision | Remaining | Planning | Δ Remaining | Δ Planning | kind");
  console.log("-".repeat(90));
  for (const rev of report.revisions) {
    console.log(
      [
        rev.label,
        rev.remainingDurationDays ?? "—",
        rev.planningDurationDays ?? "—",
        rev.remainingDurationChangeDays ?? "—",
        rev.planningDurationChangeDays ?? "—",
        rev.changeKind ?? "—",
      ].join(" | ")
    );
  }

  console.log("\nSummary tiles (remaining-based)");
  console.log({
    baselineRemaining: report.evolution.initialDuration,
    peakRemaining: report.evolution.maximumDuration,
    latestRemaining: report.evolution.finalDuration,
    trend: report.evolution.trend,
    summary: report.timeline.evolutionSummary,
  });

  // Raw DB check — no invention
  console.log("\nStored ActivitySnapshot (A2490) for comparison");
  for (const rev of report.revisions) {
    const act = await prisma.activitySnapshot.findFirst({
      where: {
        snapshotId: rev.snapshotId,
        deliverableId: deliverable.id,
        activityCode: "A2490",
      },
      select: { originalDuration: true, remainingDuration: true },
    });
    console.log(rev.label, act);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
