/**
 * Phase 9.6 — real-world intelligence validation (READ ONLY).
 * No thresholds, weights, or benchmark logic are changed here.
 * Usage: node scripts/phase-9-6-validation.mjs
 */
import { PrismaClient } from "@prisma/client";
import { getDeliverableIntelligenceAnalysis } from "../dist/services/intelligence/orchestration/intelligenceOrchestrator.service.js";

const prisma = new PrismaClient();
const projectId = "cmr1ztdj50001sybs8jbn4qf4";
const companyId = "cmo8dvlc10000syx0861h1zr5";

const CASES = [
  { name: "Reinforcement Detailing", duration: 10 },
  { name: "Reinforcement Detailing", duration: 20 },
  { name: "Model/Drawing Development", duration: 10 },
  { name: "Additional Ground Investigation", duration: 30 },
];

function avg(nums) {
  const clean = nums.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (!clean.length) return null;
  return Math.round((clean.reduce((a, b) => a + b, 0) / clean.length) * 100) / 100;
}

function attentionFromStatus(status, sampleSize) {
  if (!status || sampleSize === 0) return "Limited Evidence";
  if (status === "NORMAL") return "Typical";
  if (status === "SLIGHTLY_HIGH" || status === "SLIGHTLY_LOW") return "Review Suggested";
  return "High Risk";
}

function positionBucket(position) {
  switch (position) {
    case "TYPICAL":
      return "Typical";
    case "SLIGHTLY_BELOW":
      return "Slightly Below";
    case "WELL_BELOW":
      return "Well Below";
    case "SLIGHTLY_ABOVE":
      return "Slightly Above";
    case "WELL_ABOVE":
      return "Well Above";
    default:
      return "Typical";
  }
}

async function reportDeliverable(deliverable) {
  const analysis = await getDeliverableIntelligenceAnalysis({
    projectId,
    companyId,
    deliverableId: deliverable.id,
  });

  const b = analysis.benchmark;
  const q = b.benchmarkQuality;
  const o = analysis.outlier;
  const matches = analysis.evidence.matchedDeliverables ?? [];

  const signalAverages = {
    semantic: avg(matches.map((m) => m.similaritySignals?.semantic)),
    wbsContext: avg(matches.map((m) => m.similaritySignals?.wbsContext)),
    activityComposition: avg(matches.map((m) => m.similaritySignals?.activityComposition)),
    durationBehaviour: avg(matches.map((m) => m.similaritySignals?.durationBehaviour)),
    programmeStage: avg(matches.map((m) => m.similaritySignals?.programmeStage)),
  };

  const top10 = [...matches]
    .sort((x, y) => y.similarityScore - x.similarityScore)
    .slice(0, 10)
    .map((m) => ({
      project: m.projectName,
      revision: m.programmeState,
      duration: m.durationDays,
      similarity: m.similarityScore,
    }));

  return {
    header: `${deliverable.name} (${deliverable.currentDuration}d)`,
    currentDuration: analysis.currentDurationDays,
    currentDurationSource: analysis.currentDurationSource?.source,
    sampleSize: b.sampleSize,
    retainedComparable: analysis.evidence.selectedCount,
    allRankedCount: analysis.evidence.allRankedCount,
    evidenceQuantity: q.evidenceQuantity,
    evidenceDiversity: q.evidenceDiversity,
    evidenceMaturity: q.evidenceMaturity,
    distinctProjects: q.distinctProjects,
    distinctSnapshots: q.distinctSnapshots,
    top10,
    signalAverages,
    benchmark: {
      median: b.medianDuration,
      p25: b.percentile25,
      p75: b.percentile75,
      iqr: b.interquartileRange,
      min: b.minimumDuration,
      max: b.maximumDuration,
      percentile: o.percentilePosition,
      rawPosition: o.rawPosition,
      effectivePosition: o.effectivePosition,
      status: o.status,
      confidenceLevel: b.confidenceLevel,
      confidenceScore: b.confidenceScore,
      notes: b.notes,
    },
    recommendations: (analysis.recommendations ?? []).map((r) => ({
      type: r.recommendationType,
      title: r.title,
      summary: r.summary,
      action: r.recommendation,
      severity: r.severity,
      confidence: r.confidenceLevel,
    })),
    observations: (analysis.observations ?? []).map((f) => ({
      type: f.findingType,
      title: f.title,
      summary: f.summary,
      severity: f.severity,
    })),
    consistency: analysis.consistency,
    trustLabel: analysis.trust?.trustLabel ?? null,
    attention: attentionFromStatus(o.status, b.sampleSize),
  };
}

async function main() {
  console.log("=".repeat(70));
  console.log("PHASE 9.6 — REAL-WORLD INTELLIGENCE VALIDATION (READ ONLY)");
  console.log("=".repeat(70));

  const targets = [];
  for (const c of CASES) {
    const del = await prisma.deliverable.findFirst({
      where: { projectId, companyId, name: c.name, likelyDuration: c.duration },
      select: { id: true, name: true, likelyDuration: true },
    });
    if (!del) {
      console.log(`\nSKIP: ${c.name} (${c.duration}d) not found`);
      continue;
    }
    targets.push({ id: del.id, name: del.name, currentDuration: del.likelyDuration });
  }

  // Random deliverable (deterministic: exclude the explicit cases, pick middle by id sort)
  const targetIds = new Set(targets.map((t) => t.id));
  const others = await prisma.deliverable.findMany({
    where: { projectId, companyId, id: { notIn: [...targetIds] } },
    select: { id: true, name: true, likelyDuration: true },
    orderBy: { id: "asc" },
  });
  if (others.length) {
    const pick = others[Math.floor(others.length / 2)];
    targets.push({ id: pick.id, name: pick.name, currentDuration: pick.likelyDuration, random: true });
  }

  const reports = [];
  for (const t of targets) {
    const r = await reportDeliverable(t);
    if (t.random) r.header = `[RANDOM] ${r.header}`;
    reports.push(r);
    console.log("\n" + "#".repeat(70));
    console.log("# " + r.header);
    console.log("#".repeat(70));
    console.log(JSON.stringify(r, null, 2));
  }

  // Project-level distribution across ALL deliverables
  console.log("\n" + "=".repeat(70));
  console.log("PROJECT-LEVEL DISTRIBUTION (all deliverables)");
  console.log("=".repeat(70));

  const allDeliverables = await prisma.deliverable.findMany({
    where: { projectId, companyId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const distribution = {
    Typical: 0,
    "Slightly Below": 0,
    "Well Below": 0,
    "Slightly Above": 0,
    "Well Above": 0,
    "Limited Evidence": 0,
    "Review Suggested": 0,
    "High Risk": 0,
  };
  const attentionDistribution = { Typical: 0, "Review Suggested": 0, "High Risk": 0, "Limited Evidence": 0 };

  let processed = 0;
  for (const del of allDeliverables) {
    try {
      const analysis = await getDeliverableIntelligenceAnalysis({ projectId, companyId, deliverableId: del.id });
      const sampleSize = analysis.benchmark.sampleSize;
      const attention = attentionFromStatus(analysis.outlier.status, sampleSize);
      attentionDistribution[attention] += 1;
      if (sampleSize === 0) {
        distribution["Limited Evidence"] += 1;
      } else {
        distribution[positionBucket(analysis.outlier.effectivePosition)] += 1;
      }
      processed += 1;
    } catch (err) {
      console.log(`  ! error on ${del.name}: ${err.message}`);
    }
  }

  console.log(`\nDeliverables processed: ${processed}/${allDeliverables.length}`);
  console.log("\nPosition distribution (effective):");
  console.log(JSON.stringify(distribution, null, 2));
  console.log("\nAttention distribution (planner surface):");
  console.log(JSON.stringify(attentionDistribution, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
