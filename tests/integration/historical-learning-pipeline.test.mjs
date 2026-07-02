import test from "node:test";
import assert from "node:assert/strict";
import { resolveProgrammeState } from "../../dist/services/intelligence/shared/programmeState.service.js";
import {
  enrichDeliverableRowsFromActivities,
  rollupDeliverableDatesFromActivities,
} from "../../dist/services/intelligence/shared/deliverableSnapshotEnrichment.service.js";

test("resolveProgrammeState maps snapshot roles to intelligence states", () => {
  assert.equal(
    resolveProgrammeState({ snapshotRole: "BASELINE", sourceType: "XER_IMPORT" }),
    "APPROVED_BASELINE"
  );
  assert.equal(
    resolveProgrammeState({ snapshotRole: "AS_BUILT", sourceType: "XER_IMPORT" }),
    "AS_BUILT"
  );
  assert.equal(
    resolveProgrammeState({ snapshotRole: "LIVE_IMPORT", sourceType: "LIVE_UPDATE" }),
    "LIVE_UPDATE"
  );
  assert.equal(
    resolveProgrammeState({ snapshotRole: null, sourceType: "BASELINE_GENERATED" }),
    "APPROVED_BASELINE"
  );
});

test("rollupDeliverableDatesFromActivities derives spans from linked activities", () => {
  const deliverableId = "del-1";
  const rolled = rollupDeliverableDatesFromActivities(deliverableId, [
    {
      deliverableId,
      earlyStart: new Date("2024-01-01"),
      earlyFinish: new Date("2024-01-10"),
      actualStart: new Date("2024-01-02"),
      actualFinish: new Date("2024-01-12"),
      totalFloatDays: 5,
    },
    {
      deliverableId,
      earlyStart: new Date("2024-01-05"),
      earlyFinish: new Date("2024-01-20"),
      actualStart: new Date("2024-01-06"),
      actualFinish: new Date("2024-01-18"),
      totalFloatDays: 2,
    },
  ]);

  assert.equal(rolled.plannedStart?.toISOString().slice(0, 10), "2024-01-01");
  assert.equal(rolled.plannedFinish?.toISOString().slice(0, 10), "2024-01-20");
  assert.equal(rolled.actualStart?.toISOString().slice(0, 10), "2024-01-02");
  assert.equal(rolled.actualFinish?.toISOString().slice(0, 10), "2024-01-18");
  assert.equal(rolled.totalFloatDays, 2);
});

test("enrichDeliverableRowsFromActivities fills missing deliverable dates", () => {
  const deliverableId = "del-abc";
  const enriched = enrichDeliverableRowsFromActivities(
    [{ name: "Design Package", deliverableId }],
    [
      {
        activityCode: "A100",
        deliverableId,
        earlyStart: new Date("2025-03-01"),
        earlyFinish: new Date("2025-03-15"),
        actualStart: new Date("2025-03-02"),
        actualFinish: new Date("2025-03-16"),
      },
    ]
  );

  assert.equal(enriched[0]?.plannedStart?.toISOString().slice(0, 10), "2025-03-01");
  assert.equal(enriched[0]?.plannedFinish?.toISOString().slice(0, 10), "2025-03-15");
  assert.equal(enriched[0]?.actualStart?.toISOString().slice(0, 10), "2025-03-02");
  assert.equal(enriched[0]?.actualFinish?.toISOString().slice(0, 10), "2025-03-16");
});

test("resolveDominantFragnetId picks highest-count fragnet with deterministic tie-break", async () => {
  const { resolveDominantFragnetId } = await import(
    "../../dist/services/intelligence/shared/deliverableSnapshotContext.service.js"
  );

  const deliverableId = "del-1";
  const dominant = resolveDominantFragnetId(deliverableId, [
    { deliverableId, fragnetId: "frag-b" },
    { deliverableId, fragnetId: "frag-a" },
    { deliverableId, fragnetId: "frag-a" },
  ]);
  assert.equal(dominant, "frag-a");
});

test("resolveSnapshotDeliverableStage follows profile precedence when snapshot stage missing", async () => {
  const { resolveSnapshotDeliverableStage } = await import(
    "../../dist/services/intelligence/shared/deliverableSnapshotContext.service.js"
  );

  assert.equal(
    resolveSnapshotDeliverableStage({
      programmeSnapshotStage: null,
      projectProfileStage: "Design",
    }),
    "Design"
  );
  assert.equal(
    resolveSnapshotDeliverableStage({
      deliverableStage: "Construction",
      projectProfileStage: "Design",
    }),
    "Construction"
  );
});

test("resolveWorkPackageDuration mirrors live max-activity-duration definition", async () => {
  const { resolveWorkPackageDuration } = await import(
    "../../dist/services/intelligence/shared/historicalDuration.service.js"
  );

  // Work-package duration = max activity original duration (not calendar span).
  const workPackage = resolveWorkPackageDuration(
    [
      { originalDuration: 10, remainingDuration: 10, actualDuration: null },
      { originalDuration: 20, remainingDuration: 20, actualDuration: null },
    ],
    /* calendarSpanDays */ 173
  );
  assert.equal(workPackage.durationDays, 20);
  assert.equal(workPackage.basis, "WORK_PACKAGE");

  // Genuine milestone (all zero-duration activities).
  const milestone = resolveWorkPackageDuration([{ originalDuration: 0, remainingDuration: 0, actualDuration: 0 }], 5);
  assert.equal(milestone.durationDays, 0);
  assert.equal(milestone.basis, "MILESTONE");

  // No activity duration data → calendar span only as last resort.
  const fallback = resolveWorkPackageDuration([], 42);
  assert.equal(fallback.durationDays, 42);
  assert.equal(fallback.basis, "CALENDAR_SPAN_FALLBACK");

  // Nothing available → no benchmark contribution.
  const none = resolveWorkPackageDuration([], null);
  assert.equal(none.durationDays, null);
  assert.equal(none.basis, null);
});

test("resolveWorkPackageDuration prefers originalDuration over actual for as-built", async () => {
  const { resolveWorkPackageDuration } = await import(
    "../../dist/services/intelligence/shared/historicalDuration.service.js"
  );
  const asBuilt = resolveWorkPackageDuration(
    [{ originalDuration: 5, remainingDuration: 0, actualDuration: 39 }],
    141
  );
  assert.equal(asBuilt.durationDays, 5);
  assert.equal(asBuilt.basis, "WORK_PACKAGE");
});

test("buildHistoricalDeliverableFingerprint uses enriched snapshot WBS and stage", async () => {
  const { buildHistoricalDeliverableFingerprint } = await import(
    "../../dist/services/intelligence/matching/historicalFingerprint.service.js"
  );

  const fingerprint = buildHistoricalDeliverableFingerprint({
    deliverableSnapshot: {
      name: "Reinforcement Detailing",
      classification: "OTHER",
      fragnetId: "frag-1",
      parentWbs: "Link Structure",
      stage: "Design",
      deliverableId: "del-1",
    },
    programmeSnapshot: { programmeState: "APPROVED_BASELINE", stage: "Design" },
    linkedActivities: [{ activityCode: "A100", originalDuration: 10, isCritical: false }],
  });

  assert.equal(fingerprint.fragnetId, "frag-1");
  assert.equal(fingerprint.parentWbs, "Link Structure");
  assert.equal(fingerprint.stage, "Design");
});
