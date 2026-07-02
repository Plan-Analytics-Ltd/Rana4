"use client";

import type { LearnedInsight } from "@/lib/api";
import { humanConfidenceLevel } from "@/lib/intelligence-terminology";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  summary: string;
  confidenceLevel: LearnedInsight["confidenceLevel"];
  sampleSize: number;
  className?: string;
};

export function LearningSummaryCard({ title, summary, confidenceLevel, sampleSize, className }: Props) {
  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/50", className)}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
        <span className="rounded bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
          {humanConfidenceLevel(confidenceLevel)}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{summary}</p>
      <p className="mt-2 text-xs text-slate-500">Based on {sampleSize} examples</p>
    </div>
  );
}
