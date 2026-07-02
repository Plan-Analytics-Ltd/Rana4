"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "violet" | "emerald" | "cyan" | "amber";
};

const toneClasses: Record<NonNullable<Props["tone"]>, string> = {
  default: "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/50",
  violet: "border-violet-200/80 bg-violet-50/50 dark:border-violet-900/40 dark:bg-violet-950/20",
  emerald: "border-emerald-200/80 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20",
  cyan: "border-cyan-200/80 bg-cyan-50/50 dark:border-cyan-900/40 dark:bg-cyan-950/20",
  amber: "border-amber-200/80 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20",
};

export function IntelligenceKpiCard({ label, value, hint, icon: Icon, tone = "default" }: Props) {
  return (
    <div className={cn("rounded-lg border p-4 shadow-sm", toneClasses[tone])}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{value}</p>
          {hint ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className="rounded-md bg-white/80 p-2 dark:bg-slate-800/80">
            <Icon className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
