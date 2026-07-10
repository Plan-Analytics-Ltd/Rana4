"use client";

import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AskRanaPanel } from "@/components/ask-rana/ask-rana-panel";
import { useIntelligenceDrawerOffset } from "@/hooks/use-intelligence-drawer-offset";
import { useAskRanaContextPulse } from "@/hooks/use-ask-rana-context-pulse";
import type { useAskRanaChat } from "@/hooks/use-ask-rana-chat";
import type { AskRanaPageContext } from "@/lib/ask-rana-page-context";

type ChatState = ReturnType<typeof useAskRanaChat>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageContext: AskRanaPageContext;
  chat: ChatState;
  intelligenceDrawerOpen: boolean;
};

const SHIFT_TRANSITION = "transform 300ms ease-in-out";

/** Global floating Ask Rana — shifts left when the intelligence drawer is open. */
export function GlobalAskRanaFloating({
  open,
  onOpenChange,
  pageContext,
  chat,
  intelligenceDrawerOpen,
}: Props) {
  const horizontalOffset = useIntelligenceDrawerOffset(intelligenceDrawerOpen);
  const contextKey = `${pageContext.mode}:${pageContext.deliverableId ?? "programme"}`;
  const contextPulse = useAskRanaContextPulse(contextKey);

  const shiftStyle = {
    transform: horizontalOffset > 0 ? `translateX(-${horizontalOffset}px)` : undefined,
    transition: SHIFT_TRANSITION,
  };

  return (
    <div
      data-ask-rana-root
      className="pointer-events-none fixed bottom-6 right-6 z-[60] flex w-[min(100vw-3rem,24rem)] flex-col-reverse items-end gap-4"
      style={shiftStyle}
    >
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn(
          "pointer-events-auto flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-lg",
          "bg-violet-600 text-white hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:ring-offset-2",
          "dark:bg-violet-600 dark:hover:bg-violet-500 dark:focus:ring-offset-slate-900",
          contextPulse && "shadow-[0_0_0_4px_rgba(139,92,246,0.35)]"
        )}
        style={{ transition: "box-shadow 400ms ease-in-out" }}
        aria-label={open ? "Close Ask Rana" : "Open Ask Rana"}
        title="Ask Rana"
      >
        {open ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>

      {open ? (
        <div
          className={cn(
            "pointer-events-auto w-full",
            contextPulse && "[animation:ask-rana-context-glow_1.2s_ease-in-out_1]"
          )}
        >
          <AskRanaPanel open={open} pageContext={pageContext} chat={chat} />
        </div>
      ) : null}
    </div>
  );
}
