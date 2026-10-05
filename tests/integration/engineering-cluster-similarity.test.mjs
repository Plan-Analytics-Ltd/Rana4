/**
 * Engineering Brain — LLM-assisted cluster similarity grouping (spec section
 * 5 step 1, Phase 4).
 *
 * Run: npm run build && node --test tests/integration/engineering-cluster-similarity.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  groupObjectGapClustersBySimilarity,
  getEngineeringClusterSimilarityConfig,
  parseClusterSimilarityGrouping,
} from "../../dist/services/intelligence/diagnostics/engineeringClusterSimilarity.service.js";
import { registerLlmProvider } from "../../dist/services/explanation/providers/llmProviderRegistry.js";

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(overrides)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

/* -------------------------------------------------------------------------- */
/* (a) Kill switch: flag unset/false => identity passthrough                  */
/* -------------------------------------------------------------------------- */

test("groupObjectGapClustersBySimilarity: flag unset returns the input clusters completely unchanged", async () => {
  await withEnv({ AI_ENGINEERING_CLUSTER_SIMILARITY_ENABLED: undefined }, async () => {
    const config = getEngineeringClusterSimilarityConfig();
    assert.equal(config.enabled, false);

    const clusters = [
      {
        subjectKey: "combined mep",
        conceptLabel: "Combined Mep",
        occurrences: 3,
        projectCount: 2,
        members: [
          { fingerprint: "f0", deliverableName: "Combined MEP", projectId: "p0" },
          { fingerprint: "f1", deliverableName: "Combined MEP Review", projectId: "p1" },
        ],
        discipline: "mechanical",
      },
    ];

    const result = await groupObjectGapClustersBySimilarity(clusters);
    assert.equal(result, clusters, "must be the exact same array reference — no copy, no reordering");
    assert.deepEqual(result, clusters);
  });
});

test("groupObjectGapClustersBySimilarity: AI_ENGINEERING_CLUSTER_SIMILARITY_ENABLED=false returns input unchanged even with a configured provider", async () => {
  registerLlmProvider({
    id: "cluster-similarity-test-stub-disabled",
    isConfigured: true,
    async complete() {
      throw new Error("must never be called while the feature flag is disabled");
    },
  });

  await withEnv(
    {
      AI_ENGINEERING_CLUSTER_SIMILARITY_ENABLED: "false",
      AI_EXPLANATION_PROVIDER: "cluster-similarity-test-stub-disabled",
    },
    async () => {
      const clusters = [
        {
          subjectKey: "combined mep",
          conceptLabel: "Combined Mep",
          occurrences: 3,
          projectCount: 2,
          members: [{ fingerprint: "f0", deliverableName: "Combined MEP", projectId: "p0" }],
          discipline: "mechanical",
        },
        {
          subjectKey: "mep coordination",
          conceptLabel: "Mep Coordination",
          occurrences: 2,
          projectCount: 2,
          members: [{ fingerprint: "f1", deliverableName: "MEP Coordination", projectId: "p1" }],
          discipline: "mechanical",
        },
      ];
      const result = await groupObjectGapClustersBySimilarity(clusters);
      assert.equal(result, clusters);
    }
  );
});

test("groupObjectGapClustersBySimilarity: forceRuleBased returns input unchanged even when enabled and configured", async () => {
  registerLlmProvider({
    id: "cluster-similarity-test-stub-force",
    isConfigured: true,
    async complete() {
      throw new Error("must never be called when forceRuleBased is set");
    },
  });

  await withEnv(
    {
      AI_ENGINEERING_CLUSTER_SIMILARITY_ENABLED: "true",
      AI_EXPLANATION_PROVIDER: "cluster-similarity-test-stub-force",
    },
    async () => {
      const clusters = [
        {
          subjectKey: "combined mep",
          conceptLabel: "Combined Mep",
          occurrences: 3,
          projectCount: 2,
          members: [{ fingerprint: "f0", deliverableName: "Combined MEP", projectId: "p0" }],
          discipline: "mechanical",
        },
      ];
      const result = await groupObjectGapClustersBySimilarity(clusters, { forceRuleBased: true });
      assert.equal(result, clusters);
    }
  );
});

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

test("parseClusterSimilarityGrouping: parses a valid full-coverage grouping", () => {
  const groups = parseClusterSimilarityGrouping('{"groups":[[0,1],[2]]}', 3);
  assert.deepEqual(groups, [[0, 1], [2]]);
});

test("parseClusterSimilarityGrouping: rejects malformed JSON", () => {
  assert.equal(parseClusterSimilarityGrouping("not json at all", 2), null);
});

test("parseClusterSimilarityGrouping: rejects partial coverage (missing an index)", () => {
  assert.equal(parseClusterSimilarityGrouping('{"groups":[[0]]}', 2), null);
});

test("parseClusterSimilarityGrouping: rejects an index appearing in two groups", () => {
  assert.equal(parseClusterSimilarityGrouping('{"groups":[[0,1],[1]]}', 2), null);
});

test("parseClusterSimilarityGrouping: rejects an out-of-range index", () => {
  assert.equal(parseClusterSimilarityGrouping('{"groups":[[0,5]]}', 2), null);
});

/* -------------------------------------------------------------------------- */
/* (b) Merge-count math: occurrences summed, projectCount deduplicated        */
/* -------------------------------------------------------------------------- */

test("groupObjectGapClustersBySimilarity: merges an LLM-grouped pair with correct occurrences/projectCount/members math", async () => {
  registerLlmProvider({
    id: "cluster-similarity-test-stub-merge",
    isConfigured: true,
    async complete() {
      // Group the two same-discipline clusters together (indices 0 and 1).
      return {
        status: "success",
        text: JSON.stringify({ groups: [[0, 1]] }),
        providerId: "cluster-similarity-test-stub-merge",
      };
    },
  });

  await withEnv(
    {
      AI_ENGINEERING_CLUSTER_SIMILARITY_ENABLED: "true",
      AI_EXPLANATION_PROVIDER: "cluster-similarity-test-stub-merge",
    },
    async () => {
      const clusterA = {
        subjectKey: "combined mep",
        conceptLabel: "Combined Mep",
        occurrences: 3,
        projectCount: 2,
        members: [
          { fingerprint: "f0", deliverableName: "Combined MEP", projectId: "p0" },
          { fingerprint: "f1", deliverableName: "Combined MEP", projectId: "p0" },
          { fingerprint: "f2", deliverableName: "Combined MEP Review", projectId: "p1" },
        ],
        discipline: "mechanical",
      };
      const clusterB = {
        subjectKey: "mep coordination",
        conceptLabel: "Mep Coordination",
        occurrences: 2,
        projectCount: 2,
        members: [
          { fingerprint: "f3", deliverableName: "MEP Coordination", projectId: "p1" },
          { fingerprint: "f4", deliverableName: "MEP Coordination", projectId: "p2" },
        ],
        discipline: "mechanical",
      };

      const result = await groupObjectGapClustersBySimilarity([clusterA, clusterB]);

      assert.equal(result.length, 1, "the LLM-grouped pair must collapse into one merged cluster");
      const merged = result[0];

      // occurrences: summed (3 + 2 = 5), never deduplicated.
      assert.equal(merged.occurrences, 5);

      // projectCount: recomputed from the union of distinct member.projectId
      // values (p0, p1, p2 = 3), NOT summed (2 + 2 = 4 would be wrong — p1
      // appears in both input clusters and must only count once).
      assert.equal(merged.projectCount, 3);
      assert.notEqual(merged.projectCount, clusterA.projectCount + clusterB.projectCount);

      // members: concatenation of all merged members.
      assert.equal(merged.members.length, 5);
      assert.deepEqual(
        merged.members.map((m) => m.fingerprint),
        ["f0", "f1", "f2", "f3", "f4"]
      );

      // discipline: carried through (shared by construction — they were
      // batched together because they share a discipline).
      assert.equal(merged.discipline, "mechanical");

      // conceptLabel/subjectKey: deterministically the largest input cluster
      // by occurrences (clusterA, 3 > 2), never invented by the LLM.
      assert.equal(merged.conceptLabel, "Combined Mep");
      assert.equal(merged.subjectKey, "combined mep");
    }
  );
});

test("groupObjectGapClustersBySimilarity: only batches clusters sharing a discipline; different disciplines never merge", async () => {
  registerLlmProvider({
    id: "cluster-similarity-test-stub-batching",
    isConfigured: true,
    async complete(request) {
      // Whatever is asked, group everything in the batch together — this
      // stub exists to prove batching itself (by discipline) keeps clusters
      // apart, not to test grouping decisions.
      const indexCount = (request.user.match(/^\d+:/gm) || []).length;
      const allIndices = Array.from({ length: indexCount }, (_, i) => i);
      return {
        status: "success",
        text: JSON.stringify({ groups: [allIndices] }),
        providerId: "cluster-similarity-test-stub-batching",
      };
    },
  });

  await withEnv(
    {
      AI_ENGINEERING_CLUSTER_SIMILARITY_ENABLED: "true",
      AI_EXPLANATION_PROVIDER: "cluster-similarity-test-stub-batching",
    },
    async () => {
      const mechanical1 = {
        subjectKey: "combined mep",
        conceptLabel: "Combined Mep",
        occurrences: 3,
        projectCount: 1,
        members: [{ fingerprint: "f0", deliverableName: "Combined MEP", projectId: "p0" }],
        discipline: "mechanical",
      };
      const mechanical2 = {
        subjectKey: "mep coordination",
        conceptLabel: "Mep Coordination",
        occurrences: 2,
        projectCount: 1,
        members: [{ fingerprint: "f1", deliverableName: "MEP Coordination", projectId: "p1" }],
        discipline: "mechanical",
      };
      const structural1 = {
        subjectKey: "cofferdam installation",
        conceptLabel: "Cofferdam Installation",
        occurrences: 4,
        projectCount: 2,
        members: [{ fingerprint: "f2", deliverableName: "Cofferdam Installation", projectId: "p2" }],
        discipline: "structural",
      };

      const result = await groupObjectGapClustersBySimilarity([mechanical1, mechanical2, structural1]);

      // mechanical1 + mechanical2 merge (same discipline batch); structural1
      // is its own single-member batch and is never touched by the LLM.
      assert.equal(result.length, 2, JSON.stringify(result));
      const merged = result.find((c) => c.discipline === "mechanical");
      const untouched = result.find((c) => c.discipline === "structural");
      assert.ok(merged);
      assert.ok(untouched);
      assert.equal(merged.occurrences, 5);
      assert.deepEqual(untouched, structural1);
    }
  );
});
