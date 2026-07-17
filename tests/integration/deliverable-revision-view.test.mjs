import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveDeliverableRevisionDurations,
  resolveLiveDeliverablePlanningDurations,
} from "../../dist/services/intelligence/shared/deliverableRevisionView.service.js";

describe("resolveDeliverableRevisionDurations (RANA planning model)", () => {
  it("preserves genuine 0-day milestone durations", () => {
    const result = resolveDeliverableRevisionDurations([
      { originalDuration: 0, remainingDuration: 0, actualDuration: 0 },
    ]);
    assert.equal(result.bestDuration, 0);
    assert.equal(result.likelyDuration, 0);
  });

  it("Best and Likely both use original; remaining does not drive likely", () => {
    const result = resolveDeliverableRevisionDurations([
      { originalDuration: 20, remainingDuration: 12, actualDuration: 5 },
    ]);
    assert.equal(result.bestDuration, 20);
    assert.equal(result.likelyDuration, 20);
  });

  it("original drives both even when remaining is zero", () => {
    const result = resolveDeliverableRevisionDurations([
      { originalDuration: 15, remainingDuration: 0, actualDuration: 7 },
    ]);
    assert.equal(result.bestDuration, 15);
    assert.equal(result.likelyDuration, 15);
  });
});

describe("resolveLiveDeliverablePlanningDurations", () => {
  it("Best and Likely both use activity best (original), not stale likely", () => {
    const result = resolveLiveDeliverablePlanningDurations([
      { bestDuration: 20, likelyDuration: 12 },
      { bestDuration: 5, likelyDuration: 5 },
    ]);
    assert.equal(result?.bestDuration, 20);
    assert.equal(result?.likelyDuration, 20);
  });
});
