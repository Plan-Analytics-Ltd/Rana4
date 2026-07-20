import { PrismaClient } from "@prisma/client";
import { getDeliverableBenchmark } from "../dist/services/intelligence/benchmark/benchmark.service.js";
import { getSimilarDeliverables } from "../dist/services/intelligence/shared/similarity.service.js";
import { DEFAULT_MIN_COMPARABLE_SIMILARITY } from "../dist/services/intelligence/matching/similarityWeights.config.js";

const prisma = new PrismaClient();
const projectId = "cmr1ztdj50001sybs8jbn4qf4"; // seeded healthcare project
const companyId = "cmo8dvlc10000syx0861h1zr5";
const deliverableId = process.argv[2] ?? "c9ac0980-867b-4c48-b0ed-8a9bac5b4c18";

try {
  const d = await prisma.deliverable.findFirst({
    where: { id: deliverableId, projectId },
    select: { id: true, name: true, classification: true, likelyDuration: true, bestDuration: true },
  });
  console.log("Deliverable:", d);

  const report = await getDeliverableBenchmark({ projectId, companyId, deliverableId });

  const sim = await getSimilarDeliverables({
    projectId,
    companyId,
    deliverableId,
    limit: 50,
  });

  const above = sim.matches.filter((m) => m.similarityScore >= DEFAULT_MIN_COMPARABLE_SIMILARITY);
  console.log(`\nSimilar: ${sim.matches.length} total, ${above.length} >= ${DEFAULT_MIN_COMPARABLE_SIMILARITY}%`);
  for (const m of sim.matches.slice(0, 12)) {
    const s = m.similaritySignals ?? {};
    console.log(
      `  ${m.similarityScore}% ${m.deliverableName} dur=${s.durationBehaviour?.toFixed(3)} sem=${s.semantic?.toFixed(3)} act=${s.activityComposition?.toFixed(3)}`
    );
  }

  console.log("\nBenchmark:", {
    sampleSize: report.benchmark.sampleSize,
    excluded: report.evidence?.excludedEvidence,
    lowSim: report.evidence?.excludedEvidence?.lowDeliverableSimilarity,
    classMismatch: report.evidence?.excludedEvidence?.classificationMismatch,
    matchedProjects: report.evidence?.matchedProjects?.length,
    retained: report.evidence?.matchedDeliverables?.length,
    outlier: {
      raw: report.outlier.rawPosition,
      effective: report.outlier.effectivePosition,
      status: report.outlier.status,
    },
  });
} finally {
  await prisma.$disconnect();
}
