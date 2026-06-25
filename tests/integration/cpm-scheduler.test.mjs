/**
 * CPM scheduler unit tests (no database).
 * Run: npm run build && node --test scripts/cpm-scheduler.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateSchedule } from "../../dist/services/scheduling/scheduler.service.js";
import { addWorkingDays, defaultScheduleStart } from "../../dist/services/scheduling/calendar.service.js";

const start = defaultScheduleStart(new Date("2026-01-05")); // Monday

describe("CPM scheduler", () => {
  it("schedules linear FS chain", () => {
    const activities = [
      { id: "a1", activityCode: "A1", fragnetId: "f1", bestDuration: 2, likelyDuration: 2 },
      { id: "a2", activityCode: "A2", fragnetId: "f1", bestDuration: 3, likelyDuration: 3 },
    ];
    const relationships = [
      {
        id: "r1",
        predecessorActivityId: "a1",
        successorActivityId: "a2",
        relationshipType: "FS",
        lag: 0,
      },
    ];
    const result = calculateSchedule(activities, relationships, start, "best");
    assert.equal(result.ok, true);
    assert.equal(result.activities.length, 2);
    const a1 = result.activities.find((x) => x.id === "a1");
    const a2 = result.activities.find((x) => x.id === "a2");
    assert.ok(a1.isCritical);
    assert.ok(a2.isCritical);
    assert.equal(a1.totalFloat, 0);
    assert.equal(a2.totalFloat, 0);
    assert.ok(a2.earlyStart >= a1.earlyFinish);
  });

  it("detects cycles", () => {
    const activities = [
      { id: "a1", activityCode: "A1", fragnetId: "f1", bestDuration: 1, likelyDuration: 1 },
      { id: "a2", activityCode: "A2", fragnetId: "f1", bestDuration: 1, likelyDuration: 1 },
    ];
    const relationships = [
      { id: "r1", predecessorActivityId: "a1", successorActivityId: "a2", relationshipType: "FS", lag: 0 },
      { id: "r2", predecessorActivityId: "a2", successorActivityId: "a1", relationshipType: "FS", lag: 0 },
    ];
    const result = calculateSchedule(activities, relationships, start, "best");
    assert.equal(result.ok, false);
    assert.equal(result.activities.length, 0);
    assert.ok(result.network.cycleActivityIds.length > 0);
  });

  it("respects FS lag in working days", () => {
    const activities = [
      { id: "a1", activityCode: "A1", fragnetId: "f1", bestDuration: 1, likelyDuration: 1 },
      { id: "a2", activityCode: "A2", fragnetId: "f1", bestDuration: 1, likelyDuration: 1 },
    ];
    const relationships = [
      { id: "r1", predecessorActivityId: "a1", successorActivityId: "a2", relationshipType: "FS", lag: 2 },
    ];
    const result = calculateSchedule(activities, relationships, start, "best");
    assert.equal(result.ok, true);
    const a1 = result.activities.find((x) => x.id === "a1");
    const a2 = result.activities.find((x) => x.id === "a2");
    const expectedMin = addWorkingDays(a1.earlyFinish, 3);
    assert.ok(a2.earlyStart.getTime() >= expectedMin.getTime());
  });
});
