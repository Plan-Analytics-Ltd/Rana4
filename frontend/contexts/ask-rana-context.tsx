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
import { useIntelligenceDrawerOptional } from "@/contexts/intelligence-drawer-context";
import { useAskRanaChat } from "@/hooks/use-ask-rana-chat";

type DeliverableFocus = {
  deliverableId: string;
  deliverableName?: string;
} | null;

type AskRanaContextValue = {
  open: boolean;
  intelligenceDrawerOpen: boolean;
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
  const drawer = useIntelligenceDrawerOptional();
  const [open, setOpen] = useState(false);
  const [deliverableFocus, setDeliverableFocusState] = useState<DeliverableFocus>(null);

  const intelligenceDrawerOpen = !!drawer?.state;

  const setDeliverableFocus = useCallback((focus: DeliverableFocus) => {
    setDeliverableFocusState(focus);
  }, []);

  // Drawer open → deliverable context; drawer closed → programme-level (unless explicit page focus).
  const activeDeliverableId = intelligenceDrawerOpen
    ? drawer?.state?.deliverableId ?? null
    : deliverableFocus?.deliverableId ?? null;
  const activeDeliverableName = intelligenceDrawerOpen
    ? drawer?.state?.deliverableName ?? null
    : deliverableFocus?.deliverableName ?? null;

  const pageContext = useMemo(
    () =>
      detectAskRanaPageContext({
        pathname: pathname ?? "/app",
        deliverableId: activeDeliverableId,
        deliverableName: activeDeliverableName,
        intelligenceDrawerOpen,
      }),
    [pathname, activeDeliverableId, activeDeliverableName, intelligenceDrawerOpen]
  );

  const chatActive = open || intelligenceDrawerOpen;

  const chat = useAskRanaChat({
    projectId: selectedProjectId,
    pageContext,
    enabled: chatActive,
    loadDeliverableData: !!pageContext.deliverableId && chatActive,
  });

  const openAssistant = useCallback(() => setOpen(true), []);
  const closeAssistant = useCallback(() => setOpen(false), []);
  const toggleAssistant = useCallback(() => setOpen((v) => !v), []);

  const value = useMemo(
    () => ({
      open,
      intelligenceDrawerOpen,
      openAssistant,
      closeAssistant,
      toggleAssistant,
      setDeliverableFocus,
      pageContext,
      chat,
    }),
    [
      open,
      intelligenceDrawerOpen,
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
          intelligenceDrawerOpen={intelligenceDrawerOpen}
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
    if (!ctx || !enabled || !deliverableId || ctx.intelligenceDrawerOpen) return;
    ctx.setDeliverableFocus({ deliverableId, deliverableName });
    return () => ctx.setDeliverableFocus(null);
  }, [ctx, deliverableId, deliverableName, enabled]);
}
