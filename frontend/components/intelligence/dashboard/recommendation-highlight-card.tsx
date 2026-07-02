"use client";

import { cn } from "@/lib/utils";

type Props = {
  title: string;
  recommendation: string;
  evidenceCount: number;
  className?: string;
};

export function RecommendationHighlightCard({ title, recommendation, evidenceCount, className }: Props) {
  return (
    <div className={cn("rounded-lg border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900/40 dark:bg-violet-950/20", className)}>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{recommendation}</p>
      <p className="mt-2 text-xs text-slate-500">Supported by {evidenceCount} historical examples</p>
    </div>
  );
}
