"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Shield } from "lucide-react";
import type { IntelligenceTrustExplanation } from "@/lib/api";
import { cn } from "@/lib/utils";

function trustBandStyles(band: string): string {
  if (band === "HIGH_TRUST") return "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/30";
  if (band === "MODERATE_TRUST") return "border-cyan-200 bg-cyan-50/80 dark:border-cyan-900/40 dark:bg-cyan-950/30";
  if (band === "LIMITED_TRUST") return "border-amber-200 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/30";
  return "border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/40";
}

export function DeliverableTrustSection({ trust }: { trust: IntelligenceTrustExplanation | null }) {
  const [open, setOpen] = useState(false);

  if (!trust) return null;

  return (
    <div className={cn("rounded-lg border p-3", trustBandStyles(trust.trustBand))}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" />
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Evidence quality
            </div>
            <div className="text-base font-semibold text-slate-900 dark:text-white">{trust.trustLabel}</div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Evidence strength: {trust.evidenceStrength.strengthLabel} ·{" "}
              {trust.evidenceStrength.sampleSize} examples across {trust.evidenceStrength.projectCount} project
              {trust.evidenceStrength.projectCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          onClick={() => setOpen((v) => !v)}
        >
          Why am I seeing this?
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      </div>

      {open ? (
        <div className="mt-3 space-y-3 border-t border-slate-200/80 pt-3 dark:border-slate-700/80">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Why am I seeing this?</div>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-slate-700 dark:text-slate-300">
              {trust.whySeeingThis.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md bg-white/60 p-2 text-xs dark:bg-slate-900/40">
              <div className="font-medium text-slate-700 dark:text-slate-200">Knowledge coverage</div>
              <div className="mt-0.5 text-slate-600 dark:text-slate-400">{trust.knowledgeCoverage.coverageLabel}</div>
            </div>
            <div className="rounded-md bg-white/60 p-2 text-xs dark:bg-slate-900/40">
              <div className="font-medium text-slate-700 dark:text-slate-200">Evidence trace</div>
              <div className="mt-0.5 text-slate-600 dark:text-slate-400">
                {trust.recommendationTraceability.traceChain.join(" → ")}
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Intelligence layers</div>
            <ul className="mt-1 space-y-1">
              {trust.recommendationTraceability.sourceLayers.map((layer) => (
                <li
                  key={layer.layer}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-600 dark:text-slate-300"
                >
                  <span className="font-medium text-slate-800 dark:text-slate-200">{layer.layer}</span>
                  <span className="text-slate-500">{layer.status}</span>
                  <span className="w-full text-slate-500">{layer.summary}</span>
                </li>
              ))}
            </ul>
          </div>

          {trust.recommendationTraceability.recommendations.length > 0 ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Recommendation traceability
              </div>
              <ul className="mt-1 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                {trust.recommendationTraceability.recommendations.map((r, i) => (
                  <li key={i}>
                    <span className="font-medium">{r.title}</span>
                    <span className="text-slate-500"> — sourced from {r.sourceLayers.join(", ")}</span>
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
