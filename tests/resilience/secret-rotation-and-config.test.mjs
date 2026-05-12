import test from "node:test";
import assert from "node:assert/strict";
import { readRepoFile, withoutComments } from "../security/test-utils.mjs";

test("runtime config validates missing, weak, reused, and unsafe production secrets", async () => {
  const secrets = withoutComments(await readRepoFile("src/services/security/secrets/index.ts"));
  const runtime = withoutComments(await readRepoFile("src/services/security/runtimeConfig.ts"));
  assert.match(secrets, /validateRequiredSecrets/);
  assert.match(secrets, /must not reuse/);
  assert.match(secrets, /is too short/);
  assert.match(runtime, /Production requires explicit CORS_ORIGIN/);
  assert.match(runtime, /must not use wildcard or plain HTTP/);
  assert.match(runtime, /must not disable SSL/);
});

test("application installs validation and self-tests before listening", async () => {
  const index = withoutComments(await readRepoFile("src/index.ts"));
  assert.ok(index.indexOf("validateRuntimeSecurityConfig()") < index.indexOf("listenWithFallback"));
  assert.match(index, /runSecuritySelfTests\(\)\s*\.then\(\(\) => listenWithFallback\(basePort\)\)/s);
  assert.match(index, /catch\(\(err\) => \{\s*console\.error\(err\);\s*process\.exit\(1\);/s);
});

test("frontend and backend builds separate public config from runtime secrets", async () => {
  const frontendApi = withoutComments(await readRepoFile("frontend/lib/api.ts"));
  assert.match(frontendApi, /NEXT_PUBLIC_API_URL/);
  assert.doesNotMatch(frontendApi, /DB_ENCRYPTION_KEY|APPROVAL_SIGNING_SECRET|AUDIT_SIGNING_SECRET|JWT_SECRET/);
});
