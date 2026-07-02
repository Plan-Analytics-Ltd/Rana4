import type { ProgrammeState } from "@prisma/client";
import { DEFAULT_MIN_COMPARABLE_SIMILARITY, revisionEvidenceWeight } from "./similarityWeights.config.js";
import { deduplicateBenchmarkSamples, type HistoricalRevision } from "./revisionGrouping.service.js";
import { computeEvidenceDiversity } from "./evidenceDiversity.service.js";

export type RankedEvidenceCandidate = {
  snapshotId: string;
  projectId: string;
  projectName: string;
  deliverableId: string | null;
  deliverableName: string;
  classification: string | null;
  programmeState: ProgrammeState | null;
  durationDays: number;
  similarityScore: number;
  evidenceWeight?: number;
  fingerprintKey: string;
  similaritySignals?: Record<string, number>;
  importedAt?: Date;
};

export type EvidenceSelectionResult = {
  ranked: RankedEvidenceCandidate[];
  selected: RankedEvidenceCandidate[];
  deduplicated: RankedEvidenceCandidate[];
  excludedLowSimilarity: number;
  diversity: ReturnType<typeof computeEvidenceDiversity>;
};

/**
 * Rank and filter benchmark evidence.
 * - Threshold filter (default 70%)
 * - Revision weighting by programme state
 * - Deduplication per project+deliverable for primary statistics
 */
export function selectBenchmarkEvidence(
  candidates: RankedEvidenceCandidate[],
  options?: { minSimilarity?: number; deduplicateForStats?: boolean }
): EvidenceSelectionResult {
  const minSimilarity = options?.minSimilarity ?? DEFAULT_MIN_COMPARABLE_SIMILARITY;

  const ranked = [...candidates]
    .map((c) => ({
      ...c,
      evidenceWeight: revisionEvidenceWeight(c.programmeState) * clamp01(c.similarityScore / 100),
    }))
    .sort((a, b) => b.similarityScore - a.similarityScore || b.evidenceWeight - a.evidenceWeight);

  const selected = ranked.filter((c) => c.similarityScore >= minSimilarity);
  const excludedLowSimilarity = ranked.length - selected.length;

  const deduplicated =
    options?.deduplicateForStats !== false
      ? deduplicateBenchmarkSamples(
          selected.map((s) => ({
            snapshotId: s.snapshotId,
            snapshotVersion: 0,
            snapshotRole: null,
            programmeState: s.programmeState,
            projectId: s.projectId,
            deliverableId: s.deliverableId,
            deliverableName: s.deliverableName,
            importedAt: s.importedAt ?? new Date(0),
            durationDays: s.durationDays,
            fingerprintKey: s.fingerprintKey,
          }))
        ).map((d) => selected.find((s) => s.snapshotId === d.snapshotId && s.projectId === d.projectId)!)
      : selected;

  const diversity = computeEvidenceDiversity({
    samples: selected.map((s) => ({
      projectId: s.projectId,
      deliverableId: s.deliverableId,
      deliverableName: s.deliverableName,
      snapshotId: s.snapshotId,
      programmeState: s.programmeState,
    })),
  });

  return { ranked, selected, deduplicated, excludedLowSimilarity, diversity };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
