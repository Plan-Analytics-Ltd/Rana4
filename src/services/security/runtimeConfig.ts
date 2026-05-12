import { getApprovalSigningSecret, getAuditSigningSecret, getEncryptionKey, getJwtSecret, validateRequiredSecrets } from "./secrets/index.js";

export type RuntimeSecurityConfig = {
  nodeEnv: "development" | "test" | "production";
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  maxDecryptBatchSize: number;
  approvalPendingExpiresMinutes: number;
  enforceHttps: boolean;
};

function nodeEnv(): RuntimeSecurityConfig["nodeEnv"] {
  const env = process.env.NODE_ENV || "development";
  if (env === "production" || env === "test" || env === "development") return env;
  throw new Error("NODE_ENV must be one of development, test, or production");
}

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return Math.floor(n);
}

function corsOrigins(): string[] {
  return process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
}

export function getRuntimeSecurityConfig(): RuntimeSecurityConfig {
  const env = nodeEnv();
  return {
    nodeEnv: env,
    isProduction: env === "production",
    port: numberEnv("PORT", 3000, 1, 65535),
    corsOrigins: corsOrigins(),
    maxDecryptBatchSize: numberEnv("MAX_DECRYPT_BATCH_SIZE", 50, 1, 250),
    approvalPendingExpiresMinutes: numberEnv("APPROVAL_PENDING_EXPIRES_MINUTES", 1440, 5, 10_080),
    enforceHttps: process.env.ENFORCE_HTTPS === "true" || env === "production",
  };
}

export function validateRuntimeSecurityConfig(): RuntimeSecurityConfig {
  const config = getRuntimeSecurityConfig();
  validateRequiredSecrets();
  getEncryptionKey();
  getApprovalSigningSecret();
  getAuditSigningSecret();
  getJwtSecret();

  if (config.isProduction) {
    if (config.corsOrigins.length === 0) {
      throw new Error("Production requires explicit CORS_ORIGIN");
    }
    if (config.corsOrigins.some((origin) => origin === "*" || origin.startsWith("http://"))) {
      throw new Error("Production CORS_ORIGIN must not use wildcard or plain HTTP");
    }
    if (process.env.DATABASE_URL?.includes("sslmode=disable")) {
      throw new Error("Production DATABASE_URL must not disable SSL");
    }
  }

  return config;
}
