/** Persisted feature toggle — single source of truth for Ask Rana availability. */
export const ASK_RANA_FEATURE_STORAGE_KEY = "rana4-feature-ask-rana-enabled";

/** Default ON so existing behaviour is unchanged until explicitly disabled. */
export function readStoredAskRanaEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const value = window.localStorage.getItem(ASK_RANA_FEATURE_STORAGE_KEY);
  if (value === null) return true;
  return value === "true";
}

export function writeStoredAskRanaEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ASK_RANA_FEATURE_STORAGE_KEY, enabled ? "true" : "false");
}

/** Whether Ask Rana is enabled for this browser session (reads persisted preference). */
export function isAskRanaEnabled(): boolean {
  return readStoredAskRanaEnabled();
}
