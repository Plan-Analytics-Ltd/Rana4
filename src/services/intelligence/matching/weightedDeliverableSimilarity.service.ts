import { DELIVERABLE_SIMILARITY_WEIGHTS } from "./similarityWeights.config.js";
import type { DeliverableFingerprint } from "./deliverableFingerprint.service.js";

export type SimilaritySignalBreakdown = {
  semantic: number;
  wbsContext: number;
  activityComposition: number;
  durationBehaviour: number;
  programmeStage: number;
};

export type WeightedSimilarityResult = {
  overallScore: number;
  signals: SimilaritySignalBreakdown;
  matchedSignals: string[];
  explanations: string[];
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function tokenizeName(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 3)
  );
}

function scoreSemantic(base: DeliverableFingerprint, candidate: DeliverableFingerprint): number {
  const nameSim = jaccard(new Set(base.keywords), new Set(candidate.keywords));
  const nameTokenSim = jaccard(tokenizeName(base.normalizedName), tokenizeName(candidate.normalizedName));
  const classSim =
    base.classification && candidate.classification && norm(base.classification) === norm(candidate.classification)
      ? 1
      : 0;
  return clamp01(nameTokenSim * 0.5 + nameSim * 0.3 + classSim * 0.2);
}

function scoreWbsContext(base: DeliverableFingerprint, candidate: DeliverableFingerprint): number {
  if (base.fragnetId && candidate.fragnetId && base.fragnetId === candidate.fragnetId) return 1;
  if (base.parentWbs && candidate.parentWbs && norm(base.parentWbs) === norm(candidate.parentWbs)) return 1;
  if (base.discipline && candidate.discipline && norm(base.discipline) === norm(candidate.discipline)) return 0.6;
  return 0;
}

function scoreActivityComposition(base: DeliverableFingerprint, candidate: DeliverableFingerprint): number {
  const patternSim = jaccard(new Set(base.activityCodePattern), new Set(candidate.activityCodePattern));
  const countBase = Math.max(1, base.activityCount);
  const countCand = Math.max(1, candidate.activityCount);
  const countSim = 1 - Math.min(1, Math.abs(countBase - countCand) / Math.max(countBase, countCand));
  const critBase = base.criticalActivityCount / countBase;
  const critCand = candidate.criticalActivityCount / countCand;
  const critSim = 1 - Math.min(1, Math.abs(critBase - critCand));
  return clamp01(patternSim * 0.5 + countSim * 0.3 + critSim * 0.2);
}

function scoreDurationBehaviour(base: DeliverableFingerprint, candidate: DeliverableFingerprint): number {
  const bMed = base.durationProfile.medianDays;
  const cMed = candidate.durationProfile.medianDays;
  if (bMed == null || cMed == null) return 0;
  const max = Math.max(bMed, cMed, 1);
  const diff = Math.abs(bMed - cMed) / max;
  return clamp01(1 - diff);
}

function scoreProgrammeStage(base: DeliverableFingerprint, candidate: DeliverableFingerprint): number {
  if (!base.stage || !candidate.stage) return 0;
  return norm(base.stage) === norm(candidate.stage) ? 1 : 0;
}

/** Weighted multi-signal deliverable similarity (0–100). */
export function computeWeightedDeliverableSimilarity(
  base: DeliverableFingerprint,
  candidate: DeliverableFingerprint
): WeightedSimilarityResult {
  const W = DELIVERABLE_SIMILARITY_WEIGHTS;
  const signals: SimilaritySignalBreakdown = {
    semantic: scoreSemantic(base, candidate),
    wbsContext: scoreWbsContext(base, candidate),
    activityComposition: scoreActivityComposition(base, candidate),
    durationBehaviour: scoreDurationBehaviour(base, candidate),
    programmeStage: scoreProgrammeStage(base, candidate),
  };

  const score01 =
    (signals.semantic * W.semantic +
      signals.wbsContext * W.wbsContext +
      signals.activityComposition * W.activityComposition +
      signals.durationBehaviour * W.durationBehaviour +
      signals.programmeStage * W.programmeStage) /
    100;

  const matchedSignals: string[] = [];
  const explanations: string[] = [];
  if (signals.semantic >= 0.5) {
    matchedSignals.push("semantic");
    explanations.push("Similar deliverable identity and classification");
  }
  if (signals.wbsContext >= 0.5) {
    matchedSignals.push("wbsContext");
    explanations.push("Same work package or discipline context");
  }
  if (signals.activityComposition >= 0.5) {
    matchedSignals.push("activityComposition");
    explanations.push("Similar activity composition pattern");
  }
  if (signals.durationBehaviour >= 0.5) {
    matchedSignals.push("durationBehaviour");
    explanations.push("Similar historical duration behaviour");
  }
  if (signals.programmeStage >= 0.5) {
    matchedSignals.push("programmeStage");
    explanations.push("Same programme stage");
  }

  return {
    overallScore: Math.round(clamp01(score01) * 1000) / 10,
    signals,
    matchedSignals,
    explanations,
  };
}
