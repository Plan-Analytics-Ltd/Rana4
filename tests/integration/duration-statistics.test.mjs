import test from "node:test";
import assert from "node:assert/strict";
import { computeDurationStatistics } from "../../dist/services/intelligence/statistics/durationStatistics.service.js";

const HOSPITAL_MATCHES = [
  { projectId: "p-a", projectName: "Hospital A", deliverableName: "Reinforcement Detailing", durationDays: 6 },
  { projectId: "p-b", projectName: "Hospital B", deliverableName: "Reinforcement Detailing", durationDays: 8 },
  { projectId: "p-c", projectName: "Hospital C", deliverableName: "Reinforcement Detailing", durationDays: 5 },
];

test("computes min, average, and max from matched deliverables", () => {
  const stats = computeDurationStatistics(HOSPITAL_MATCHES);

  assert.equal(stats.available, true);
  assert.equal(stats.projectsUsed, 3);
  assert.equal(stats.sampleCount, 3);
  assert.equal(stats.minimumDays, 5);
  assert.equal(stats.averageDays, 6.3);
  assert.equal(stats.maximumDays, 8);
});

test("lists every project entry with its duration", () => {
  const stats = computeDurationStatistics(HOSPITAL_MATCHES);

  assert.equal(stats.entries.length, 3);
  assert.deepEqual(stats.entries[0], {
    projectName: "Hospital A",
    deliverableName: "Reinforcement Detailing",
    durationDays: 6,
  });
  assert.ok(stats.entries.every((e) => e.deliverableName === "Reinforcement Detailing"));
});

test("empty input produces unavailable statistics", () => {
  const stats = computeDurationStatistics([]);

  assert.equal(stats.available, false);
  assert.equal(stats.projectsUsed, 0);
  assert.equal(stats.minimumDays, null);
  assert.equal(stats.averageDays, null);
  assert.equal(stats.maximumDays, null);
  assert.deepEqual(stats.entries, []);
});

test("excludes matches from the current project", () => {
  const stats = computeDurationStatistics(
    [
      ...HOSPITAL_MATCHES,
      { projectId: "current", projectName: "This Project", deliverableName: "Reinforcement Detailing", durationDays: 99 },
    ],
    { excludeProjectId: "current" }
  );

  assert.equal(stats.projectsUsed, 3);
  assert.equal(stats.maximumDays, 8);
  assert.ok(!stats.entries.some((e) => e.projectName === "This Project"));
});

test("ignores non-positive and non-finite durations", () => {
  const stats = computeDurationStatistics([
    ...HOSPITAL_MATCHES,
    { projectId: "p-d", projectName: "Hospital D", deliverableName: "Reinforcement Detailing", durationDays: 0 },
    { projectId: "p-e", projectName: "Hospital E", deliverableName: "Reinforcement Detailing", durationDays: NaN },
  ]);

  assert.equal(stats.sampleCount, 3);
  assert.equal(stats.projectsUsed, 3);
});

test("counts distinct projects when one project contributes multiple matches", () => {
  const stats = computeDurationStatistics([
    ...HOSPITAL_MATCHES,
    { projectId: "p-a", projectName: "Hospital A", deliverableName: "Reinforcement Detailing", durationDays: 7 },
  ]);

  assert.equal(stats.projectsUsed, 3);
  assert.equal(stats.sampleCount, 4);
  assert.equal(stats.averageDays, 6.5);
});
