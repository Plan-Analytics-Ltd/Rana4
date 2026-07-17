import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  liveActivityBestDurationDays,
  liveActivityLikelyDurationDays,
  rollupLiveDeliverableDurations,
} from "../../dist/services/intelligence/shared/liveProgrammeSync.service.js";

describe("live programme sync durations (RANA planning model)", () => {
  it("Best and Likely both seed from original; remaining does not drive likely", () => {
    const row = {
      activityCode: "A2490",
      originalDurationDays: 30,
      remainingDurationDays: 5,
    };
    assert.equal(liveActivityBestDurationDays(row), 30);
    assert.equal(liveActivityLikelyDurationDays(row), 30);
    const rolled = rollupLiveDeliverableDurations([
      {
        bestDuration: liveActivityBestDurationDays(row),
        likelyDuration: liveActivityLikelyDurationDays(row),
      },
    ]);
    assert.deepEqual(rolled, { bestDuration: 30, likelyDuration: 30 });
  });

  it("rollup takes max of best and max of likely across activities", () => {
    const rolled = rollupLiveDeliverableDurations([
      { bestDuration: 10, likelyDuration: 10 },
      { bestDuration: 5, likelyDuration: 5 },
    ]);
    assert.deepEqual(rolled, { bestDuration: 10, likelyDuration: 10 });
  });

  it("uses original even when remaining is zero", () => {
    const row = {
      activityCode: "A1350",
      originalDurationDays: 15,
      remainingDurationDays: 0,
      actualDurationDays: 7,
    };
    assert.equal(liveActivityBestDurationDays(row), 15);
    assert.equal(liveActivityLikelyDurationDays(row), 15);
  });

  it("falls back to actual then 1 when no original", () => {
    assert.equal(liveActivityLikelyDurationDays({ activityCode: "X", actualDurationDays: 7 }), 7);
    assert.equal(liveActivityLikelyDurationDays({ activityCode: "X" }), 1);
  });
});
