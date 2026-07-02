"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export const INTELLIGENCE_HELP: Record<string, string> = {
  historicalComparison:
    "Shows how this deliverable compares with similar work on completed projects. Helps you judge whether the planned duration is realistic.",
  likelyOutcome:
    "Estimates what is most likely to happen based on how similar deliverables actually performed in the past.",
  evidenceQuality:
    "How much you can rely on this analysis, based on the volume and consistency of imported project history.",
  recommendations:
    "Items you may wish to review. These are evidence-based prompts — Rana4 does not change your schedule.",
  keyFactors:
    "Patterns from comparable projects that may influence duration. These explain context, not actions to take.",
  observations:
    "What Rana4 noticed when comparing this deliverable with historical evidence.",
  forecastReliability:
    "How often original duration estimates matched what actually happened on previous projects.",
  whatWeLearned:
    "Organisation-wide patterns built from imported completed programmes.",
  scheduleConfidence:
    "A quick read of how well this project's deliverables align with historical evidence.",
  trust:
    "How much you can rely on this analysis, based on the volume and consistency of imported project history.",
};

type Props = {
  topic: keyof typeof INTELLIGENCE_HELP;
  className?: string;
};

export function IntelligenceHelpTooltip({ topic, className }: Props) {
  const text = INTELLIGENCE_HELP[topic];
  return (
    <span className={cn("group relative inline-flex align-middle", className)}>
      <button
        type="button"
        className="rounded-full p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        aria-label="More information"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-56 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-normal normal-case leading-snug text-slate-600 shadow-lg group-hover:block group-focus-within:block dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
      >
        {text}
      </span>
    </span>
  );
}
