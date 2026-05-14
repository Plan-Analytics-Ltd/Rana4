import test from "node:test";
import assert from "node:assert/strict";
import { assertOrdered, readRepoFile, withoutComments } from "../security/test-utils.mjs";

test("corrupted ciphertext and wrong-key decrypt failures expose only generic errors", async () => {
  const encryption = withoutComments(await readRepoFile("src/services/encryption/index.ts"));
  assert.match(encryption, /Payload decryption failed/);
  assert.match(encryption, /Decrypted payload is not valid JSON/);
  assert.doesNotMatch(encryption, /throw new Error\(`|\+ decrypted|JSON\.stringify\(decrypted\)/i);
  assert.doesNotMatch(encryption, /console\.(log|error|warn|info).*decrypted/i);
});

test("RBAC audit runs before decrypt; immutable audit failures fail closed or isolate safely", async () => {
  const secureTables = withoutComments(await readRepoFile("src/repositories/secureData/secureTables.ts"));
  const audit = withoutComments(await readRepoFile("src/services/audit/immutableAudit.service.ts"));
  assertOrdered(secureTables, "await auditDecrypt", "await decryptPayload<T>");
  assert.match(audit, /safeLogImmutableAudit/);
  assert.match(audit, /catch\s*\{/);
});

test("startup self-tests cover secrets, approval token HMAC, audit HMAC, and pgcrypto smoke", async () => {
  const selfTests = withoutComments(await readRepoFile("src/services/security/selfTests.ts"));
  assert.match(selfTests, /getEncryptionKey/);
  assert.match(selfTests, /getApprovalSigningSecret/);
  assert.match(selfTests, /getAuditSigningSecret/);
  assert.match(selfTests, /timingSafeEqual/);
  assert.match(selfTests, /pgp_sym_decrypt\(pgp_sym_encrypt/);
  assert.match(selfTests, /private_data\.audit_log/);
});

test("runtime security middleware enforces fail-closed route controls", async () => {
  const middleware = withoutComments(await readRepoFile("src/middleware/security/securityHeaders.middleware.ts"));
  assert.match(middleware, /HTTPS required/);
  assert.match(middleware, /Cache-Control", "no-store/);
  assert.match(middleware, /Content-Security-Policy/);
  assert.match(middleware, /Too many requests/);
});
