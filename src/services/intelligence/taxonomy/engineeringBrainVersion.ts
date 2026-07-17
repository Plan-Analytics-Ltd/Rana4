/**
 * Version stamps for the Engineering Brain.
 *
 * Every Engineering Identity produced can be stamped with these versions so
 * historical reasoning stays reproducible: if the vocabulary, prompt, or
 * validation rules change, the version changes, and a diagnostic report can
 * explain that two runs differed because the brain itself changed.
 *
 * Manual versions (brain / validation) are bumped by developers on behaviour
 * changes. Content-derived versions (prompt / vocabulary) change automatically
 * whenever the underlying data changes, so they can never silently drift.
 */
import { createHash } from "node:crypto";
import {
  ENGINEERING_OBJECT_RULES,
  DISCIPLINE_OBJECT_FALLBACKS,
  WORK_PACKAGE_OBJECT_FALLBACKS,
} from "./engineeringVocabulary.data.js";
import { ENGINEERING_REASONING_SYSTEM_PROMPT } from "./engineeringReasoning.service.js";

/** Bump when the reasoning/merge/resolution behaviour changes. */
export const ENGINEERING_BRAIN_VERSION = "brain-1.0.0";

/** Bump when the deterministic validation rules change. */
export const ENGINEERING_VALIDATION_VERSION = "validation-1.0.0";

function shortHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
}

/** Content hash of the reasoning prompt — changes when the prompt text changes. */
export const ENGINEERING_REASONING_PROMPT_VERSION = `prompt-${shortHash(
  ENGINEERING_REASONING_SYSTEM_PROMPT
)}`;

/** Content hash of the engineering vocabulary — changes when the data changes. */
export const ENGINEERING_VOCABULARY_VERSION = `vocab-${shortHash(
  JSON.stringify({
    objects: ENGINEERING_OBJECT_RULES,
    disciplineFallbacks: DISCIPLINE_OBJECT_FALLBACKS,
    workPackageFallbacks: WORK_PACKAGE_OBJECT_FALLBACKS,
  })
)}`;

export type EngineeringBrainVersions = {
  brain: string;
  reasoningPrompt: string;
  vocabulary: string;
  validation: string;
};

export function getEngineeringBrainVersions(): EngineeringBrainVersions {
  return {
    brain: ENGINEERING_BRAIN_VERSION,
    reasoningPrompt: ENGINEERING_REASONING_PROMPT_VERSION,
    vocabulary: ENGINEERING_VOCABULARY_VERSION,
    validation: ENGINEERING_VALIDATION_VERSION,
  };
}
