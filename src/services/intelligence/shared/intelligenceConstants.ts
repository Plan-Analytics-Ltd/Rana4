import type { ProgrammeState } from "@prisma/client";

/** Programme snapshot states used for historical intelligence evidence. */
export const ALLOWED_SNAPSHOT_STATES: ProgrammeState[] = [
  "APPROVED_BASELINE",
  "AS_BUILT",
  "FINAL_AS_BUILT",
];

/**
 * Programme states that indicate a project has been imported as completed.
 * Used for "Projects most like yours" — live/in-flight projects are excluded.
 */
export const COMPLETED_PROJECT_SNAPSHOT_STATES: ProgrammeState[] = ["AS_BUILT", "FINAL_AS_BUILT"];

/** Minimum comparable samples before a classification profile is persisted. */
export const MIN_PROFILE_SAMPLE = 3;

/** Minimum comparable samples before organisational insights are generated. */
export const MIN_INSIGHT_SAMPLE = 10;
