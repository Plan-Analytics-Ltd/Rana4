import test from "node:test";
import assert from "node:assert/strict";
import {
  compareSnapshotProgrammeLogic,
  computeRevisionProgrammeIntelligence,
} from "../../dist/services/intelligence/shared/programmeLogicEvolution.service.js";
import {
  resolveCanonicalProgrammeName,
  getRootWbsTitleFromTables,
} from "../../dist/services/intelligence/shared/programmeIdentity.service.js";
import { parseXerTables } from "../../dist/services/intelligence/shared/xerParse.service.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RedactedSitePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../validation/RedactedSite/REDACTED-CODE-Emergency Care Building - REDACTED-SITE - Civils & Structures Programme - Baseline.xer"
);

test("canonical programme name prefers root WBS over generic proj_short_name", () => {
  const content = readFileSync(RedactedSitePath, "utf8");
  const tables = parseXerTables(content);
  const root = getRootWbsTitleFromTables(tables);
  assert.equal(root, "REDACTED-CITY Hospital - Live");
  const name = resolveCanonicalProgrammeName({
    rootWbsName: root,
    projShortName: "Programme_V2.xml-3",
  });
  assert.equal(name, "REDACTED-CITY Hospital - Live");
});

test("detects relationship and lag changes between revisions", () => {
  const codes = new Set(["SUCC1"]);
  const previous = {
    snapshotId: "s1",
    label: "Rev 1",
    activities: [
      { activityCode: "SUCC1", name: "Successor", totalFloat: 18, freeFloat: 10, isCritical: false, finishDate: null },
      { activityCode: "PRED1", name: "Concrete Works", totalFloat: 20, freeFloat: 12, isCritical: false, finishDate: null },
    ],
    relationships: [],
  };
  const current = {
    snapshotId: "s2",
    label: "Rev 2",
    activities: [
      { activityCode: "SUCC1", name: "Successor", totalFloat: 3, freeFloat: 1, isCritical: true, finishDate: null },
      { activityCode: "PRED1", name: "Concrete Works", totalFloat: 20, freeFloat: 12, isCritical: false, finishDate: null },
    ],
    relationships: [
      {
        predecessorActivityCode: "PRED1",
        successorActivityCode: "SUCC1",
        relationshipType: "FS",
        lag: 10,
      },
    ],
  };

  const events = compareSnapshotProgrammeLogic({ previous, current, activityCodes: codes });
  assert.ok(events.some((e) => e.type === "RELATIONSHIP_ADDED"));
  assert.ok(events.some((e) => e.type === "LAG_INTRODUCED"));
  assert.ok(events.some((e) => e.type === "FLOAT_LOST"));
  assert.ok(events.some((e) => e.type === "BECAME_CRITICAL"));
});

test("revision programme intelligence includes logic story when duration unchanged", () => {
  const result = computeRevisionProgrammeIntelligence({
    deliverableActivityCodes: new Set(["A1"]),
    revisions: [
      {
        snapshotId: "s1",
        label: "Rev 1",
        durationDays: 10,
        durationChangeDays: null,
        logicState: {
          snapshotId: "s1",
          label: "Rev 1",
          activities: [
            { activityCode: "A1", name: "Activity", totalFloat: 15, freeFloat: 8, isCritical: false, finishDate: null },
          ],
          relationships: [],
        },
      },
      {
        snapshotId: "s2",
        label: "Rev 2",
        durationDays: 10,
        durationChangeDays: 0,
        logicState: {
          snapshotId: "s2",
          label: "Rev 2",
          activities: [
            { activityCode: "A1", name: "Activity", totalFloat: 2, freeFloat: 0, isCritical: true, finishDate: null },
          ],
          relationships: [
            {
              predecessorActivityCode: "B1",
              successorActivityCode: "A1",
              relationshipType: "FS",
              lag: 10,
            },
          ],
        },
      },
    ],
  });

  const rev2 = result[1];
  assert.ok(rev2);
  assert.ok(rev2.events.length > 0);
  assert.ok(rev2.plannerObservations.some((o) => /unchanged/i.test(o)));
  assert.ok(rev2.plannerObservations.some((o) => /critical|float|relationship|lag/i.test(o)));
});
