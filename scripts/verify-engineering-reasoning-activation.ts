/**
 * Phase-1 Engineering Reasoning activation harness (spec §6).
 *
 * Runs Brain diagnostics twice against the same company data:
 *   1. forceRuleBased (today's behaviour)
 *   2. reasoning enabled (AI_ENGINEERING_REASONING_ENABLED=true)
 *
 * Reports GET-Milestones differentiation, consistency probes, and real
 * cost/latency from OpenAI usage telemetry.
 *
 *   npx tsx scripts/verify-engineering-reasoning-activation.ts [companyId]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  computeEngineeringBrainDiagnostics,
  DEFAULT_CONSISTENCY_PROBES,
  loadObservedDeliverablesForCompany,
} from "../src/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";
import { loadEngineeringKnowledge, isEngineeringKnowledgeStoreAvailable } from "../src/services/intelligence/diagnostics/engineeringKnowledgeStore.service.js";
import { clearEngineeringReasoningCache, getEngineeringReasoningConfig } from "../src/services/intelligence/taxonomy/engineeringReasoning.service.js";
import {
  clearEngineeringReasoningTelemetry,
  getRecentEngineeringReasoningEvents,
  summarizeEngineeringReasoningEvents,
} from "../src/services/intelligence/taxonomy/engineeringReasoningTelemetry.js";
import type { EngineeringBrainDiagnosticsReport } from "../src/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";

const prisma = new PrismaClient();

const GET_MILESTONES_NAMES = [
  "Enabling Works",
  "Architectural Setting Out",
  "BWIC",
  "Equipment Specifications",
  "GI",
  "Drainage",
];

/** Approximate USD per 1M tokens — update if model pricing changes. */
const MODEL_COST_PER_MILLION = {
  input: 2.5,
  output: 10.0,
};

type IdentityTriple = {
  discipline: string | null;
  engineeringObject: string | null;
  engineeringWork: string | null;
};

function identityLabel(identity: IdentityTriple): string {
  return `${identity.discipline ?? "?"}/${identity.engineeringObject ?? "?"}/${identity.engineeringWork ?? "?"}`;
}

function allVisibleEntries(report: EngineeringBrainDiagnosticsReport) {
  return [
    ...report.collections.needsReview,
    ...report.collections.autoApproved,
    ...report.collections.developerApproved,
    ...report.collections.developerModified,
  ];
}

function findIdentityForDeliverableName(
  report: EngineeringBrainDiagnosticsReport,
  deliverableName: string
): { label: string; fingerprint: string; state: string; source: string } | null {
  const needle = deliverableName.trim().toLowerCase();
  for (const item of allVisibleEntries(report)) {
    const names = new Set<string>();
    if ("exampleDeliverableName" in item && item.exampleDeliverableName) {
      names.add(item.exampleDeliverableName.toLowerCase());
    }
    for (const example of item.examples ?? []) {
      if (example.deliverableName) names.add(example.deliverableName.toLowerCase());
    }
    if (item.concept) names.add(item.concept.toLowerCase());
    if (!names.has(needle) && ![...names].some((n) => n.includes(needle))) continue;
    return {
      label: identityLabel(item.identity),
      fingerprint: item.fingerprint,
      state: "state" in item ? String(item.state) : String(item.status),
      source: "collections",
    };
  }

  const sample = report.sampleIdentities.find((s) => s.deliverableName.toLowerCase() === needle);
  if (sample) {
    return {
      label: identityLabel(sample.identity),
      fingerprint: sample.deliverableKey,
      state: sample.identity.status,
      source: "sampleIdentities (rule-based row — may not reflect reasoned inbox)",
    };
  }
  return null;
}

function stableReport(report: EngineeringBrainDiagnosticsReport) {
  const copy = structuredClone(report);
  delete (copy as { generatedAt?: string }).generatedAt;
  delete (copy as { recentReasoningEvents?: unknown }).recentReasoningEvents;
  for (const sample of copy.sampleIdentities ?? []) {
    delete (sample as { timestamp?: string }).timestamp;
    delete (sample as { reasoningDurationMs?: number }).reasoningDurationMs;
  }
  return copy;
}

async function resolveCompanyId(argvCompanyId?: string): Promise<string> {
  if (argvCompanyId?.trim()) return argvCompanyId.trim();
  if (process.env.VERIFY_COMPANY_ID?.trim()) return process.env.VERIFY_COMPANY_ID.trim();

  const row = await prisma.programmeSnapshot.groupBy({
    by: ["companyId"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });
  if (row[0]?.companyId) return row[0].companyId;

  throw new Error("No company with programme snapshots found — pass companyId as argv or set VERIFY_COMPANY_ID");
}

async function runDiagnostics(
  observed: Awaited<ReturnType<typeof loadObservedDeliverablesForCompany>>,
  companyId: string,
  options: { forceRuleBased?: boolean }
) {
  clearEngineeringReasoningCache();
  clearEngineeringReasoningTelemetry();
  const decisions = await loadEngineeringKnowledge(companyId);
  const startedAt = Date.now();
  const report = await computeEngineeringBrainDiagnostics(
    observed,
    DEFAULT_CONSISTENCY_PROBES,
    decisions,
    isEngineeringKnowledgeStoreAvailable(),
    options
  );
  const wallMs = Date.now() - startedAt;
  const events = getRecentEngineeringReasoningEvents(500);
  const telemetry = summarizeEngineeringReasoningEvents(events);
  return { report, wallMs, events, telemetry };
}

function estimateCostUsd(promptTokens: number, completionTokens: number): number {
  return (
    (promptTokens / 1_000_000) * MODEL_COST_PER_MILLION.input +
    (completionTokens / 1_000_000) * MODEL_COST_PER_MILLION.output
  );
}

async function main() {
  const companyId = await resolveCompanyId(process.argv[2]);
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true },
  });
  console.log(`Company: ${company?.name ?? "?"} (${companyId})`);

  const reasoningConfig = getEngineeringReasoningConfig();
  console.log(`Reasoning config: enabled=${reasoningConfig.enabled} model=${reasoningConfig.model}`);

  const observed = await loadObservedDeliverablesForCompany({ companyId });
  console.log(`Observed deliverables loaded: ${observed.length}`);

  const getMilestoneObserved = observed.filter((o) =>
    GET_MILESTONES_NAMES.some((name) => o.name.toLowerCase().includes(name.toLowerCase()))
  );
  console.log(`GET-Milestones-related observed rows: ${getMilestoneObserved.length}`);
  for (const row of getMilestoneObserved.slice(0, 12)) {
    console.log(`  - ${row.name} (${row.fragnetName ?? "no fragnet"}) activities=${row.relatedActivityNames?.length ?? 0}`);
  }

  console.log("\n=== Run 1: forceRuleBased (baseline) ===");
  const baseline = await runDiagnostics(observed, companyId, { forceRuleBased: true });
  console.log(`Wall time: ${baseline.wallMs}ms`);
  console.log(`Brain inbox: ${baseline.report.summary.brainInbox}, trusted: ${baseline.report.summary.trustedKnowledge}`);
  console.log(`Reasoning telemetry calls: ${baseline.telemetry.totalCalls} (expect 0)`);

  console.log("\n=== Run 2: reasoning enabled ===");
  const previousFlag = process.env.AI_ENGINEERING_REASONING_ENABLED;
  process.env.AI_ENGINEERING_REASONING_ENABLED = "true";
  let reasoned;
  try {
    reasoned = await runDiagnostics(observed, companyId, {});
  } finally {
    if (previousFlag === undefined) delete process.env.AI_ENGINEERING_REASONING_ENABLED;
    else process.env.AI_ENGINEERING_REASONING_ENABLED = previousFlag;
  }
  console.log(`Wall time: ${reasoned.wallMs}ms`);
  console.log(`Brain inbox: ${reasoned.report.summary.brainInbox}, trusted: ${reasoned.report.summary.trustedKnowledge}`);
  console.log(`Reasoning telemetry: ${JSON.stringify(reasoned.telemetry, null, 2)}`);
  const costUsd = estimateCostUsd(reasoned.telemetry.promptTokens, reasoned.telemetry.completionTokens);
  console.log(
    `Approx token cost (${reasoningConfig.model}, $${MODEL_COST_PER_MILLION.input}/M in + $${MODEL_COST_PER_MILLION.output}/M out): $${costUsd.toFixed(4)} USD`
  );

  console.log("\n=== Kill switch check (env false vs forceRuleBased) ===");
  process.env.AI_ENGINEERING_REASONING_ENABLED = "false";
  clearEngineeringReasoningCache();
  clearEngineeringReasoningTelemetry();
  const decisions = await loadEngineeringKnowledge(companyId);
  const killSwitchReport = await computeEngineeringBrainDiagnostics(
    observed,
    DEFAULT_CONSISTENCY_PROBES,
    decisions,
    isEngineeringKnowledgeStoreAvailable()
  );
  if (previousFlag === undefined) delete process.env.AI_ENGINEERING_REASONING_ENABLED;
  else process.env.AI_ENGINEERING_REASONING_ENABLED = previousFlag;

  const baselineStable = stableReport(baseline.report);
  const killStable = stableReport(killSwitchReport);
  const killMatch = JSON.stringify(baselineStable) === JSON.stringify(killStable);
  console.log(killMatch ? "PASS — kill switch output matches forceRuleBased baseline" : "FAIL — kill switch output differs from baseline");

  console.log("\n=== GET-Milestones cluster — identity before vs after ===");
  const labelsBefore = new Map<string, string>();
  const labelsAfter = new Map<string, string>();
  for (const name of GET_MILESTONES_NAMES) {
    const before = findIdentityForDeliverableName(baseline.report, name);
    const after = findIdentityForDeliverableName(reasoned.report, name);
    if (before) labelsBefore.set(name, before.label);
    if (after) labelsAfter.set(name, after.label);
    const changed = before?.label !== after?.label ? "CHANGED" : "same";
    console.log(
      `${name}: before=${before?.label ?? "(not found)"} after=${after?.label ?? "(not found)"} [${changed}]`
    );
  }
  const distinctBefore = new Set(labelsBefore.values()).size;
  const distinctAfter = new Set(labelsAfter.values()).size;
  console.log(`Distinct identity labels: before=${distinctBefore}, after=${distinctAfter} (found ${labelsBefore.size}/${GET_MILESTONES_NAMES.length} names)`);

  console.log("\n=== DEFAULT_CONSISTENCY_PROBES — before vs after ===");
  let probeRegressions = 0;
  for (const probe of DEFAULT_CONSISTENCY_PROBES) {
    const beforeProbe = baseline.report.consistency.probes.find((p) => p.concept === probe.concept);
    const afterProbe = reasoned.report.consistency.probes.find((p) => p.concept === probe.concept);
    const ok =
      beforeProbe?.verdict === "CONSISTENT" &&
      afterProbe?.verdict === "CONSISTENT" &&
      beforeProbe.resolvedSignatures.join("|") === afterProbe?.resolvedSignatures.join("|");
    if (!ok) probeRegressions += 1;
    console.log(
      `${probe.concept}: before=${beforeProbe?.verdict}/${beforeProbe?.resolvedSignatures[0] ?? "?"} after=${afterProbe?.verdict}/${afterProbe?.resolvedSignatures[0] ?? "?"} ${ok ? "OK" : "REGRESSION"}`
    );
  }

  console.log("\n=== Inbox diff (fingerprints whose identity changed) ===");
  const baselineByFp = new Map(
    allVisibleEntries(baseline.report).map((item) => [item.fingerprint, identityLabel(item.identity)])
  );
  let inboxIdentityChanges = 0;
  for (const item of allVisibleEntries(reasoned.report)) {
    const beforeLabel = baselineByFp.get(item.fingerprint);
    const afterLabel = identityLabel(item.identity);
    if (beforeLabel && beforeLabel !== afterLabel) {
      inboxIdentityChanges += 1;
      console.log(`  ${item.concept}: ${beforeLabel} → ${afterLabel}`);
    }
  }
  if (inboxIdentityChanges === 0) console.log("  (none — reasoning did not change any visible fingerprint identity)");

  console.log("\n=== Summary ===");
  console.log({
    observedCount: observed.length,
    baselineWallMs: baseline.wallMs,
    reasonedWallMs: reasoned.wallMs,
    llmCalls: reasoned.telemetry.llmCalls,
    ruleBasedFallbacks: reasoned.telemetry.ruleBasedCalls,
    totalReasoningDurationMs: reasoned.telemetry.totalDurationMs,
    promptTokens: reasoned.telemetry.promptTokens,
    completionTokens: reasoned.telemetry.completionTokens,
    totalTokens: reasoned.telemetry.totalTokens,
    approxCostUsd: Number(costUsd.toFixed(4)),
    getMilestonesDistinctBefore: distinctBefore,
    getMilestonesDistinctAfter: distinctAfter,
    probeRegressions,
    inboxIdentityChanges,
    killSwitchMatch: killMatch,
  });

  const ok = killMatch && probeRegressions === 0;
  process.exit(ok ? 0 : 1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
