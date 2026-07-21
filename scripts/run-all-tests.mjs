#!/usr/bin/env node
import { spawnSync } from "child_process";
import { readdirSync } from "fs";
import { join } from "path";

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p);
    else if (name.name.endsWith(".test.mjs")) files.push(p);
  }
}
walk("tests");
files.sort();

// Tests that require an already-running dev server + live DB (documented in their own
// header comments) rather than being self-contained unit/integration tests. They aren't
// code bugs when they fail here — they're an infra/CI gap. Skip them in the general sweep;
// run them manually with `npm run dev` up when you need to exercise this path.
const REQUIRES_RUNNING_SERVER = new Set([join("tests", "integration", "project-member-demotion.test.mjs")]);

let passFiles = 0;
let failFiles = 0;
let skipFiles = 0;
const failures = [];
const hangs = [];

for (const file of files) {
  if (REQUIRES_RUNNING_SERVER.has(file)) {
    skipFiles += 1;
    console.log(`SKIP ${file} (requires a running dev server — run manually with npm run dev)`);
    continue;
  }
  const started = Date.now();
  const r = spawnSync(process.execPath, ["--test", "--test-timeout=120000", file], {
    encoding: "utf8",
    timeout: 180000,
  });
  const elapsed = Date.now() - started;
  const out = `${r.stdout || ""}${r.stderr || ""}`;

  if (r.error?.code === "ETIMEDOUT") {
    hangs.push({ file, elapsed });
    console.log(`HANG ${file} (>${elapsed}ms)`);
    continue;
  }

  const summary = out.match(/ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)(?:[\s\S]*?ℹ skip (\d+))?/);
  if (r.status === 0) {
    passFiles += 1;
    const detail = summary
      ? `pass ${summary[2]}/${summary[1]}${summary[4] ? ` skip ${summary[4]}` : ""}`
      : "ok";
    console.log(`PASS ${file} (${detail}, ${elapsed}ms)`);
  } else {
    failFiles += 1;
    failures.push(file);
    const failLines = out
      .split("\n")
      .filter((l) => l.includes("✖") || l.includes("not ok") || l.includes("AssertionError") || l.includes("ERR_TEST"))
      .slice(0, 8);
    console.log(`FAIL ${file} (${elapsed}ms)`);
    for (const line of failLines) console.log(`  ${line.trim()}`);
  }
}

console.log("\n=== SUMMARY ===");
console.log(`Files passed: ${passFiles}`);
console.log(`Files failed: ${failFiles}`);
console.log(`Files hung: ${hangs.length}`);
if (hangs.length > 0) {
  console.log("Hung files:");
  for (const h of hangs) console.log(`  ${h.file} (${h.elapsed}ms)`);
}
if (failures.length > 0) {
  console.log("Failed files:");
  for (const f of failures) console.log(`  ${f}`);
}
process.exit(failFiles > 0 || hangs.length > 0 ? 1 : 0);
