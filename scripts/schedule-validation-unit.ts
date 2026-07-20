/**
 * Unit checks for schedule validation (export page + milestone durations).
 * Run: cd frontend && npx tsx ../scripts/schedule-validation-unit.ts
 */
import {
  isActivityDurationValid,
  validateProjectSchedule,
} from "../frontend/lib/schedule-validation.ts";
import type { ProjectFullData } from "../frontend/lib/schedule-types.ts";

function miniProject(overrides: {
  activityCode?: string;
  p6TaskType?: string | null;
  bestDuration?: number;
  likelyDuration?: number;
  predCode?: string;
}): ProjectFullData {
  const code = overrides.activityCode ?? "A1001";
  const pred = overrides.predCode ?? "A1000";
  return {
    fragnets: [
      {
        id: "f1",
        name: "Fragnet",
        deliverables: [
          {
            id: "d1",
            name: "Del A",
            bestDuration: 5,
            likelyDuration: 5,
            relationships: { predecessors: [], successors: [] },
            activities: [
              {
                id: "a0",
                activityCode: pred,
                name: "Pred",
                bestDuration: 3,
                likelyDuration: 3,
                assignedResources: [],
                relationships: { predecessors: [], successors: [{ activityCode: code, relationshipType: "FS", lag: 0 }] },
              },
              {
                id: "a1",
                activityCode: code,
                name: "Succ",
                bestDuration: overrides.bestDuration ?? 5,
                likelyDuration: overrides.likelyDuration ?? 5,
                p6TaskType: overrides.p6TaskType ?? null,
                assignedResources: [],
                relationships: {
                  predecessors: [{ activityCode: pred, relationshipType: "FS", lag: 0 }],
                  successors: [],
                },
              },
            ],
          },
          {
            id: "d2",
            name: "Del B",
            bestDuration: 1,
            likelyDuration: 1,
            relationships: { predecessors: [], successors: [] },
            activities: [
              {
                id: "a2",
                activityCode: "A2000",
                name: "Other deliverable pred",
                bestDuration: 2,
                likelyDuration: 2,
                assignedResources: [],
                relationships: {
                  predecessors: [],
                  successors: [{ activityCode: "A2001", relationshipType: "FS", lag: 0 }],
                },
              },
              {
                id: "a3",
                activityCode: "A2001",
                name: "Other succ",
                bestDuration: 4,
                likelyDuration: 4,
                assignedResources: [],
                relationships: {
                  predecessors: [{ activityCode: "A2000", relationshipType: "FS", lag: 0 }],
                  successors: [],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("ok:", msg);
  }
}

// Milestone 0-day duration is valid when p6TaskType is set
assert(
  isActivityDurationValid({ bestDuration: 0, likelyDuration: 0, p6TaskType: "TT_FinMile" }, "best"),
  "milestone 0-day best duration valid"
);
assert(
  !isActivityDurationValid({ bestDuration: 0, likelyDuration: 0, p6TaskType: "TT_Task" }, "best"),
  "task 0-day duration still invalid"
);
assert(
  !isActivityDurationValid({ bestDuration: 0, likelyDuration: 0, p6TaskType: null }, "best"),
  "null p6TaskType 0-day still invalid (backwards compat)"
);

const milestoneIssues = validateProjectSchedule(
  miniProject({ activityCode: "A1160", p6TaskType: "TT_FinMile", bestDuration: 0, likelyDuration: 0 }),
  [],
  "best"
);
assert(
  !milestoneIssues.some((i) => i.code === "INVALID_DURATION"),
  "milestone no INVALID_DURATION in validation"
);

// Cross-deliverable orphan only appears on expanded export view, not persisted data
const persisted = miniProject({ activityCode: "A1022", predCode: "A1190" });
// Simulate cross-deliverable stale pred: A1022 references A1190 but A1190 only exists on another deliverable
persisted.fragnets[0]!.deliverables[1]!.activities.push({
  id: "a1190",
  activityCode: "A1190",
  name: "External pred",
  bestDuration: 1,
  likelyDuration: 1,
  assignedResources: [],
  relationships: { predecessors: [], successors: [] },
});
persisted.fragnets[0]!.deliverables[0]!.activities[1]!.relationships.predecessors = [
  { activityCode: "A1190", relationshipType: "FS", lag: 0 },
];
const rawOrphans = validateProjectSchedule(persisted, [], "best").filter((i) => i.code === "ORPHAN_PRED");

// Genuine orphan still detected when predecessor code is absent from the project
const orphan: ProjectFullData = {
  fragnets: [
    {
      id: "f1",
      name: "Fragnet",
      deliverables: [
        {
          id: "d1",
          name: "Del",
          bestDuration: 1,
          likelyDuration: 1,
          relationships: { predecessors: [], successors: [] },
          activities: [
            {
              id: "a1",
              activityCode: "A1001",
              name: "Succ",
              bestDuration: 5,
              likelyDuration: 5,
              assignedResources: [],
              relationships: {
                predecessors: [{ activityCode: "A9999", relationshipType: "FS", lag: 0 }],
                successors: [],
              },
            },
          ],
        },
      ],
    },
  ],
};
const genuine = validateProjectSchedule(orphan, [], "best").filter((i) => i.code === "ORPHAN_PRED");
assert(genuine.length === 1, "genuine missing predecessor still flagged");

// Export page validates persisted data (not expanded) — cross-deliverable preds stay valid
assert(rawOrphans.length === 0, "persisted cross-deliverable pred resolves (0 ORPHAN_PRED)");

if (failed > 0) {
  process.exit(1);
}
console.log("All schedule validation unit checks passed.");
