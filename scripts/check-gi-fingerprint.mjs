#!/usr/bin/env node
import { prisma } from "../dist/utils/prisma.js";
import { resolveEngineeringIdentity } from "../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../dist/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";
import { engineeringIdentityFingerprint } from "../dist/services/intelligence/taxonomy/engineeringTrust.service.js";
import { conceptSubject } from "../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";

async function main() {
  const company = await prisma.company.findFirst({ where: { name: "PlanAnalytics Dev" }, select: { id: true } });
  const existing = await prisma.engineeringKnowledgeEntry.findFirst({
    where: { companyId: company.id, concept: "GI" },
    select: { id: true, fingerprint: true, discipline: true, engineeringObject: true, engineeringWork: true },
  });
  if (!existing) { console.log("NOT FOUND"); process.exit(1); }

  // Real live example fragnet for "GI" was "EW-001 - Review Additional Works" (GET Milestones-style),
  // per the original dump's realLiveExamples for this concept.
  const rawIdentity = enforceEngineeringIdentityValidation(
    resolveEngineeringIdentity({ deliverableName: "GI", fragnetName: "EW-001 - Review Additional Works" })
  );
  const freshFingerprint = engineeringIdentityFingerprint(conceptSubject("GI").key, rawIdentity);

  console.log("stored:", existing.fingerprint, "| discipline/object/work in DB:", existing.discipline, existing.engineeringObject, existing.engineeringWork);
  console.log("fresh: ", freshFingerprint, "| fresh raw resolution:", rawIdentity.discipline.id, rawIdentity.engineeringObject.id, rawIdentity.engineeringWork.id);
  console.log(existing.fingerprint === freshFingerprint ? "MATCH - no fix needed" : "MISMATCH - needs fix");

  if (existing.fingerprint !== freshFingerprint) {
    const collision = await prisma.engineeringKnowledgeEntry.findFirst({ where: { companyId: company.id, fingerprint: freshFingerprint } });
    if (collision) {
      console.log("ABORTED - collides with", collision.concept);
    } else {
      await prisma.engineeringKnowledgeEntry.update({ where: { id: existing.id }, data: { fingerprint: freshFingerprint } });
      console.log("FIXED.");
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
