/**
 * Smoke: lock down P6 resource short-name generation.
 *
 * Runs against compiled output to avoid tsx/esbuild platform issues.
 * Run: npm run test:p6-resources
 */

import { buildP6ResourceMap } from "../dist/services/p6ResourceMap.service.js";

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function main() {
  const entries = [
    { resourceType: "IGNORED", resourceName: "Senior - Project Manager", unit: "hr", rate: 152 },
    { resourceType: "IGNORED2", resourceName: "Senior - Project Manager", unit: "hr", rate: 152 },
    { resourceType: "X", resourceName: "Architect", unit: "hr", rate: 100 },
    { resourceType: "Y", resourceName: "Quality Inspector", unit: "hr", rate: 80 },
    { resourceType: "Z", resourceName: "Lead--Engineer (MEP)", unit: "hr", rate: 90 },
  ];

  const a = buildP6ResourceMap(entries);
  const b = buildP6ResourceMap(entries);

  // Determinism: exact same output on repeated runs
  expectEqual(JSON.stringify(a.resources), JSON.stringify(b.resources), "determinism");

  const shorts = a.resources.map((r) => r.rsrc_short_name);
  if (new Set(shorts).size !== shorts.length) {
    throw new Error(`expected unique rsrc_short_name values, got ${JSON.stringify(shorts)}`);
  }

  // Spec examples
  // Sorted by resourceName first, so order will be: Architect, Lead--Engineer (MEP), Quality Inspector, Senior..., Senior...
  expectEqual(a.resources[0]?.rsrc_short_name, "PLARES-1", "first resource short name");
  expectEqual(a.resources[1]?.rsrc_short_name, "PLARES-2", "second resource short name");
  expectEqual(a.resources[2]?.rsrc_short_name, "PLARES-3", "third resource short name");
  expectEqual(a.resources[3]?.rsrc_short_name, "PLARES-4", "fourth resource short name");
  expectEqual(a.resources[4]?.rsrc_short_name, "PLARES-5", "fifth resource short name");

  // Base format constraints
  for (const r of a.resources) {
    if (!/^PLARES-\d+$/.test(r.rsrc_short_name)) {
      throw new Error(`short name must be PLARES-<number>, got ${r.rsrc_short_name}`);
    }
  }

  // ID rules (strict ranges)
  for (let i = 0; i < a.resources.length; i++) {
    const index = i + 1;
    const r = a.resources[i];
    expectEqual(r.rsrc_id, 99999900 + index, `rsrc_id index ${index}`);
    expectEqual(r.rsrc_seq_num, 460000000 + index, `rsrc_seq_num index ${index}`);
    expectEqual(r.rsrc_rate_id, 999900 + index, `rsrc_rate_id index ${index}`);
  }
}

main();

