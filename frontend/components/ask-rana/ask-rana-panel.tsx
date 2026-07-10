"use client";

import { useEffect, useRef } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";
import type { useAskRanaChat } from "@/hooks/use-ask-rana-chat";
import type { AskRanaPageContext } from "@/lib/ask-rana-page-context";

type ChatState = ReturnType<typeof useAskRanaChat>;

type Props = {
  open: boolean;
  pageContext: AskRanaPageContext;
  chat: ChatState;
};

function RanaAnswerBubble({ answer }: { answer: string }) {
  return (
    <div className="rounded-lg border border-violet-200/80 bg-white px-3 py-2.5 text-sm text-slate-800 dark:border-violet-900/40 dark:bg-slate-900/60 dark:text-slate-100">
      <Markdown content={answer} />
    </div>
  );
}

function welcomeMessage(pageContext: AskRanaPageContext): string {
  if (pageContext.deliverableId && pageContext.deliverableName) {
    return `I'm looking at ${pageContext.deliverableName}. Ask me anything about this work package.`;
  }
  if (pageContext.mode === "dashboard") {
    return "Ask about this programme — Rana uses the intelligence already loaded for this project.";
  }
  if (pageContext.mode === "comparison") {
    return "Ask about what similar completed projects can teach you.";
  }
  return "Ask about what Rana sees in the imported programme evidence.";
}

function notReadyMessage(pageContext: AskRanaPageContext): string {
  if (pageContext.deliverableId) {
    return "Import programme history on this project so Rana can answer questions about this work package.";
  }
  return "Import programme history so Rana has evidence to work with.";
}

export function AskRanaPanel({ open, pageContext, chat }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const {
    question,
    setQuestion,
    turns,
    dataLoading,
    answering,
    loadingMessage,
    error,
    suggestions,
    ready,
    submitQuestion,
    clearConversation,
  } = chat;

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, answering, loadingMessage, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitQuestion(question);
  };

  const contextHint =
    pageContext.deliverableName && pageContext.deliverableId
      ? pageContext.deliverableName
      : pageContext.mode === "comparison"
        ? "Previous project comparison"
        : pageContext.mode === "dashboard"
          ? "Programme overview"
          : null;

  return (
    <div
      className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950"
      role="dialog"
      aria-label="Ask Rana assistant"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Ask Rana</div>
            {contextHint ? (
              <div className="text-xs text-slate-500 dark:text-slate-400">{contextHint}</div>
            ) : null}
          </div>
        </div>
        {turns.length > 0 ? (
          <button
            type="button"
            onClick={clearConversation}
            className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="max-h-[min(24rem,50vh)] flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {turns.length === 0 && !dataLoading ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">{welcomeMessage(pageContext)}</p>
        ) : null}

        {turns.map((turn) => (
          <div key={turn.id} className="space-y-2">
            <div className="flex justify-end">
              <div className="max-w-[90%] rounded-lg bg-violet-600 px-3 py-2 text-sm text-white dark:bg-violet-700">
                {turn.question}
              </div>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[95%] space-y-1">
                <div className="text-xs font-medium text-violet-700 dark:text-violet-300">Rana</div>
                <RanaAnswerBubble answer={turn.answer} />
              </div>
            </div>
          </div>
        ))}

        {dataLoading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading context…
          </p>
        ) : null}

        {answering && loadingMessage ? (
          <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {loadingMessage}
          </p>
        ) : null}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
        {suggestions.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {suggestions.slice(0, 3).map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={!ready || answering}
                onClick={() => void submitQuestion(suggestion)}
                className={cn(
                  "rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 transition",
                  "hover:border-violet-300 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50",
                  "dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                )}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        {error ? <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}

        {!dataLoading && !ready ? (
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{notReadyMessage(pageContext)}</p>
        ) : null}

        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={pageContext.placeholder}
            disabled={answering || dataLoading}
            className="flex-1 bg-white text-sm dark:bg-slate-900"
            aria-label="Ask Rana"
          />
          <Button
            type="submit"
            size="sm"
            disabled={answering || dataLoading || !question.trim()}
            className="shrink-0"
          >
            {answering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
