/**
 * Engineering Brain — LLM-assisted cluster similarity grouping. DEVELOPER ONLY.
 *
 * Phase 4 of docs/engineering-brain-self-learning-spec.md, section 5 step 1.
 *
 * `computeEngineeringBrainDiagnostics` groups unresolved `ENGINEERING_OBJECT`
 * gaps by exact `subjectKey` (near-exact string normalization) into
 * `ObjectGapClusterInput[]` before scoring them into rule-proposal candidates.
 * That grouping is "too strict" per the spec — it can't tell that "Combined
 * MEP Services" and "MEP Coordination" are the same underlying gap. This
 * module is the optional accelerant described in spec section 8: a narrower,
 * batch use of the same LLM provider already wired for per-deliverable
 * reasoning (`engineeringReasoning.service.ts`), used only to decide "are
 * these unresolved names the same underlying gap" — never to invent a rule,
 * a label, or to auto-approve anything.
 *
 * Two distinct uses, two distinct kill-switches (spec section 8: "not to be
 * conflated"). This module has its own env flag,
 * `AI_ENGINEERING_CLUSTER_SIMILARITY_ENABLED`, completely independent of
 * `AI_ENGINEERING_REASONING_ENABLED` — enabling one must never enable the
 * other.
 *
 * Fail-safe by construction, same posture as `engineeringReasoning.service.ts`:
 * when the flag is off, `forceRuleBased` is passed, or the provider is
 * unconfigured/mock, `groupObjectGapClustersBySimilarity` returns the input
 * `clusters` array completely unchanged (identity passthrough — no copy, no
 * reordering, 1:1). That is the default today, so
 * `computeEngineeringRuleProposalCandidates` re-run over the (unchanged)
 * result is byte-identical to running it once. See
 * tests/integration/engineering-cluster-similarity.test.mjs.
 */
import { resolveLlmProvider } from "../../explanation/providers/llmProviderRegistry.js";
import type { LlmProvider } from "../../explanation/providers/llmProvider.types.js";
import { getAiExplanationConfig } from "../../explanation/explanationConfig.js";
import type { ObjectGapClusterInput } from "./engineeringRuleProposal.service.js";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

export type EngineeringClusterSimilarityConfig = {
  enabled: boolean;
  model: string;
  temperature: number;
  maxTokens: number | null;
};

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Reuses the explanation provider/model but has its own enable flag, distinct
 * from `AI_ENGINEERING_REASONING_ENABLED` (spec section 8 / section 9 item 4:
 * these are two independent rollout decisions, not to be conflated).
 */
export function getEngineeringClusterSimilarityConfig(): EngineeringClusterSimilarityConfig {
  const ai = getAiExplanationConfig();
  return {
    enabled: parseBool(process.env.AI_ENGINEERING_CLUSTER_SIMILARITY_ENABLED, false),
    model: ai.model,
    temperature: ai.temperature,
    maxTokens: ai.maxTokens,
  };
}

/* -------------------------------------------------------------------------- */
/* Prompt                                                                     */
/* -------------------------------------------------------------------------- */

export const CLUSTER_SIMILARITY_SYSTEM_PROMPT = [
  "You are a planning engineer reviewing a batch of unresolved engineering concept labels that all share the same discipline.",
  "Some of these labels are different wordings for the exact same real-world engineering scope (for example \"Combined MEP Services\" and \"MEP Coordination\" can be the same underlying concept). Others are genuinely different scopes and must never be grouped together.",
  "Your only job is to say which indices refer to the same real-world engineering concept. Never invent a new label, pattern, or rule — only group the indices you are given.",
  "Respond with ONLY a JSON object, no prose, matching:",
  "{",
  '  "groups": [[0, 2], [1], [3, 4, 5]]',
  "}",
  "Every index from the numbered list below must appear in exactly one group. A concept with no match to any other index is its own single-element group.",
].join("\n");

export function buildClusterSimilarityPrompt(batch: ObjectGapClusterInput[]): {
  system: string;
  user: string;
} {
  const lines: string[] = [];
  lines.push(`Discipline: ${batch[0]?.discipline ?? "unknown"}`);
  lines.push("Unresolved concepts:");
  batch.forEach((cluster, index) => {
    const samples = cluster.members.slice(0, 2).map((m) => m.deliverableName);
    const sampleText = samples.length ? ` (examples: ${samples.join("; ")})` : "";
    lines.push(`${index}: "${cluster.conceptLabel}"${sampleText}`);
  });
  return { system: CLUSTER_SIMILARITY_SYSTEM_PROMPT, user: lines.join("\n") };
}

/* -------------------------------------------------------------------------- */
/* Parsing — defensive, same style as parseEngineeringReasoning: tolerate     */
/* malformed JSON, never throw, fall back to no-grouping on any failure.     */
/* -------------------------------------------------------------------------- */

/**
 * Parse the LLM's grouping response for one batch of `batchSize` clusters.
 * Returns `null` (caller falls back to no-grouping for the whole batch) unless
 * every index `0..batchSize-1` appears in exactly one group — a partial or
 * malformed grouping is never partially trusted.
 */
export function parseClusterSimilarityGrouping(text: string | null, batchSize: number): number[][] | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!Array.isArray(raw.groups)) return null;

  const groups: number[][] = [];
  const seen = new Set<number>();
  for (const entry of raw.groups) {
    if (!Array.isArray(entry)) return null;
    const indices: number[] = [];
    for (const value of entry) {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(n) || n < 0 || n >= batchSize) return null;
      if (seen.has(n)) return null; // an index appearing in two groups is invalid
      seen.add(n);
      indices.push(n);
    }
    if (indices.length === 0) continue;
    groups.push(indices);
  }
  // Every index must appear exactly once across all groups.
  if (seen.size !== batchSize) return null;
  return groups;
}

/* -------------------------------------------------------------------------- */
/* Merging — never invents a label; the merged cluster's conceptLabel/        */
/* subjectKey are always taken verbatim from one of the input clusters.      */
/* -------------------------------------------------------------------------- */

/**
 * Merge the clusters at `indices` (already batched by shared discipline) into
 * one `ObjectGapClusterInput`. `indices` must be sorted ascending by the
 * caller, so tie-breaks below are deterministic.
 *
 * - `occurrences`: summed across merged clusters.
 * - `projectCount`: recomputed as the size of the union of distinct
 *   `member.projectId` values across all merged members — never summed,
 *   since a project appearing in two merged clusters must only count once.
 * - `members`: concatenation of all merged clusters' members, in ascending
 *   original-index order.
 * - `discipline`: carried through unchanged — every cluster in `indices`
 *   shares the same discipline by construction (batching groups on it).
 * - `conceptLabel` / `subjectKey`: taken from the "representative" cluster —
 *   the one with the highest `occurrences` among the merged set, ties broken
 *   by the smallest original index (i.e. the first one encountered). This is
 *   deterministic and never LLM-authored: the LLM only ever supplies which
 *   indices to merge, never any text used in the output.
 */
function mergeClusterGroup(batch: ObjectGapClusterInput[], indices: number[]): ObjectGapClusterInput {
  if (indices.length === 1) return batch[indices[0]];

  let representative = batch[indices[0]];
  let occurrences = 0;
  const members: ObjectGapClusterInput["members"] = [];
  for (const index of indices) {
    const cluster = batch[index];
    occurrences += cluster.occurrences;
    members.push(...cluster.members);
    if (cluster.occurrences > representative.occurrences) representative = cluster;
  }
  const projectCount = new Set(members.map((m) => m.projectId)).size;

  return {
    subjectKey: representative.subjectKey,
    conceptLabel: representative.conceptLabel,
    occurrences,
    projectCount,
    members,
    discipline: batch[indices[0]].discipline ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Batching + orchestration                                                   */
/* -------------------------------------------------------------------------- */

/** Clusters with no resolved discipline are batched together in their own
 * catch-all bucket (documented choice — they still share "no discipline
 * known" as a category, so a batch LLM call across them is still meaningful;
 * they are just never mixed with clusters that do have a resolved discipline). */
const NO_DISCIPLINE_BATCH_KEY = "__no_discipline__";

function batchKeyFor(cluster: ObjectGapClusterInput): string {
  return cluster.discipline ?? NO_DISCIPLINE_BATCH_KEY;
}

async function groupBatchWithLlm(
  batch: ObjectGapClusterInput[],
  provider: LlmProvider,
  config: EngineeringClusterSimilarityConfig
): Promise<ObjectGapClusterInput[]> {
  try {
    const prompt = buildClusterSimilarityPrompt(batch);
    const completion = await provider.complete({
      system: prompt.system,
      user: prompt.user,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });
    if (completion.status !== "success") return batch;

    const groups = parseClusterSimilarityGrouping(completion.text, batch.length);
    if (!groups) return batch;

    return groups
      .map((indices) => [...indices].sort((a, b) => a - b))
      .sort((a, b) => a[0] - b[0])
      .map((indices) => mergeClusterGroup(batch, indices));
  } catch {
    // Graceful degradation (same philosophy as persistEngineeringRuleProposals'
    // per-candidate try/catch): any failure for this batch just passes its
    // clusters through unmerged, it never breaks the caller.
    return batch;
  }
}

/**
 * Group unresolved `ENGINEERING_OBJECT` clusters by LLM-assisted fuzzy
 * similarity (spec section 5 step 1, Phase 4) before
 * `computeEngineeringRuleProposalCandidates` scores them. Optional
 * accelerant: disabled by default, and always safe to leave disabled per spec
 * section 8 — the proposal pipeline works with the plain exact-subject
 * clustering already computed upstream.
 *
 * Returns the *same* `clusters` array, unchanged, when disabled/forced/
 * unconfigured — this is the critical fallback path that must exactly match
 * today's (pre-Phase-4) behaviour.
 */
export async function groupObjectGapClustersBySimilarity(
  clusters: ObjectGapClusterInput[],
  options: { forceRuleBased?: boolean } = {}
): Promise<ObjectGapClusterInput[]> {
  const config = getEngineeringClusterSimilarityConfig();
  const provider = resolveLlmProvider();

  if (options.forceRuleBased || !config.enabled || provider.id === "mock" || !provider.isConfigured) {
    return clusters;
  }

  // Batch by shared discipline, preserving first-seen order of each batch so
  // the output order is deterministic and independent of the LLM's response
  // ordering.
  const batchOrder: string[] = [];
  const batches = new Map<string, ObjectGapClusterInput[]>();
  for (const cluster of clusters) {
    const key = batchKeyFor(cluster);
    const existing = batches.get(key);
    if (existing) {
      existing.push(cluster);
    } else {
      batches.set(key, [cluster]);
      batchOrder.push(key);
    }
  }

  const result: ObjectGapClusterInput[] = [];
  for (const key of batchOrder) {
    const batch = batches.get(key)!;
    // A "batch" of one has nothing to group against — pass through without a
    // wasted LLM call.
    if (batch.length < 2) {
      result.push(...batch);
      continue;
    }
    const grouped = await groupBatchWithLlm(batch, provider, config);
    result.push(...grouped);
  }
  return result;
}
