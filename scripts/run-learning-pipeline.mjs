import { PrismaClient } from "@prisma/client";
import { repairCompanyHistoricalLearningEvidence } from "../dist/services/intelligence/learning/historicalLearningRepair.service.js";
import { runPostImportLearningRefresh } from "../dist/services/intelligence/learning/learningRefresh.service.js";

const prisma = new PrismaClient();
const companyId = process.argv[2];

if (!companyId) {
  console.error("Usage: node scripts/run-learning-pipeline.mjs <companyId>");
  process.exit(1);
}

try {
  console.log("Repairing historical learning evidence...");
  const repair = await repairCompanyHistoricalLearningEvidence(companyId);
  console.log(JSON.stringify({ repair }, null, 2));

  console.log("Running full learning refresh...");
  const refresh = await runPostImportLearningRefresh(companyId);
  console.log(JSON.stringify({ refresh }, null, 2));

  const profiles = await prisma.deliverableKnowledgeProfile.count({ where: { companyId } });
  const insights = await prisma.learnedInsight.count({ where: { companyId } });
  const withDates = await prisma.deliverableSnapshot.count({
    where: {
      snapshot: { companyId },
      OR: [
        { AND: [{ plannedStart: { not: null } }, { plannedFinish: { not: null } }] },
        { AND: [{ actualStart: { not: null } }, { actualFinish: { not: null } }] },
      ],
    },
  });
  const eligibleSnaps = await prisma.programmeSnapshot.count({
    where: {
      companyId,
      programmeState: { in: ["APPROVED_BASELINE", "AS_BUILT", "FINAL_AS_BUILT"] },
    },
  });

  console.log(
    JSON.stringify(
      { profiles, insights, deliverableSnapshotsWithDates: withDates, eligibleSnapshots: eligibleSnaps },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
