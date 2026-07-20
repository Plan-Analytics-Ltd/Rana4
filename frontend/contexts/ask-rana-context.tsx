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
import { usePathname } from "next/navigation";
import { GlobalAskRanaFloating } from "@/components/ask-rana/global-ask-rana-assistant";
import { detectAskRanaPageContext, type AskRanaPageContext } from "@/lib/ask-rana-page-context";
import { useProject } from "@/contexts/project-context";
import { useAskRanaChat } from "@/hooks/use-ask-rana-chat";

type DeliverableFocus = {
  deliverableId: string;
  deliverableName?: string;
} | null;

type AskRanaContextValue = {
  open: boolean;
  openAssistant: () => void;
  closeAssistant: () => void;
  toggleAssistant: () => void;
  setDeliverableFocus: (focus: DeliverableFocus) => void;
  pageContext: AskRanaPageContext;
  chat: ReturnType<typeof useAskRanaChat>;
};

const AskRanaContext = createContext<AskRanaContextValue | null>(null);

export function AskRanaProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { selectedProjectId } = useProject();
  const [open, setOpen] = useState(false);
  const [deliverableFocus, setDeliverableFocusState] = useState<DeliverableFocus>(null);

  const setDeliverableFocus = useCallback((focus: DeliverableFocus) => {
    setDeliverableFocusState(focus);
  }, []);

  const activeDeliverableId = deliverableFocus?.deliverableId ?? null;
  const activeDeliverableName = deliverableFocus?.deliverableName ?? null;

  const pageContext = useMemo(
    () =>
      detectAskRanaPageContext({
        pathname: pathname ?? "/app",
        deliverableId: activeDeliverableId,
        deliverableName: activeDeliverableName,
      }),
    [pathname, activeDeliverableId, activeDeliverableName]
  );

  const chat = useAskRanaChat({
    projectId: selectedProjectId,
    pageContext,
    enabled: open,
    loadDeliverableData: !!pageContext.deliverableId && open,
  });

  const openAssistant = useCallback(() => setOpen(true), []);
  const closeAssistant = useCallback(() => setOpen(false), []);
  const toggleAssistant = useCallback(() => setOpen((v) => !v), []);

  const value = useMemo(
    () => ({
      open,
      openAssistant,
      closeAssistant,
      toggleAssistant,
      setDeliverableFocus,
      pageContext,
      chat,
    }),
    [
      open,
      openAssistant,
      closeAssistant,
      toggleAssistant,
      setDeliverableFocus,
      pageContext,
      chat,
    ]
  );

  return (
    <AskRanaContext.Provider value={value}>
      {children}
      {selectedProjectId ? (
        <GlobalAskRanaFloating
          open={open}
          onOpenChange={setOpen}
          pageContext={pageContext}
          chat={chat}
        />
      ) : null}
    </AskRanaContext.Provider>
  );
}

export function useAskRana() {
  const ctx = useContext(AskRanaContext);
  if (!ctx) throw new Error("useAskRana must be used within AskRanaProvider");
  return ctx;
}

export function useAskRanaOptional() {
  return useContext(AskRanaContext);
}

/** Register the active deliverable while a panel or page is visible (when drawer is closed). */
export function useRegisterAskRanaDeliverable(args: {
  deliverableId: string;
  deliverableName?: string;
  enabled?: boolean;
}) {
  const ctx = useAskRanaOptional();
  const { deliverableId, deliverableName, enabled = true } = args;

  useEffect(() => {
    if (!ctx || !enabled || !deliverableId) return;
    ctx.setDeliverableFocus({ deliverableId, deliverableName });
    return () => ctx.setDeliverableFocus(null);
  }, [ctx, deliverableId, deliverableName, enabled]);
}
