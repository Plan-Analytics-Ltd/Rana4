import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBackfillEstimate,
  executeEngineeringReasoningBackfill,
  hasUsableReasoningContext,
  parseBackfillArgs,
  estimateBackfillCost,
} from "../../dist/services/intelligence/taxonomy/engineeringReasoningBackfill.service.js";

test("parseBackfillArgs: dry-run by default; --confirm / --execute enable writes", () => {
  assert.equal(parseBackfillArgs([]).confirm, false);
  assert.equal(parseBackfillArgs(["--confirm"]).confirm, true);
  assert.equal(parseBackfillArgs(["--execute"]).confirm, true);
  assert.equal(parseBackfillArgs(["--companyId", "abc"]).companyId, "abc");
  assert.equal(parseBackfillArgs(["--all-companies"]).allCompanies, true);
  assert.throws(() => parseBackfillArgs(["--companyId", "x", "--all-companies"]));
});

test("hasUsableReasoningContext: requires activities or fragnet/WBS", () => {
  assert.equal(hasUsableReasoningContext({}), false);
  assert.equal(hasUsableReasoningContext({ relatedActivityNames: [] }), false);
  assert.equal(hasUsableReasoningContext({ relatedActivityNames: ["  "] }), false);
  assert.equal(hasUsableReasoningContext({ parentWbs: null, wbsPath: null }), false);
  assert.equal(hasUsableReasoningContext({ parentWbs: "GET Milestones" }), true);
  assert.equal(hasUsableReasoningContext({ wbsPath: "Site / Drainage" }), true);
  assert.equal(hasUsableReasoningContext({ relatedActivityNames: ["Confirm BWIC"] }), true);
});

test("estimateBackfillCost extrapolates from Phase 2 per-row numbers", () => {
  const estimate = estimateBackfillCost(100, 3);
  assert.equal(estimate.estimatedTokens, 84500);
  assert.equal(estimate.estimatedCostUsd, 0.45);
  assert.ok(estimate.estimatedWallMs > 0);
  assert.equal(estimate.concurrency, 3);
});

function mockPrismaForEstimate(rows) {
  const updates = [];
  let findCalls = 0;
  return {
    updates,
    prisma: {
      deliverableSnapshot: {
        count: async ({ where }) => {
          if (where.reasoningSource === null) {
            return rows.filter((r) => r.reasoningSource == null).length;
          }
          if (where.reasoningSource?.not === null) {
            return rows.filter((r) => r.reasoningSource != null).length;
          }
          return rows.length;
        },
        findMany: async ({ where, take, orderBy }) => {
          findCalls += 1;
          assert.equal(where.reasoningSource, null, "pages only load reasoningSource IS NULL");
          assert.equal(orderBy.id, "asc");
          let pool = rows.filter((r) => r.reasoningSource == null);
          if (where.id?.gt) pool = pool.filter((r) => r.id > where.id.gt);
          pool = [...pool].sort((a, b) => (a.id < b.id ? -1 : 1));
          return pool.slice(0, take).map((r) => ({
            id: r.id,
            name: r.name,
            snapshotId: r.snapshotId,
            deliverableId: r.deliverableId,
            parentWbs: r.parentWbs,
            wbsPath: r.wbsPath,
            discipline: r.discipline ?? null,
            stage: r.stage ?? null,
            classificationTags: r.classificationTags ?? {},
            reasoningSource: r.reasoningSource,
            snapshot: {
              id: r.snapshotId,
              sector: null,
              projectType: null,
              stage: null,
              activitySnapshots: r.activitySnapshots ?? [],
              deliverableSnapshots: r.siblingSnapshots ?? [
                { id: r.id, name: r.name, parentWbs: r.parentWbs, wbsPath: r.wbsPath },
              ],
            },
          }));
        },
        update: async ({ where, data }) => {
          updates.push({ id: where.id, data });
          const row = rows.find((r) => r.id === where.id);
          if (row) row.reasoningSource = data.reasoningSource;
          return { id: where.id };
        },
      },
    },
    getFindCalls: () => findCalls,
  };
}

test("dry-run estimate makes zero database writes", async () => {
  const { prisma, updates } = mockPrismaForEstimate([
    {
      id: "ds1",
      name: "BWIC",
      snapshotId: "snap1",
      deliverableId: "d1",
      parentWbs: "GET Milestones",
      wbsPath: null,
      reasoningSource: null,
      activitySnapshots: [{ deliverableId: "d1", name: "Confirm BWIC receipt" }],
    },
    {
      id: "ds2",
      name: "Orphan",
      snapshotId: "snap1",
      deliverableId: null,
      parentWbs: null,
      wbsPath: null,
      reasoningSource: null,
      activitySnapshots: [],
    },
  ]);

  const estimate = await buildBackfillEstimate(prisma, {
    companyId: "co1",
    allCompanies: false,
    pageSize: 50,
    concurrency: 3,
  });

  assert.equal(estimate.eligibleCount, 1);
  assert.equal(estimate.insufficientContextCount, 1);
  assert.equal(updates.length, 0, "estimate/dry-run must not write");
});

test("insufficient-context rows are classified explicitly, not silently dropped", async () => {
  const { prisma } = mockPrismaForEstimate([
    {
      id: "ds-empty",
      name: "Nameless Milestone",
      snapshotId: "snap1",
      deliverableId: null,
      parentWbs: null,
      wbsPath: null,
      reasoningSource: null,
      activitySnapshots: [],
    },
  ]);

  const estimate = await buildBackfillEstimate(prisma, {
    companyId: "co1",
    allCompanies: false,
  });
  assert.equal(estimate.eligibleCount, 0);
  assert.equal(estimate.insufficientContextCount, 1);
  assert.equal(estimate.estimatedCostUsd, 0);
});

test("second backfill pass finds zero newly-eligible rows after reasoningSource is set", async () => {
  const rows = [
    {
      id: "ds1",
      name: "Drainage",
      snapshotId: "snap1",
      deliverableId: "d1",
      parentWbs: "GET Milestones",
      wbsPath: null,
      reasoningSource: "LLM_REASONED",
      activitySnapshots: [{ deliverableId: "d1", name: "Confirm drainage" }],
    },
    {
      id: "ds2",
      name: "BWIC",
      snapshotId: "snap1",
      deliverableId: "d2",
      parentWbs: "GET Milestones",
      wbsPath: null,
      reasoningSource: "LLM_MERGED",
      activitySnapshots: [{ deliverableId: "d2", name: "Confirm BWIC" }],
    },
  ];
  const { prisma, updates } = mockPrismaForEstimate(rows);

  const estimate = await buildBackfillEstimate(prisma, {
    companyId: "co1",
    allCompanies: false,
  });
  assert.equal(estimate.eligibleCount, 0);
  assert.equal(estimate.alreadyReasonedCount, 2);
  assert.equal(estimate.estimatedTokens, 0);
  assert.equal(updates.length, 0);

  // Execute with nothing eligible must not call update / LLM (empty pages).
  const skips = [];
  const run = await executeEngineeringReasoningBackfill(prisma, {
    companyId: "co1",
    allCompanies: false,
    onProgress: (m) => skips.push(m),
  });
  assert.equal(run.processed, 0);
  assert.equal(run.llmCalls, 0);
  assert.equal(run.storedReasoned, 0);
  assert.equal(updates.length, 0);
});
