#!/usr/bin/env node
/**
 * Real diagnosis of the Plymouth Hospital "Drainage Design" fragnet screenshot:
 * - "Detailed Design" (bare) shows zero history.
 * - "Model/Drawing Development" and "Additional Drainage Works" both pull
 *   from the same Tilbury Port historical item at wildly different durations.
 *
 * Pulls the REAL live deliverables + the REAL historical candidate, resolves
 * their actual identities exactly as the duration-matching feature does
 * (rule-based + knowledge overlay), and prints discipline/object/work/type
 * plus which one is a knowledge-entry override vs raw rule resolution.
 */
import { prisma } from "../dist/utils/prisma.js";
import { resolveEngineeringIdentity } from "../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../dist/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";
import { engineeringIdentityFingerprint } from "../dist/services/intelligence/taxonomy/engineeringTrust.service.js";
import { conceptSubject } from "../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";
import { loadEngineeringKnowledge } from "../dist/services/intelligence/diagnostics/engineeringKnowledgeStore.service.js";

function raw(name, extra = {}) {
  return enforceEngineeringIdentityValidation(resolveEngineeringIdentity({ deliverableName: name, ...extra }));
}

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const decisionsByCompany = new Map();
  for (const c of companies) decisionsByCompany.set(c.id, await loadEngineeringKnowledge(c.id));

  const targets = [
    { label: "Plymouth: Detailed Design (bare, Drainage Design fragnet)", name: "Detailed Design", fragnetName: "Drainage Design" },
    { label: "Plymouth: Model/Drawing Development (Drainage Design fragnet)", name: "Model/Drawing Development", fragnetName: "Drainage Design" },
    { label: "Plymouth: Additional Drainage Works", name: "Additional Drainage Works", fragnetName: null },
    { label: "Tilbury: Detailed Design - Drainage Drawing Pack", name: "Detailed Design - Drainage Drawing Pack", fragnetName: "Detailed Design" },
    { label: "OOC: CI-506 Additional Drainage Scope", name: "CI-506 Additional Drainage Scope", fragnetName: null },
  ];

  for (const t of targets) {
    const id = raw(t.name, { fragnetName: t.fragnetName });
    const key = conceptSubject(t.name).key;
    console.log(`\n${t.label}`);
    console.log(`  raw: discipline=${id.discipline.id} object=${id.engineeringObject.id} work=${id.engineeringWork.id} type=${id.deliverableType.id} status=${id.status}`);
    console.log(`  conceptSubject key: "${key}"`);

    // Check every company's stored decisions for a fingerprint match.
    let found = null;
    for (const [companyId, decisions] of decisionsByCompany) {
      const fp = engineeringIdentityFingerprint(key, id);
      if (decisions.has(fp)) {
        found = { companyId, decision: decisions.get(fp) };
        break;
      }
    }
    if (found) {
      const d = found.decision;
      console.log(`  MATCHED STORED DECISION: "${d.concept}" -> discipline=${d.identity.discipline} object=${d.identity.engineeringObject} work=${d.identity.engineeringWork} type=${d.identity.deliverableType}`);
    } else {
      console.log(`  NO stored decision matched this fingerprint - using raw rule-based identity as-is.`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
