import test from "node:test";
import assert from "node:assert/strict";
import {
  computeStrictOriginalDurationItems,
  currentPlanningDurationDays,
  STRICT_ORIGINAL_DURATION_DEFINITION,
  nameSimilarity,
  LOW_NAME_CONSISTENCY_THRESHOLD,
} from "../../dist/services/deliverableDurationStatisticsPresentation.service.js";
import { conceptSubject } from "../../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";
import { engineeringIdentityFingerprint } from "../../dist/services/intelligence/taxonomy/engineeringTrust.service.js";
import {
  resolveEngineeringIdentity,
} from "../../dist/services/intelligence/taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../../dist/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";

function rawIdentity(name, extra = {}) {
  return enforceEngineeringIdentityValidation(
    resolveEngineeringIdentity({ deliverableName: name, ...extra })
  );
}

function storedDecision(name, rawIdentityValue, identity, status = "DEVELOPER_MODIFIED") {
  const fingerprint = engineeringIdentityFingerprint(conceptSubject(name).key, rawIdentityValue);
  return [
    fingerprint,
    {
      knowledgeEntryId: null,
      fingerprint,
      status,
      lastAction: status === "REJECTED" ? "REJECT" : status === "DEVELOPER_APPROVED" ? "APPROVE" : "MODIFY",
      concept: name,
      identity,
      aliases: [],
      evidence: [],
      reviewNotes: null,
      reviewedBy: null,
      firstObservedAt: "2025-01-01T00:00:00.000Z",
      lastObservedAt: "2025-01-01T00:00:00.000Z",
      projectCount: 1,
      successfulComparisons: 0,
      versionHistory: [],
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ];
}

function reinforcementReferenceIdentity() {
  return rawIdentity("Reinforcement Detailing");
}

function deliverable(overrides = {}) {
  return {
    deliverableId: "historical-deliverable",
    name: "Reinforcement Detailing",
    classification: "DESIGN",
    fragnetId: null,
    parentWbs: null,
    wbsPath: null,
    discipline: null,
    classificationTags: {},
    ...overrides,
  };
}

function snapshot({
  id,
  projectId,
  projectName,
  importedAt,
  programmeState,
  originals,
  deliverables = [deliverable()],
  activities,
  snapshotVersion = 1,
}) {
  return {
    id,
    projectId,
    projectName: projectName ?? `${projectId} name`,
    importedAt: new Date(importedAt),
    snapshotVersion,
    snapshotRole: programmeState === "AS_BUILT" || programmeState === "FINAL_AS_BUILT" ? "AS_BUILT" : "BASELINE",
    programmeState,
    deliverableSnapshots: deliverables,
    activitySnapshots:
      activities ??
      originals.map((originalDuration) => ({
        deliverableId: "historical-deliverable",
        originalDuration,
      })),
  };
}

const persistedTarget = {
  key: "current-deliverable",
  deliverableId: "current-deliverable",
  name: "Reinforcement Detailing",
  fragnetName: null,
  classification: "DESIGN",
  provisional: false,
};

test("strict presentation uses max positive Original Duration and one preferred revision per project", () => {
  const snapshots = [
    snapshot({
      id: "p1-baseline",
      projectId: "p1",
      importedAt: "2025-01-01",
      programmeState: "APPROVED_BASELINE",
      originals: [4, 6],
    }),
    snapshot({
      id: "p1-as-built",
      projectId: "p1",
      importedAt: "2025-06-01",
      programmeState: "AS_BUILT",
      originals: [3, 8],
    }),
    snapshot({
      id: "p2-final",
      projectId: "p2",
      importedAt: "2025-04-01",
      programmeState: "FINAL_AS_BUILT",
      originals: [10, 0, -2],
    }),
  ];

  const [item] = computeStrictOriginalDurationItems([persistedTarget], snapshots);

  assert.equal(item.matchMode, "FULL_DELIVERABLE_CONTEXT");
  assert.equal(item.provisional, false);
  assert.equal(item.comparisonBasis, "SAME_DISCIPLINE");
  assert.deepEqual(item.statistics, {
    available: true,
    projectsUsed: 2,
    sampleCount: 2,
    minimumDays: 8,
    averageDays: 9,
    maximumDays: 10,
  });
  assert.equal(item.unavailableReason, null);
  assert.deepEqual(item.contributingProjects, [
    {
      projectId: "p1",
      projectName: "p1 name",
      matchedDeliverableName: "Reinforcement Detailing",
      fragnetName: null,
      planningDurationDays: 8,
    },
    {
      projectId: "p2",
      projectName: "p2 name",
      matchedDeliverableName: "Reinforcement Detailing",
      fragnetName: null,
      planningDurationDays: 10,
    },
  ]);
});

test("strict presentation never leaks Remaining or Actual Duration and excludes unrelated work packages", () => {
  const snapshots = [
    snapshot({
      id: "missing-original",
      projectId: "p1",
      importedAt: "2025-01-01",
      programmeState: "AS_BUILT",
      originals: [],
      activities: [
        {
          deliverableId: "historical-deliverable",
          originalDuration: null,
          remainingDuration: 99,
          actualDuration: 101,
        },
      ],
    }),
    snapshot({
      id: "unrelated",
      projectId: "p2",
      importedAt: "2025-01-01",
      programmeState: "AS_BUILT",
      originals: [77],
      deliverables: [deliverable({ name: "Drainage Strategy" })],
    }),
  ];

  const [item] = computeStrictOriginalDurationItems([persistedTarget], snapshots);

  assert.equal(item.statistics.available, false);
  assert.equal(item.statistics.sampleCount, 0);
  assert.equal(item.statistics.maximumDays, null);
  assert.equal(item.unavailableReason, "NO_HISTORICAL_PLANNING_DATA");
});

test("name-only draft lookups are deterministic and explicitly provisional", () => {
  const [item] = computeStrictOriginalDurationItems(
    [{ ...persistedTarget, key: "create-form", deliverableId: null, provisional: true }],
    [
      snapshot({
        id: "matching",
        projectId: "p1",
        importedAt: "2025-01-01",
        programmeState: "BASELINE",
        originals: [7],
      }),
    ]
  );

  assert.equal(item.key, "create-form");
  assert.equal(item.matchMode, "NAME_ONLY");
  assert.equal(item.provisional, true);
  assert.equal(item.statistics.averageDays, 7);
});

test("response duration definition declares strict source with no fallbacks", () => {
  assert.deepEqual(STRICT_ORIGINAL_DURATION_DEFINITION, {
    measure: "HISTORICAL_PLANNED_WORK_PACKAGE_DURATION",
    aggregation: "MAX_ACTIVITY_ORIGINAL_DURATION",
    source: "ACTIVITY_SNAPSHOT_ORIGINAL_DURATION",
    liveFallbackSource: "CURRENT_BEST_PLANNING_DURATION_NORMALISED_FROM_P6_HOURS",
    unit: "PLANNING_DAYS",
    fallbacksPossible: false,
  });
});

test("project without snapshots contributes current activity Best planning duration", () => {
  const [item] = computeStrictOriginalDurationItems(
    [persistedTarget],
    [],
    [
      {
        projectId: "live-project",
        deliverables: [
          {
            deliverableId: "live-reinforcement",
            name: "Rebar Detailing",
            classification: "DESIGN",
            fragnetName: "Structures",
            bestDuration: 30,
            activities: [{ bestDuration: 7 }, { bestDuration: 12 }],
          },
        ],
      },
    ]
  );

  assert.deepEqual(item.statistics, {
    available: true,
    projectsUsed: 1,
    sampleCount: 1,
    minimumDays: 1.5,
    averageDays: 1.5,
    maximumDays: 1.5,
  });
  assert.equal(item.comparisonBasis, "SAME_DISCIPLINE");
});

test("live project falls back to deliverable Best duration when no activities exist", () => {
  const [item] = computeStrictOriginalDurationItems(
    [persistedTarget],
    [],
    [
      {
        projectId: "legacy-import",
        deliverables: [
          {
            deliverableId: "legacy-reinforcement",
            name: "CE329 - Reinforcement detailing - facade interface",
            classification: null,
            fragnetName: null,
            bestDuration: 18,
            activities: [],
          },
        ],
      },
    ]
  );

  assert.equal(item.statistics.projectsUsed, 1);
  assert.equal(item.statistics.minimumDays, 2.25);
  assert.equal(item.statistics.averageDays, 2.3);
});

test("latest snapshot takes precedence and live data for that project is ignored", () => {
  const snapshots = [
    snapshot({
      id: "older",
      projectId: "same-project",
      importedAt: "2025-06-01",
      programmeState: "AS_BUILT",
      originals: [20],
      snapshotVersion: 1,
    }),
    snapshot({
      id: "latest",
      projectId: "same-project",
      importedAt: "2025-07-01",
      programmeState: "LIVE_UPDATE",
      originals: [14],
      snapshotVersion: 2,
    }),
  ];
  const liveProjects = [
    {
      projectId: "same-project",
      deliverables: [
        {
          deliverableId: "live-reinforcement",
          name: "Reinforcement Detailing",
          classification: "DESIGN",
          fragnetName: null,
          bestDuration: 99,
          activities: [{ bestDuration: 99 }],
        },
      ],
    },
  ];

  const [item] = computeStrictOriginalDurationItems(
    [persistedTarget],
    snapshots,
    liveProjects
  );

  assert.equal(item.statistics.projectsUsed, 1);
  assert.equal(item.statistics.averageDays, 14);
});

test("unavailable reasons distinguish missing matches from unusable planning data", () => {
  const [noMatch] = computeStrictOriginalDurationItems(
    [persistedTarget],
    [],
    [{ projectId: "p1", deliverables: [] }]
  );
  const [noDuration] = computeStrictOriginalDurationItems(
    [persistedTarget],
    [],
    [
      {
        projectId: "p1",
        deliverables: [
          {
            deliverableId: "matching",
            name: "Reinforcement Detailing",
            classification: "DESIGN",
            fragnetName: null,
            bestDuration: 0,
            activities: [{ bestDuration: 0 }],
          },
        ],
      },
    ]
  );

  assert.equal(noMatch.unavailableReason, "NO_MATCHING_DELIVERABLES");
  assert.equal(noDuration.unavailableReason, "NO_HISTORICAL_PLANNING_DATA");
});

test("all current planning fallbacks normalise Primavera hours to planning days", () => {
  assert.equal(currentPlanningDurationDays(105), 13.13);
  assert.equal(currentPlanningDurationDays(8), 1);
  assert.equal(currentPlanningDurationDays(0), null);
  assert.equal(currentPlanningDurationDays(null), null);
});

test("comparison evidence prefers Same Fragnet over broader matching projects", () => {
  const target = { ...persistedTarget, fragnetName: "Structures" };
  const liveProjects = [
    {
      projectId: "same-fragnet",
      deliverables: [
        {
          deliverableId: "same-fragnet-deliverable",
          name: "Reinforcement Detailing",
          classification: "DESIGN",
          fragnetName: "Structures",
          bestDuration: 80,
          activities: [],
        },
      ],
    },
    {
      projectId: "same-discipline",
      deliverables: [
        {
          deliverableId: "same-discipline-deliverable",
          name: "Reinforcement Detailing",
          classification: "DESIGN",
          fragnetName: "Foundations",
          bestDuration: 160,
          activities: [],
        },
      ],
    },
  ];

  const [item] = computeStrictOriginalDurationItems([target], [], liveProjects);

  assert.equal(item.comparisonBasis, "SAME_FRAGNET");
  assert.equal(item.statistics.projectsUsed, 1);
  assert.equal(item.statistics.averageDays, 10);
});

test("same wording does not match when engineering disciplines differ", () => {
  const target = {
    ...persistedTarget,
    name: "Design Review",
    fragnetName: "Structures",
  };
  const [item] = computeStrictOriginalDurationItems(
    [target],
    [],
    [
      {
        projectId: "other-discipline",
        deliverables: [
          {
            deliverableId: "other-discipline-deliverable",
            name: "Design Review",
            classification: "DESIGN",
            fragnetName: "Mechanical",
            bestDuration: 40,
            activities: [],
          },
        ],
      },
    ]
  );

  assert.equal(item.comparisonBasis, null);
  assert.equal(item.statistics.available, false);
  assert.equal(item.unavailableReason, "NO_MATCHING_DELIVERABLES");
});

test("canonical work package identity matches different reinforcement wording", () => {
  const [item] = computeStrictOriginalDurationItems(
    [persistedTarget],
    [],
    [
      {
        projectId: "wording-variant",
        projectName: "Wording Variant Project",
        deliverables: [
          {
            deliverableId: "variant",
            name: "RDDB047 Reinforcement Detailing - Platforms 7/8",
            classification: "DESIGN",
            fragnetName: "Structures",
            bestDuration: 80,
            activities: [],
          },
        ],
      },
    ]
  );

  assert.equal(item.statistics.available, true);
  assert.equal(item.statistics.averageDays, 10);
});

test("discipline and document type match unknown fire technical-note wording", () => {
  const fireTarget = {
    ...persistedTarget,
    name: "Updated Technical Note - Fire",
    fragnetName: "Fire Engineering",
  };
  const [item] = computeStrictOriginalDurationItems(
    [fireTarget],
    [],
    [
      {
        projectId: "fire-history",
        projectName: "Fire History",
        deliverables: [
          {
            deliverableId: "fire-note",
            name: "Technical Note - Fire Safety Engineering",
            classification: "DESIGN",
            fragnetName: "Fire Safety Engineering",
            bestDuration: 40,
            activities: [],
          },
        ],
      },
    ]
  );

  assert.equal(item.statistics.available, true);
  assert.equal(item.statistics.averageDays, 5);
});

test("technical notes from different disciplines never match by wording alone", () => {
  const fireTarget = {
    ...persistedTarget,
    name: "Updated Technical Note - Fire",
    fragnetName: "Fire Engineering",
  };
  const [item] = computeStrictOriginalDurationItems(
    [fireTarget],
    [],
    [
      {
        projectId: "mechanical-history",
        projectName: "Mechanical History",
        deliverables: [
          {
            deliverableId: "mechanical-note",
            name: "Updated Technical Note - Mechanical",
            classification: "DESIGN",
            fragnetName: "Mechanical Services",
            bestDuration: 40,
            activities: [],
          },
        ],
      },
    ]
  );

  assert.equal(item.statistics.available, false);
  assert.equal(item.unavailableReason, "NO_MATCHING_DELIVERABLES");
});

test("historical comparison rejects taxonomy false positives when engineering identity differs", () => {
  const cases = [
    {
      target: {
        name: "Primary Steelwork (Plant Screen)",
        fragnetName: "Level 11",
      },
      candidate: {
        name: "TC-314 - EI-613 - Conventional station steelwork and cladding - EoP Lifts Cladding",
        fragnetName: null,
      },
    },
    {
      target: {
        name: "VI-052 Link Bridge - Option 1 (Early Stage 3 Structural Analysis)",
        fragnetName: "Link Structure",
      },
      candidate: {
        name: "Detailed Design - Southern Stockpile Benefits Analysis",
        fragnetName: "Detailed Design",
      },
    },
    {
      target: {
        name: "Core General Arrangements",
        fragnetName: "Structural Design",
      },
      candidate: {
        name: "Detailed Design - Foundation Drawing Pack",
        fragnetName: "Detailed Design",
      },
    },
  ];

  for (const item of cases) {
    const [result] = computeStrictOriginalDurationItems(
      [{ ...persistedTarget, ...item.target }],
      [],
      [
        {
          projectId: "historical-project",
          projectName: "Historical Project",
          deliverables: [
            {
              deliverableId: "historical-candidate",
              ...item.candidate,
              classification: "DESIGN",
              bestDuration: 40,
              activities: [],
            },
          ],
        },
      ]
    );

    assert.equal(result.statistics.available, false, `${item.target.name} should reject`);
    assert.equal(result.unavailableReason, "NO_MATCHING_DELIVERABLES");
    assert.deepEqual(result.contributingProjects, []);
  }
});

test("developer-modified decision on target unlocks historical matching", () => {
  const targetName = "VI-045 - Generator Compound — Work package";
  const targetRaw = rawIdentity(targetName, { fragnetName: "VI-045 - Generator Compound" });
  const referenceRaw = reinforcementReferenceIdentity();
  assert.equal(targetRaw.status, "INSUFFICIENT");
  assert.equal(referenceRaw.status, "RESOLVED");

  const knowledge = new Map([
    storedDecision(targetName, targetRaw, {
      discipline: referenceRaw.discipline.id,
      engineeringObject: referenceRaw.engineeringObject.id,
      engineeringWork: referenceRaw.engineeringWork.id,
      deliverableType: null,
      lifecycleStage: null,
    }),
  ]);

  const snapshots = [
    snapshot({
      id: "p1-history",
      projectId: "p1",
      importedAt: "2025-01-01",
      programmeState: "AS_BUILT",
      originals: [8],
    }),
  ];
  const target = {
    ...persistedTarget,
    name: targetName,
    fragnetName: "VI-045 - Generator Compound",
  };

  const [withoutReview] = computeStrictOriginalDurationItems(
    [target],
    snapshots,
    [],
    knowledge,
    false
  );
  assert.equal(withoutReview.statistics.available, false);

  const [withReview] = computeStrictOriginalDurationItems(
    [target],
    snapshots,
    [],
    knowledge,
    true
  );
  assert.equal(withReview.statistics.available, true);
  assert.equal(withReview.statistics.averageDays, 8);
});

test("developer-modified decision on candidate contributes duration sample", () => {
  const candidateName = "Drainage Strategy";
  const candidateRaw = rawIdentity(candidateName);
  const referenceRaw = reinforcementReferenceIdentity();
  const knowledge = new Map([
    storedDecision(candidateName, candidateRaw, {
      discipline: referenceRaw.discipline.id,
      engineeringObject: referenceRaw.engineeringObject.id,
      engineeringWork: referenceRaw.engineeringWork.id,
      deliverableType: null,
      lifecycleStage: null,
    }),
  ]);

  const snapshots = [
    snapshot({
      id: "p1-drainage",
      projectId: "p1",
      importedAt: "2025-01-01",
      programmeState: "AS_BUILT",
      originals: [12],
      deliverables: [deliverable({ name: candidateName })],
    }),
  ];

  const [withoutReview] = computeStrictOriginalDurationItems(
    [persistedTarget],
    snapshots,
    [],
    knowledge,
    false
  );
  assert.equal(withoutReview.statistics.available, false);

  const [withReview] = computeStrictOriginalDurationItems(
    [persistedTarget],
    snapshots,
    [],
    knowledge,
    true
  );
  assert.equal(withReview.statistics.available, true);
  assert.equal(withReview.statistics.averageDays, 12);
});

test("rejected fingerprint is excluded as target and as candidate", () => {
  const referenceRaw = reinforcementReferenceIdentity();
  const rejectedTargetName = "Generator Compound Stage 3 Complete";
  const rejectedTargetRaw = rawIdentity(rejectedTargetName);
  const targetKnowledge = new Map([
    storedDecision(
      rejectedTargetName,
      rejectedTargetRaw,
      {
        discipline: referenceRaw.discipline.id,
        engineeringObject: referenceRaw.engineeringObject.id,
        engineeringWork: referenceRaw.engineeringWork.id,
        deliverableType: null,
        lifecycleStage: null,
      },
      "REJECTED"
    ),
  ]);
  const historySnapshots = [
    snapshot({
      id: "p1-history",
      projectId: "p1",
      importedAt: "2025-01-01",
      programmeState: "AS_BUILT",
      originals: [8],
    }),
  ];

  const [rejectedTarget] = computeStrictOriginalDurationItems(
    [{ ...persistedTarget, name: rejectedTargetName }],
    historySnapshots,
    [],
    targetKnowledge,
    true
  );
  assert.equal(rejectedTarget.statistics.available, false);
  assert.equal(rejectedTarget.unavailableReason, "NO_MATCHING_DELIVERABLES");

  const candidateName = "Drainage Strategy";
  const candidateRaw = rawIdentity(candidateName);
  const candidateKnowledge = new Map([
    storedDecision(
      candidateName,
      candidateRaw,
      {
        discipline: referenceRaw.discipline.id,
        engineeringObject: referenceRaw.engineeringObject.id,
        engineeringWork: referenceRaw.engineeringWork.id,
        deliverableType: null,
        lifecycleStage: null,
      },
      "REJECTED"
    ),
  ]);
  const mixedSnapshots = [
    snapshot({
      id: "p1-rejected-candidate",
      projectId: "p1",
      importedAt: "2025-01-01",
      programmeState: "AS_BUILT",
      originals: [99],
      deliverables: [deliverable({ name: candidateName })],
    }),
    snapshot({
      id: "p2-good-candidate",
      projectId: "p2",
      importedAt: "2025-02-01",
      programmeState: "AS_BUILT",
      originals: [10],
    }),
  ];

  const [rejectedCandidateResult] = computeStrictOriginalDurationItems(
    [persistedTarget],
    mixedSnapshots,
    [],
    candidateKnowledge,
    true
  );
  assert.equal(rejectedCandidateResult.statistics.available, true);
  assert.equal(rejectedCandidateResult.statistics.averageDays, 10);
  assert.equal(rejectedCandidateResult.contributingProjects.length, 1);
  assert.equal(rejectedCandidateResult.contributingProjects[0]?.projectId, "p2");
});

test("knowledge store unavailable skips lookup and preserves pre-wiring behavior", () => {
  const targetName = "VI-045 - Generator Compound — Work package";
  const targetRaw = rawIdentity(targetName, { fragnetName: "VI-045 - Generator Compound" });
  const referenceRaw = reinforcementReferenceIdentity();
  const knowledge = new Map([
    storedDecision(targetName, targetRaw, {
      discipline: referenceRaw.discipline.id,
      engineeringObject: referenceRaw.engineeringObject.id,
      engineeringWork: referenceRaw.engineeringWork.id,
      deliverableType: null,
      lifecycleStage: null,
    }),
  ]);
  const snapshots = [
    snapshot({
      id: "p1-history",
      projectId: "p1",
      importedAt: "2025-01-01",
      programmeState: "AS_BUILT",
      originals: [8],
    }),
  ];
  const target = {
    ...persistedTarget,
    name: targetName,
    fragnetName: "VI-045 - Generator Compound",
  };

  const [baseline] = computeStrictOriginalDurationItems([target], snapshots, []);
  const [withMapDisabled] = computeStrictOriginalDurationItems(
    [target],
    snapshots,
    [],
    knowledge,
    false
  );
  const [withReviewEnabled] = computeStrictOriginalDurationItems(
    [target],
    snapshots,
    [],
    knowledge,
    true
  );

  assert.deepEqual(withMapDisabled, baseline);
  assert.equal(baseline.statistics.available, false);
  assert.equal(withReviewEnabled.statistics.available, true);
});

test("uniform deliverable names still pool into historical statistics", () => {
  const snapshots = [
    snapshot({
      id: "p1-same",
      projectId: "p1",
      importedAt: "2025-01-01",
      programmeState: "AS_BUILT",
      originals: [6],
    }),
    snapshot({
      id: "p2-same",
      projectId: "p2",
      importedAt: "2025-02-01",
      programmeState: "AS_BUILT",
      originals: [8],
    }),
  ];

  const [item] = computeStrictOriginalDurationItems([persistedTarget], snapshots);

  assert.equal(item.statistics.available, true);
  assert.equal(item.contributingProjects.length, 2);
});

test("legitimate reinforcement wording variants still match via engineering identity", () => {
  const targetName = "Reinforcement Detailing";
  const variantNames = ["Rebar Detailing", "Reinforcement Detail Drawings"];
  // Pre-fix baselines (naive Jaccard, no stemming / no vocab): 0.333 and 0.25.
  const BEFORE_REBAR = 1 / 3;
  const BEFORE_DRAWINGS = 0.25;

  const liveProjects = variantNames.map((name, index) => ({
    projectId: `wording-variant-${index}`,
    projectName: `Wording Variant Project ${index + 1}`,
    deliverables: [
      {
        deliverableId: `variant-${index}`,
        name,
        classification: "DESIGN",
        fragnetName: "Structures",
        bestDuration: 80,
        activities: [],
      },
    ],
  }));

  const [item] = computeStrictOriginalDurationItems(
    [{ ...persistedTarget, name: targetName }],
    [],
    liveProjects
  );

  assert.equal(item.statistics.available, true);
  assert.equal(item.statistics.projectsUsed, 2);
  assert.equal(item.statistics.averageDays, 10);

  const rebarScore = nameSimilarity(targetName, "Rebar Detailing");
  const drawingsScore = nameSimilarity(targetName, "Reinforcement Detail Drawings");

  console.log(
    `[wording-variant] BEFORE rebar=${BEFORE_REBAR.toFixed(3)} drawings=${BEFORE_DRAWINGS.toFixed(3)}; ` +
      `AFTER rebar=${rebarScore.toFixed(3)} drawings=${drawingsScore.toFixed(3)}`
  );

  assert.ok(rebarScore > BEFORE_REBAR, `rebar score should improve on ${BEFORE_REBAR}`);
  assert.ok(drawingsScore > BEFORE_DRAWINGS, `drawings score should improve on ${BEFORE_DRAWINGS}`);
  assert.ok(
    rebarScore >= LOW_NAME_CONSISTENCY_THRESHOLD,
    `rebar should clear threshold (${LOW_NAME_CONSISTENCY_THRESHOLD}), got ${rebarScore}`
  );
  assert.ok(
    drawingsScore >= LOW_NAME_CONSISTENCY_THRESHOLD,
    `drawings should clear threshold (${LOW_NAME_CONSISTENCY_THRESHOLD}), got ${drawingsScore}`
  );
});

test("Meetings plural/singular stemming lifts live 0% similarity pair", () => {
  const a = "Meetings — Work package";
  const b =
    "RDDB015 - Review Information, Go/No-Go meeting & Instruction to Proceed";
  const BEFORE = 0;
  const score = nameSimilarity(a, b);
  console.log(
    `[meetings stemming] BEFORE=${BEFORE.toFixed(3)} AFTER=${score.toFixed(3)}`
  );
  assert.ok(score > BEFORE, "stemming must create a shared meeting token");
  assert.ok(score > 0);
});

test("vocabulary synonym pairs beyond reinforcement/rebar canonicalize", () => {
  // Pull multi-pattern rules from ENGINEERING_OBJECT_RULES:
  // foundations: foundations / footings; drainage: drainage / sanitary; lift: lifts / elevators
  const cases = [
    {
      label: "foundations/footings",
      a: "Foundation Design",
      b: "Footing Design",
      before: 1 / 3, // {foundation, design} vs {footing, design} → 1/3 without vocab+stem
    },
    {
      label: "drainage/sanitary",
      a: "Drainage Design",
      b: "Sanitary Design",
      before: 1 / 3,
    },
    {
      label: "lift/elevator",
      a: "Lift Layout",
      b: "Elevator Layout",
      before: 1 / 3,
    },
  ];

  for (const c of cases) {
    const score = nameSimilarity(c.a, c.b);
    console.log(
      `[vocab synonym ${c.label}] BEFORE≈${c.before.toFixed(3)} AFTER=${score.toFixed(3)}`
    );
    assert.ok(
      score > c.before,
      `${c.label}: expected improvement over ~${c.before}, got ${score}`
    );
    assert.ok(
      score >= LOW_NAME_CONSISTENCY_THRESHOLD,
      `${c.label}: expected ≥ ${LOW_NAME_CONSISTENCY_THRESHOLD}, got ${score}`
    );
  }
});

test("GET-milestones-style pooling keeps durations without filtering by name similarity", () => {
  const milestoneIdentityFields = {
    discipline: "project_management",
    engineeringObject: "project_management",
    engineeringWork: "milestone",
    deliverableType: null,
    lifecycleStage: null,
  };
  const targetName = "Enabling Works";
  const candidateNames = ["Readiness Milestone", "Architectural Setting Out"];
  const knowledge = new Map([
    storedDecision(targetName, rawIdentity(targetName), milestoneIdentityFields),
    storedDecision(
      candidateNames[0],
      rawIdentity(candidateNames[0]),
      milestoneIdentityFields
    ),
    storedDecision(
      candidateNames[1],
      rawIdentity(candidateNames[1]),
      milestoneIdentityFields
    ),
  ]);
  const snapshots = [
    snapshot({
      id: "p1-milestone",
      projectId: "p1",
      importedAt: "2025-01-01",
      programmeState: "AS_BUILT",
      originals: [2],
      deliverables: [deliverable({ name: candidateNames[0] })],
    }),
    snapshot({
      id: "p2-milestone",
      projectId: "p2",
      importedAt: "2025-02-01",
      programmeState: "AS_BUILT",
      originals: [5],
      deliverables: [deliverable({ name: candidateNames[1] })],
    }),
  ];
  const target = { ...persistedTarget, name: targetName, classification: null };

  const [item] = computeStrictOriginalDurationItems(
    [target],
    snapshots,
    [],
    knowledge,
    true
  );

  assert.equal(item.statistics.available, true);
  assert.equal(item.statistics.minimumDays, 2);
  assert.equal(item.statistics.averageDays, 3.5);
  assert.equal(item.statistics.maximumDays, 5);
  assert.equal(item.contributingProjects.length, 2);

  // Direct score guard: stemming/vocab must not invent similarity across genuine different names.
  const s1 = nameSimilarity(targetName, candidateNames[0]);
  const s2 = nameSimilarity(targetName, candidateNames[1]);
  const s3 = nameSimilarity(candidateNames[0], candidateNames[1]);
  console.log(
    `[GET-milestones regression] Enabling↔Readiness=${s1.toFixed(3)} ` +
      `Enabling↔Architectural=${s2.toFixed(3)} Readiness↔Architectural=${s3.toFixed(3)}`
  );
  assert.ok(s1 < LOW_NAME_CONSISTENCY_THRESHOLD);
  assert.ok(s2 < LOW_NAME_CONSISTENCY_THRESHOLD);
  assert.ok(s3 < LOW_NAME_CONSISTENCY_THRESHOLD);
});

test("GET-shared token must not inflate similarity across different deliverables", () => {
  // Regression: incidental shared tokens like "GET" must not make genuinely different
  // deliverables look similar after stemming/canonicalization.
  const pairs = [
    ["GET - Enabling Works", "GET - Architectural Setting Out"],
    ["GET - Final BWIC", "GET - Receive drainage"],
    ["GET - Confirm BWIC receipt", "GET - Receive drainage flow rates"],
  ];
  for (const [a, b] of pairs) {
    const score = nameSimilarity(a, b);
    console.log(`[GET-shared-token regression] "${a}" ↔ "${b}" = ${score.toFixed(3)}`);
    assert.ok(
      score < LOW_NAME_CONSISTENCY_THRESHOLD,
      `shared GET must not clear threshold: ${a} vs ${b} scored ${score}`
    );
  }

  // BWIC vs Drainage with only GET in common: baseline Jaccard is 1/3 ≈ 0.333 —
  // stemming/vocab must not push this any higher (would clear / stay at the flag boundary).
  const getBwicVsDrainage = nameSimilarity("GET - BWIC", "GET - Drainage");
  console.log(
    `[GET-shared-token regression] "GET - BWIC" ↔ "GET - Drainage" = ${getBwicVsDrainage.toFixed(3)} (baseline 0.333)`
  );
  assert.ok(
    getBwicVsDrainage <= 1 / 3 + 1e-9,
    `GET+BWIC vs GET+Drainage must not exceed pre-fix Jaccard 1/3, got ${getBwicVsDrainage}`
  );
});

test("Secondary-Steelwork-style names stay low on nameSimilarity helper while still pooling", () => {
  // Ceilings / Elevations / Partitions / Ambulance Bay Canopy pool taxonomically
  // under steelwork detailing but are semantically different names — flag must stay.
  const cluster = [
    "Ceilings",
    "Elevations",
    "Partitions",
    "Ambulance Bay Canopy",
  ];
  const scores = [];
  for (let i = 0; i < cluster.length; i++) {
    for (let j = i + 1; j < cluster.length; j++) {
      const score = nameSimilarity(cluster[i], cluster[j]);
      scores.push({ a: cluster[i], b: cluster[j], score });
      assert.ok(
        score < LOW_NAME_CONSISTENCY_THRESHOLD,
        `${cluster[i]} vs ${cluster[j]} should stay low, got ${score}`
      );
    }
  }

  const steelworkIdentityFields = {
    discipline: "structural",
    engineeringObject: "steelwork",
    engineeringWork: "detailing",
    deliverableType: "drawing",
    lifecycleStage: "stage_3",
  };
  const targetName = cluster[0];
  const knowledge = new Map([
    storedDecision(targetName, rawIdentity(targetName), steelworkIdentityFields),
    ...cluster.slice(1).map((name) =>
      storedDecision(name, rawIdentity(name), steelworkIdentityFields)
    ),
  ]);
  const snapshots = cluster.slice(1).map((name, index) =>
    snapshot({
      id: `ss-${index}`,
      projectId: `ss-p${index}`,
      importedAt: `2025-0${index + 1}-01`,
      programmeState: "AS_BUILT",
      originals: [2 + index],
      deliverables: [deliverable({ name })],
    })
  );
  const [item] = computeStrictOriginalDurationItems(
    [{ ...persistedTarget, name: targetName, classification: null }],
    snapshots,
    [],
    knowledge,
    true
  );

  console.log(
    `[Secondary-Steelwork regression] pairwise=${scores
      .map((s) => `${s.a}↔${s.b}=${s.score.toFixed(3)}`)
      .join(", ")}`
  );

  assert.equal(item.statistics.available, true);
  assert.equal(item.contributingProjects.length, 3);
});

test("Phase 2: candidate with stored reasoned identity is preferred over rule-based", () => {
  // Rule-based: "Cofferdam Installation" does not match "Reinforcement Detailing".
  // With reasoned* fields set to the reinforcement identity, it should match.
  const snapshots = [
    snapshot({
      id: "p1-reasoned-candidate",
      projectId: "p1",
      importedAt: "2025-01-01",
      programmeState: "AS_BUILT",
      originals: [7],
      deliverables: [
        deliverable({
          name: "Cofferdam Installation",
          deliverableId: "historical-deliverable",
          reasoningSource: "LLM_REASONED",
          reasonedDiscipline: "structural",
          reasonedEngineeringObject: "reinforcement",
          reasonedEngineeringWork: "detailing",
          reasonedDeliverableType: null,
          reasonedLifecycleStage: null,
        }),
      ],
    }),
  ];

  const [withoutReasoning] = computeStrictOriginalDurationItems(
    [persistedTarget],
    [
      snapshot({
        id: "p1-rule",
        projectId: "p1",
        importedAt: "2025-01-01",
        programmeState: "AS_BUILT",
        originals: [7],
        deliverables: [deliverable({ name: "Cofferdam Installation" })],
      }),
    ]
  );
  assert.equal(withoutReasoning.statistics.available, false);

  const [withReasoning] = computeStrictOriginalDurationItems([persistedTarget], snapshots);
  assert.equal(withReasoning.statistics.available, true);
  assert.equal(withReasoning.statistics.averageDays, 7);
  assert.equal(withReasoning.statistics.projectsUsed, 1);
});

test("Phase 2: null reasoningSource falls back to rule-based candidate identity", () => {
  const snapshots = [
    snapshot({
      id: "p1-null-source",
      projectId: "p1",
      importedAt: "2025-01-01",
      programmeState: "AS_BUILT",
      originals: [7],
      deliverables: [
        deliverable({
          name: "Cofferdam Installation",
          // Explicit nulls — older snapshot row shape
          reasoningSource: null,
          reasonedDiscipline: "structural",
          reasonedEngineeringObject: "reinforcement",
          reasonedEngineeringWork: "detailing",
        }),
      ],
    }),
  ];
  const [item] = computeStrictOriginalDurationItems([persistedTarget], snapshots);
  // Reasoned columns ignored when reasoningSource is null — cofferdam still doesn't match.
  assert.equal(item.statistics.available, false);
});

test("Phase 2: GET-Milestones — reasoned candidates separate previously-pooled deliverables", () => {
  const milestoneIdentityFields = {
    discipline: "project_management",
    engineeringObject: "project_management",
    engineeringWork: "milestone",
    deliverableType: null,
    lifecycleStage: null,
  };
  const targetName = "Enabling Works";
  const knowledge = new Map([
    storedDecision(targetName, rawIdentity(targetName), milestoneIdentityFields),
    storedDecision("BWIC", rawIdentity("BWIC"), milestoneIdentityFields),
    storedDecision("Drainage", rawIdentity("Drainage"), milestoneIdentityFields),
  ]);

  const pooledSnapshots = [
    snapshot({
      id: "p1-bwic",
      projectId: "p1",
      importedAt: "2025-01-01",
      programmeState: "AS_BUILT",
      originals: [3],
      deliverables: [deliverable({ name: "BWIC", deliverableId: "d-bwic" })],
      activities: [{ deliverableId: "d-bwic", originalDuration: 3 }],
    }),
    snapshot({
      id: "p2-drainage",
      projectId: "p2",
      importedAt: "2025-02-01",
      programmeState: "AS_BUILT",
      originals: [9],
      deliverables: [deliverable({ name: "Drainage", deliverableId: "d-drainage" })],
      activities: [{ deliverableId: "d-drainage", originalDuration: 9 }],
    }),
  ];

  const [pooled] = computeStrictOriginalDurationItems(
    [{ ...persistedTarget, name: targetName, classification: null }],
    pooledSnapshots,
    [],
    knowledge,
    true
  );
  assert.equal(pooled.statistics.available, true);
  assert.equal(pooled.statistics.projectsUsed, 2, "rule-based+knowledge pools BWIC and Drainage together");
  assert.equal(pooled.statistics.minimumDays, 3);
  assert.equal(pooled.statistics.maximumDays, 9);

  // Reasoned candidates: Drainage aligns with a drainage-specific target identity;
  // BWIC has a different reasoned identity and must drop out of the pool.
  const drainageIdentity = {
    status: "RESOLVED",
    discipline: { id: "public_health", label: "public_health", evidence: [] },
    engineeringObject: { id: "drainage", label: "drainage", evidence: [] },
    engineeringWork: { id: "coordination", label: "coordination", evidence: [] },
    deliverableType: { id: null, label: null, evidence: [] },
    lifecycleStage: { id: null, label: null, evidence: [] },
    projectContext: { id: null, label: null, evidence: [] },
    fragnetContext: { id: null, label: null, evidence: [] },
    taxonomy: {
      taxonomyKey: null,
      categoryId: null,
      workPackageId: null,
      isUnknownWorkPackage: false,
    },
    supportingEvidence: [],
  };
  const reasonedSnapshots = [
    snapshot({
      id: "p1-bwic-r",
      projectId: "p1",
      importedAt: "2025-01-01",
      programmeState: "AS_BUILT",
      originals: [3],
      deliverables: [
        deliverable({
          name: "BWIC",
          deliverableId: "d-bwic",
          reasoningSource: "LLM_REASONED",
          reasonedDiscipline: null,
          reasonedEngineeringObject: null,
          reasonedEngineeringWork: "coordination",
        }),
      ],
      activities: [{ deliverableId: "d-bwic", originalDuration: 3 }],
    }),
    snapshot({
      id: "p2-drainage-r",
      projectId: "p2",
      importedAt: "2025-02-01",
      programmeState: "AS_BUILT",
      originals: [9],
      deliverables: [
        deliverable({
          name: "Drainage",
          deliverableId: "d-drainage",
          reasoningSource: "LLM_REASONED",
          reasonedDiscipline: "public_health",
          reasonedEngineeringObject: "drainage",
          reasonedEngineeringWork: "coordination",
        }),
      ],
      activities: [{ deliverableId: "d-drainage", originalDuration: 9 }],
    }),
  ];

  const targetKey = "current-deliverable";
  const reasonedTargets = new Map([[targetKey, drainageIdentity]]);
  const [separated] = computeStrictOriginalDurationItems(
    [{ ...persistedTarget, key: targetKey, name: targetName, classification: null }],
    reasonedSnapshots,
    [],
    new Map(), // no knowledge override — reasoned identities decide
    false,
    reasonedTargets
  );

  console.log(
    `[GET-Milestones Phase 2] pooled projectsUsed=${pooled.statistics.projectsUsed} ` +
      `min=${pooled.statistics.minimumDays} max=${pooled.statistics.maximumDays}; ` +
      `reasoned projectsUsed=${separated.statistics.projectsUsed} ` +
      `available=${separated.statistics.available} ` +
      `min=${separated.statistics.minimumDays} avg=${separated.statistics.averageDays} max=${separated.statistics.maximumDays}`
  );

  assert.equal(separated.statistics.available, true);
  assert.equal(separated.statistics.projectsUsed, 1, "only Drainage remains equivalent under reasoned identities");
  assert.equal(separated.statistics.minimumDays, 9);
  assert.equal(separated.statistics.averageDays, 9);
  assert.equal(separated.statistics.maximumDays, 9);
  assert.equal(separated.contributingProjects[0]?.matchedDeliverableName, "Drainage");
});
