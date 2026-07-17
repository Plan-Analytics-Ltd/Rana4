/**
 * Phase 2 capture-time reasoning verification.
 *
 * Captures a small throwaway snapshot with GET-Milestones deliverables,
 * reports real LLM cost/latency, then captures again with the kill switch
 * and confirms reasoned columns stay null. Deletes both snapshots afterward.
 *
 *   npx tsx scripts/verify-engineering-reasoning-phase2-capture.ts [projectId]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { captureProgrammeSnapshot } from "../src/services/intelligence/shared/programmeSnapshotCapture.service.js";

const prisma = new PrismaClient();

const MODEL_COST_PER_MILLION = { input: 2.5, output: 10.0 };

const GET_MILESTONES = [
  {
    name: "Enabling Works",
    activities: ["Confirm enabling works receipt"],
  },
  {
    name: "Architectural Setting Out",
    activities: ["Confirm architectural setting out", "Issue setting out drawing"],
  },
  {
    name: "BWIC",
    activities: ["Confirm BWIC receipt", "Coordinate BWIC openings", "Issue BWIC schedule"],
  },
  {
    name: "Equipment Specifications",
    activities: ["Confirm equipment specifications receipt"],
  },
  {
    name: "GI",
    activities: ["Confirm GI receipt"],
  },
  {
    name: "Drainage",
    activities: ["Confirm drainage receipt", "Coordinate drainage connections"],
  },
];

function emptyMatch() {
  return {
    matchedActivities: 0,
    unmatchedActivityCodes: [] as string[],
    matchedDeliverables: 0,
    unmatchedDeliverableNames: [] as string[],
    matchedRelationships: 0,
    unmatchedRelationships: 0,
  };
}

async function resolveProject(argvProjectId?: string) {
  if (argvProjectId?.trim()) {
    const project = await prisma.project.findFirst({
      where: { id: argvProjectId.trim() },
      select: { id: true, name: true, companyId: true },
    });
    if (!project) throw new Error(`Project not found: ${argvProjectId}`);
    return project;
  }
  const withSnapshots = await prisma.programmeSnapshot.groupBy({
    by: ["projectId"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });
  const projectId = withSnapshots[0]?.projectId;
  if (!projectId) throw new Error("No project with snapshots found");
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: { id: true, name: true, companyId: true },
  });
  if (!project) throw new Error("Project lookup failed");
  return project;
}

function buildRows() {
  const deliverables = GET_MILESTONES.map((item, index) => ({
    name: item.name,
    deliverableId: `phase2-verify-d-${index}`,
    classificationTags: {},
  }));
  const activities = GET_MILESTONES.flatMap((item, dIndex) =>
    item.activities.map((name, aIndex) => ({
      activityCode: `P2V-${dIndex}-${aIndex}`,
      name,
      deliverableId: `phase2-verify-d-${dIndex}`,
      originalDurationDays: 1 + aIndex,
      classificationTags: {},
    }))
  );
  return { deliverables, activities };
}

async function main() {
  const project = await resolveProject(process.argv[2]);
  console.log(`Project: ${project.name} (${project.id}) company=${project.companyId}`);

  const { deliverables, activities } = buildRows();
  const snapshotIds: string[] = [];

  console.log("\n=== Capture 1: AI_ENGINEERING_REASONING_ENABLED=true ===");
  const previous = process.env.AI_ENGINEERING_REASONING_ENABLED;
  process.env.AI_ENGINEERING_REASONING_ENABLED = "true";
  const t0 = Date.now();
  let reasonedCapture;
  try {
    reasonedCapture = await captureProgrammeSnapshot({
      projectId: project.id,
      companyId: project.companyId,
      sourceType: "XER_IMPORT",
      snapshotRole: "BASELINE",
      label: "Phase2 reasoning verify (reasoned)",
      activities,
      deliverables,
      relationships: [],
      matchResult: emptyMatch(),
      importSummary: { phase2Verify: true },
    });
  } finally {
    if (previous === undefined) delete process.env.AI_ENGINEERING_REASONING_ENABLED;
    else process.env.AI_ENGINEERING_REASONING_ENABLED = previous;
  }
  const wallMs = Date.now() - t0;
  snapshotIds.push(reasonedCapture.snapshotId);
  console.log(`snapshotId=${reasonedCapture.snapshotId}`);
  console.log(`wallMs=${wallMs}`);
  console.log("reasoningSummary=", JSON.stringify(reasonedCapture.reasoningSummary, null, 2));

  const rows = await prisma.deliverableSnapshot.findMany({
    where: { snapshotId: reasonedCapture.snapshotId },
    select: {
      name: true,
      reasonedDiscipline: true,
      reasonedEngineeringObject: true,
      reasonedEngineeringWork: true,
      reasonedDeliverableType: true,
      reasonedLifecycleStage: true,
      reasoningSource: true,
      reasoningComputedAt: true,
    },
    orderBy: { name: "asc" },
  });
  console.log("\nStored reasoned identities:");
  for (const row of rows) {
    console.log(
      `  ${row.name}: ${row.reasonedDiscipline ?? "?"}/${row.reasonedEngineeringObject ?? "?"}/${row.reasonedEngineeringWork ?? "?"} source=${row.reasoningSource ?? "null"}`
    );
  }
  const storedCount = rows.filter((r) => r.reasoningSource != null).length;
  const rs = reasonedCapture.reasoningSummary;
  const costUsd = rs
    ? (rs.promptTokens / 1_000_000) * MODEL_COST_PER_MILLION.input +
      (rs.completionTokens / 1_000_000) * MODEL_COST_PER_MILLION.output
    : 0;
  console.log(
    `\nApprox token cost: $${costUsd.toFixed(4)} USD (prompt=${rs?.promptTokens ?? 0}, completion=${rs?.completionTokens ?? 0})`
  );

  console.log("\n=== Capture 2: forceRuleBased / kill switch ===");
  process.env.AI_ENGINEERING_REASONING_ENABLED = "false";
  const killCapture = await captureProgrammeSnapshot({
    projectId: project.id,
    companyId: project.companyId,
    sourceType: "XER_IMPORT",
    snapshotRole: "BASELINE",
    label: "Phase2 reasoning verify (kill switch)",
    activities,
    deliverables,
    relationships: [],
    matchResult: emptyMatch(),
    importSummary: { phase2Verify: true },
    forceRuleBasedReasoning: true,
  });
  if (previous === undefined) delete process.env.AI_ENGINEERING_REASONING_ENABLED;
  else process.env.AI_ENGINEERING_REASONING_ENABLED = previous;
  snapshotIds.push(killCapture.snapshotId);
  const killRows = await prisma.deliverableSnapshot.findMany({
    where: { snapshotId: killCapture.snapshotId },
    select: {
      name: true,
      reasoningSource: true,
      reasonedDiscipline: true,
      reasonedEngineeringObject: true,
      reasonedEngineeringWork: true,
    },
  });
  const killAllNull = killRows.every(
    (r) =>
      r.reasoningSource == null &&
      r.reasonedDiscipline == null &&
      r.reasonedEngineeringObject == null &&
      r.reasonedEngineeringWork == null
  );
  console.log(
    killAllNull
      ? `PASS — kill switch left all ${killRows.length} reasoned columns null`
      : `FAIL — kill switch still populated reasoned columns`
  );
  console.log("killSwitch reasoningSummary=", killCapture.reasoningSummary ?? null);

  const distinctReasoned = new Set(
    rows
      .filter((r) => r.reasoningSource != null)
      .map(
        (r) =>
          `${r.reasonedDiscipline ?? "?"}/${r.reasonedEngineeringObject ?? "?"}/${r.reasonedEngineeringWork ?? "?"}`
      )
  );

  console.log("\n=== Summary ===");
  console.log({
    deliverableCount: rows.length,
    storedReasonedRows: storedCount,
    distinctReasonedIdentities: distinctReasoned.size,
    llmCalls: rs?.llmCalls ?? 0,
    ruleBasedFallbacks: rs?.ruleBasedFallbacks ?? 0,
    wallMs,
    promptTokens: rs?.promptTokens ?? 0,
    completionTokens: rs?.completionTokens ?? 0,
    totalTokens: rs?.totalTokens ?? 0,
    approxCostUsd: Number(costUsd.toFixed(4)),
    budgetExceeded: rs?.budgetExceeded ?? false,
    killSwitchAllNull: killAllNull,
  });

  console.log("\nCleaning up verify snapshots...");
  await prisma.programmeSnapshot.deleteMany({ where: { id: { in: snapshotIds } } });
  console.log(`Deleted ${snapshotIds.length} snapshot(s).`);

  process.exit(killAllNull && (rs?.llmCalls ?? 0) > 0 ? 0 : storedCount === 0 && !killAllNull ? 1 : killAllNull ? 0 : 1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
