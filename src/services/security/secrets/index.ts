import { createHash } from "node:crypto";

type SecretName = "DB_ENCRYPTION_KEY" | "APPROVAL_SIGNING_SECRET" | "AUDIT_SIGNING_SECRET" | "JWT_SECRET";

const MIN_SECRET_LENGTH: Record<SecretName, number> = {
  DB_ENCRYPTION_KEY: 16,
  APPROVAL_SIGNING_SECRET: 32,
  AUDIT_SIGNING_SECRET: 32,
  JWT_SECRET: 32,
};

function readSecret(name: SecretName): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  if (value.length < MIN_SECRET_LENGTH[name]) {
    throw new Error(`${name} is too short`);
  }
  return value;
}

export function getEncryptionKey(): string {
  return readSecret("DB_ENCRYPTION_KEY");
}

export function getApprovalSigningSecret(): string {
  return readSecret("APPROVAL_SIGNING_SECRET");
}

export function getAuditSigningSecret(): string {
  return readSecret("AUDIT_SIGNING_SECRET");
}

export function getJwtSecret(): string {
  return readSecret("JWT_SECRET");
}

export function secretFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function validateRequiredSecrets(): void {
  const secrets = {
    DB_ENCRYPTION_KEY: getEncryptionKey(),
    APPROVAL_SIGNING_SECRET: getApprovalSigningSecret(),
    AUDIT_SIGNING_SECRET: getAuditSigningSecret(),
    JWT_SECRET: getJwtSecret(),
  };
  const fingerprints = new Map<string, string>();

  for (const [name, value] of Object.entries(secrets)) {
    const fingerprint = secretFingerprint(value);
    const previous = fingerprints.get(fingerprint);
    if (previous) {
      throw new Error(`${name} must not reuse ${previous}`);
    }
    fingerprints.set(fingerprint, name);
  }
}

export function getOptionalSecret(name: "SMTP_PASS" | "ZEROBOUNCE_API_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}
