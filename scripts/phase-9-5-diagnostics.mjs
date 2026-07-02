/**
 * Phase 9.5 — historical fingerprint enrichment validation.
 * Usage: node scripts/phase-9-5-diagnostics.mjs
 */
import { PrismaClient } from "@prisma/client";
import { repairCompanyHistoricalLearningEvidence } from "../dist/services/intelligence/learning/historicalLearningRepair.service.js";
import { getSimilarDeliverables } from "../dist/services/intelligence/shared/similarity.service.js";
import { selectBenchmarkEvidence } from "../dist/services/intelligence/matching/evidenceSelection.service.js";
import { deduplicateBenchmarkSamples } from "../dist/services/intelligence/matching/revisionGrouping.service.js";
import { DEFAULT_MIN_COMPARABLE_SIMILARITY } from "../dist/services/intelligence/matching/similarityWeights.config.js";
import { ALLOWED_SNAPSHOT_STATES } from "../dist/services/intelligence/shared/intelligenceConstants.js";
import { diffDaysFromIso } from "../dist/services/intelligence/shared/intelligenceMath.js";

const prisma = new PrismaClient();
const projectId = "cmr1ztdj50001sybs8jbn4qf4";
const companyId = "cmo8dvlc10000syx0861h1zr5";
const THRESHOLD = DEFAULT_MIN_COMPARABLE_SIMILARITY;

const CASES = [
  { name: "Reinforcement Detailing", duration: 10 },
  { name: "Model/Drawing Development", duration: 10 },
];

async function main() {
  console.log("=== Phase 9.5 — backfill historical snapshot context ===\n");
  const repair = await repairCompanyHistoricalLearningEvidence(companyId);
  console.log(JSON.stringify(repair, null, 2));
  console.log();

  for (const testCase of CASES) {
    const deliverable = await prisma.deliverable.findFirst({
      where: {
        projectId,
        companyId,
        name: testCase.name,
        likelyDuration: testCase.duration,
      },
      select: { id: true, name: true, classification: true, fragnetId: true, fragnet: { select: { name: true } } },
    });
    if (!deliverable) {
      console.log(`SKIP: ${testCase.name} (${testCase.duration}d) not found`);
      continue;
    }

    const sim = await getSimilarDeliverables({
      projectId,
      companyId,
      deliverableId: deliverable.id,
      limit: 200,
      allowedProgrammeStates: ALLOWED_SNAPSHOT_STATES,
    });

    const exactName = sim.matches.filter(
      (m) => m.deliverableName.trim().toLowerCase() === deliverable.name.trim().toLowerCase()
    );
    const topExact = exactName[0];

    const gated = sim.matches.filter((m) => {
      const hist = m.classification ?? null;
      if (deliverable.classification && hist) {
        return String(deliverable.classification) === String(hist);
      }
      return true;
    });

    const beforeThreshold = gated.filter((m) => m.similarityScore >= THRESHOLD);
    const deduped = deduplicateBenchmarkSamples(
      beforeThreshold.map((m) => ({
        snapshotId: m.evidence?.snapshotId ?? m.snapshotId ?? "",
        snapshotVersion: 1,
        snapshotRole: null,
        programmeState: m.evidence?.programmeState ?? null,
        projectId: m.evidence?.projectId ?? "",
        deliverableId: m.deliverableId ?? "",
        deliverableName: m.deliverableName,
        importedAt: m.importedAt ?? new Date(),
        durationDays:
          diffDaysFromIso(m.evidence?.actualStart, m.evidence?.actualFinish) ??
          diffDaysFromIso(m.evidence?.plannedStart, m.evidence?.plannedFinish) ??
          0,
        fingerprintKey: m.fingerprintKey ?? "",
        similarityScore: m.similarityScore,
      }))
    );
    const selected = selectBenchmarkEvidence(
      deduped.map((d) => ({
        snapshotId: d.snapshotId,
        projectId: d.projectId,
        projectName: d.projectId,
        deliverableId: d.deliverableId,
        deliverableName: d.deliverableName,
        classification: deliverable.classification ?? "OTHER",
        programmeState: d.programmeState ?? "APPROVED_BASELINE",
        durationDays: d.durationDays,
        similarityScore: d.similarityScore ?? 0,
        evidenceWeight: 1,
        fingerprintKey: d.fingerprintKey,
      }))
    );

    console.log(`=== ${testCase.name} (${testCase.duration} days) ===`);
    console.log(`Live WBS: fragnetId=${deliverable.fragnetId} parentWbs=${deliverable.fragnet?.name ?? "—"}`);
    if (topExact) {
      const sig = topExact.similaritySignals ?? {};
      console.log(`Top exact-name match: ${topExact.deliverableName}`);
      console.log(`  WBS score:        ${sig.wbsContext ?? 0}`);
      console.log(`  Stage score:      ${sig.programmeStage ?? 0}`);
      console.log(`  Final similarity: ${topExact.similarityScore}%`);
    } else {
      console.log("No exact-name historical match in top results");
    }
    console.log(`Retained benchmark matches (≥${THRESHOLD}%): ${selected.selected.length}`);
    console.log(`Candidates ≥ threshold before dedup: ${beforeThreshold.length}`);
    console.log();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
