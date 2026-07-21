#!/usr/bin/env node
/**
 * Same class of regression as fix-stale-fingerprints.mjs: the engineeringWork
 * regex fix (detailing no longer matches "detailed") changes the RAW rule-based
 * signature for Plymouth's bare "Detailed Design" (Drainage Design fragnet) from
 * null|drainage|detailing to null|drainage|null. The stored knowledge-entry
 * fingerprint for "Detailed Design (drainage)" was computed under the OLD code
 * and still encodes the old signature, so the lookup now misses entirely.
 *
 * Recomputes the fingerprint fresh using the real observed context (name +
 * fragnet, matching debug-plymouth-drainage.mjs and the live screenshot) and
 * updates ONLY the fingerprint column, with the usual collision guard.
 */
import { prisma } from "../dist/utils/prisma.js";
import { resolveEngineeringIdentity } from "../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../dist/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";
import { engineeringIdentityFingerprint } from "../dist/services/intelligence/taxonomy/engineeringTrust.service.js";
import { conceptSubject } from "../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";

async function main() {
  const company = await prisma.company.findFirst({ where: { name: "PlanAnalytics Dev" }, select: { id: true } });
  if (!company) throw new Error("Company not found");

  const existing = await prisma.engineeringKnowledgeEntry.findFirst({
    where: { companyId: company.id, concept: "Detailed Design (drainage)" },
    select: { id: true, fingerprint: true, discipline: true, engineeringObject: true, engineeringWork: true, deliverableType: true, lifecycleStage: true },
  });
  if (!existing) {
    console.log("NOT FOUND: Detailed Design (drainage)");
    process.exit(1);
  }

  const rawIdentity = enforceEngineeringIdentityValidation(
    resolveEngineeringIdentity({ deliverableName: "Detailed Design", fragnetName: "Drainage Design" })
  );
  const freshFingerprint = engineeringIdentityFingerprint(conceptSubject("Detailed Design").key, rawIdentity);

  console.log("stored fields:", existing.discipline, existing.engineeringObject, existing.engineeringWork, existing.deliverableType, existing.lifecycleStage);
  console.log("old fingerprint:", existing.fingerprint);
  console.log("new fingerprint:", freshFingerprint);
  console.log("fresh raw resolution: discipline=" + rawIdentity.discipline.id + " object=" + rawIdentity.engineeringObject.id + " work=" + rawIdentity.engineeringWork.id + " type=" + rawIdentity.deliverableType.id);

  if (existing.fingerprint === freshFingerprint) {
    console.log("Already matches - no update needed.");
    process.exit(0);
  }

  const collision = await prisma.engineeringKnowledgeEntry.findFirst({
    where: { companyId: company.id, fingerprint: freshFingerprint },
    select: { id: true, concept: true },
  });
  if (collision && collision.id !== existing.id) {
    console.log(`ABORTED - collides with "${collision.concept}" (${collision.id}). Needs manual review.`);
    process.exit(1);
  }

  await prisma.engineeringKnowledgeEntry.update({
    where: { id: existing.id },
    data: { fingerprint: freshFingerprint },
  });
  console.log("FIXED.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
