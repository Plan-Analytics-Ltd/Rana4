"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { IntelligenceRecommendation } from "@/lib/api";

function severityIcon(severity: IntelligenceRecommendation["severity"]): string {
  if (severity === "HIGH") return "🔴";
  if (severity === "MEDIUM") return "🟡";
  return "🟢";
}

function severityBorder(severity: IntelligenceRecommendation["severity"]): string {
  if (severity === "HIGH") return "border-red-200 dark:border-red-900/50";
  if (severity === "MEDIUM") return "border-amber-200 dark:border-amber-900/50";
  return "border-emerald-200 dark:border-emerald-900/50";
}

function RecommendationCard({ item }: { item: IntelligenceRecommendation }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`rounded-md border px-3 py-2 ${severityBorder(item.severity)}`}>
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden>{severityIcon(item.severity)}</span>
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {item.severity} · confidence {item.confidenceLevel}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{item.recommendation}</p>
        </div>
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        )}
      </button>

      {open ? (
        <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          <p className="text-xs text-slate-600 dark:text-slate-300">{item.summary}</p>
          {item.supportingEvidence.length > 0 ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Supporting evidence
              </div>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {item.supportingEvidence.map((e, i) => (
                  <div key={i} className="contents">
                    <dt className="text-slate-500 dark:text-slate-400">{e.label}</dt>
                    <dd className="font-medium text-slate-800 dark:text-slate-200">{String(e.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Based on {item.evidenceCount} comparable deliverable{item.evidenceCount === 1 ? "" : "s"}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DeliverableRecommendationsSection({
  recommendations,
}: {
  recommendations: IntelligenceRecommendation[];
}) {
  if (recommendations.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        No recommendations for this deliverable yet (insufficient historical evidence).
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Recommendations</div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Evidence-based guidance only — does not modify schedules or prescribe durations.
      </p>
      {recommendations.map((r, i) => (
        <RecommendationCard key={`${r.recommendationType}-${i}`} item={r} />
      ))}
    </div>
  );
}
