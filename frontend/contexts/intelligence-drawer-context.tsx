"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { IntelligenceInsightDrawer } from "@/components/intelligence/intelligence-insight-drawer";

type DrawerState = {
  projectId: string;
  deliverableId: string;
  deliverableName?: string;
} | null;

type ContextValue = {
  state: DrawerState;
  openInsight: (args: { projectId: string; deliverableId: string; deliverableName?: string }) => void;
  closeInsight: () => void;
};

const IntelligenceDrawerContext = createContext<ContextValue | null>(null);

export function IntelligenceDrawerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DrawerState>(null);

  const openInsight = useCallback(
    (args: { projectId: string; deliverableId: string; deliverableName?: string }) => {
      setState(args);
    },
    []
  );

  const closeInsight = useCallback(() => setState(null), []);

  const value = useMemo(() => ({ state, openInsight, closeInsight }), [state, openInsight, closeInsight]);

  return (
    <IntelligenceDrawerContext.Provider value={value}>
      {children}
      {state ? (
        <IntelligenceInsightDrawer
          open={!!state}
          onOpenChange={(open) => !open && closeInsight()}
          projectId={state.projectId}
          deliverableId={state.deliverableId}
          deliverableName={state.deliverableName}
        />
      ) : null}
    </IntelligenceDrawerContext.Provider>
  );
}

export function useIntelligenceDrawer() {
  const ctx = useContext(IntelligenceDrawerContext);
  if (!ctx) throw new Error("useIntelligenceDrawer must be used within IntelligenceDrawerProvider");
  return ctx;
}

/** Safe hook when provider may be absent */
export function useIntelligenceDrawerOptional() {
  return useContext(IntelligenceDrawerContext);
}
