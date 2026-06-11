import type { LucideIcon } from "lucide-react";
import { Brain, CalendarRange, Package, Upload } from "lucide-react";

export type AppUIMode = "platform" | "intelligence";

/** Intelligence hub — entering this route always enables intelligence mode. */
export const INTELLIGENCE_HUB_PREFIX = "/app/intelligence";

/** Shared routes: available in both modes; sidebar follows active mode. */
export const INTELLIGENCE_SHARED_PREFIXES = ["/app/schedule", "/app/deliverables", "/app/import"] as const;

export const INTELLIGENCE_NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/app/intelligence", label: "What We've Learned", icon: Brain },
  { href: "/app/schedule", label: "Project History", icon: CalendarRange },
  { href: "/app/deliverables", label: "Deliverable Analysis", icon: Package },
  { href: "/app/import", label: "Import History", icon: Upload },
];

export const INTELLIGENCE_DEFAULT_ROUTE = "/app/intelligence";
export const PLATFORM_DEFAULT_ROUTE = "/app";

const STORAGE_KEY = "rana4-ui-mode";

export function isIntelligenceHubPath(pathname: string): boolean {
  return pathname === INTELLIGENCE_HUB_PREFIX || pathname.startsWith(`${INTELLIGENCE_HUB_PREFIX}/`);
}

export function isSharedIntelligencePath(pathname: string): boolean {
  return INTELLIGENCE_SHARED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function isPlatformWorkspacePath(pathname: string): boolean {
  if (!pathname.startsWith("/app")) return false;
  if (isIntelligenceHubPath(pathname) || isSharedIntelligencePath(pathname)) return false;
  return true;
}

export function readStoredUIMode(): AppUIMode | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "intelligence" || v === "platform" ? v : null;
}

export function writeStoredUIMode(mode: AppUIMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
}
