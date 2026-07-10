"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export const INTELLIGENCE_HELP: Record<string, string> = {
  historicalComparison:
    "How this compares with similar work on completed projects. Helps you judge whether the planned duration is realistic.",
  likelyOutcome:
    "What usually happens, based on how similar work actually turned out on previous projects.",
  evidenceQuality:
    "How much project history this is based on. More completed projects means more reliable guidance.",
  recommendations:
    "Things worth checking, based on previous projects. Rana never changes your schedule — these are prompts, not actions.",
  keyFactors:
    "Patterns from similar projects that tend to influence how long this work takes.",
  observations:
    "What Rana noticed when comparing this with previous projects.",
  forecastReliability:
    "How often planned durations matched what actually happened on previous projects.",
  whatWeLearned:
    "Patterns Rana has found across the completed projects you've imported.",
  scheduleConfidence:
    "A quick read of how closely this project lines up with similar completed projects.",
  trust:
    "How much project history this is based on. More completed projects means more reliable guidance.",
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
