import { PrismaClient } from "@prisma/client";
import { getSimilarDeliverables } from "../dist/services/intelligence/shared/similarity.service.js";
import { computeWeightedDeliverableSimilarity } from "../dist/services/intelligence/matching/weightedDeliverableSimilarity.service.js";
import { buildDeliverableFingerprint } from "../dist/services/intelligence/matching/deliverableFingerprint.service.js";
import { DELIVERABLE_SIMILARITY_WEIGHTS } from "../dist/services/intelligence/matching/similarityWeights.config.js";
import { ALLOWED_SNAPSHOT_STATES } from "../dist/services/intelligence/shared/intelligenceConstants.js";

const prisma = new PrismaClient();
const projectId = "cmr1ztdj50001sybs8jbn4qf4";
const companyId = "cmo8dvlc10000syx0861h1zr5";
const W = DELIVERABLE_SIMILARITY_WEIGHTS;

async function inspectDeliverable(deliverableId, label) {
  const d = await prisma.deliverable.findFirst({
    where: { id: deliverableId, projectId },
    select: {
      id: true,
      name: true,
      fragnetId: true,
      fragnet: { select: { id: true, name: true } },
      activityCodeAssignments: { include: { type: { select: { slug: true, name: true } }, code: { select: { name: true, shortName: true } } } },
    },
  });

  const sim = await getSimilarDeliverables({
    projectId,
    companyId,
    deliverableId,
    limit: 5,
    allowedProgrammeStates: ALLOWED_SNAPSHOT_STATES,
  });

  const top = sim.matches.find((m) => m.deliverableName.toLowerCase().includes(label.split(" ")[0].toLowerCase())) ?? sim.matches[0];

  const hist = top
    ? await prisma.deliverableSnapshot.findFirst({
        where: { snapshotId: top.snapshotId ?? top.evidence?.snapshotId },
        select: {
          name: true,
          snapshot: { select: { id: true, stage: true, disciplineTags: true } },
        },
      })
    : null;

  console.log(`\n=== ${label} ===`);
  console.log("Current deliverable fingerprint inputs:");
  console.log(
    JSON.stringify(
      {
        name: d?.name,
        fragnetId: d?.fragnetId,
        parentWbsName: d?.fragnet?.name ?? null,
        activityCodeAssignments: d?.activityCodeAssignments?.map((a) => ({
          type: a.type.slug,
          value: a.code.shortName ?? a.code.name,
        })),
      },
      null,
      2
    )
  );

  const profile = await prisma.projectIntelligenceProfile.findUnique({
    where: { projectId },
    select: { stage: true, primaryRibaStage: true },
  });
  console.log("Project intelligence profile stage:", profile);

  if (top?.similaritySignals) {
    console.log("\nTop match signals:", top.similaritySignals);
    console.log("Top match:", top.deliverableName, top.similarityScore);
  }

  if (hist) {
    console.log("\nHistorical snapshot stage (programme):", hist.snapshot.stage);
    console.log("Historical disciplineTags:", hist.snapshot.disciplineTags);
  }

  // Hypothetical: if WBS=1 and stage=1 for top reinforcement matches
  const all = await getSimilarDeliverables({
    projectId,
    companyId,
    deliverableId,
    limit: 200,
    allowedProgrammeStates: ALLOWED_SNAPSHOT_STATES,
  });

  const named = all.matches.filter((m) =>
    m.deliverableName.toLowerCase().includes(label.includes("Reinforcement") ? "reinforcement" : "model")
  );

  console.log("\nHypothetical scores if wbsContext=1.0 AND programmeStage=1.0 (top 20 named matches):");
  for (const m of named.slice(0, 20)) {
    const sig = m.similaritySignals ?? {};
    const hypo =
      (sig.semantic ?? 0) * W.semantic +
      1.0 * W.wbsContext +
      (sig.activityComposition ?? 0) * W.activityComposition +
      (sig.durationBehaviour ?? 0) * W.durationBehaviour +
      1.0 * W.programmeStage;
    const hypoRounded = Math.round(hypo * 10) / 10;
    console.log(
      `  actual=${m.similarityScore}% hypo=${hypoRounded}% dur=${sig.durationBehaviour?.toFixed(3)} act=${sig.activityComposition?.toFixed(3)} | ${m.deliverableName} (${m.evidence?.programmeState})`
    );
  }
}

try {
  await inspectDeliverable("c9ac0980-867b-4c48-b0ed-8a9bac5b4c18", "Reinforcement Detailing 10d");
  await inspectDeliverable("11c1562b-9517-41be-816b-9170bd45a0c6", "Model/Drawing Development 10d");
} finally {
  await prisma.$disconnect();
}
