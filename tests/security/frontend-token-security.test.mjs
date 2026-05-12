import test from "node:test";
import assert from "node:assert/strict";
import { readRepoFile, withoutComments } from "./test-utils.mjs";

test("frontend approval token helper is memory-only", async () => {
  const helper = withoutComments(await readRepoFile("frontend/lib/approval-token.ts"));
  assert.match(helper, /let approvalToken: string \| null = null/);
  assert.doesNotMatch(helper, /localStorage|sessionStorage|indexedDB|document\.cookie|location\.search|URLSearchParams/);
});

test("approval token is only transmitted in X-Approval-Token header", async () => {
  const api = withoutComments(await readRepoFile("frontend/lib/api.ts"));
  assert.match(api, /headers\["X-Approval-Token"\]\s*=\s*approvalToken/);
  for (const line of api.split("\n")) {
    assert.doesNotMatch(line, /approvalToken.*encodeURIComponent|encodeURIComponent.*approvalToken|localStorage.*approvalToken|sessionStorage.*approvalToken|params:.*approvalToken/);
  }
});

test("frontend does not persist approval tokens in browser storage", async () => {
  const files = [
    "frontend/lib/api.ts",
    "frontend/lib/approval-token.ts",
    "frontend/lib/auth-storage.ts",
    "frontend/contexts/project-context.tsx",
  ];
  for (const file of files) {
    const content = withoutComments(await readRepoFile(file));
    assert.doesNotMatch(content, /(localStorage|sessionStorage|indexedDB).*approval/i, `${file} must not persist approval tokens`);
  }
});
