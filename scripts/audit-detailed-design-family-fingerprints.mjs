#!/usr/bin/env node
/**
 * The engineeringWork regex fix (detailing no longer matches "detailed")
 * changes the RAW rule-based signature for EVERY bare "Detailed Design"
 * deliverable from {discipline}|{object}|detailing to {discipline}|{object}|null.
 * Every "Detailed Design (X)" knowledge entry created before this fix has a
 * fingerprint baked from the OLD signature, so ALL of them are now stale, not
 * just the drainage one.
 *
 * Read-only report: lists every persisted, non-rejected entry whose concept
 * starts with "Detailed Design", its stored fields, and for each, finds real
 * live/snapshot deliverables literally named "Detailed Design" and shows what
 * they raw-resolve to today (object + fragnet), to identify which real
 * deliverable each stored entry actually corresponds to before any fingerprint
 * is changed.
 */
import { prisma } from "../dist/utils/prisma.js";
import { resolveEngineeringIdentity } from "../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../dist/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";
import { engineeringIdentityFingerprint } from "../dist/services/intelligence/taxonomy/engineeringTrust.service.js";
import { conceptSubject } from "../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";

async function main() {
  const company = await prisma.company.findFirst({ where: { name: "PlanAnalytics Dev" }, select: { id: true } });
  if (!company) throw new Error("Company not found");

  const entries = await prisma.engineeringKnowledgeEntry.findMany({
    where: { companyId: company.id, status: { not: "REJECTED" }, concept: { startsWith: "Detailed Design" } },
    select: { id: true, concept: true, fingerprint: true, discipline: true, engineeringObject: true, engineeringWork: true, deliverableType: true, lifecycleStage: true },
  });

  console.log(`Found ${entries.length} "Detailed Design*" entries:\n`);
  for (const e of entries) {
    console.log(`- ${e.concept}: discipline=${e.discipline} object=${e.engineeringObject} work=${e.engineeringWork} type=${e.deliverableType} lifecycle=${e.lifecycleStage} | fingerprint=${e.fingerprint}`);
  }

  // Real deliverables literally named "Detailed Design" (bare), across live + snapshots.
  const liveDeliverables = await prisma.deliverable.findMany({
    where: { companyId: company.id, name: "Detailed Design" },
    select: { name: true, fragnet: { select: { name: true } } },
  });
  const snapshots = await prisma.deliverableSnapshot.findMany({
    where: { snapshot: { companyId: company.id }, name: "Detailed Design" },
    select: { name: true, parentWbs: true, wbsPath: true },
    take: 2000,
  });

  const contexts = new Map(); // fragnetName -> count
  for (const d of liveDeliverables) {
    const fn = d.fragnet?.name ?? null;
    contexts.set(fn, (contexts.get(fn) ?? 0) + 1);
  }
  for (const s of snapshots) {
    const fn = s.parentWbs ?? s.wbsPath ?? null;
    contexts.set(fn, (contexts.get(fn) ?? 0) + 1);
  }

  console.log(`\nReal bare "Detailed Design" deliverables found: ${liveDeliverables.length} live + ${snapshots.length} snapshot rows.`);
  console.log("Distinct fragnet/WBS contexts and what they raw-resolve to today:\n");
  for (const [fragnetName, count] of contexts) {
    const rawIdentity = enforceEngineeringIdentityValidation(
      resolveEngineeringIdentity({ deliverableName: "Detailed Design", fragnetName })
    );
    const freshFingerprint = engineeringIdentityFingerprint(conceptSubject("Detailed Design").key, rawIdentity);
    console.log(`  fragnet/wbs="${fragnetName}" (x${count}) -> discipline=${rawIdentity.discipline.id} object=${rawIdentity.engineeringObject.id} work=${rawIdentity.engineeringWork.id} type=${rawIdentity.deliverableType.id} | fresh fingerprint=${freshFingerprint}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
