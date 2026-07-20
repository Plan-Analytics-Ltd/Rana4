/**
 * Phase 9.3 — read-only matching diagnostics (no source changes).
 * Usage: node scripts/phase-9-3-diagnostics.mjs
 */
import { PrismaClient } from "@prisma/client";
import { getSimilarDeliverables } from "../dist/services/intelligence/shared/similarity.service.js";
import { selectBenchmarkEvidence } from "../dist/services/intelligence/matching/evidenceSelection.service.js";
import { deduplicateBenchmarkSamples } from "../dist/services/intelligence/matching/revisionGrouping.service.js";
import { DEFAULT_MIN_COMPARABLE_SIMILARITY, DELIVERABLE_SIMILARITY_WEIGHTS } from "../dist/services/intelligence/matching/similarityWeights.config.js";
import { ALLOWED_SNAPSHOT_STATES } from "../dist/services/intelligence/shared/intelligenceConstants.js";
import { diffDaysFromIso } from "../dist/services/intelligence/shared/intelligenceMath.js";

const prisma = new PrismaClient();
const projectId = "cmr1ztdj50001sybs8jbn4qf4";
const companyId = "cmo8dvlc10000syx0861h1zr5";
const THRESHOLD = DEFAULT_MIN_COMPARABLE_SIMILARITY;
const W = DELIVERABLE_SIMILARITY_WEIGHTS;

const CASES = [
  { name: "Reinforcement Detailing", duration: 10 },
  { name: "Model/Drawing Development", duration: 10 },
];

function weightedScore(signals) {
  if (!signals) return null;
  const score01 =
    ((signals.semantic ?? 0) * W.semantic +
      (signals.wbsContext ?? 0) * W.wbsContext +
      (signals.activityComposition ?? 0) * W.activityComposition +
      (signals.durationBehaviour ?? 0) * W.durationBehaviour +
      (signals.programmeStage ?? 0) * W.programmeStage) /
    100;
  return Math.round(score01 * 1000) / 10;
}

function band(score) {
  if (score >= 90) return "90–100%";
  if (score >= 80) return "80–90%";
  if (score >= 70) return "70–80%";
  if (score >= 60) return "60–70%";
  if (score >= 50) return "50–60%";
  if (score >= 40) return "40–50%";
  if (score >= 30) return "30–40%";
  return "Below 30%";
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function revisionPriority(state) {
  if (state === "FINAL_AS_BUILT") return 5;
  if (state === "AS_BUILT") return 4;
  if (state === "APPROVED_BASELINE") return 3;
  if (state === "LIVE_UPDATE") return 2;
  if (state === "BASELINE") return 1;
  return 0;
}

function dedupKey(c) {
  return `${c.projectId}\x1d${c.deliverableId ?? c.fingerprintKey}`;
}

async function buildPipeline(deliverableId, baseClassification) {
  const sim = await getSimilarDeliverables({
    projectId,
    companyId,
    deliverableId,
    limit: 200,
    allowedProgrammeStates: ALLOWED_SNAPSHOT_STATES,
  });

  let classificationMismatch = 0;
  const gated = sim.matches.filter((m) => {
    const hist = m.classification ?? null;
    if (baseClassification && hist) {
      if (String(baseClassification) === String(hist)) return true;
      classificationMismatch += 1;
      return false;
    }
    return true;
  });

  let missingDates = 0;
  const rawCandidates = gated
    .map((m) => {
      const e = m.evidence ?? {};
      const durationActual = diffDaysFromIso(e.actualStart ?? null, e.actualFinish ?? null);
      const durationPlanned = diffDaysFromIso(e.plannedStart ?? null, e.plannedFinish ?? null);
      const durationDays = durationActual ?? durationPlanned;
      if (durationDays == null || !Number.isFinite(durationDays) || durationDays < 0) {
        missingDates += 1;
        return null;
      }
      return {
        snapshotId: m.snapshotId ?? e.snapshotId ?? "",
        projectId: e.projectId ?? "",
        projectName: e.projectName ?? "Unknown",
        deliverableId: m.deliverableId,
        deliverableName: m.deliverableName,
        classification: m.classification,
        programmeState: e.programmeState ?? null,
        durationDays,
        similarityScore: m.similarityScore,
        fingerprintKey: m.fingerprintKey ?? "",
        similaritySignals: m.similaritySignals ?? {},
        importedAt: m.importedAt ? new Date(m.importedAt) : new Date(0),
      };
    })
    .filter(Boolean);

  const selection = selectBenchmarkEvidence(rawCandidates, {
    minSimilarity: THRESHOLD,
    deduplicateForStats: true,
  });

  const dedupedIds = new Set(
    selection.deduplicated.map((d) => `${d.projectId}\x1d${d.snapshotId}`)
  );

  const selectedKeys = new Map();
  for (const s of selection.selected) {
    const k = dedupKey(s);
    const existing = selectedKeys.get(k);
    if (!existing) {
      selectedKeys.set(k, s);
      continue;
    }
    const pick =
      revisionPriority(s.programmeState) > revisionPriority(existing.programmeState)
        ? s
        : revisionPriority(s.programmeState) === revisionPriority(existing.programmeState) &&
            s.importedAt.getTime() > existing.importedAt.getTime()
          ? s
          : existing;
    selectedKeys.set(k, pick);
  }

  const dedupRemovals = [];
  for (const s of selection.selected) {
    const k = dedupKey(s);
    const winner = selectedKeys.get(k);
    const inFinal = dedupedIds.has(`${s.projectId}\x1d${s.snapshotId}`);
    if (!inFinal) {
      dedupRemovals.push({
        deliverable: s.deliverableName,
        revision: `${s.programmeState} (${s.snapshotId.slice(0, 8)}…)`,
        historicalDurationDays: s.durationDays,
        similarityScore: s.similarityScore,
        replacedBy: winner
          ? {
              deliverable: winner.deliverableName,
              revision: `${winner.programmeState} (${winner.snapshotId.slice(0, 8)}…)`,
              similarityScore: winner.similarityScore,
            }
          : null,
        reason:
          winner && winner.snapshotId !== s.snapshotId
            ? `Same project+deliverable key; kept revision with higher programme-state priority or later import`
            : "Not selected as primary revision",
        selectionRule:
          "deduplicateBenchmarkSamples: one per projectId+deliverableId (or fingerprintKey); prefer FINAL_AS_BUILT > AS_BUILT > APPROVED_BASELINE > LIVE_UPDATE > BASELINE, then latest importedAt",
        dedupKey: k,
      });
    }
  }

  const rankedRows = selection.ranked.map((c, idx) => {
    const sig = c.similaritySignals ?? {};
    const passes = c.similarityScore >= THRESHOLD;
    const inDedup = dedupedIds.has(`${c.projectId}\x1d${c.snapshotId}`);
    let exclusionReason = "—";
    if (!passes) exclusionReason = `Below ${THRESHOLD}% similarity threshold`;
    else if (!inDedup) exclusionReason = "Passed threshold but removed by revision deduplication";
    else exclusionReason = "Retained for benchmark";

    return {
      rank: idx + 1,
      historicalProject: c.projectName,
      historicalDeliverable: c.deliverableName,
      snapshotRevision: `${c.programmeState ?? "unknown"} / ${c.snapshotId}`,
      historicalDurationDays: c.durationDays,
      similarityScore: c.similarityScore,
      semantic: sig.semantic != null ? Math.round(sig.semantic * 1000) / 1000 : null,
      wbs: sig.wbsContext != null ? Math.round(sig.wbsContext * 1000) / 1000 : null,
      activity: sig.activityComposition != null ? Math.round(sig.activityComposition * 1000) / 1000 : null,
      duration: sig.durationBehaviour != null ? Math.round(sig.durationBehaviour * 1000) / 1000 : null,
      stage: sig.programmeStage != null ? Math.round(sig.programmeStage * 1000) / 1000 : null,
      weightedRecomputed: weightedScore(sig),
      passesThreshold: passes ? "yes" : "no",
      removedByDedup: passes && !inDedup ? "yes" : "no",
      exclusionReason,
    };
  });

  const scores = selection.ranked.map((c) => c.similarityScore);
  const histogram = {};
  for (const b of ["90–100%", "80–90%", "70–80%", "60–70%", "50–60%", "40–50%", "30–40%", "Below 30%"]) {
    histogram[b] = 0;
  }
  for (const s of scores) histogram[band(s)] += 1;

  return {
    funnel: {
      similarityScoredMatches: sim.matches.length,
      afterClassification: gated.length,
      classificationMismatchExcluded: classificationMismatch,
      missingDatesExcluded: missingDates,
      beforeThresholdCutoff: rawCandidates.length,
      passedThreshold: selection.selected.length,
      afterRevisionDedup: selection.deduplicated.length,
      belowThresholdExcluded: selection.excludedLowSimilarity,
    },
    top20BeforeThreshold: rankedRows.slice(0, 20),
    distribution: {
      histogram,
      highest: scores.length ? Math.max(...scores) : null,
      lowest: scores.length ? Math.min(...scores) : null,
      median: median(scores),
      mean: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      top10: [...scores].sort((a, b) => b - a).slice(0, 10),
      marginallyBelow70: scores.filter((s) => s >= 65 && s < 70).length,
      scores60to70: scores.filter((s) => s >= 60 && s < 70).length,
    },
    dedup: {
      before: selection.selected.length,
      after: selection.deduplicated.length,
      removals: dedupRemovals,
      uniqueDedupKeys: [...new Set(selection.selected.map(dedupKey))].length,
    },
  };
}

try {
  console.log("# Phase 9.3 Matching Diagnostics\n");
  console.log(`Project: Northvale Emergency Care Wing (${projectId})`);
  console.log(`Threshold: ${THRESHOLD}%`);
  console.log(`Weights: semantic ${W.semantic}%, wbs ${W.wbsContext}%, activity ${W.activityComposition}%, duration ${W.durationBehaviour}%, stage ${W.programmeStage}%\n`);

  for (const testCase of CASES) {
    const d = await prisma.deliverable.findFirst({
      where: {
        projectId,
        name: { equals: testCase.name, mode: "insensitive" },
        likelyDuration: testCase.duration,
      },
      select: { id: true, name: true, likelyDuration: true, classification: true },
    });

    if (!d) {
      console.log(`## ${testCase.name} (${testCase.duration}d) — NOT FOUND\n`);
      continue;
    }

    const report = await buildPipeline(d.id, d.classification);
    console.log(`## ${d.name} — ${d.likelyDuration} days (${d.id})\n`);
    console.log("### Funnel");
    console.log(JSON.stringify(report.funnel, null, 2));
    console.log("\n### Task 1 — Top 20 ranked BEFORE threshold (includes rejected)");
    console.log(JSON.stringify(report.top20BeforeThreshold, null, 2));
    console.log("\n### Task 2 — Similarity distribution (all pre-threshold candidates)");
    console.log(JSON.stringify(report.distribution, null, 2));
    console.log("\n### Task 4 — Revision dedup");
    console.log(JSON.stringify(report.dedup, null, 2));
    console.log("\n---\n");
  }
} finally {
  await prisma.$disconnect();
}
