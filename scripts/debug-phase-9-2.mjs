/**
 * Phase 9.2 diagnostic — position pipeline + similarity signal breakdown.
 * Usage: node scripts/debug-phase-9-2.mjs [projectId] [deliverableNameSubstring]
 */
import { PrismaClient } from "@prisma/client";
import { getDeliverableBenchmark } from "../dist/services/intelligence/benchmark/benchmark.service.js";
import { DEFAULT_MIN_COMPARABLE_SIMILARITY } from "../dist/services/intelligence/matching/similarityWeights.config.js";

const prisma = new PrismaClient();
const projectId = process.argv[2] ?? "cmr1ztdj50001sybs8jbn4qf4"; // seeded healthcare project
const nameFilter = (process.argv[3] ?? "").toLowerCase();

const TEST_NAMES = [
  "milestone",
  "reinforcement detailing",
  "additional ground investigation",
  "model/drawing development",
];

try {
  const project = await prisma.project.findFirst({ where: { id: projectId } });
  if (!project) throw new Error(`Project not found: ${projectId}`);

  let deliverables = await prisma.deliverable.findMany({
    where: { projectId },
    select: { id: true, name: true, classification: true },
    orderBy: { name: "asc" },
  });

  if (nameFilter) {
    deliverables = deliverables.filter((d) => d.name.toLowerCase().includes(nameFilter));
  } else {
    deliverables = deliverables.filter((d) =>
      TEST_NAMES.some((t) => d.name.toLowerCase().includes(t))
    );
  }

  console.log(`\n=== Phase 9.2 diagnostics (${deliverables.length} deliverables) ===\n`);

  for (const d of deliverables) {
    const report = await getDeliverableBenchmark({
      projectId,
      companyId: project.companyId,
      deliverableId: d.id,
    });

    const o = report.outlier;
    const retained = (report.evidence?.matchedDeliverables ?? []).slice(0, 8);

    console.log(`--- ${d.name} (${d.classification ?? "?"}) ---`);
    console.log("Issue 1 — position pipeline:");
    console.log(
      JSON.stringify(
        {
          rawStatus: o.rawStatus ?? o.status,
          effectiveStatus: o.status,
          position: o.position,
          positionLabel: o.positionLabel,
          rawPosition: o.rawPosition,
          effectivePosition: o.effectivePosition,
          sampleSize: report.benchmark.sampleSize,
          confidenceLevel: report.benchmark.confidenceLevel,
        },
        null,
        2
      )
    );

    console.log("\nIssue 2 — similarity (retained evidence):");
    const scores = retained.map((m) => m.similarityScore);
    const uniqueScores = [...new Set(scores)];
    console.log(`  Retained: ${retained.length}, unique scores: ${uniqueScores.join(", ")}`);
    for (const m of retained.slice(0, 5)) {
      const signals = m.similaritySignals ?? {};
      const weighted =
        (signals.semantic ?? 0) * 40 +
        (signals.wbsContext ?? 0) * 20 +
        (signals.activityComposition ?? 0) * 20 +
        (signals.durationBehaviour ?? 0) * 10 +
        (signals.programmeStage ?? 0) * 10;
      const pass = m.similarityScore >= DEFAULT_MIN_COMPARABLE_SIMILARITY;
      console.log(
        `  ${m.deliverableName} (${m.durationDays}d) score=${m.similarityScore} recomputed=${Math.round(weighted * 10) / 10} pass=${pass}`
      );
      console.log(
        `    signals: semantic=${signals.semantic?.toFixed(3)} wbs=${signals.wbsContext?.toFixed(3)} activity=${signals.activityComposition?.toFixed(3)} duration=${signals.durationBehaviour?.toFixed(3)} stage=${signals.programmeStage?.toFixed(3)}`
      );
    }

    console.log("\nIssue 3 — evidence quality:");
    const bq = report.benchmark.benchmarkQuality;
    console.log(
      JSON.stringify(
        {
          distinctProjects: bq?.distinctProjects,
          revisionRatio: bq?.revisionRatio,
          evidenceDiversity: bq?.evidenceDiversity,
          plannerSummary: report.evidence?.plannerSummary,
          notes: report.benchmark.notes,
        },
        null,
        2
      )
    );
    console.log("");
  }
} finally {
  await prisma.$disconnect();
}
