#!/usr/bin/env node
/**
 * Recomputes "GI"'s fingerprint using its REAL fragnet ("GET Milestones",
 * confirmed from the live Brain Inbox screenshot, not the wrong guess used
 * previously) and the now-narrowed taxonomy (no bare \bgi\b pattern), then
 * verifies the resulting identity is no longer contradictory before writing.
 */
import { prisma } from "../dist/utils/prisma.js";
import { resolveEngineeringIdentity } from "../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../dist/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";
import { engineeringIdentityFingerprint } from "../dist/services/intelligence/taxonomy/engineeringTrust.service.js";
import { conceptSubject } from "../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";

async function main() {
  const company = await prisma.company.findFirst({ where: { name: "PlanAnalytics Dev" }, select: { id: true } });
  const existing = await prisma.engineeringKnowledgeEntry.findFirst({
    where: { companyId: company.id, concept: "GI" },
    select: { id: true, fingerprint: true },
  });
  if (!existing) { console.log("NOT FOUND"); process.exit(1); }

  const rawIdentity = enforceEngineeringIdentityValidation(
    resolveEngineeringIdentity({ deliverableName: "GI", fragnetName: "GET Milestones", parentWbs: "GET Milestones" })
  );
  console.log("validity check - status:", rawIdentity.status);
  console.log("discipline:", rawIdentity.discipline.id, "| object:", rawIdentity.engineeringObject.id, "| work:", rawIdentity.engineeringWork.id);

  const freshFingerprint = engineeringIdentityFingerprint(conceptSubject("GI").key, rawIdentity);
  console.log("currently stored fingerprint:", existing.fingerprint);
  console.log("newly computed fingerprint:  ", freshFingerprint);

  if (existing.fingerprint === freshFingerprint) {
    console.log("Already matches - no update needed.");
    process.exit(0);
  }

  const collision = await prisma.engineeringKnowledgeEntry.findFirst({ where: { companyId: company.id, fingerprint: freshFingerprint } });
  if (collision) {
    console.log("ABORTED - collides with", collision.concept, collision.id);
    process.exit(1);
  }

  await prisma.engineeringKnowledgeEntry.update({ where: { id: existing.id }, data: { fingerprint: freshFingerprint } });
  console.log("FIXED - fingerprint updated to match GI's real fragnet context.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
