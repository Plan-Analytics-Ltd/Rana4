"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  type AppUIMode,
  INTELLIGENCE_DEFAULT_ROUTE,
  PLATFORM_DEFAULT_ROUTE,
  isIntelligenceHubPath,
  isPlatformWorkspacePath,
  readStoredUIMode,
  writeStoredUIMode,
} from "@/lib/intelligence-ui";

type IntelligenceModeContextValue = {
  mode: AppUIMode;
  isIntelligenceMode: boolean;
  setMode: (mode: AppUIMode) => void;
  toggleMode: () => void;
};

const IntelligenceModeContext = createContext<IntelligenceModeContextValue | null>(null);

export function IntelligenceModeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mode, setModeState] = useState<AppUIMode>("platform");

  useEffect(() => {
    if (isIntelligenceHubPath(pathname)) {
      setModeState("intelligence");
      writeStoredUIMode("intelligence");
      return;
    }
    if (isPlatformWorkspacePath(pathname)) {
      setModeState("platform");
      writeStoredUIMode("platform");
      return;
    }
    const stored = readStoredUIMode();
    if (stored) setModeState(stored);
  }, [pathname]);

  const setMode = useCallback(
    (next: AppUIMode) => {
      setModeState(next);
      writeStoredUIMode(next);
      if (next === "intelligence") {
        if (!isIntelligenceHubPath(pathname)) {
          router.push(INTELLIGENCE_DEFAULT_ROUTE);
        }
      } else if (isIntelligenceHubPath(pathname)) {
        router.push(PLATFORM_DEFAULT_ROUTE);
      }
    },
    [pathname, router]
  );

  const toggleMode = useCallback(() => {
    setMode(mode === "intelligence" ? "platform" : "intelligence");
  }, [mode, setMode]);

  const value = useMemo(
    () => ({
      mode,
      isIntelligenceMode: mode === "intelligence",
      setMode,
      toggleMode,
    }),
    [mode, setMode, toggleMode]
  );

  return <IntelligenceModeContext.Provider value={value}>{children}</IntelligenceModeContext.Provider>;
}

export function useIntelligenceMode(): IntelligenceModeContextValue {
  const ctx = useContext(IntelligenceModeContext);
  if (!ctx) {
    throw new Error("useIntelligenceMode must be used within IntelligenceModeProvider");
  }
  return ctx;
}
