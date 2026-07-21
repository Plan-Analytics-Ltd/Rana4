#!/usr/bin/env node
/**
 * Investigates a specific mismatch flagged by the user: the historical deliverable
 * "Detailed Design - Drainage Drawing Pack" (Tilbury Port) is matching the Plymouth
 * Hospital target "Model/Drawing Development" instead of Plymouth's own "Detailed
 * Design" deliverable in the same fragnet — even though the historical item's own
 * name says "Detailed Design", not "Model Development".
 *
 * This checks:
 *   1. Whether there's a developer-approved knowledge decision for "Model/Drawing
 *      Development" (and what it says), since that's the only way its identity
 *      would bypass corroboration with empty evidence.
 *   2. What "Detailed Design" (Plymouth target) actually resolves to on its own,
 *      and why it doesn't match "Detailed Design - Drainage Drawing Pack" at all.
 *
 * Read-only. No writes.
 */
import { prisma } from "../dist/utils/prisma.js";
import { conceptSubject } from "../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";
import { engineeringIdentityFingerprint } from "../dist/services/intelligence/taxonomy/engineeringTrust.service.js";
import { resolveEngineeringIdentity } from "../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../dist/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";
import { nameSimilarity } from "../dist/services/deliverableDurationStatisticsPresentation.service.js";

function rawIdentity(name, extra = {}) {
  return enforceEngineeringIdentityValidation(
    resolveEngineeringIdentity({ deliverableName: name, ...extra })
  );
}

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });

  for (const company of companies) {
    const knowledgeEntries = await prisma.engineeringKnowledgeEntry.findMany({
      where: {
        companyId: company.id,
        concept: { contains: "Model", mode: "insensitive" },
      },
      select: {
        concept: true,
        status: true,
        lastAction: true,
        discipline: true,
        engineeringObject: true,
        engineeringWork: true,
        deliverableType: true,
        lifecycleStage: true,
        aliases: true,
        reviewNotes: true,
        reviewedBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    for (const entry of knowledgeEntries) {
      console.log(`\n[${company.name}] Knowledge entry: "${entry.concept}"`);
      console.log(`  status=${entry.status} lastAction=${entry.lastAction} reviewedBy=${entry.reviewedBy ?? "(none)"} reviewNotes=${entry.reviewNotes ?? "(none)"}`);
      console.log(
        `  discipline=${entry.discipline} engineeringObject=${entry.engineeringObject} engineeringWork=${entry.engineeringWork} deliverableType=${entry.deliverableType} lifecycleStage=${entry.lifecycleStage}`
      );
      console.log(`  aliases=${JSON.stringify(entry.aliases)}`);
      console.log(`  createdAt=${entry.createdAt} updatedAt=${entry.updatedAt}`);
    }
  }

  console.log("\n--- Rule-based resolution of the two Plymouth deliverables on their own ---");
  const modelDev = rawIdentity("Model/Drawing Development", { fragnetName: "Drainage Design" });
  const detailedDesign = rawIdentity("Detailed Design", { fragnetName: "Drainage Design" });
  const historicalCandidate = rawIdentity("Detailed Design - Drainage Drawing Pack", { fragnetName: "Detailed Design" });

  console.log("Model/Drawing Development ->", JSON.stringify({
    discipline: modelDev.discipline,
    engineeringObject: modelDev.engineeringObject,
    engineeringWork: modelDev.engineeringWork,
  }, null, 2));
  console.log("Detailed Design ->", JSON.stringify({
    discipline: detailedDesign.discipline,
    engineeringObject: detailedDesign.engineeringObject,
    engineeringWork: detailedDesign.engineeringWork,
  }, null, 2));
  console.log("Detailed Design - Drainage Drawing Pack (historical) ->", JSON.stringify({
    discipline: historicalCandidate.discipline,
    engineeringObject: historicalCandidate.engineeringObject,
    engineeringWork: historicalCandidate.engineeringWork,
  }, null, 2));

  console.log("\n--- Name similarity ---");
  console.log(
    "Model/Drawing Development <-> Detailed Design - Drainage Drawing Pack:",
    nameSimilarity("Model/Drawing Development", "Detailed Design - Drainage Drawing Pack")
  );
  console.log(
    "Detailed Design <-> Detailed Design - Drainage Drawing Pack:",
    nameSimilarity("Detailed Design", "Detailed Design - Drainage Drawing Pack")
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
