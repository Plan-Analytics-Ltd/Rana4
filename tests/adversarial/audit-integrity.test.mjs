import test from "node:test";
import assert from "node:assert/strict";
import { readRepoFile, withoutComments } from "../security/test-utils.mjs";

test("immutable audit migration rejects update, delete, and truncate", async () => {
  const migration = await readRepoFile("prisma/migrations/20260512150000_immutable_secure_audit_log/migration.sql");
  assert.match(migration, /BEFORE UPDATE ON private_data\.audit_log/i);
  assert.match(migration, /BEFORE DELETE ON private_data\.audit_log/i);
  assert.match(migration, /BEFORE TRUNCATE ON private_data\.audit_log/i);
  assert.match(migration, /REVOKE UPDATE, DELETE, TRUNCATE ON private_data\.audit_log FROM PUBLIC/i);
  assert.match(migration, /append-only/i);
});

test("audit rows are append-only through application service", async () => {
  const audit = withoutComments(await readRepoFile("src/services/audit/immutableAudit.service.ts"));
  assert.match(audit, /INSERT INTO private_data\.audit_log/);
  assert.doesNotMatch(audit, /UPDATE private_data\.audit_log|DELETE FROM private_data\.audit_log|TRUNCATE private_data\.audit_log/);
  assert.match(audit, /createHmac\("sha256", getAuditSigningSecret\(\)\)/);
  assert.match(audit, /previous_hash/);
});

test("audit metadata sanitizer rejects plaintext-shaped fields", async () => {
  const audit = withoutComments(await readRepoFile("src/services/audit/immutableAudit.service.ts"));
  assert.match(audit, /payload_enc/);
  assert.match(audit, /decrypted/);
  assert.match(audit, /plaintext/);
  assert.match(audit, /authorization/);
  assert.match(audit, /cookie/);
  assert.match(audit, /stack/);
});
