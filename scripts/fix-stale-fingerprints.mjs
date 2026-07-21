#!/usr/bin/env node
/**
 * Fixes a real regression introduced by adding two new taxonomy object rules
 * (ground_investigation, sustainability_assessment): the stored fingerprint on
 * knowledge entries whose RAW rule-based object resolution changed as a
 * result (previously null, now a real id) no longer matches what gets
 * computed fresh at read time, so the lookup silently misses and the entry
 * falls back to bare rule-based resolution (confirmed live via the Brain
 * Inbox screenshot showing "Sustainability Breeam" with engineeringWork
 * unresolved, even though a stored decision with engineeringWork=calculation
 * exists).
 *
 * For each affected concept: re-resolves the identity fresh using the real
 * observed deliverable context (name + fragnet + related activities, matching
 * how the app actually builds EngineeringIdentityInput), recomputes the
 * fingerprint the app would use today, and updates ONLY the fingerprint
 * column on the existing row (a direct prisma update, since
 * recordEngineeringReviewDecision's fingerprint argument is a lookup key, not
 * something it lets you change on an existing row).
 */
import { prisma } from "../dist/utils/prisma.js";
import { resolveEngineeringIdentity } from "../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../dist/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";
import { engineeringIdentityFingerprint } from "../dist/services/intelligence/taxonomy/engineeringTrust.service.js";
import { conceptSubject } from "../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";

const AFFECTED = [
  { concept: "Additional Ground Investigation", name: "Additional Ground Investigation", fragnetName: "EW-001 - Review Additional Works" },
  { concept: "Report - Sustainability - BREEAM", name: "Report - Sustainability - BREEAM", fragnetName: "Sustainability" },
  { concept: "Report - Sustainability - Environment / Sustainability", name: "Report - Sustainability - Environment / Sustainability", fragnetName: "Sustainability" },
  { concept: "Report - Sustainability - Net Zero Carbon", name: "Report - Sustainability - Net Zero Carbon", fragnetName: "Sustainability" },
];

async function main() {
  const company = await prisma.company.findFirst({ where: { name: "PlanAnalytics Dev" }, select: { id: true } });
  if (!company) throw new Error("Company not found");

  for (const item of AFFECTED) {
    const existing = await prisma.engineeringKnowledgeEntry.findFirst({
      where: { companyId: company.id, concept: item.concept },
      select: { id: true, fingerprint: true, discipline: true, engineeringObject: true, engineeringWork: true },
    });
    if (!existing) {
      console.log(`NOT FOUND: ${item.concept}`);
      continue;
    }

    const rawIdentity = enforceEngineeringIdentityValidation(
      resolveEngineeringIdentity({ deliverableName: item.name, fragnetName: item.fragnetName })
    );
    const subjectKey = conceptSubject(item.name).key;
    const freshFingerprint = engineeringIdentityFingerprint(subjectKey, rawIdentity);

    console.log(`\n${item.concept}`);
    console.log(`  old fingerprint: ${existing.fingerprint}`);
    console.log(`  new fingerprint: ${freshFingerprint}`);
    console.log(`  fresh raw resolution: discipline=${rawIdentity.discipline.id} object=${rawIdentity.engineeringObject.id} work=${rawIdentity.engineeringWork.id}`);

    if (existing.fingerprint === freshFingerprint) {
      console.log(`  UNCHANGED - fingerprint already matches, no fix needed.`);
      continue;
    }

    // Guard: make sure we're not about to collide with a different existing row.
    const collision = await prisma.engineeringKnowledgeEntry.findFirst({
      where: { companyId: company.id, fingerprint: freshFingerprint },
      select: { id: true, concept: true },
    });
    if (collision && collision.id !== existing.id) {
      console.log(`  ABORTED - new fingerprint collides with a different existing row: "${collision.concept}" (${collision.id}). Needs manual review.`);
      continue;
    }

    await prisma.engineeringKnowledgeEntry.update({
      where: { id: existing.id },
      data: { fingerprint: freshFingerprint },
    });
    console.log(`  FIXED.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
