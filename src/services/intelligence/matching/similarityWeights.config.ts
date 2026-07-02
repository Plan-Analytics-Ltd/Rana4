import type { ProgrammeState } from "@prisma/client";

/** Default minimum overall similarity for benchmark evidence (0–100). */
export const DEFAULT_MIN_COMPARABLE_SIMILARITY = 70;

/** Minimum project similarity for auto-inclusion in benchmark pool. */
export const MIN_AUTO_PROJECT_SIMILARITY = 50;

/**
 * Weighted deliverable similarity signals (must sum to 100).
 * Tunable without rewriting the intelligence pipeline.
 */
export const DELIVERABLE_SIMILARITY_WEIGHTS = {
  semantic: 40,
  wbsContext: 20,
  activityComposition: 20,
  durationBehaviour: 10,
  programmeStage: 10,
} as const;

/**
 * Evidence weight by programme snapshot state when building benchmark samples.
 * Completed history is preferred over intermediate revisions.
 */
export const REVISION_EVIDENCE_WEIGHTS: Partial<Record<ProgrammeState, number>> = {
  FINAL_AS_BUILT: 1.0,
  AS_BUILT: 1.0,
  LIVE_UPDATE: 0.4,
  APPROVED_BASELINE: 0.2,
  BASELINE: 0.2,
};

export function revisionEvidenceWeight(programmeState: ProgrammeState | null | undefined): number {
  if (!programmeState) return 0.3;
  return REVISION_EVIDENCE_WEIGHTS[programmeState] ?? 0.3;
}
