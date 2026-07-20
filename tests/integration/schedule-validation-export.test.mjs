import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const frontendDir = path.join(root, "frontend");

test("schedule validation: persisted data + milestone durations", () => {
  const result = spawnSync("npx", ["tsx", path.join(root, "scripts", "schedule-validation-unit.ts")], {
    cwd: frontendDir,
    encoding: "utf8",
    shell: true,
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
  }
  assert.equal(result.status, 0, "schedule-validation-unit.ts should pass");
});
