/**
 * Smoke: lock down P6 resource short-name generation and deterministic ids.
 *
 * Runs against compiled output to avoid tsx/esbuild platform issues.
 * Run: npm run test:p6-resources
 */

import { buildP6ResourceMap } from "../../../dist/services/p6ResourceMap.service.js";

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function main() {
  const scope = "smoke-test-scope";
  const entries = [
    { resourceType: "IGNORED", resourceName: "Senior - Project Manager", rsrcShortName: "PLARES-1", unit: "hr", rate: 152 },
    { resourceType: "IGNORED2", resourceName: "Senior - Project Manager", rsrcShortName: "PLARES-2", unit: "hr", rate: 152 },
    { resourceType: "X", resourceName: "Architect", rsrcShortName: "PLARES-3", unit: "hr", rate: 100 },
    { resourceType: "Y", resourceName: "Quality Inspector", rsrcShortName: "PLARES-4", unit: "hr", rate: 80 },
    { resourceType: "Z", resourceName: "Lead--Engineer (MEP)", rsrcShortName: "PLARES-5", unit: "hr", rate: 90 },
  ];

  const a = buildP6ResourceMap(entries, { deterministicScope: scope });
  const b = buildP6ResourceMap(entries, { deterministicScope: scope });

  // Determinism: exact same output on repeated runs
  expectEqual(JSON.stringify(a.resources), JSON.stringify(b.resources), "determinism");

  const shorts = a.resources.map((r) => r.rsrc_short_name);
  if (new Set(shorts).size !== shorts.length) {
    throw new Error(`expected unique rsrc_short_name values, got ${JSON.stringify(shorts)}`);
  }

  expectEqual(a.resources.length, entries.length, "resource row count");

  // Order follows P6 sort (resource name / type), not spreadsheet row order.
  for (const e of entries) {
    const r = a.resources.find((x) => x.rsrc_short_name === e.rsrcShortName);
    if (!r) {
      throw new Error(`missing resource for short name ${JSON.stringify(e.rsrcShortName)}`);
    }
    expectEqual(r.rsrc_name, e.resourceName, `rsrc_name for ${e.rsrcShortName}`);
  }

  for (const r of a.resources) {
    if (!/^PLARES-\d+$/.test(r.rsrc_short_name)) {
      throw new Error(`short name must be PLARES-<number>, got ${r.rsrc_short_name}`);
    }
    if (r.rsrc_id < 1_266_000_000 || r.rsrc_id >= 1_266_000_000 + 6_000_000) {
      throw new Error(`rsrc_id out of deterministic band: ${r.rsrc_id}`);
    }
  }
}

main();
