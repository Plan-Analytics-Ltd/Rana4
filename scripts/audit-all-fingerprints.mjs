#!/usr/bin/env node
/**
 * Comprehensive check: for every persisted, non-rejected knowledge entry,
 * find its real underlying observed deliverable(s) (matching by conceptSubject
 * key, exactly how the app groups them), recompute the fingerprint fresh
 * using TODAY's rule engine, and compare against the stored fingerprint.
 *
 * This catches ANY entry affected by the two new taxonomy object rules added
 * this session (ground_investigation, sustainability_assessment) — not just
 * the ones already fixed by hand — by checking against real data instead of
 * guessing which concepts might contain matching text.
 *
 * Read-only unless --fix is passed, in which case mismatches are corrected
 * (with the same collision guard as fix-stale-fingerprints.mjs).
 */
import { prisma } from "../dist/utils/prisma.js";
import { resolveEngineeringIdentity } from "../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../dist/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";
import { engineeringIdentityFingerprint } from "../dist/services/intelligence/taxonomy/engineeringTrust.service.js";
import { conceptSubject } from "../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";

const FIX = process.argv.includes("--fix");

async function main() {
  const company = await prisma.company.findFirst({ where: { name: "PlanAnalytics Dev" }, select: { id: true } });
  if (!company) throw new Error("Company not found");

  const entries = await prisma.engineeringKnowledgeEntry.findMany({
    where: { companyId: company.id, status: { not: "REJECTED" } },
    select: { id: true, concept: true, fingerprint: true },
  });

  // Build a key -> real deliverable index, same approach as the earlier dump script.
  const liveDeliverables = await prisma.deliverable.findMany({
    where: { companyId: company.id },
    select: { name: true, fragnet: { select: { name: true } }, activities: { select: { name: true } } },
  });
  const byKey = new Map();
  for (const d of liveDeliverables) {
    const key = conceptSubject(d.name).key;
    if (!byKey.has(key)) {
      byKey.set(key, { name: d.name, fragnetName: d.fragnet?.name ?? null, relatedActivityNames: d.activities.map((a) => a.name) });
    }
  }
  const snapshots = await prisma.deliverableSnapshot.findMany({
    where: { snapshot: { companyId: company.id } },
    select: { name: true, parentWbs: true, wbsPath: true },
    take: 8000,
  });
  for (const s of snapshots) {
    const key = conceptSubject(s.name).key;
    if (!byKey.has(key)) {
      byKey.set(key, { name: s.name, fragnetName: s.parentWbs ?? s.wbsPath ?? null, relatedActivityNames: [] });
    }
  }

  let matched = 0;
  let mismatched = 0;
  let noRealMatch = 0;
  let fixedCount = 0;

  for (const entry of entries) {
    const key = conceptSubject(entry.concept).key;
    const real = byKey.get(key);
    if (!real) {
      noRealMatch += 1;
      console.log(`NO REAL DELIVERABLE FOUND for concept "${entry.concept}" (key="${key}") - can't verify, skipping.`);
      continue;
    }

    const rawIdentity = enforceEngineeringIdentityValidation(
      resolveEngineeringIdentity({
        deliverableName: real.name,
        fragnetName: real.fragnetName,
        relatedActivityNames: real.relatedActivityNames,
      })
    );
    const freshFingerprint = engineeringIdentityFingerprint(conceptSubject(real.name).key, rawIdentity);

    if (freshFingerprint === entry.fingerprint) {
      matched += 1;
      continue;
    }

    mismatched += 1;
    console.log(`\nMISMATCH: "${entry.concept}"`);
    console.log(`  stored fingerprint: ${entry.fingerprint}`);
    console.log(`  fresh fingerprint:  ${freshFingerprint}`);
    console.log(`  fresh raw resolution: discipline=${rawIdentity.discipline.id} object=${rawIdentity.engineeringObject.id} work=${rawIdentity.engineeringWork.id}`);

    if (FIX) {
      const collision = await prisma.engineeringKnowledgeEntry.findFirst({
        where: { companyId: company.id, fingerprint: freshFingerprint },
        select: { id: true, concept: true },
      });
      if (collision && collision.id !== entry.id) {
        console.log(`  ABORTED - collides with "${collision.concept}" (${collision.id}). Needs manual review.`);
        continue;
      }
      await prisma.engineeringKnowledgeEntry.update({ where: { id: entry.id }, data: { fingerprint: freshFingerprint } });
      fixedCount += 1;
      console.log(`  FIXED.`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Checked: ${entries.length}`);
  console.log(`Matched (fingerprint current): ${matched}`);
  console.log(`Mismatched (stale fingerprint): ${mismatched}${FIX ? ` (fixed: ${fixedCount})` : " (run with --fix to correct)"}`);
  console.log(`Could not verify (no real deliverable found by name): ${noRealMatch}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
