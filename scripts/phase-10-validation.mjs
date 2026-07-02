/**
 * Phase 10 — historical duration normalisation validation (READ ONLY analysis;
 * runs the repair backfill once to persist canonical durations, no code changes).
 * Usage: node scripts/phase-10-validation.mjs
 */
import { PrismaClient } from "@prisma/client";
import { repairCompanyHistoricalLearningEvidence } from "../dist/services/intelligence/learning/historicalLearningRepair.service.js";
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

function positionBucket(position) {
  switch (position) {
    case "TYPICAL": return "Typical";
    case "SLIGHTLY_BELOW": return "Slightly Below";
    case "WELL_BELOW": return "Well Below";
    case "SLIGHTLY_ABOVE": return "Slightly Above";
    case "WELL_ABOVE": return "Well Above";
    default: return "Typical";
  }
}

function attentionFromStatus(status, sampleSize) {
  if (!status || sampleSize === 0) return "Limited Evidence";
  if (status === "NORMAL") return "Typical";
  if (status === "SLIGHTLY_HIGH" || status === "SLIGHTLY_LOW") return "Review Suggested";
  return "High Risk";
}

async function reportOne(del) {
  const a = await getDeliverableIntelligenceAnalysis({ projectId, companyId, deliverableId: del.id });
  const b = a.benchmark;
  const o = a.outlier;
  const bases = {};
  for (const m of a.evidence.matchedDeliverables ?? []) {
    const snap = await prisma.deliverableSnapshot.findUnique({
      where: { id: m.snapshotId }, select: { durationBasis: true },
    }).catch(() => null);
    const key = snap?.durationBasis ?? "unknown";
    bases[key] = (bases[key] ?? 0) + 1;
  }
  console.log(`\n### ${del.name} (${del.currentDuration}d)${del.random ? " [RANDOM]" : ""}`);
  console.log(`  current duration:            ${a.currentDurationDays}d (${a.currentDurationSource?.source})`);
  console.log(`  historical duration basis:   ${JSON.stringify(bases)}`);
  console.log(`  sample size / retained:      ${b.sampleSize} / ${a.evidence.selectedCount}`);
  console.log(`  median:                      ${b.medianDuration}`);
  console.log(`  IQR (p25–p75):               ${b.interquartileRange} (${b.percentile25}–${b.percentile75})`);
  console.log(`  min / max:                   ${b.minimumDuration} / ${b.maximumDuration}`);
  console.log(`  percentile / raw / effective:${o.percentilePosition} / ${o.rawPosition} / ${o.effectivePosition}`);
  console.log(`  status / attention:          ${o.status} / ${attentionFromStatus(o.status, b.sampleSize)}`);
  console.log(`  confidence:                  ${b.confidenceLevel} (${b.confidenceScore})`);
  const dupSample = (a.evidence.matchedDeliverables ?? []).slice(0, 3).map((m) => m.durationDays);
  console.log(`  sample durations (first 3):  ${JSON.stringify(dupSample)}`);
}

async function main() {
  console.log("=".repeat(70));
  console.log("PHASE 10 — HISTORICAL DURATION NORMALISATION VALIDATION");
  console.log("=".repeat(70));

  console.log("\n-- Backfilling canonical work-package durations --");
  const repair = await repairCompanyHistoricalLearningEvidence(companyId);
  console.log(JSON.stringify(repair, null, 2));

  const targets = [];
  for (const c of CASES) {
    const del = await prisma.deliverable.findFirst({
      where: { projectId, companyId, name: c.name, likelyDuration: c.duration },
      select: { id: true, name: true, likelyDuration: true },
    });
    if (del) targets.push({ id: del.id, name: del.name, currentDuration: del.likelyDuration });
    else console.log(`SKIP ${c.name} (${c.duration}d)`);
  }
  const ids = new Set(targets.map((t) => t.id));
  const others = await prisma.deliverable.findMany({
    where: { projectId, companyId, id: { notIn: [...ids] } },
    select: { id: true, name: true, likelyDuration: true },
    orderBy: { id: "asc" },
  });
  if (others.length) {
    const pick = others[Math.floor(others.length / 2)];
    targets.push({ id: pick.id, name: pick.name, currentDuration: pick.likelyDuration, random: true });
  }

  for (const t of targets) await reportOne(t);

  console.log("\n" + "=".repeat(70));
  console.log("PROJECT-LEVEL DISTRIBUTION (all deliverables)");
  console.log("=".repeat(70));

  const all = await prisma.deliverable.findMany({
    where: { projectId, companyId }, select: { id: true }, orderBy: { name: "asc" },
  });
  const dist = { Typical: 0, "Slightly Below": 0, "Well Below": 0, "Slightly Above": 0, "Well Above": 0, "Limited Evidence": 0 };
  const attn = { Typical: 0, "Review Suggested": 0, "High Risk": 0, "Limited Evidence": 0 };
  let processed = 0;
  for (const d of all) {
    try {
      const a = await getDeliverableIntelligenceAnalysis({ projectId, companyId, deliverableId: d.id });
      const ss = a.benchmark.sampleSize;
      attn[attentionFromStatus(a.outlier.status, ss)] += 1;
      if (ss === 0) dist["Limited Evidence"] += 1;
      else dist[positionBucket(a.outlier.effectivePosition)] += 1;
      processed += 1;
    } catch (e) { console.log(`  ! ${d.id}: ${e.message}`); }
  }
  console.log(`\nProcessed ${processed}/${all.length}`);
  console.log("Position distribution (effective): " + JSON.stringify(dist, null, 2));
  console.log("Attention distribution:            " + JSON.stringify(attn, null, 2));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
