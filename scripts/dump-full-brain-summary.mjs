#!/usr/bin/env node
/**
 * Reconciles the "52 knowledge-entry rows" vs "64 deliverables" discrepancy.
 *
 * The EngineeringKnowledgeEntry table only stores DEVELOPER_APPROVED /
 * DEVELOPER_MODIFIED / REJECTED rows (52 in this dataset) — concepts the
 * rule engine resolves confidently on its own (TRUSTED) are "auto-approved"
 * and shown in the Engineering Brain review UI, but are NEVER written to that
 * table (see engineeringTrust.service.ts: "Only the rare developer decisions
 * are persisted elsewhere"). If the UI shows ~64, the gap is almost certainly
 * that auto-approved bucket, computed fresh every time from the live rules.
 *
 * This calls the exact same pipeline the real Engineering Brain diagnostics
 * page uses (computeEngineeringBrainDiagnostics), per company, WITHOUT the
 * DB-writing rule-proposal persistence step, and prints:
 *   - the same summary counts (brainInbox / trustedKnowledge / autoApproved /
 *     developerApproved / developerModified) the UI would show
 *   - the full list of auto-approved concepts with their resolved identity,
 *     aliases, and evidence, so we can see whether those also have real gaps
 *     (deliverableType/lifecycleStage/aliases aren't required for TRUSTED
 *     status, so they can still be genuinely empty even when auto-approved).
 *
 * Read-only. No writes (skips persistEngineeringRuleProposals on purpose).
 */
import { prisma } from "../dist/utils/prisma.js";
import {
  loadObservedDeliverablesForCompany,
  computeEngineeringBrainDiagnostics,
  buildEngineeringBrainSummary,
} from "../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";
import { loadEngineeringKnowledge, isEngineeringKnowledgeStoreAvailable } from "../dist/services/intelligence/diagnostics/engineeringKnowledgeStore.service.js";

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });

  for (const company of companies) {
    const observed = await loadObservedDeliverablesForCompany({ companyId: company.id });
    const decisions = await loadEngineeringKnowledge(company.id);
    const report = await computeEngineeringBrainDiagnostics(
      observed,
      [],
      decisions,
      isEngineeringKnowledgeStoreAvailable(),
      {}
    );
    const summary = buildEngineeringBrainSummary(report.collections);

    console.log(`\n=== ${company.name} ===`);
    console.log(JSON.stringify(summary, null, 2));

    if (report.collections.autoApproved.length > 0) {
      console.log(`\n--- Auto-approved concepts (${report.collections.autoApproved.length}, never persisted) ---`);
      for (const entry of report.collections.autoApproved) {
        console.log(
          JSON.stringify(
            {
              concept: entry.concept,
              identity: entry.identity,
              aliases: entry.aliases,
              evidence: entry.evidence,
              projectCount: entry.projectCount,
            },
            null,
            2
          )
        );
      }
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
