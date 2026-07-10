"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getApiErrorMessage,
  intelligenceApi,
  type AskRanaConversationTurn,
  type DeliverableIntelligenceAnalysis,
  type DeliverableProjectEvolutionReport,
} from "@/lib/api";
import { buildAskRanaContext, suggestedQuestions } from "@/lib/ask-rana-orchestration";
import type { AskRanaPageContext } from "@/lib/ask-rana-page-context";

export type AskRanaChatTurn = {
  id: string;
  question: string;
  answer: string;
};

type UseAskRanaChatArgs = {
  projectId: string | null;
  pageContext: AskRanaPageContext;
  enabled?: boolean;
  analysis?: DeliverableIntelligenceAnalysis | null;
  evolution?: DeliverableProjectEvolutionReport | null;
  loadDeliverableData?: boolean;
};

export function useAskRanaChat({
  projectId,
  pageContext,
  enabled = true,
  analysis: analysisProp,
  evolution: evolutionProp,
  loadDeliverableData = true,
}: UseAskRanaChatArgs) {
  const deliverableId = pageContext.deliverableId ?? null;
  const [question, setQuestion] = useState("");
  const [dataLoading, setDataLoading] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<DeliverableIntelligenceAnalysis | null>(analysisProp ?? null);
  const [evolution, setEvolution] = useState<DeliverableProjectEvolutionReport | null>(evolutionProp ?? null);
  const [turns, setTurns] = useState<AskRanaChatTurn[]>([]);
  const turnIdRef = useRef(0);
  const lastProjectIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (analysisProp !== undefined) setAnalysis(analysisProp);
  }, [analysisProp]);

  useEffect(() => {
    if (evolutionProp !== undefined) setEvolution(evolutionProp);
  }, [evolutionProp]);

  useEffect(() => {
    if (projectId && lastProjectIdRef.current && lastProjectIdRef.current !== projectId) {
      setTurns([]);
      setQuestion("");
      setError(null);
      turnIdRef.current = 0;
    }
    lastProjectIdRef.current = projectId;
  }, [projectId]);

  const clearConversation = useCallback(() => {
    setTurns([]);
    setQuestion("");
    setError(null);
    turnIdRef.current = 0;
  }, []);

  useEffect(() => {
    if (!enabled || !projectId || !deliverableId || !loadDeliverableData) {
      if (!deliverableId) {
        if (analysisProp === undefined) setAnalysis(null);
        if (evolutionProp === undefined) setEvolution(null);
      }
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
  }, [enabled, projectId, deliverableId, analysisProp, evolutionProp, loadDeliverableData]);

  const orchestrationContext = useMemo(
    () =>
      projectId
        ? buildAskRanaContext({ analysis, evolution, projectId })
        : {
            hasPreviousProjects: false,
            hasEvolution: false,
            revisionCount: 0,
            completedProjectCount: 0,
            workPackageCount: 0,
          },
    [analysis, evolution, projectId]
  );

  const suggestions = useMemo(() => {
    if (pageContext.suggestions.length > 0) return pageContext.suggestions;
    return suggestedQuestions(orchestrationContext);
  }, [pageContext.suggestions, orchestrationContext]);

  const ready =
    enabled &&
    !!projectId &&
    !dataLoading &&
    (deliverableId
      ? orchestrationContext.hasPreviousProjects || orchestrationContext.hasEvolution
      : pageContext.mode === "dashboard" || pageContext.mode === "comparison");

  const submitQuestion = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || answering || !projectId) return;

      setError(null);
      setAnswering(true);
      setLoadingMessage("Rana is gathering evidence…");

      const conversation: AskRanaConversationTurn[] = turns.flatMap((turn) => [
        { role: "planner" as const, content: turn.question },
        { role: "rana" as const, content: turn.answer },
      ]);

      try {
        const { data } = await intelligenceApi.askRana(projectId, {
          deliverableId: deliverableId ?? undefined,
          question: trimmed,
          conversation,
          pageContext: pageContext.mode,
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
    [answering, projectId, deliverableId, turns, pageContext.mode]
  );

  return {
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
    orchestrationContext,
  };
}
