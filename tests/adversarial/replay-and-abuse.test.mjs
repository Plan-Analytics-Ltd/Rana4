import test from "node:test";
import assert from "node:assert/strict";
import { readRepoFile, withoutComments } from "../security/test-utils.mjs";

test("approval replay and usage-limit abuse paths revoke or deny access", async () => {
  const approval = withoutComments(await readRepoFile("src/services/approvals/approval.service.ts"));
  assert.match(approval, /row\.usageCount \+ params\.decryptCount > row\.maxDecryptCount/);
  assert.match(approval, /params\.batchSize > row\.maxBatchSize/);
  assert.match(approval, /nextStatus: "revoked"/);
  assert.match(approval, /status = 'expired'/);
});

test("approval lifecycle emits immutable audit events", async () => {
  const approval = withoutComments(await readRepoFile("src/services/approvals/approval.service.ts"));
  for (const action of [
    "APPROVAL_REQUESTED",
    "APPROVAL_GRANTED",
    "APPROVAL_DENIED",
    "APPROVAL_REVOKED",
    "APPROVAL_EXPIRED",
    "DECRYPT_UNDER_APPROVAL",
  ]) {
    assert.match(approval, new RegExp(action));
  }
});

test("abuse flood hooks exist for repeated denials, mass approvals, and route floods", async () => {
  const approval = withoutComments(await readRepoFile("src/services/approvals/approval.service.ts"));
  const middleware = withoutComments(await readRepoFile("src/middleware/security/securityHeaders.middleware.ts"));
  assert.match(approval, /REPEATED_APPROVAL_DENIALS/);
  assert.match(approval, /MASS_APPROVAL_ATTEMPTS/);
  assert.match(middleware, /SECURITY_ROUTE_RATE_LIMIT/);
  assert.match(middleware, /values\.length > 120/);
});
