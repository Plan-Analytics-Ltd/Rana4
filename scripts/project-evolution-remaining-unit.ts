/**
 * Unit checks for Project Evolution Remaining vs Planning helpers.
 * Run: npx tsx scripts/project-evolution-remaining-unit.ts
 */
import assert from "node:assert/strict";
import {
  classifyProgrammeStateChange,
  resolvePlanningDurationDays,
  resolveProgrammeRemainingDays,
} from "../src/services/intelligence/shared/deliverableProjectEvolution.service.ts";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("Project Evolution remaining/planning unit tests\n");

test("prefers Remaining for programme state even when Original differs", () => {
  const remaining = resolveProgrammeRemainingDays([
    { originalDuration: 5, remainingDuration: 10, actualDuration: null },
  ]);
  assert.equal(remaining, 10);
});

test("planning uses Original, not Remaining", () => {
  const planning = resolvePlanningDurationDays([
    { originalDuration: 5, remainingDuration: 10, actualDuration: null },
  ]);
  assert.equal(planning, 5);
});

test("classifies progress when remaining falls and planning is unchanged", () => {
  assert.equal(
    classifyProgrammeStateChange({
      remaining: 6,
      previousRemaining: 8,
      planning: 10,
      previousPlanning: 10,
    }),
    "progress"
  );
});

test("classifies replanning when planning changes", () => {
  assert.equal(
    classifyProgrammeStateChange({
      remaining: 15,
      previousRemaining: 6,
      planning: 15,
      previousPlanning: 10,
    }),
    "replanning"
  );
});

test("max across activities for remaining", () => {
  assert.equal(
    resolveProgrammeRemainingDays([
      { originalDuration: 5, remainingDuration: 3, actualDuration: null },
      { originalDuration: 8, remainingDuration: 12, actualDuration: null },
    ]),
    12
  );
});

console.log("\nAll project evolution remaining unit tests passed.");
