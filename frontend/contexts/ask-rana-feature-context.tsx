"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ASK_RANA_FEATURE_STORAGE_KEY,
  readStoredAskRanaEnabled,
  writeStoredAskRanaEnabled,
} from "@/lib/ask-rana-feature";

type AskRanaFeatureContextValue = {
  enabled: boolean;
  setAskRanaEnabled: (enabled: boolean) => void;
};

const AskRanaFeatureContext = createContext<AskRanaFeatureContextValue | null>(null);

export function AskRanaFeatureProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(readStoredAskRanaEnabled());

    const onStorage = (event: StorageEvent) => {
      if (event.key === ASK_RANA_FEATURE_STORAGE_KEY || event.key === null) {
        setEnabled(readStoredAskRanaEnabled());
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setAskRanaEnabled = useCallback((next: boolean) => {
    writeStoredAskRanaEnabled(next);
    setEnabled(next);
  }, []);

  const value = useMemo(
    () => ({ enabled, setAskRanaEnabled }),
    [enabled, setAskRanaEnabled]
  );

  return (
    <AskRanaFeatureContext.Provider value={value}>{children}</AskRanaFeatureContext.Provider>
  );
}

export function useAskRanaFeature(): AskRanaFeatureContextValue {
  const ctx = useContext(AskRanaFeatureContext);
  if (!ctx) {
    throw new Error("useAskRanaFeature must be used within AskRanaFeatureProvider");
  }
  return ctx;
}

export function useAskRanaFeatureOptional(): AskRanaFeatureContextValue | null {
  return useContext(AskRanaFeatureContext);
}
