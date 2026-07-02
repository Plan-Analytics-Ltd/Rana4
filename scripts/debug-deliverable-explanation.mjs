import { PrismaClient } from "@prisma/client";
import { buildExplanationIntelligencePackage } from "../dist/services/explanation/context/explanationContext.builder.js";
import { validateExplanationContext } from "../dist/services/explanation/validation/explanationValidator.service.js";

const prisma = new PrismaClient();
const projectId = "cmr1ztdj50001sybs8jbn4qf4";
const deliverableId = "c9ac0980-867b-4c48-b0ed-8a9bac5b4c18";

try {
  const project = await prisma.project.findFirst({ where: { id: projectId } });
  if (!project) throw new Error("project not found");

  const deliverable = await prisma.deliverable.findFirst({
    where: { id: deliverableId, projectId },
    select: { id: true, name: true, classification: true },
  });

  const pkg = await buildExplanationIntelligencePackage({
    projectId,
    companyId: project.companyId,
    deliverableId,
  });

  const validation = validateExplanationContext(pkg, "DELIVERABLE_SUMMARY");

  console.log(
    JSON.stringify(
      {
        deliverable,
        evidenceSummary: pkg.evidenceSummary,
        hasBenchmark: pkg.benchmark != null,
        benchmarkSampleSize: pkg.benchmark?.sampleSize ?? null,
        benchmarkConfidence: pkg.benchmark?.confidenceLevel ?? null,
        observations: pkg.observations.length,
        recommendations: pkg.recommendations.length,
        keyFactors: pkg.keyFactors.length,
        hasTrust: pkg.trust != null,
        hasPrediction: pkg.outcomePrediction != null,
        hasReliability: pkg.forecastReliability != null,
        validation: {
          readiness: validation.readiness,
          score: validation.score,
          failedChecks: validation.failedChecks,
          warningChecks: validation.warningChecks,
          passedChecks: validation.passedChecks.map((c) => c.id),
        },
      },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
