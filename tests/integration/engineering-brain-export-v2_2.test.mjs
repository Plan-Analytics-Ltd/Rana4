import test from "node:test";
import assert from "node:assert/strict";
import { IDENTITY_DEBUG_EXPORT_SCHEMA_VERSION } from "../../dist/services/intelligence/diagnostics/engineeringIdentityDebugExport.service.js";
import {
  buildExportObservationGrouping,
  buildExportRootSummary,
} from "../../dist/services/intelligence/diagnostics/engineeringBrainExportGrouping.service.js";
import {
  enrichBrainExportV2_2,
  enrichDeliverableObservations,
} from "../../dist/services/intelligence/diagnostics/engineeringBrainExportEnrichment.service.js";
import { mapDiagnosticsReportToBrainExportV2 } from "../../dist/services/intelligence/diagnostics/engineeringBrainExportMapper.service.js";
import { buildEngineeringBrainSummary } from "../../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";

test("export schema is 2.2.0", () => {
  assert.equal(IDENTITY_DEBUG_EXPORT_SCHEMA_VERSION, "2.2.0");
});

test("schema 2.2.0 enriches brain entities and observations for round-trip", () => {
  const resolved = [
    {
      observed: {
        key: "snap1:d1",
        id: "d1",
        name: "Reinforcement Detailing",
        projectId: "p1",
        projectName: "Alpha",
        snapshotId: "snap1",
        importVersion: 1,
        importedAt: "2026-01-01T00:00:00.000Z",
      },
      identity: {
        status: "RESOLVED",
        discipline: { id: "structures", label: "Structures", evidence: [] },
        engineeringObject: { id: "reinforcement", label: "Reinforcement", evidence: [] },
        engineeringWork: { id: "detailing", label: "Detailing", evidence: [] },
        deliverableType: { id: "drawing", label: "Drawing", evidence: [] },
        lifecycleStage: { id: "design", label: "Design", evidence: [] },
        projectContext: { id: null, label: null, evidence: [] },
        fragnetContext: { id: null, label: null, evidence: [] },
        taxonomy: null,
        supportingEvidence: [],
        validation: { valid: true, errors: [], warnings: [], contradictions: [] },
      },
    },
    {
      observed: {
        key: "snap1:d2",
        id: "d2",
        name: "Reinforcement Detailing",
        projectId: "p1",
        projectName: "Alpha",
        snapshotId: "snap1",
        importVersion: 1,
        importedAt: "2026-01-01T00:00:00.000Z",
      },
      identity: {
        status: "RESOLVED",
        discipline: { id: "structures", label: "Structures", evidence: [] },
        engineeringObject: { id: "reinforcement", label: "Reinforcement", evidence: [] },
        engineeringWork: { id: "detailing", label: "Detailing", evidence: [] },
        deliverableType: { id: "drawing", label: "Drawing", evidence: [] },
        lifecycleStage: { id: "design", label: "Design", evidence: [] },
        projectContext: { id: null, label: null, evidence: [] },
        fragnetContext: { id: null, label: null, evidence: [] },
        taxonomy: null,
        supportingEvidence: [],
        validation: { valid: true, errors: [], warnings: [], contradictions: [] },
      },
    },
  ];

  const collections = {
    needsReview: [],
    autoApproved: [
      {
        fingerprint: "fp-test",
        concept: "Reinforcement Detailing",
        status: "AUTO_APPROVED",
        identity: {
          discipline: "structures",
          engineeringObject: "reinforcement",
          engineeringWork: "detailing",
          deliverableType: "drawing",
          lifecycleStage: "design",
        },
        identityView: null,
        context: null,
        aliases: [],
        evidence: [],
        examples: [],
        historicalMatches: [],
        firstObserved: "2026-01-01T00:00:00.000Z",
        lastObserved: "2026-01-01T00:00:00.000Z",
        projectCount: 1,
        successfulComparisons: 0,
        versionHistory: [],
        versionHistoryCount: 0,
        lastModificationReason: null,
      },
    ],
    developerApproved: [],
    developerModified: [],
    rejected: [],
  };
  const summary = buildEngineeringBrainSummary(collections);
  let report = {
    collections,
    summary,
    brainInbox: [],
    trustedKnowledge: collections.autoApproved,
  };

  let grouping = buildExportObservationGrouping(resolved, report);
  collections.autoApproved[0].fingerprint = grouping.groups[0].fingerprint;
  summary.autoApproved = 1;
  report = {
    collections,
    summary,
    brainInbox: [],
    trustedKnowledge: collections.autoApproved,
  };
  grouping = buildExportObservationGrouping(resolved, report);
  assert.equal(grouping.groups.length, 1);
  assert.equal(grouping.groups[0].observationCount, 2);

  const exportSummary = buildExportRootSummary({
    observationCount: resolved.length,
    grouping,
    brainSummary: summary,
  });
  assert.equal(exportSummary.deliverableObservations, 2);
  assert.equal(exportSummary.uniqueEngineeringIdentities, 1);
  assert.equal(exportSummary.groupedObservations, 1);

  // Fingerprint aligned above with grouping.groups[0]
  const brain = enrichBrainExportV2_2(mapDiagnosticsReportToBrainExportV2(report), grouping);
  const entry = brain.autoApproved[0];
  assert.equal(entry.observationCount, 2);
  assert.equal(entry.representativeDeliverableId, "d1");
  assert.deepEqual(entry.observationIds, ["d1", "d2"]);
  assert.equal(entry.approvalStatus, "AUTO_APPROVED");
  assert.equal(entry.decision.action, "NONE");
  assert.equal(entry.decision.fields.discipline, "structures");

  const deliverables = enrichDeliverableObservations(
    [
      { key: "snap1:d1", deliverableId: "d1", fingerprint: grouping.groups[0].fingerprint },
      { key: "snap1:d2", deliverableId: "d2", fingerprint: grouping.groups[0].fingerprint },
    ],
    grouping
  );
  assert.equal(deliverables[0].isRepresentative, true);
  assert.equal(deliverables[1].isRepresentative, false);
  assert.equal(deliverables[1].observationIndex, 1);
  assert.equal(deliverables[1].representativeDeliverableId, "d1");
  assert.equal(deliverables[1].observationCount, 2);
});
