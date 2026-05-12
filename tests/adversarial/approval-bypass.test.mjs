import test from "node:test";
import assert from "node:assert/strict";
import { assertOrdered, readRepoFile, withoutComments } from "../security/test-utils.mjs";

test("repository decrypt path requires approval before pgcrypto decrypt", async () => {
  const secureTables = withoutComments(await readRepoFile("src/repositories/secureData/secureTables.ts"));
  assertOrdered(secureTables, "await assertApprovalForDecrypt", "await decryptPayload<T>", "approval must execute before single-row decrypt");
  assertOrdered(secureTables, "await assertApprovalForDecrypt", "payload: await decryptPayload<T>", "approval must execute before batch decrypt");
  assert.match(secureTables, /requireSensitiveApproval/);
});

test("decryptPayload is only called from the centralized secure repository", async () => {
  const secureTables = withoutComments(await readRepoFile("src/repositories/secureData/secureTables.ts"));
  const encryption = withoutComments(await readRepoFile("src/services/encryption/index.ts"));
  assert.match(secureTables, /decryptPayload<T>/);
  assert.match(encryption, /export async function decryptPayload/);

  const scanned = [
    "src/repositories/secureData/rateCard.repository.ts",
    "src/repositories/secureData/resource.repository.ts",
    "src/services/rateCard.ts",
    "src/controllers/rateCard.controller.ts",
  ];
  for (const file of scanned) {
    const content = withoutComments(await readRepoFile(file));
    assert.doesNotMatch(content, /decryptPayload\s*</, `${file} must not decrypt outside secureTables`);
  }
});

test("approval tokens are HMAC hashed and constant-time compared", async () => {
  const approval = withoutComments(await readRepoFile("src/services/approvals/approval.service.ts"));
  assert.match(approval, /createHmac\("sha256", getApprovalSigningSecret\(\)\)/);
  assert.match(approval, /timingSafeEqual/);
  assert.doesNotMatch(approval, /createHash\("sha256"\)\.update\(token\)/);
});

test("forged, wrong-scope, and bypassed approval tokens create deny/abuse paths", async () => {
  const approval = withoutComments(await readRepoFile("src/services/approvals/approval.service.ts"));
  assert.match(approval, /APPROVAL_BYPASS_ATTEMPT/);
  assert.match(approval, /EXPIRED_APPROVAL_TOKEN_REUSE/);
  assert.match(approval, /APPROVAL_USAGE_LIMIT_EXCEEDED/);
  assert.match(approval, /requesting_user_id = \$\{params\.scope\.userId\}/);
  assert.match(approval, /company_id = \$\{params\.scope\.companyId\}/);
  assert.match(approval, /resource_category = \$\{params\.scope\.resourceCategory\}/);
});

test("sensitive routes carry approval middleware but repository enforcement remains authoritative", async () => {
  const rateCardRoutes = withoutComments(await readRepoFile("src/routes/rateCard.routes.ts"));
  const exportRoutes = withoutComments(await readRepoFile("src/routes/export.routes.ts"));
  assert.match(rateCardRoutes, /requireSensitiveApproval/);
  assert.match(exportRoutes, /requireSensitiveApproval/);
  assert.match(await readRepoFile("src/repositories/secureData/secureTables.ts"), /requireSensitiveApproval/);
});
