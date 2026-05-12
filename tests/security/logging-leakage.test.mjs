import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeForLogging } from "../../dist/services/security/logging.js";
import { readRepoFile, withoutComments } from "./test-utils.mjs";

test("sanitizeForLogging redacts nested secrets, headers, payloads, and errors", () => {
  const raw = {
    headers: {
      authorization: "Bearer approval-secret-token",
      cookie: "sid=super-secret",
      "x-approval-token": "approval-token-value",
    },
    nested: {
      payload_enc: Buffer.from("encrypted"),
      decrypted: "plain-business-data",
      stack: "SQL and secret stack",
    },
    message: "DB_ENCRYPTION_KEY=should-not-leak X-Approval-Token: token123",
    error: new Error("approval token leaked in error"),
  };

  const sanitized = JSON.stringify(sanitizeForLogging(raw));
  assert.doesNotMatch(sanitized, /approval-secret-token|super-secret|approval-token-value|plain-business-data|should-not-leak|token123/i);
  assert.match(sanitized, /\[redacted\]/);
});

test("security-sensitive env vars are only read by centralized security modules", async () => {
  const files = [
    "src/services/encryption/index.ts",
    "src/utils/auth.ts",
    "src/services/approvals/approval.service.ts",
    "src/services/audit/immutableAudit.service.ts",
    "src/services/security/secrets/index.ts",
    "src/services/security/runtimeConfig.ts",
  ];

  const sensitive = /process\.env\.(DB_ENCRYPTION_KEY|JWT_SECRET|APPROVAL_SIGNING_SECRET|AUDIT_SIGNING_SECRET|SMTP_PASS|ZEROBOUNCE_API_KEY)/;
  for (const file of files) {
    const content = withoutComments(await readRepoFile(file));
    if (file.startsWith("src/services/security/")) continue;
    assert.doesNotMatch(content, sensitive, `${file} must not read sensitive env vars directly`);
  }
});

test("console redaction is installed before server startup logs can execute", async () => {
  const index = await readRepoFile("src/index.ts");
  assert.ok(index.indexOf("installConsoleRedaction()") < index.indexOf("validateRuntimeSecurityConfig()"));
  assert.ok(index.indexOf("installConsoleRedaction()") < index.indexOf("listenWithFallback"));
});
