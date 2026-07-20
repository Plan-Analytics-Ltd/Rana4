import test from "node:test";
import assert from "node:assert/strict";
import { buildRevisionDisplayLabel } from "../../dist/services/intelligence/shared/programmeIdentity.service.js";
import { buildPlannerRevisionStoryLabel } from "../../dist/services/intelligence/shared/plannerLanguage.service.js";

test("project creation baseline label uses Baseline story name", () => {
  const story = buildPlannerRevisionStoryLabel({
    snapshotRole: "BASELINE",
    programmeState: "APPROVED_BASELINE",
    liveUpdateIndex: null,
    isLatestLiveUpdate: false,
    totalLiveUpdates: 0,
  });
  assert.equal(story, "Baseline");

  const label = buildRevisionDisplayLabel({
    programmeDisplayName: "Northvale Emergency Care Wing",
    snapshotVersion: 1,
    snapshotRole: "BASELINE",
    fallbackLabel: "Northvale",
  });
  assert.match(label, /Baseline/);
  assert.match(label, /Northvale Emergency Care Wing/);
});

test("first project evolution import uses Update story naming", () => {
  const story = buildPlannerRevisionStoryLabel({
    snapshotRole: "LIVE_IMPORT",
    programmeState: "LIVE_UPDATE",
    liveUpdateIndex: 1,
    isLatestLiveUpdate: true,
    totalLiveUpdates: 1,
  });
  assert.equal(story, "Update 1");
});

test("latest live import keeps numbered update label instead of Latest Update alias", () => {
  const story = buildPlannerRevisionStoryLabel({
    snapshotRole: "LIVE_IMPORT",
    programmeState: "LIVE_UPDATE",
    liveUpdateIndex: 2,
    isLatestLiveUpdate: true,
    totalLiveUpdates: 2,
  });
  assert.equal(story, "Update 2");
});
