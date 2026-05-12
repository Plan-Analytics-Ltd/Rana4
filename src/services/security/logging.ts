const SENSITIVE_KEY_PATTERN =
  /(approval.?token|x-approval-token|authorization|cookie|set-cookie|payload_enc|payload|decrypted|plaintext|plain_text|db_encryption_key|jwt_secret|approval_signing_secret|audit_signing_secret|password|secret|token|api.?key|stack|sql|query)/i;

const MAX_STRING_LENGTH = 1000;

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/X-Approval-Token["'\s:=]+[A-Za-z0-9._~+/-]+=*/gi, "X-Approval-Token=[redacted]")
    .replace(/(DB_ENCRYPTION_KEY|JWT_SECRET|APPROVAL_SIGNING_SECRET|AUDIT_SIGNING_SECRET)=([^\s]+)/gi, "$1=[redacted]")
    .slice(0, MAX_STRING_LENGTH);
}

export function sanitizeForLogging(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[redacted:max-depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return "[redacted:binary]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: "[redacted]",
    };
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeForLogging(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeForLogging(nested, depth + 1);
    }
    return out;
  }
  return redactString(String(value));
}

export function sanitizeError(err: unknown): unknown {
  return sanitizeForLogging(err);
}

export function installConsoleRedaction(): void {
  const methods: Array<"log" | "info" | "warn" | "error" | "debug"> = ["log", "info", "warn", "error", "debug"];
  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => original(...args.map((arg) => sanitizeForLogging(arg)));
  }
}
