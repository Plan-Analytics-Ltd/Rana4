/**
 * End-to-end intelligence + explanation validation (requires DATABASE_URL + OpenAI optional).
 * Run: npm run validate:e2e
 */
import "dotenv/config";
import { prisma } from "../../../dist/utils/prisma.js";
import { runWithAuthContextAsync } from "../../../dist/utils/requestContext.js";
import { getDeliverableIntelligenceAnalysis } from "../../../dist/services/intelligence/orchestration/intelligenceOrchestrator.service.js";
import {
  generateDeliverableExplanation,
  validateDeliverableExplanation,
} from "../../../dist/services/explanation/explanation.service.js";
import { getAiExplanationConfig } from "../../../dist/services/explanation/explanationConfig.js";
import { readOpenAiApiKey } from "../../../dist/services/integrations/openai/openaiLlmProvider.js";
import { containsInternalIdentifiers } from "../../../dist/services/explanation/prompt/explanationPromptSanitizer.js";

const results = { passed: [], failed: [], warnings: [] };

function pass(name, detail = "") {
  results.passed.push({ name, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail = "") {
  results.failed.push({ name, detail });
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function warn(name, detail = "") {
  results.warnings.push({ name, detail });
  console.warn(`! ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("\n=== Rana4 E2E Intelligence + Explanation Validation ===\n");

  const config = getAiExplanationConfig();
  pass("AI explanation config loads", `provider=${config.provider}, enabled=${config.enabled}, model=${config.model}`);
  if (readOpenAiApiKey()) pass("OPENAI_API_KEY present (server-side only)");
  else warn("OPENAI_API_KEY not set — live explanations will not run");

  const bootstrapCtx = { userId: "bootstrap", companyId: "bootstrap" };
  const seedUser = await runWithAuthContextAsync(bootstrapCtx, async () =>
    prisma.user.findFirst({ orderBy: { id: "desc" }, select: { companyId: true } })
  );

  if (!seedUser?.companyId) {
    fail("Find company for intelligence test", "No users/companies in database");
    printSummary();
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const companyCtx = { userId: "e2e", companyId: seedUser.companyId };
  const deliverable = await runWithAuthContextAsync(companyCtx, async () =>
    prisma.deliverable.findFirst({
      orderBy: { createdAt: "desc" },
    })
  );

  if (!deliverable?.projectId) {
    fail("Find deliverable for intelligence test", "No deliverables in database");
    printSummary();
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const ctx = { userId: "e2e", companyId: deliverable.companyId };
  const base = {
    projectId: deliverable.projectId,
    companyId: deliverable.companyId,
    deliverableId: deliverable.id,
  };

  pass("Database reachable", `deliverable=${deliverable.name}`);
  let analysis;
  try {
    analysis = await runWithAuthContextAsync(ctx, async () => getDeliverableIntelligenceAnalysis(base));
    pass("Deliverable intelligence analysis (single orchestration)", [
      `observations=${analysis.observations.length}`,
      `keyFactors=${analysis.keyFactors.length}`,
      `recommendations=${analysis.recommendations.length}`,
      `benchmark=${analysis.benchmark ? "yes" : "no"}`,
      `trust=${analysis.trust ? "yes" : "no"}`,
    ].join(", "));
  } catch (err) {
    fail("Deliverable intelligence analysis", err instanceof Error ? err.message : String(err));
  }

  const explanationTypes = [
    "DELIVERABLE_SUMMARY",
    "BENCHMARK",
    "PREDICTED_OUTCOME",
    "RECOMMENDATION",
    "TRUST_SCORE",
    "FLAGGED_DELIVERABLE",
  ];

  for (const explanationType of explanationTypes) {
    try {
      const { validation } = await runWithAuthContextAsync(ctx, async () =>
        validateDeliverableExplanation({ ...base, explanationType })
      );
      pass(`Validation ${explanationType}`, `readiness=${validation.readiness}, score=${validation.score}`);

      const result = await runWithAuthContextAsync(ctx, async () =>
        generateDeliverableExplanation({ ...base, explanationType, question: null })
      );

      if (validation.readiness === "NOT_READY") {
        if (result.providerCalled) {
          fail(`NOT_READY bypass ${explanationType}`, "provider was called");
        } else {
          pass(`NOT_READY bypass ${explanationType}`, "provider not called");
        }
        if (result.status === "not_ready" && result.explanation) {
          pass(`NOT_READY message ${explanationType}`);
        }
        continue;
      }

      if (!result.providerCalled) {
        fail(`Provider invocation ${explanationType}`, "expected provider call");
        continue;
      }

      if (result.citations.length > 0 && result.supportingEvidence.length > 0) {
        pass(`Citations preserved ${explanationType}`, `citations=${result.citations.length}`);
      } else {
        warn(`Citations sparse ${explanationType}`);
      }

      if (config.enabled && config.provider === "openai" && readOpenAiApiKey()) {
        if (result.status === "success" && result.explanation) {
          pass(`Live explanation ${explanationType}`, `${result.explanation.length} chars`);
        } else {
          warn(`Live explanation ${explanationType}`, `status=${result.status}`);
        }
      } else if (result.status === "disabled" || result.status === "mock" || result.status === "provider_not_configured") {
        warn(`Explanation ${explanationType}`, `status=${result.status} (config)`);
      }

      const prompt = result.generatedPrompt?.user ?? "";
      if (containsInternalIdentifiers(prompt)) {
        warn(`Prompt hygiene ${explanationType}`, "prompt may contain internal IDs or technical metadata");
      } else {
        pass(`Prompt hygiene ${explanationType}`, "planner-readable briefing only");
      }
    } catch (err) {
      fail(`Explanation flow ${explanationType}`, err instanceof Error ? err.message : String(err));
    }
  }

  printSummary();
  process.exitCode = results.failed.length > 0 ? 1 : 0;
  await prisma.$disconnect();
}

function printSummary() {
  console.log("\n--- Summary ---");
  console.log(`Passed: ${results.passed.length}`);
  console.log(`Failed: ${results.failed.length}`);
  console.log(`Warnings: ${results.warnings.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
