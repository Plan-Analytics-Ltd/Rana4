#!/usr/bin/env node
/**
 * Real root cause of Plymouth's bare "Detailed Design" showing zero history:
 * its stored knowledge-entry override ("Detailed Design (drainage)") carries
 * discipline=civil (set by a prior review pass, batch 2, before this
 * session), while every other drainage-related entry in the dataset — and
 * the raw rule engine's typical resolution for real historical drainage
 * deliverables (e.g. Tilbury's "Detailed Design - Drainage Drawing Pack") —
 * uses discipline=public_health. Since discipline is an IDENTITY-gating
 * field, this one entry can never match anything.
 *
 * Fixes it the correct way: through recordEngineeringReviewDecision (MODIFY),
 * preserving the existing fingerprint (a lookup key, never changed by this
 * call), object/work/type/lifecycle, aliases and evidence — only the
 * discipline field changes, plus an appended review note.
 */
import { prisma } from "../dist/utils/prisma.js";
import { recordEngineeringReviewDecision } from "../dist/services/intelligence/diagnostics/engineeringKnowledgeStore.service.js";

const REVIEWED_BY = "aelsaman@plananalytics.co.uk";

async function main() {
  const company = await prisma.company.findFirst({ where: { name: "PlanAnalytics Dev" }, select: { id: true } });
  if (!company) throw new Error("Company not found");

  const existing = await prisma.engineeringKnowledgeEntry.findFirst({
    where: { companyId: company.id, concept: "Detailed Design (drainage)" },
  });
  if (!existing) {
    console.log("NOT FOUND: Detailed Design (drainage)");
    process.exit(1);
  }

  console.log("BEFORE:");
  console.log(`  discipline=${existing.discipline} object=${existing.engineeringObject} work=${existing.engineeringWork} type=${existing.deliverableType} lifecycle=${existing.lifecycleStage}`);

  if (existing.discipline === "public_health") {
    console.log("Already public_health - no fix needed.");
    process.exit(0);
  }

  const result = await recordEngineeringReviewDecision({
    companyId: company.id,
    fingerprint: existing.fingerprint,
    action: "MODIFY",
    concept: existing.concept,
    identity: {
      discipline: "public_health",
      engineeringObject: existing.engineeringObject,
      engineeringWork: existing.engineeringWork,
      deliverableType: existing.deliverableType,
      lifecycleStage: existing.lifecycleStage,
    },
    aliases: Array.isArray(existing.aliases) ? existing.aliases : [],
    evidence: Array.isArray(existing.evidence) ? existing.evidence : [],
    notes: `${existing.reviewNotes ?? ""} [Post-brain-fill correction] Discipline realigned public_health (from civil, set in an earlier batch) for consistency with every other drainage-related entry (Drainage, Additional Drainage Works, Model/Drawing Development (drainage), New Design Drawing - Public Health) and with the raw rule engine's default resolution for real drainage deliverables. The civil/public_health split was a genuine inconsistency, not a deliberate distinction, and was the direct cause of this deliverable showing zero duration history in the live UI.`.trim(),
    reviewedBy: REVIEWED_BY,
  });

  if (!result) {
    console.log("WRITE FAILED - store unavailable or error.");
    process.exit(1);
  }

  console.log("AFTER:");
  console.log(`  discipline=${result.identity.discipline} object=${result.identity.engineeringObject} work=${result.identity.engineeringWork} type=${result.identity.deliverableType} lifecycle=${result.identity.lifecycleStage}`);
  console.log("FIXED.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
