import test from "node:test";
import assert from "node:assert/strict";
import { readRepoFile, withoutComments } from "../security/test-utils.mjs";

test("middleware ordering cannot be the only decrypt protection", async () => {
  const secureTables = withoutComments(await readRepoFile("src/repositories/secureData/secureTables.ts"));
  assert.match(secureTables, /assertSensitiveAccess/);
  assert.match(secureTables, /auditDecrypt/);
  assert.match(secureTables, /decryptPayload/);
});

test("malformed or spoofed correlation headers are bounded and not authorization inputs", async () => {
  const correlation = withoutComments(await readRepoFile("src/middleware/requestCorrelation.middleware.ts"));
  assert.match(correlation, /slice\(0, 128\)/);
  assert.match(correlation, /x-request-id/);
  assert.match(correlation, /x-trace-id/);
  assert.doesNotMatch(correlation, /role|companyId.*headers|userId.*headers/);
});

test("approval tokens are accepted only from header context, not URLs or query params", async () => {
  const correlation = withoutComments(await readRepoFile("src/middleware/requestCorrelation.middleware.ts"));
  const approvalMiddleware = withoutComments(await readRepoFile("src/middleware/security/sensitiveApproval.middleware.ts"));
  assert.match(correlation, /headers\["x-approval-token"\]/);
  assert.doesNotMatch(correlation, /query|params|url/i);
  assert.doesNotMatch(approvalMiddleware, /req\.query.*approval|req\.params.*approval/i);
});
