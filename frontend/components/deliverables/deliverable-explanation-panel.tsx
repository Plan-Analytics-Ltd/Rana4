"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getApiErrorMessage,
  intelligenceApi,
  type AskRanaConversationTurn,
  type DeliverableIntelligenceAnalysis,
  type DeliverableProjectEvolutionReport,
} from "@/lib/api";
import { buildAskRanaContext, suggestedQuestions } from "@/lib/ask-rana-orchestration";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";

type Props = {
  projectId: string;
  deliverableId: string;
  enabled?: boolean;
  analysis?: DeliverableIntelligenceAnalysis | null;
  evolution?: DeliverableProjectEvolutionReport | null;
};

type ChatTurn = {
  id: string;
  question: string;
  answer: string;
};

function RanaAnswerBubble({ answer }: { answer: string }) {
  return (
    <div className="rounded-lg border border-violet-200/80 bg-white px-3 py-2.5 text-sm text-slate-800 dark:border-violet-900/40 dark:bg-slate-900/60 dark:text-slate-100">
      <Markdown content={answer} />
    </div>
  );
}

export function DeliverableExplanationPanel({
  projectId,
  deliverableId,
  enabled = true,
  analysis: analysisProp,
  evolution: evolutionProp,
}: Props) {
  const [question, setQuestion] = useState("");
  const [dataLoading, setDataLoading] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<DeliverableIntelligenceAnalysis | null>(analysisProp ?? null);
  const [evolution, setEvolution] = useState<DeliverableProjectEvolutionReport | null>(evolutionProp ?? null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const turnIdRef = useRef(0);

  useEffect(() => {
    if (analysisProp !== undefined) setAnalysis(analysisProp);
  }, [analysisProp]);

  useEffect(() => {
    if (evolutionProp !== undefined) setEvolution(evolutionProp);
  }, [evolutionProp]);

  useEffect(() => {
    setTurns([]);
    setQuestion("");
    setError(null);
    turnIdRef.current = 0;
  }, [projectId, deliverableId]);

  useEffect(() => {
    if (!enabled || !projectId || !deliverableId) {
      if (analysisProp === undefined) setAnalysis(null);
      if (evolutionProp === undefined) setEvolution(null);
      return;
    }

    let cancelled = false;
    setDataLoading(true);
    setError(null);

    const tasks: Promise<void>[] = [];

    if (analysisProp === undefined) {
      tasks.push(
        intelligenceApi
          .getDeliverableIntelligenceAnalysis(projectId, deliverableId)
          .then(({ data }) => {
            if (!cancelled) setAnalysis(data);
          })
          .catch(() => {
            if (!cancelled) setAnalysis(null);
          })
      );
    }

    if (evolutionProp === undefined) {
      tasks.push(
        intelligenceApi
          .getDeliverableProjectEvolution(projectId, deliverableId)
          .then(({ data }) => {
            if (!cancelled) setEvolution(data);
          })
          .catch(() => {
            if (!cancelled) setEvolution(null);
          })
      );
    }

    void Promise.all(tasks)
      .catch((e: unknown) => {
        if (!cancelled) setError(getApiErrorMessage(e) || "Could not load deliverable intelligence");
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, projectId, deliverableId, analysisProp, evolutionProp]);

  const context = useMemo(
    () => buildAskRanaContext({ analysis, evolution, projectId }),
    [analysis, evolution, projectId]
  );

  const suggestions = useMemo(() => suggestedQuestions(context), [context]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, answering, loadingMessage]);

  const submitQuestion = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || answering || dataLoading) return;

      setError(null);
      setAnswering(true);
      setLoadingMessage("Rana is gathering evidence…");

      const conversation: AskRanaConversationTurn[] = turns.flatMap((turn) => [
        { role: "planner" as const, content: turn.question },
        { role: "rana" as const, content: turn.answer },
      ]);

      try {
        const { data } = await intelligenceApi.askRana(projectId, {
          deliverableId,
          question: trimmed,
          conversation,
        });

        const answer =
          data.answer?.trim() ||
          data.message ||
          "Rana could not produce an answer from the available evidence.";

        turnIdRef.current += 1;
        setTurns((prev) => [
          ...prev,
          { id: `turn-${turnIdRef.current}`, question: trimmed, answer },
        ]);
        setQuestion("");
      } catch (e: unknown) {
        setError(getApiErrorMessage(e) || "Ask Rana request failed");
      } finally {
        setAnswering(false);
        setLoadingMessage(null);
      }
    },
    [answering, dataLoading, projectId, deliverableId, turns]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitQuestion(question);
  };

  const ready = enabled && !dataLoading && (context.hasPreviousProjects || context.hasEvolution);

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-900/30">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <MessageCircle className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          Ask Rana
        </div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          What would you like to know about this deliverable?
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Type your question…"
          disabled={!enabled || dataLoading || answering}
          className="flex-1 bg-white dark:bg-slate-900"
          aria-label="Ask Rana a question about this deliverable"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!enabled || dataLoading || answering || !question.trim()}
          className="shrink-0"
        >
          {answering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          <span className="ml-1.5 hidden sm:inline">Ask Rana</span>
        </Button>
      </form>

      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={!ready || answering}
              onClick={() => void submitQuestion(suggestion)}
              className={cn(
                "rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 transition",
                "hover:border-violet-300 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50",
                "dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40"
              )}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      {dataLoading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading what Rana knows about this deliverable…
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {!dataLoading && !ready ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Import a programme baseline or update on this project, and completed projects elsewhere, so Rana can answer
          questions.
        </p>
      ) : null}

      <div ref={scrollRef} className="max-h-[min(28rem,50vh)] space-y-4 overflow-y-auto pr-1">
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

        {answering && loadingMessage ? (
          <div className="flex justify-start">
            <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {loadingMessage}
            </p>
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
