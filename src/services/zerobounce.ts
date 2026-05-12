/**
 * ZeroBounce email validation (v2 API).
 * See: https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-validate-emails
 * If ZEROBOUNCE_API_KEY is not set, validation is skipped (returns true) for local dev.
 */
import { getRuntimeSecurityConfig } from "./security/runtimeConfig.js";
import { getOptionalSecret } from "./security/secrets/index.js";

const ZEROBOUNCE_BASE = "https://api.zerobounce.net/v2";

interface ZeroBounceResponse {
  status?: string;
  address?: string;
  sub_status?: string;
  account?: string;
  domain?: string;
  did_you_mean?: string;
  error?: string;
}

export async function validateEmailWithZeroBounce(email: string): Promise<{ valid: boolean; error?: string }> {
  const apiKey = getOptionalSecret("ZEROBOUNCE_API_KEY");
  // In non-production, keep signup smooth and avoid flaky external dependency.
  if (!getRuntimeSecurityConfig().isProduction) {
    return { valid: true };
  }
  if (!apiKey) {
    return { valid: true };
  }

  try {
    const url = `${ZEROBOUNCE_BASE}/validate?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}`;
    const res = await fetch(url);
    const data = (await res.json()) as ZeroBounceResponse;

    if (!res.ok) {
      const errMsg = data.error ?? `ZeroBounce API error (${res.status})`;
      console.error("[ZeroBounce]", errMsg);
      return { valid: false, error: "Email verification is temporarily unavailable. Please try again later." };
    }

    const status = (data.status ?? "").toLowerCase();
    if (status === "valid") {
      return { valid: true };
    }
    return {
      valid: false,
      error: "This email address could not be verified. Please use a different email.",
    };
  } catch (err) {
    console.error("[ZeroBounce] request failed:", err);
    return {
      valid: false,
      error: "Email verification is temporarily unavailable. Please try again later.",
    };
  }
}
