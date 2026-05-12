import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getApprovalSigningSecret, getAuditSigningSecret, getEncryptionKey } from "./secrets/index.js";
import { prisma } from "../../utils/prisma.js";

function hmac(secret: string, value: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

export async function runSecuritySelfTests(): Promise<void> {
  if (process.env.SECURITY_SELF_TESTS !== "true") return;

  const encryptionKey = getEncryptionKey();
  if (encryptionKey.length < 16) throw new Error("Security self-test failed: encryption key length");

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hmac(getApprovalSigningSecret(), token);
  if (!timingSafeEqual(tokenHash, hmac(getApprovalSigningSecret(), token))) {
    throw new Error("Security self-test failed: approval token HMAC");
  }

  const auditHash = hmac(getAuditSigningSecret(), "audit-self-test");
  if (auditHash.length !== 32) {
    throw new Error("Security self-test failed: audit signing HMAC");
  }

  const rows = await prisma.$queryRaw<{ decrypted: string }[]>(
    Prisma.sql`SELECT pgp_sym_decrypt(pgp_sym_encrypt('self-test'::text, ${encryptionKey}), ${encryptionKey}) AS decrypted`
  );
  if (rows[0]?.decrypted !== "self-test") {
    throw new Error("Security self-test failed: pgcrypto decrypt smoke test");
  }

  await prisma.$queryRaw<{ hash: string | null; previous_hash: string | null }[]>(
    Prisma.sql`SELECT hash, previous_hash FROM private_data.audit_log ORDER BY created_at DESC LIMIT 1`
  ).catch(() => []);
}
