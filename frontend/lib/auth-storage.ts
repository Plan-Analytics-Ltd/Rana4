export const AUTH_TOKEN_STORAGE_KEY = "rana4-auth-token";

export function getStoredAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  const t = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  return t && t.trim() !== "" ? t.trim() : null;
}

export function setStoredAuthToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token && token.trim() !== "") localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token.trim());
  else localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}
