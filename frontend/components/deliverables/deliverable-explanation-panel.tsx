"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EXPLANATION_TYPE_LABELS,
  EXPLANATION_TYPES,
  getApiErrorMessage,
  intelligenceApi,
  type DeliverableExplanationResult,
  type DeliverableExplanationValidationResult,
  type ExplanationReadiness,
  type ExplanationType,
} from "@/lib/api";

type Props = {
  projectId: string;
  deliverableId: string;
  enabled?: boolean;
};

const READINESS_COPY: Record<
  ExplanationReadiness,
  { title: string; description: string; tone: "ready" | "limited" | "blocked" }
> = {
  READY: {
    title: "Ready to Explain",
    description: "Historical evidence is sufficient. Explanation quality is expected to be high.",
    tone: "ready",
  },
  LIMITED: {
    title: "Limited Evidence",
    description: "Explanation available with reduced confidence.",
    tone: "limited",
  },
  NOT_READY: {
    title: "Insufficient Evidence",
    description:
      "Explanation unavailable. Not enough historical information has been imported for Rana4 to provide a reliable explanation.",
    tone: "blocked",
  },
};

function ReadinessBanner({ validation }: { validation: DeliverableExplanationValidationResult["validation"] }) {
  const copy = READINESS_COPY[validation.readiness];
  const Icon =
    validation.readiness === "READY"
      ? CheckCircle2
      : validation.readiness === "LIMITED"
        ? AlertTriangle
        : ShieldAlert;

  const toneClasses =
    copy.tone === "ready"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
      : copy.tone === "limited"
        ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
        : "border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-200";

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${toneClasses}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <div className="font-medium">{copy.title}</div>
          <p className="text-xs opacity-90">{copy.description}</p>
          {validation.issues.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-xs opacity-90">
              {validation.issues.slice(0, 6).map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function DeliverableExplanationPanel({ projectId, deliverableId, enabled = true }: Props) {
  const [open, setOpen] = useState(false);
  const [explanationType, setExplanationType] = useState<ExplanationType>("DELIVERABLE_SUMMARY");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validation, setValidation] = useState<DeliverableExplanationValidationResult | null>(null);
  const [result, setResult] = useState<DeliverableExplanationResult | null>(null);

  useEffect(() => {
    if (!enabled || !projectId || !deliverableId) {
      setValidation(null);
      return;
    }

    let cancelled = false;
    setValidating(true);
    setValidationError(null);

    void intelligenceApi
      .validateDeliverableExplanation(projectId, { deliverableId, explanationType })
      .then(({ data }) => {
        if (!cancelled) setValidation(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setValidation(null);
          setValidationError(getApiErrorMessage(err) || "Failed to check explanation readiness");
        }
      })
      .finally(() => {
        if (!cancelled) setValidating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, projectId, deliverableId, explanationType]);

  const readiness = validation?.validation.readiness ?? null;
  const explainDisabled =
    !enabled || loading || validating || readiness === "NOT_READY";

  const requestExplanation = async () => {
    if (explainDisabled || !projectId || !deliverableId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await intelligenceApi.explainDeliverable(projectId, {
        deliverableId,
        explanationType,
        question: question.trim() || null,
      });
      setResult(data);
      setOpen(true);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err) || "Failed to request explanation");
    } finally {
      setLoading(false);
    }
  };

  const showUnavailableNotice =
    result &&
    (result.status === "provider_not_configured" ||
      result.status === "disabled" ||
      result.status === "mock");

  const showProviderError = result?.status === "error";

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-900/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
          <MessageCircle className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          AI Explanation
        </div>
      </div>

      {validating ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking explanation readiness…
        </div>
      ) : null}

      {validationError ? <p className="text-sm text-red-600">{validationError}</p> : null}

      {validation ? <ReadinessBanner validation={validation.validation} /> : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
          Explanation type
          <select
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            value={explanationType}
            onChange={(e) => setExplanationType(e.target.value as ExplanationType)}
            disabled={loading}
          >
            {EXPLANATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {EXPLANATION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
          Optional question
          <input
            type="text"
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            placeholder="Ask a specific question about this deliverable…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={loading || readiness === "NOT_READY"}
          />
        </label>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void requestExplanation()}
        disabled={explainDisabled}
        title={readiness === "NOT_READY" ? "Insufficient evidence for a reliable explanation" : undefined}
      >
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Explain
      </Button>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {open && result ? (
        <div className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
          {result.status === "not_ready" ? (
            <div className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-200">
              {result.message ?? result.explanation}
            </div>
          ) : null}

          {showUnavailableNotice ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              {result.message ??
                "AI explanations are not available in this environment. Please contact your administrator."}
            </div>
          ) : null}

          {showProviderError ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              {result.message ??
                "Unable to generate an explanation right now. Please try again later."}
            </div>
          ) : null}

          {result.validation ? <ReadinessBanner validation={result.validation} /> : null}

          {result.explanation && result.status !== "not_ready" && !showProviderError ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Explanation
              </div>
              <p className="mt-1 text-sm text-slate-800 dark:text-slate-100">{result.explanation}</p>
            </div>
          ) : null}

          {result.question ? (
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Question</div>
              <p className="text-sm">{result.question}</p>
            </div>
          ) : null}

          {result.confidence ? (
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Confidence</div>
              <p className="text-sm font-medium">{result.confidence}</p>
            </div>
          ) : null}

          {result.citations.length > 0 ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Sources
              </div>
              <ul className="mt-1 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                {result.citations.slice(0, 8).map((c) => (
                  <li key={c.id}>
                    <span className="font-medium">{c.label}</span>
                    <span className="text-slate-400"> · {c.layer}</span>
                    {c.confidenceLevel ? <span className="text-slate-400"> · {c.confidenceLevel}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.supportingEvidence.length > 0 ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Supporting evidence
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                {result.supportingEvidence.slice(0, 6).map((e, i) => (
                  <li key={`${e.label}-${i}`}>
                    {e.label}: {e.value}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
